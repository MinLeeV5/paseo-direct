import { PrivateBridge, type ConnectionStatus } from "./bridge";
import { bounded, DirectError, publicError, type ErrorCode } from "./errors";
import type { DevicePreferences } from "../shared/settings";

export type RoutePhase = "waiting" | "checking" | "routed" | "cooldown" | "paused" | "fallback_unavailable" | "error";
export interface RouteState {
  originServerId: string; originLabel: string; phase: RoutePhase;
  error: ErrorCode | null; nextAttemptAt: number | null;
}
export interface RoutingSnapshot { targets: Record<string, RouteState> }
export type RoutingBridge = Pick<PrivateBridge, "routeHosts" | "subscribeAll" | "status" | "originIsDirect" |
  "readPreferences" | "updatePreferences" | "preferRoute" | "restoreOriginal">;
interface RecordState {
  originServerId: string; failures: number; retryAt: number; fallbackAt: number;
  wasRouted: boolean; pendingFallback: boolean;
}

/** One owner per App, independent of the visible screen and of individual host plugin reloads. */
export class PreferredRoutes {
  private snapshot: RoutingSnapshot = { targets: {} };
  private readonly listeners = new Set<() => void>();
  private readonly leases = new Map<object, boolean>();
  private readonly records = new Map<string, RecordState>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = 0;
  private unsubscribe: (() => void) | null = null;
  private scope: AbortController | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;

  constructor(private readonly bridge: RoutingBridge, private readonly mobile: boolean,
    private readonly now: () => number = Date.now) {}
  getSnapshot = (): RoutingSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private foreground(): boolean { return [...this.leases.values()].some(Boolean); }
  acquire(foreground: boolean): { setForeground(value: boolean): void; dispose(): void } {
    const owner = {};
    const update = () => {
      if (this.foreground()) {
        this.unsubscribe ??= this.bridge.subscribeAll(() => this.refresh());
        this.refresh();
      } else {
        this.scope?.abort();
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.unsubscribe?.(); this.unsubscribe = null;
      }
    };
    this.leases.set(owner, foreground); update();
    return {
      setForeground: (value) => { if (this.leases.has(owner)) { this.leases.set(owner, value); update(); } },
      dispose: () => { this.leases.delete(owner); update(); },
    };
  }
  private publish(serverId: string, state: RouteState | null): void {
    if (JSON.stringify(this.snapshot.targets[serverId] ?? null) === JSON.stringify(state)) return;
    const targets = { ...this.snapshot.targets };
    if (state) targets[serverId] = state; else delete targets[serverId];
    this.snapshot = { targets };
    this.listeners.forEach((listener) => listener());
  }
  private queue(delay: number): void {
    if (!this.foreground()) return;
    const at = this.now() + delay;
    if (this.timer && this.timerAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => { this.timer = null; void this.check(); }, delay);
  }
  refresh = (): void => {
    if (this.running) this.rerun = true;
    else this.queue(100);
  };

  async select(serverId: string, originServerId: string | null): Promise<void> {
    if (originServerId) {
      if (originServerId === serverId) throw new DirectError("identity");
      const status = this.bridge.status(serverId);
      if (!status.routedConnections?.some((c) => c.originServerId === originServerId)) throw new DirectError("route_missing");
      if (!status.originalSaved) throw new DirectError("needs_fallback");
    }
    this.scope?.abort();
    await this.bridge.updatePreferences(serverId, this.mobile, (values) => ({ ...values, preferredOriginServerId: originServerId }));
    this.records.delete(serverId);
    this.publish(serverId, originServerId ? { originServerId,
      originLabel: this.bridge.routeHosts().find((host) => host.serverId === originServerId)?.label ?? originServerId,
      phase: "waiting", error: null, nextAttemptAt: null } : null);
    this.refresh();
  }

