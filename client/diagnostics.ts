import type { RuntimeDiagnostic } from "../shared/contracts";

interface ClientState { status: string; reason?: string }
export interface DiagnosticClient {
  getConnectionState(): ClientState;
  getLastLivenessRttMs?(): number | null;
  subscribeConnectionStatus?(listener: (state: ClientState) => void): () => void;
  subscribeRawMessages?(listener: (message: { type?: unknown }) => void): () => void;
}
export interface DiagnosticRuntime {
  getHosts(): { serverId: string; connections: { id: string; type: string; originServerId?: string }[] }[];
  getSnapshot(serverId: string): {
    activeConnectionId: string | null; connectionStatus: string; client: DiagnosticClient | null;
    clientGeneration?: number; connectionEpoch?: number;
  } | null;
  subscribeAll?(listener: () => void): () => void;
  createViewedTimelineOwner?: unknown;
}
type HostSample = RuntimeDiagnostic["hosts"][number];
type DiagnosticEvent = RuntimeDiagnostic["events"][number];
type ForegroundSource = NonNullable<DiagnosticEvent["source"]>;
export interface DiagnosticLease {
  setForeground(value: boolean, source?: ForegroundSource): void;
  snapshot(): RuntimeDiagnostic;
  dispose(): void;
}
interface Clock {
  now(): number; monotonic(): number;
  setTimer(callback: () => void): unknown; clearTimer(timer: unknown): void;
}
interface Entry {
  sample: HostSample; client: DiagnosticClient | null; cleanups: (() => void)[];
  runtimeSignature: string; clientSignature: string;
}
const clientStatuses = ["connected", "connecting", "disconnected", "disposed"] as const;
const runtimeStatuses = ["online", "offline", "connecting", "error"] as const;
const transports = ["directTcp", "directSocket", "directPipe", "remoteSsh", "relay", "routed"] as const;
const fileMessages = new Set(["file_explorer_response", "fs.file.subscribe.response", "fs.file.update"]);
const subscriptionMessages = new Set(["session.events.set_subscription.response", "agent.timeline.set_subscription.response"]);
function known<T extends string>(value: string | undefined, choices: readonly T[]): T | "unknown" {
  return choices.includes(value as T) ? value as T : "unknown";
}
function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
function reasonFrom(state: ClientState): Pick<HostSample, "reason" | "closeCode"> {
  const text = typeof state.reason === "string" ? state.reason.toLowerCase() : "";
  const match = /(?:code|clos(?:e|ed))\D{0,12}([1-4]\d{3})\b/.exec(text);
  const closeCode = match ? Number(match[1]) : null;
  if (!text) return { reason: state.status === "disposed" ? "disposed" : null, closeCode };
  const reason = text.includes("liveness") ? "liveness_timeout" : /timed? out|timeout/.test(text) ? "timeout" :
    text.includes("client closed") ? "disposed" : /password|authentication|unauthorized/.test(text) ? "authentication" :
    /protocol|frame|decode|parse/.test(text) ? "protocol" : /connection reset|econnreset/.test(text) ? "connection_reset" :
    /network|socket|broken pipe|econn|transport error/.test(text) ? "network" :
    /closed|transport close/.test(text) ? "transport_closed" : "other";
  return { reason, closeCode };
}
function cleanup(callback: (() => void) | undefined): void { try { callback?.(); } catch { /* Observation must not affect native ownership. */ } }

/** Passive, bounded metadata. No socket ownership, requests, message bodies, or arbitrary error text. */
export class RuntimeDiagnostics {
  private readonly clock: Clock;
  private readonly startedAt: number;
  private readonly leases = new Map<object, boolean>();
  private readonly entries = new Map<string, Entry>();
  private readonly ordinals = new WeakMap<DiagnosticClient, number>();
  private ordinal = 0;
  private events: DiagnosticEvent[] = [];
  private unsubscribe: (() => void) | null = null;
  private timer: unknown = null;
  private lastTick = 0;
  private refreshing = false;
  private clientStates = false;
  private rawMessageTimes = false;

