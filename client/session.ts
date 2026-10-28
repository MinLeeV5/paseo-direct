import type { Candidate, Discovery } from "../shared/contracts";
import { defaultDevicePreferences, type DevicePreferences, type ManagedConnection } from "../shared/settings";
import { PrivateBridge, releaseProbe, type ConnectionStatus, type VerifiedProbe } from "./bridge";
import { bounded, DirectError, publicError, type ErrorCode } from "./errors";

export type Phase = "starting" | "ready" | "paused" | "background" | "probing" | "switching" |
  "direct" | "relay" | "paseo" | "cooldown" | "unreachable" | "no_candidates" | "host_disabled" | "unsupported" | "error";
export type EventCode = "direct_online" | "relay_return" | "verified" | "saved" | "relay_requested" |
  "settings_saved" | "address_removed" | "report_sent" | "save_unconfirmed";
export interface ProbeResult { endpoint: string; latencyMs: number | null; error: ErrorCode | null; at?: number }
export interface LogEntry { at: number; message: EventCode; endpoint?: string }
export interface SessionState {
  serverId: string | null; enabled: boolean; foreground: boolean; busy: boolean;
  phase: Phase; stage: string; error: ErrorCode | null; bridgeReady: boolean;
  preferences: DevicePreferences; preferencesReady: boolean; savingPreferences: boolean;
  connection: ConnectionStatus | null; discovery: Discovery | null; results: ProbeResult[]; logs: LogEntry[];
  persisted: boolean; handshakeConfirmed: boolean; lastSavedEndpoint: string | null;
  directActivations: number; relayReturns: number; lastOnlineType: string | null;
  holdDirectUntil: number; lastCheckedAt: number | null; nextCheckAt: number | null;
}
export interface Bridge {
  status(serverId: string): ConnectionStatus;
  subscribe(serverId: string, listener: () => void): () => void;
  probe(serverId: string, candidate: Candidate, signal: AbortSignal, timeoutMs?: number): Promise<VerifiedProbe>;
  save(serverId: string, probe: VerifiedProbe, signal: AbortSignal, activate: boolean): Promise<{ added: boolean }>;
  persisted(serverId: string, endpoint: string, useTls?: boolean): Promise<boolean>;
  activateRelay(serverId: string): Promise<void>;
  readPreferences(serverId: string, mobile: boolean): Promise<{ values: DevicePreferences; warning: "storage" | "preferences_invalid" | null; fresh: boolean }>;
  writePreferences(serverId: string, values: DevicePreferences): Promise<void>;
  updatePreferences(serverId: string, mobile: boolean, change: (values: DevicePreferences) => DevicePreferences): Promise<DevicePreferences>;
  removeManaged(serverId: string, managed: ManagedConnection): Promise<void>;
}
interface Cache { owner: object; state: SessionState; stop: () => void; disposed?: boolean }
const CACHE_KEY = "__paseoDirectSessionsV1";
function cache(): Map<string, Cache> {
  const previous = Reflect.get(globalThis, CACHE_KEY);
  if (previous instanceof Map) return previous;
  const value = new Map<string, Cache>();
  Reflect.set(globalThis, CACHE_KEY, value);
  return value;
}

export class DirectSession {
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  private readonly owner = {};
  private readonly probes = new Set<VerifiedProbe>();
  private disposed = false;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private bridge: Bridge | null = null;
  private initializing: Promise<void> | null = null;
  private failures = 0;
  private resumeRequested = false;