  check(): Promise<void> {
    if (this.running) return this.running;
    if (!this.foreground()) return Promise.resolve();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const scope = new AbortController();
    this.scope = scope;
    this.running = this.cycle(scope.signal).finally(() => {
      if (this.scope === scope) this.scope = null;
      this.running = null;
      const immediate = this.rerun; this.rerun = false;
      this.queue(immediate ? 100 : 2000);
    });
    return this.running;
  }
  private async cycle(signal: AbortSignal): Promise<void> {
    const hosts = this.bridge.routeHosts();
    for (const id of Object.keys(this.snapshot.targets)) {
      if (!hosts.some((host) => host.serverId === id)) { this.records.delete(id); this.publish(id, null); }
    }
    let next = 0;
    const worker = async () => {
      while (!signal.aborted && next < hosts.length) {
        const host = hosts[next++];
        try {
          const loaded = await bounded(this.bridge.readPreferences(host.serverId, this.mobile), signal, 4000);
          if (signal.aborted) return;
          const origin = loaded.values.preferredOriginServerId;
          if (loaded.warning || !origin) {
            this.records.delete(host.serverId); this.publish(host.serverId, null); continue;
          }
          const label = hosts.find((row) => row.serverId === origin)?.label ?? origin;
          await this.reconcile(host.serverId, origin, label, loaded.values, signal);
        } catch (error) {
          if (signal.aborted) return;
          const state = this.snapshot.targets[host.serverId];
          if (state) this.publish(host.serverId, { ...state, phase: "error", error: publicError(error) });
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }
  private async reconcile(serverId: string, origin: string, label: string, preferences: DevicePreferences, signal: AbortSignal): Promise<void> {
    let record = this.records.get(serverId);
    if (!record || record.originServerId !== origin) {
      record = { originServerId: origin, failures: 0, retryAt: 0, fallbackAt: 0, wasRouted: false, pendingFallback: false };
      this.records.set(serverId, record);
    }
    const state = (phase: RoutePhase, error: ErrorCode | null = null) => this.publish(serverId, {
      originServerId: origin, originLabel: label, phase, error,
      nextAttemptAt: record.retryAt > this.now() ? record.retryAt : null,
    });
    const routed = (status: ConnectionStatus) => status.type === "routed" && status.originServerId === origin;
    const target = this.bridge.status(serverId);
    const fail = () => {
      record.failures++;
      record.wasRouted = false;
      record.retryAt = this.now() + Math.min(300_000, Math.max(30_000, preferences.intervalSeconds * 1000) * 2 ** Math.min(record.failures - 1, 3));
    };
    const restore = async (): Promise<boolean> => {
      const status = this.bridge.status(serverId);
      if (status.status === "online" && !routed(status)) { record.pendingFallback = false; return true; }
      record.pendingFallback = true;
      if (record.fallbackAt > this.now()) return false;
      record.fallbackAt = this.now() + Math.max(5000, preferences.intervalSeconds * 1000);
      try {
        await this.bridge.restoreOriginal(serverId, origin, signal, preferences.timeoutSeconds * 1000);
        record.pendingFallback = false; return true;
      } catch (error) {
        if (signal.aborted) throw error;
        state("fallback_unavailable", publicError(error)); return false;
      }
    };
    if (record.wasRouted && (!routed(target) || target.status !== "online")) fail();
    let originDirect = false;
    try { originDirect = this.bridge.originIsDirect(origin); }
    catch (error) { if (!(error instanceof DirectError) || error.code !== "host_missing") throw error; }
    const paused = preferences.relayPauseUntil > this.now();
    if (!originDirect || paused) {
      if (record.wasRouted) fail();
      if (routed(target) || record.pendingFallback || target.status !== "online") {
        if (!await restore()) return;
      }
      state(paused ? "paused" : "waiting"); return;
    }
    if (record.retryAt > this.now()) {
      if ((record.pendingFallback || (record.failures > 0 && routed(target))) && !await restore()) return;
      state(record.wasRouted && routed(target) && target.status === "online" ? "routed" : "cooldown"); return;
    }
    state("checking");
    try {
      await this.bridge.preferRoute(origin, serverId, signal, preferences.timeoutSeconds * 1000, async () => {
        const current = await bounded(this.bridge.readPreferences(serverId, this.mobile), signal, 4000);
        if (current.warning || current.values.preferredOriginServerId !== origin || current.values.relayPauseUntil > this.now())
          throw new DirectError("cancelled");
      });
      if (signal.aborted) return;
      record.failures = 0; record.wasRouted = true; record.pendingFallback = false; record.fallbackAt = 0;
      record.retryAt = this.now() + preferences.intervalSeconds * 1000;
      state("routed");
    } catch (error) {
      if (signal.aborted) return;
      fail();
      if (!await restore()) return;
      state("cooldown", publicError(error));
    }
  }
}

const KEY = "__paseoDirectPreferredRoutesV1";
export function preferredRoutes(mobile: boolean): PreferredRoutes {
  const previous = Reflect.get(globalThis, KEY) as PreferredRoutes | undefined;
  if (previous && typeof previous.acquire === "function") return previous;
  const policy = new PreferredRoutes(PrivateBridge.fromGlobal(), mobile);
  Reflect.set(globalThis, KEY, policy);
  return policy;
}