  constructor(private readonly runtime: DiagnosticRuntime, clock: Partial<Clock> = {}) {
    this.clock = {
      now: Date.now, monotonic: () => typeof performance === "undefined" ? Date.now() : performance.now(),
      setTimer: callback => { const timer = setTimeout(callback, 1000); timer.unref?.(); return timer; },
      clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>), ...clock,
    };
    this.startedAt = this.clock.now();
  }
  private foreground(): boolean { return [...this.leases.values()].some(Boolean); }
  private record(event: Omit<DiagnosticEvent, "at">): void {
    this.events.push({ at: this.clock.now(), ...event });
    if (this.events.length > 120) this.events.shift();
  }
  acquire(foreground: boolean): DiagnosticLease {
    const owner = {};
    this.leases.set(owner, foreground);
    if (this.leases.size === 1 && typeof this.runtime.subscribeAll === "function") {
      this.unsubscribe = this.runtime.subscribeAll(() => this.refresh());
    }
    this.record({ kind: "foreground", foreground, source: "initial" });
    this.refresh(); this.updateTimer();
    return {
      setForeground: (value, source = "app_state") => {
        if (!this.leases.has(owner)) return;
        this.leases.set(owner, value); this.record({ kind: "foreground", foreground: value, source }); this.updateTimer();
      },
      snapshot: () => this.snapshot(),
      dispose: () => {
        if (!this.leases.delete(owner)) return;
        this.updateTimer();
        if (this.leases.size) return;
        cleanup(this.unsubscribe ?? undefined); this.unsubscribe = null;
        for (const entry of this.entries.values()) this.detach(entry);
      },
    };
  }
  private updateTimer(): void {
    if (!this.foreground()) {
      if (this.timer !== null) this.clock.clearTimer(this.timer);
      this.timer = null; return;
    }
    if (this.timer !== null) return;
    this.lastTick = this.clock.monotonic();
    const tick = () => {
      this.timer = null;
      if (!this.foreground()) return;
      const elapsed = this.clock.monotonic() - this.lastTick;
      if (Number.isFinite(elapsed) && elapsed > 2500) this.record({ kind: "event_loop_gap", delayMs: Math.round(elapsed - 1000) });
      this.updateTimer();
    };
    this.timer = this.clock.setTimer(tick);
  }
  private detach(entry: Entry): void {
    for (const dispose of entry.cleanups) cleanup(dispose);
    entry.cleanups = []; entry.client = null; entry.clientSignature = "";
  }
  private clientState(serverId: string, entry: Entry, state: ClientState): void {
    const clientStatus = known(state.status, clientStatuses), reason = reasonFrom(state);
    Object.assign(entry.sample, { clientStatus, ...reason });
    const signature = JSON.stringify([entry.sample.clientOrdinal, clientStatus, reason]);
    if (signature === entry.clientSignature) return;
    entry.clientSignature = signature;
    this.record({ kind: "client", serverId, clientOrdinal: entry.sample.clientOrdinal ?? undefined, clientStatus,
      ...(reason.reason ? { reason: reason.reason } : {}), ...(reason.closeCode ? { closeCode: reason.closeCode } : {}) });
  }
  private attach(serverId: string, entry: Entry, client: DiagnosticClient | null): void {
    this.detach(entry); entry.client = client;
    entry.sample.lastMessageAt = null;
    if (!client) { entry.sample.clientOrdinal = null; entry.sample.clientStatus = "unknown"; return; }
    let ordinal = this.ordinals.get(client);
    if (!ordinal) { ordinal = ++this.ordinal; this.ordinals.set(client, ordinal); }
    entry.sample.clientOrdinal = ordinal;
    this.clientState(serverId, entry, client.getConnectionState());
    if (typeof client.subscribeConnectionStatus === "function") {
      this.clientStates = true;
      entry.cleanups.push(client.subscribeConnectionStatus(state => {
        if (entry.client === client) this.clientState(serverId, entry, state);
      }));
    }
    if (typeof client.subscribeRawMessages === "function") {
      this.rawMessageTimes = true;
      entry.cleanups.push(client.subscribeRawMessages(message => {
        if (entry.client !== client) return;
        entry.sample.lastMessageAt = this.clock.now();
        const category = message.type === "agent_stream" || message.type === "fetch_agent_timeline_response" ? "timeline" :
          fileMessages.has(message.type as string) ? "file" : subscriptionMessages.has(message.type as string) ? "subscription" :
            message.type === "hosts.route.closed" ? "routeClosed" : null;
        if (category) entry.sample.messages[category]++;
      }));
    }
  }
  private refresh(): void {
    if (this.refreshing || !this.leases.size) return;
    this.refreshing = true;
    try {
      const hosts = this.runtime.getHosts().slice(0, 32), ids = new Set(hosts.map(host => host.serverId));
      for (const [id, entry] of this.entries) if (!ids.has(id)) { this.detach(entry); this.entries.delete(id); }
      for (const host of hosts) {
        let entry = this.entries.get(host.serverId);
        if (!entry) {
          entry = { client: null, cleanups: [], runtimeSignature: "", clientSignature: "", sample: {
            serverId: host.serverId, clientOrdinal: null, transport: "unknown", originServerId: null,
            runtimeStatus: "unknown", clientStatus: "unknown", generation: null, epoch: null, reason: null, closeCode: null,
            lastMessageAt: null, lastLivenessRttMs: null, messages: { timeline: 0, file: 0, subscription: 0, routeClosed: 0 },
          } };
          this.entries.set(host.serverId, entry);
        }
        const snapshot = this.runtime.getSnapshot(host.serverId), connection = host.connections.find(c => c.id === snapshot?.activeConnectionId);
        const client = snapshot?.client ?? null;
        if (entry.client !== client) this.attach(host.serverId, entry, client);
        const runtimeStatus = known(snapshot?.connectionStatus, runtimeStatuses), transport = known(connection?.type, transports);
        Object.assign(entry.sample, { runtimeStatus, transport, originServerId: connection?.originServerId ?? null,
          generation: finite(snapshot?.clientGeneration), epoch: finite(snapshot?.connectionEpoch),
          lastLivenessRttMs: finite(client?.getLastLivenessRttMs?.()),
        });
        const signature = JSON.stringify([runtimeStatus, transport, entry.sample.clientOrdinal, entry.sample.generation, entry.sample.epoch]);
        if (signature !== entry.runtimeSignature) {
          entry.runtimeSignature = signature;
          this.record({ kind: "runtime", serverId: host.serverId, runtimeStatus, transport,
            clientOrdinal: entry.sample.clientOrdinal ?? undefined });
        }
      }
    } catch { /* Optional diagnostics must not interrupt native runtime notifications. */ }
    finally { this.refreshing = false; }
  }
  private snapshot(): RuntimeDiagnostic {
    this.refresh();
    return {
      version: 1, startedAt: this.startedAt, capturedAt: this.clock.now(), foreground: this.foreground(),
      capabilities: { runtimeSubscriptions: typeof this.runtime.subscribeAll === "function", clientStates: this.clientStates,
        rawMessageTimes: this.rawMessageTimes,
        timelineConnectionSync: Boolean(typeof this.runtime.createViewedTimelineOwner === "function" &&
          Reflect.get(this.runtime.createViewedTimelineOwner as object, Symbol.for("paseo-direct.timeline-connection-sync.v1"))),
      },
      hosts: [...this.entries.values()].map(({ sample }) => ({ ...sample, messages: { ...sample.messages } })),
      events: this.events.map(event => ({ ...event })),
    };
  }
}

const key = Symbol.for("paseo-direct.runtime-diagnostics.v1");
export function runtimeDiagnostics(runtime: DiagnosticRuntime): RuntimeDiagnostics {
  let recorders = Reflect.get(globalThis, key) as WeakMap<DiagnosticRuntime, RuntimeDiagnostics> | undefined;
  if (!recorders) { recorders = new WeakMap(); Reflect.set(globalThis, key, recorders); }
  let recorder = recorders.get(runtime);
  if (!recorder) { recorder = new RuntimeDiagnostics(runtime); recorders.set(runtime, recorder); }
  return recorder;
}