  constructor(private readonly options: {
    mobile: boolean; foreground: boolean; discover: () => Promise<Discovery>;
    bridge?: () => Bridge; now?: () => number; locale?: () => string;
    report?: (state: SessionState) => Promise<void>;
  }) {
    this.state = {
      serverId: null, enabled: options.mobile, foreground: options.foreground, busy: false,
      phase: "starting", stage: "starting", error: null, bridgeReady: false,
      preferences: defaultDevicePreferences(options.mobile), preferencesReady: false, savingPreferences: false,
      connection: null, discovery: null, results: [], logs: [], persisted: false, handshakeConfirmed: false,
      lastSavedEndpoint: null, directActivations: 0, relayReturns: 0, lastOnlineType: null,
      holdDirectUntil: 0, lastCheckedAt: null, nextCheckAt: null,
    };
  }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  locale(): "en" | "zh-CN" {
    const selected = this.state.preferences.language;
    const locale = selected !== "system" ? selected : this.options.locale?.() ?? Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  }
  getSnapshot = (): SessionState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private current(): boolean {
    return !this.disposed && (!this.state.serverId || cache().get(this.state.serverId)?.owner === this.owner);
  }
  private patch(patch: Partial<SessionState>): void {
    if (!this.current()) return;
    this.state = { ...this.state, ...patch };
    if (this.state.serverId) cache().set(this.state.serverId, { owner: this.owner, state: this.state, stop: () => this.dispose() });
    this.listeners.forEach((listener) => listener());
  }
  private phase(phase: Phase): void { this.patch({ phase, stage: phase }); }
  private log(message: EventCode, endpoint?: string): void {
    this.patch({ logs: [{ at: this.now(), message, ...(endpoint ? { endpoint } : {}) }, ...this.state.logs].slice(0, 40) });
  }
  private cancel(): void {
    this.abort?.abort();
    for (const probe of this.probes) void releaseProbe(probe);
    this.clearTimer();
  }
  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.patch({ nextCheckAt: null });
  }
  private schedule(delay = this.state.preferences.intervalSeconds * 1000): void {
    this.clearTimer();
    if (!this.current() || !this.state.foreground || ["unsupported", "version", "identity"].includes(this.state.error ?? "")) return;
    const initialize = !this.bridge || !this.state.preferencesReady;
    if (!initialize && !this.state.enabled) return;
    this.patch({ nextCheckAt: this.now() + delay });
    this.timer = setTimeout(() => {
      this.timer = null;
      if (initialize) void this.start(); else void this.check(false);
    }, delay);
  }
  private valid(scope: AbortController): boolean { return this.current() && !scope.signal.aborted && this.state.foreground; }
  private fail(error: unknown): void {
    const code = publicError(error);
    this.patch({ error: code });
    this.phase(["unsupported", "version"].includes(code) ? "unsupported" : "error");
  }

  start(): Promise<void> {
    if (!this.current()) return Promise.resolve();
    if (this.initializing) return this.initializing;
    this.initializing = this.initialize().finally(() => { this.initializing = null; });
    return this.initializing;
  }
  private async initialize(): Promise<void> {
    this.clearTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
    const scope = new AbortController();
    this.abort = scope;
    this.phase("starting");
    this.patch({ busy: true, error: null });
    try {
      const discovery = await bounded(this.options.discover(), scope.signal, 6000);
      if (!this.current() || scope.signal.aborted) return;
      const prior = cache().get(discovery.serverId);
      if (prior?.owner !== this.owner) prior?.stop();
      const old = prior?.state;
      const foreground = this.state.foreground;
      this.state = { ...this.state, serverId: discovery.serverId, discovery, foreground,
        ...(old ? { results: old.results, logs: old.logs, persisted: old.persisted,
          handshakeConfirmed: old.handshakeConfirmed, lastSavedEndpoint: old.lastSavedEndpoint,
          directActivations: old.directActivations, relayReturns: old.relayReturns,
          lastOnlineType: old.lastOnlineType, holdDirectUntil: old.holdDirectUntil } : {}) };
      cache().set(discovery.serverId, { owner: this.owner, state: this.state, stop: () => this.dispose() });
      for (const [key, entry] of cache()) {
        if (cache().size <= 32) break;
        if (entry.disposed) cache().delete(key);
      }
      this.bridge = (this.options.bridge ?? PrivateBridge.fromGlobal)();
      const loaded = await bounded(this.bridge.readPreferences(discovery.serverId, this.options.mobile), scope.signal, 4000);
      if (!this.current() || scope.signal.aborted) return;
      let preferences = loaded.values;
      if (loaded.fresh) {
        const legacy = Reflect.get(globalThis, "__paseoDirectPrototypeV1") as Map<string, { state?: { enabled?: boolean; holdDirectUntil?: number } }> | undefined;
        const oldState = legacy?.get?.(discovery.serverId)?.state;
        if (typeof oldState?.enabled === "boolean") preferences = { ...preferences, enabled: oldState.enabled,
          relayPauseUntil: Math.max(0, oldState.holdDirectUntil ?? 0) };
        await this.bridge.writePreferences(discovery.serverId, preferences);
      }
      if (!this.current() || scope.signal.aborted) return;
      this.patch({ bridgeReady: true, preferencesReady: true, preferences, enabled: preferences.enabled, error: loaded.warning, busy: false });
      this.unsubscribe = this.bridge.subscribe(discovery.serverId, () => this.observeConnection());
      this.observeConnection();
      this.failures = 0;
      if (loaded.warning) { this.phase("paused"); return; }
      if (this.state.enabled && this.state.foreground) await this.check(false);
      else this.phase(this.state.foreground ? "paused" : "background");
    } catch (error) {
      if (!scope.signal.aborted) {
        this.fail(error);
        this.failures++;
        this.schedule(Math.min(5000 * 2 ** Math.min(this.failures - 1, 3), 60_000));
      }
    } finally {
      if (this.abort === scope) this.abort = null;
      this.patch({ busy: false });
      if (this.current() && this.state.foreground && this.resumeRequested) {
        this.resumeRequested = false;
        this.schedule(0);
      }
    }
  }

  private observeConnection(): void {
    if (!this.bridge || !this.state.serverId || !this.current()) return;
    try {
      const connection = this.bridge.status(this.state.serverId);
      const previous = this.state.lastOnlineType;
      this.patch({ connection });
      if (connection.status !== "online" || !connection.type) return;
      if (previous !== connection.type) {
        if (connection.type === "relay" && previous === "directTcp") {
          this.patch({ relayReturns: this.state.relayReturns + 1,
            holdDirectUntil: Math.max(this.state.holdDirectUntil, this.now() + 30_000) });
          this.log("relay_return");
        } else if (connection.type === "directTcp") {
          this.patch({ directActivations: this.state.directActivations + 1 });
          this.log("direct_online", connection.endpoint ?? undefined);
        }
        this.patch({ lastOnlineType: connection.type });
      }
      if (!this.state.busy && this.state.foreground && !this.state.error &&
        (this.state.enabled || ["direct", "relay", "paseo", "switching", "ready"].includes(this.state.phase))) {
        this.phase(connection.type === "directTcp" ? "direct" : "relay");
      }
    } catch (error) { this.fail(error); }
  }

  setForeground(foreground: boolean): void {
    if (!this.current()) return;
    this.patch({ foreground });
    if (!foreground) { this.cancel(); this.phase("background"); return; }
    this.failures = 0;
    this.resumeRequested = true;
    if (this.state.busy || this.initializing) return;
    this.resumeRequested = false;
    if (!this.bridge || !this.state.preferencesReady) void this.start();
    else if (this.state.enabled) void this.check(false);
    else this.phase("paused");
  }

  async updatePreferences(change: Partial<Omit<DevicePreferences, "version" | "managed">>): Promise<boolean> {
    if (!this.current() || !this.bridge || !this.state.serverId || !this.state.preferencesReady || this.state.savingPreferences) return false;
    if (change.enabled === false) this.cancel();
    this.patch({ savingPreferences: true });
    try {
      const preferences = await this.bridge.updatePreferences(this.state.serverId, this.options.mobile, (values) => ({ ...values, ...change }));
      this.patch({ preferences, enabled: preferences.enabled, error: null });
      this.log("settings_saved");
      this.failures = 0;
      if (!preferences.enabled) { this.cancel(); this.phase("paused"); }
      else if (this.state.foreground) this.schedule(0);
      return true;
    } catch (error) {
      if (change.enabled === false) this.patch({ enabled: false });
      this.fail(error); return false;
    }
    finally { this.patch({ savingPreferences: false }); }
  }
  async setEnabled(enabled: boolean): Promise<void> { await this.updatePreferences({ enabled }); }
  async restorePreferences(): Promise<void> {
    if (!this.current() || !this.bridge || !this.state.serverId) return;
    try {
      const preferences = { ...defaultDevicePreferences(this.options.mobile), managed: this.state.preferences.managed };
      await this.bridge.writePreferences(this.state.serverId, preferences);
      this.patch({ preferences, enabled: preferences.enabled, preferencesReady: true, error: null });
      this.schedule(0);
    } catch (error) { this.fail(error); }
  }

  async refreshDiscovery(): Promise<void> {
    if (!this.current() || !this.state.serverId) return;
    try {
      const discovery = await bounded(this.options.discover(), new AbortController().signal, 6000);
      if (discovery.serverId !== this.state.serverId) throw new DirectError("identity");
      this.patch({ discovery });
    } catch (error) { this.fail(error); }
  }

  async check(manual = true, selectedEndpoint?: string): Promise<void> {
    if (!this.current() || !this.bridge || !this.state.serverId || this.state.busy ||
      !this.state.foreground || (!manual && !this.state.enabled)) return;
    this.clearTimer();
    const holdUntil = Math.max(this.state.holdDirectUntil, this.state.preferences.relayPauseUntil);
    if (!selectedEndpoint && this.now() < holdUntil) {
      this.phase("cooldown"); this.schedule(Math.min(holdUntil - this.now(), this.state.preferences.intervalSeconds * 1000)); return;
    }
    const serverId = this.state.serverId;
    const bridge = this.bridge;
    const scope = new AbortController();
    this.abort = scope;
    this.patch({ busy: true, error: null, lastCheckedAt: this.now() });
    this.phase("probing");
    let winner: VerifiedProbe | null = null;
    let failed = false;
    try {
      const loaded = await bounded(bridge.readPreferences(serverId, this.options.mobile), scope.signal, 4000);
      if (!this.valid(scope)) return;
      if (loaded.warning) {
        this.patch({ preferences: loaded.values, enabled: false });
        throw new DirectError(loaded.warning);
      }
      this.patch({ preferences: loaded.values, enabled: loaded.values.enabled });
      if (!manual && !loaded.values.enabled) { this.phase("paused"); return; }
      const discovery = await bounded(this.options.discover(), scope.signal, 6000);
      if (!this.valid(scope)) return;
      if (discovery.serverId !== serverId) throw new DirectError("identity");
      this.patch({ discovery });
      this.observeConnection();
      if (discovery.enabled === false) { this.phase("host_disabled"); return; }
      const status = bridge.status(serverId);
      if (!selectedEndpoint && status.status === "online" && status.type === "directTcp" && status.endpoint) {
        const persisted = await bridge.persisted(serverId, status.endpoint, status.activeTls ?? undefined);
        this.patch({ persisted, lastSavedEndpoint: status.endpoint });
        this.phase("direct"); this.failures = 0; return;
      }
      if (!status.relaySaved) throw new DirectError("needs_relay");
      const candidates = discovery.candidates.filter((candidate) => selectedEndpoint ? candidate.endpoint === selectedEndpoint :
        !this.state.preferences.excludedEndpoints.includes(candidate.endpoint) &&
        (this.state.preferences.preferDirect || !status.directConnections?.some((saved) =>
          saved.endpoint === candidate.endpoint && saved.useTls === candidate.useTls)));
      if (!candidates.length) { this.phase(!this.state.preferences.preferDirect && !selectedEndpoint ? "paseo" : "no_candidates"); return; }
      let next = 0;
      const worker = async () => {
        while (!winner && next < candidates.length && this.valid(scope)) {
          const candidate = candidates[next++];
          try {
            const probe = await bridge.probe(serverId, candidate, scope.signal, this.state.preferences.timeoutSeconds * 1000);
            this.probes.add(probe);
            this.result({ endpoint: candidate.endpoint, latencyMs: probe.latencyMs, error: null, at: this.now() });
            if (winner || !this.valid(scope)) { await releaseProbe(probe); this.probes.delete(probe); }
            else { winner = probe; this.patch({ handshakeConfirmed: true }); }
          } catch (error) {
            if (this.valid(scope)) this.result({ endpoint: candidate.endpoint, latencyMs: null, error: publicError(error), at: this.now() });
          }
        }
      };
      await Promise.all([worker(), worker()]);
      if (!this.valid(scope)) return;
      if (!winner) { failed = true; this.phase(!this.state.preferences.preferDirect && !selectedEndpoint ? "paseo" : "unreachable"); return; }
      const probe: VerifiedProbe = winner;
      const activate = Boolean(selectedEndpoint) || this.state.preferences.preferDirect;
      this.log("verified", probe.candidate.endpoint);
      this.phase("switching");
      this.patch({ lastSavedEndpoint: probe.candidate.endpoint, persisted: false });
      const saved = await bridge.save(serverId, probe, scope.signal, activate);
      // Finish metadata persistence even if handing over the socket reinstalls the client plugin.
      if (saved.added) {
        const preferences = await bridge.updatePreferences(serverId, this.options.mobile, (values) => ({
          ...values, managed: [...values.managed.filter((item) => item.endpoint !== probe.candidate.endpoint),
            { endpoint: probe.candidate.endpoint, useTls: probe.candidate.useTls, addedAt: this.now() }].slice(-64),
        }));
        this.patch({ preferences, enabled: preferences.enabled });
      }
      if (!this.current()) return;
      const persisted = await bridge.persisted(serverId, probe.candidate.endpoint, probe.candidate.useTls);
      this.patch({ persisted });
      this.log(persisted ? "saved" : "save_unconfirmed", probe.candidate.endpoint);
      this.observeConnection();
      this.phase(this.state.connection?.type === "directTcp" && this.state.connection.status === "online" ? "direct" : "relay");
      this.failures = 0;
    } catch (error) {
      if (!scope.signal.aborted) { failed = true; this.fail(error); }
    } finally {
      const unused = winner as VerifiedProbe | null;
      if (unused) { await releaseProbe(unused); this.probes.delete(unused); }
      if (this.abort === scope) this.abort = null;
      this.patch({ busy: false });
      if (failed) this.failures++; else this.failures = 0;
      if (this.current()) {
        const immediate = this.resumeRequested;
        this.resumeRequested = false;
        this.schedule(immediate ? 0 : Math.min(this.state.preferences.intervalSeconds * 1000 * 2 ** Math.min(this.failures, 2), 60_000));
      }
    }
  }
  private result(result: ProbeResult): void {
    this.patch({ results: [result, ...this.state.results.filter((item) => item.endpoint !== result.endpoint)].slice(0, 32) });
  }

  async useRelay(): Promise<void> {
    if (!this.current() || !this.bridge || !this.state.serverId || this.state.savingPreferences) return;
    this.cancel();
    try {
      const preferences = await this.bridge.updatePreferences(this.state.serverId, this.options.mobile,
        (values) => ({ ...values, relayPauseUntil: this.now() + 60_000 }));
      this.patch({ preferences, enabled: preferences.enabled, error: null });
      this.phase("switching");
      this.log("relay_requested");
      await this.bridge.activateRelay(this.state.serverId);
      this.observeConnection();
      this.phase("cooldown");
      this.schedule();
    } catch (error) { this.fail(error); this.schedule(); }
  }
  async resumeDirect(): Promise<void> {
    this.patch({ holdDirectUntil: 0 });
    if (await this.updatePreferences({ relayPauseUntil: 0 })) await this.check();
  }
  async removeAddress(endpoint: string): Promise<void> {
    if (!this.current() || !this.bridge || !this.state.serverId || this.state.busy || this.state.savingPreferences) return;
    const managed = this.state.preferences.managed.find((item) => item.endpoint === endpoint);
    if (!managed) { this.fail(new DirectError("not_managed")); return; }
    this.cancel();
    this.patch({ busy: true });
    try {
      await this.bridge.removeManaged(this.state.serverId, managed);
      const preferences = await this.bridge.updatePreferences(this.state.serverId, this.options.mobile,
        (values) => ({ ...values, managed: values.managed.filter((item) => item.endpoint !== endpoint),
          excludedEndpoints: [...values.excludedEndpoints.filter((item) => item !== endpoint), endpoint].slice(-64) }));
      this.patch({ preferences, error: null,
        ...(this.state.lastSavedEndpoint === endpoint ? { persisted: false, lastSavedEndpoint: null } : {}) });
      this.observeConnection(); this.log("address_removed", endpoint);
    } catch (error) { this.fail(error); }
    finally { this.patch({ busy: false }); this.schedule(); }
  }
  async sendReport(manual = true): Promise<void> {
    if (!manual || !this.current() || !this.state.serverId || !this.options.report) return;
    try { await this.options.report(this.state); this.log("report_sent"); }
    catch { this.fail(new DirectError("discovery")); }
  }
  resetEvidence(): void {
    this.patch({ results: [], logs: [], directActivations: 0, relayReturns: 0, handshakeConfirmed: false,
      lastOnlineType: this.state.connection?.type ?? null });
  }
  dispose(): void {
    this.disposed = true;
    this.abort?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    for (const probe of this.probes) void releaseProbe(probe);
    this.probes.clear(); this.listeners.clear();
    const saved = this.state.serverId ? cache().get(this.state.serverId) : null;
    if (saved?.owner === this.owner) cache().set(this.state.serverId!, { ...saved, stop: () => {}, disposed: true });
  }
}
