import type { Candidate } from "../shared/contracts";
import type { DevicePreferences, ManagedConnection } from "../shared/settings";
import { DevicePreferenceStore, type PreferenceStorage } from "./preferences";
import { bounded, DirectError, ensureActive } from "./errors";
import { installTimelineConnectionSync } from "./timeline";

export interface Connection { id: string; type: string; endpoint?: string; useTls?: boolean; originServerId?: string }
export interface Host { serverId: string; label: string; password?: string; connections: Connection[] }
export interface ProbeClient {
  close(): Promise<void>;
  measureLatency(options: { timeoutMs: number }): Promise<number>;
  livenessPing?(options: { timeoutMs: number }): Promise<number>;
  getConnectionState(): { status: string };
  getLastServerInfoMessage(): { serverId: string; version?: string } | null;
  invokePluginRpc?(pluginId: string, method: string, input: unknown): Promise<unknown>;
}
export interface RuntimeSnapshot {
  activeConnectionId: string | null; connectionStatus: string; client: ProbeClient | null;
  probeByConnectionId?: Map<string, { status: string; latencyMs: number | null }>;
}
export interface RuntimeController {
  activateConnection(input: { connectionId: string; existingClient?: ProbeClient }): Promise<void>;
  runProbeCycleNow?(): Promise<void>;
  probeCycleInFlight?: Promise<void> | null;
}
interface HandoffController extends RuntimeController {
  runProbeCycleNow(): Promise<void>;
  probeCycleInFlight: Promise<void> | null;
}
export interface PrivateStore {
  getHosts(): Host[];
  getSnapshot(serverId: string): RuntimeSnapshot | null;
  subscribe(serverId: string, listener: () => void): () => void;
  subscribeAll?(listener: () => void): () => void;
  deps: { connectToDaemon(input: { host: Host; connection: Connection; timeoutMs: number }): Promise<{ client: ProbeClient; serverId: string }> };
  controllers: Map<string, RuntimeController>;
  storage: PreferenceStorage;
  upsertDirectConnection(input: { serverId: string; endpoint: string; useTls: boolean; existingClient?: ProbeClient }): Promise<unknown>;
  removeConnection(serverId: string, connectionId: string): Promise<void>;
}
export interface DirectConnection { id: string; endpoint: string; useTls: boolean }
export interface ConnectionStatus {
  status: string; type: string | null; endpoint: string | null; connectionId: string | null;
  relaySaved: boolean; directSaved: string[];
  directConnections?: DirectConnection[]; activeTls?: boolean | null; daemonVersion?: string | null;
  originServerId?: string | null; originalSaved?: boolean;
  routedConnections?: { originServerId: string; label: string }[];
}
interface VerifiedTransport {
  latencyMs: number; client: ProbeClient;
  adopted: boolean; handingOff?: boolean; closed?: boolean;
}
export interface VerifiedProbe extends VerifiedTransport { candidate: Candidate }
export function connectionId(candidate: Candidate): string { return "direct:" + candidate.endpoint; }
export async function releaseProbe(probe: VerifiedTransport): Promise<void> {
  if (probe.adopted || probe.handingOff || probe.closed) return;
  probe.closed = true;
  await probe.client.close().catch(() => {});
}

function supportsPaseoVersion(version: string): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
  if (!match) return false;
  const [, major, minor, patch, prerelease] = match;
  return Number(major) > 0 || Number(minor) > 13 ||
    (Number(minor) === 13 && (Number(patch) > 0 || !prerelease));
}

/** The only module that accesses Paseo's private App connection owner. */
export class PrivateBridge {
  private readonly preferences = new Map<string, DevicePreferenceStore>();
  constructor(private readonly store: PrivateStore) {
    if (!store || typeof store.getHosts !== "function" || typeof store.getSnapshot !== "function" ||
      typeof store.subscribe !== "function" || typeof store.upsertDirectConnection !== "function" ||
      typeof store.removeConnection !== "function" || typeof store.deps?.connectToDaemon !== "function" ||
      typeof store.controllers?.get !== "function" || typeof store.storage?.getItem !== "function" ||
      typeof store.storage?.setItem !== "function") throw new DirectError("unsupported");
    installTimelineConnectionSync(store);
  }
  static fromGlobal(): PrivateBridge {
    return new PrivateBridge(Reflect.get(globalThis, "__paseoHostRuntimeStore") as PrivateStore);
  }
  private host(serverId: string): Host {
    const host = this.store.getHosts().find((value) => value.serverId === serverId);
    if (!host) throw new DirectError("host_missing");
    const info = this.store.getSnapshot(serverId)?.client?.getLastServerInfoMessage();
    if (info && info.serverId !== serverId) throw new DirectError("identity");
    if (info?.version && !supportsPaseoVersion(info.version)) throw new DirectError("version");
    return host;
  }
  private prefs(serverId: string): DevicePreferenceStore {
    this.host(serverId);
    let value = this.preferences.get(serverId);
    if (!value) { value = new DevicePreferenceStore(this.store.storage, serverId); this.preferences.set(serverId, value); }
    return value;
  }
  private handoffController(serverId: string): HandoffController {
    const controller = this.store.controllers.get(serverId);
    const slot = controller && Object.getOwnPropertyDescriptor(controller, "probeCycleInFlight");
    if (typeof controller?.activateConnection !== "function" || typeof controller.runProbeCycleNow !== "function" ||
      !slot?.writable || (slot.value !== null && typeof slot.value?.then !== "function")) throw new DirectError("unsupported");
    return controller as HandoffController;
  }
  readPreferences(serverId: string, mobile: boolean) { return this.prefs(serverId).read(mobile); }
  writePreferences(serverId: string, values: DevicePreferences): Promise<void> { return this.prefs(serverId).write(values); }
  updatePreferences(serverId: string, mobile: boolean, change: (values: DevicePreferences) => DevicePreferences): Promise<DevicePreferences> {
    return this.prefs(serverId).update(mobile, change);
  }
  status(serverId: string): ConnectionStatus {
    const host = this.host(serverId);
    const snapshot = this.store.getSnapshot(serverId);
    const active = host.connections.find((c) => c.id === snapshot?.activeConnectionId);
    const directConnections = host.connections.filter((c) => c.type === "directTcp" && c.endpoint).map((c) => ({
      id: c.id, endpoint: c.endpoint!, useTls: c.useTls ?? false,
    }));
    return {
      status: snapshot?.connectionStatus ?? "offline", type: active?.type ?? null,
      endpoint: active?.endpoint ?? null, connectionId: active?.id ?? null,
      relaySaved: host.connections.some((c) => c.type === "relay"), directSaved: directConnections.map((c) => c.endpoint),
      directConnections, activeTls: active?.type === "directTcp" ? active.useTls ?? false : null,
      daemonVersion: snapshot?.client?.getLastServerInfoMessage()?.version ?? null,
      originServerId: active?.originServerId ?? null,
      originalSaved: host.connections.some((c) => c.type !== "routed"),
      routedConnections: host.connections.filter((c) => c.type === "routed" && c.originServerId).map((c) => ({
        originServerId: c.originServerId!,
        label: this.store.getHosts().find((row) => row.serverId === c.originServerId)?.label ?? c.originServerId!,
      })),
    };
  }
  subscribe(serverId: string, listener: () => void): () => void { return this.store.subscribe(serverId, listener); }
  subscribeAll(listener: () => void): () => void {
    return typeof this.store.subscribeAll === "function" ? this.store.subscribeAll(listener) : () => {};
  }
  routeHosts(): { serverId: string; label: string }[] {
    return this.store.getHosts().map(({ serverId, label }) => ({ serverId, label }));
  }

  async invoke(serverId: string, method: string, input: unknown): Promise<unknown> {
    this.host(serverId);
    const snapshot = this.store.getSnapshot(serverId);
    if (snapshot?.connectionStatus !== "online" || !snapshot.client) throw new DirectError("discovery");
    if (typeof snapshot.client.invokePluginRpc !== "function") throw new DirectError("unsupported");
    try { return await snapshot.client.invokePluginRpc("paseo-direct", method, input); }
    catch { throw new DirectError("discovery"); }
  }

  async probe(serverId: string, candidate: Candidate, signal: AbortSignal, timeoutMs = 3000): Promise<VerifiedProbe> {
    ensureActive(signal);
    const host = this.host(serverId);
    if (!host.connections.some((c) => c.type === "relay")) throw new DirectError("needs_relay");
    const existing = host.connections.find((c) => c.type === "directTcp" && c.endpoint === candidate.endpoint);
    if (existing && (existing.useTls ?? false) !== candidate.useTls) throw new DirectError("connection_conflict");
    const verified = await this.verifyConnection(host, {
      id: connectionId(candidate), type: "directTcp", endpoint: candidate.endpoint, useTls: candidate.useTls,
    }, signal, timeoutMs);
    return { ...verified, candidate };
  }

  private async verifyConnection(host: Host, connection: Connection, signal: AbortSignal, timeoutMs: number): Promise<VerifiedTransport> {
    ensureActive(signal);
    let abandoned = false;
    const pending = this.store.deps.connectToDaemon({
      host, connection, timeoutMs,
    });
    // A timed-out/aborted private connector can still resolve later; that socket must be released.
    void pending.then((result) => { if (abandoned) void result.client.close().catch(() => {}); }, () => {});
    let result: Awaited<typeof pending>;
    try { result = await bounded(pending, signal, timeoutMs + 250); }
    catch (error) { abandoned = true; throw error; }
    let closing: Promise<void> | null = null;
    const close = () => closing ??= result.client.close().catch(() => {});
    const abort = () => { void close(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      ensureActive(signal);
      if (typeof result.client.getLastServerInfoMessage !== "function" || typeof result.client.measureLatency !== "function" ||
        typeof result.client.getConnectionState !== "function") throw new DirectError("unsupported");
      if (result.serverId !== host.serverId || result.client.getLastServerInfoMessage()?.serverId !== host.serverId) throw new DirectError("identity");
      const latencyMs = await bounded(result.client.measureLatency({ timeoutMs }), signal, timeoutMs + 250);
      if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new DirectError("unreachable");
      ensureActive(signal);
      if (result.client.getConnectionState().status !== "connected") throw new DirectError("unreachable");
      return { client: result.client, latencyMs, adopted: false };
    } catch (error) { await close(); throw error; }
    finally { signal.removeEventListener("abort", abort); }
  }

  async save(serverId: string, probe: VerifiedProbe, signal: AbortSignal, activate: boolean, timeoutMs = 3000,
    beforeCommit?: () => Promise<void>): Promise<{ added: boolean }> {
    ensureActive(signal);
    if (probe.closed) throw new DirectError("cancelled");
    const host = this.host(serverId);
    if (!host.connections.some((c) => c.type === "relay")) throw new DirectError("needs_relay");
    if (probe.client.getLastServerInfoMessage()?.serverId !== serverId) throw new DirectError("identity");
    if (probe.client.getConnectionState().status !== "connected") throw new DirectError("unreachable");
    const existing = host.connections.find((c) => c.type === "directTcp" && c.endpoint === probe.candidate.endpoint);
    if (existing && (existing.useTls ?? false) !== probe.candidate.useTls) throw new DirectError("connection_conflict");
    if (activate) this.handoffController(serverId);
    probe.handingOff = activate;
    try {
      // upsert starts native probes without awaiting them. Passing the socket here
      // lets an older unavailable result immediately replace the fresh connection.
      await this.store.upsertDirectConnection({ serverId, endpoint: probe.candidate.endpoint, useTls: probe.candidate.useTls });
      if (activate) await this.adoptConnection(serverId, existing ? { ...existing } : {
        id: connectionId(probe.candidate), type: "directTcp", endpoint: probe.candidate.endpoint, useTls: probe.candidate.useTls,
      }, probe, signal, { timeoutMs, beforeCommit });
      return { added: !existing };
    } catch (error) {
      probe.adopted = this.store.getSnapshot(serverId)?.client === probe.client;
      throw error;
    } finally { probe.handingOff = false; }
  }
  async saveAndActivate(serverId: string, probe: VerifiedProbe, signal: AbortSignal): Promise<void> {
    await this.save(serverId, probe, signal, true);
  }
  async persisted(serverId: string, endpoint: string, useTls?: boolean): Promise<boolean> {
    try {
      const raw = await this.store.storage.getItem("@paseo:daemon-registry");
      const rows: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(rows)) throw new DirectError("storage");
      return rows.some((row) => row?.serverId === serverId && Array.isArray(row.connections) && row.connections.some((c: Connection) =>
        c.type === "directTcp" && c.endpoint === endpoint && (useTls === undefined || (c.useTls ?? false) === useTls)));
    } catch { throw new DirectError("storage"); }
  }
  async activateRelay(serverId: string): Promise<void> {
    const relay = this.host(serverId).connections.find((c) => c.type === "relay");
    const controller = this.store.controllers.get(serverId);
    if (!relay || typeof controller?.activateConnection !== "function") throw new DirectError("needs_relay");
    await controller.activateConnection({ connectionId: relay.id });
  }
  async activateForwardedHost(originServerId: string, serverId: string): Promise<void> {
    if (originServerId === serverId) throw new DirectError("identity");
    this.host(originServerId);
    if (this.store.getSnapshot(originServerId)?.connectionStatus !== "online") throw new DirectError("discovery");
    if (!this.store.getHosts().some((host) => host.serverId === serverId)) throw new DirectError("route_missing");
    const host = this.host(serverId);
    const connection = host.connections.find((row) => row.type === "routed" && row.originServerId === originServerId);
    if (!connection) throw new DirectError("route_missing");
    this.handoffController(serverId);
    const current = this.store.getSnapshot(serverId);
    if (current?.activeConnectionId === connection.id && current.connectionStatus === "online" &&
      current.client?.getConnectionState().status === "connected") return;
    const origin = this.store.getSnapshot(originServerId)?.client;
    const guard = () => {
      if (!origin || this.store.getSnapshot(originServerId)?.client !== origin ||
        this.store.getSnapshot(originServerId)?.connectionStatus !== "online" || origin.getConnectionState().status !== "connected")
        throw new DirectError("unreachable");
    };
    guard();
    const signal = new AbortController().signal;
    const verified = await this.verifyConnection(host, { ...connection }, signal, 6000);
    try { await this.adoptConnection(serverId, { ...connection }, verified, signal, { timeoutMs: 6000, guard }); }
    finally { await releaseProbe(verified); }
  }

  originIsDirect(serverId: string): boolean {
    const status = this.status(serverId);
    return status.status === "online" && ["directTcp", "directSocket", "directPipe"].includes(status.type ?? "") &&
      this.store.getSnapshot(serverId)?.client?.getConnectionState().status === "connected";
  }

  /** Probe both hops before replacing the target's working connection. No host records are changed. */
  async preferRoute(originServerId: string, serverId: string, signal: AbortSignal, timeoutMs: number,
    beforeCommit?: () => Promise<void>): Promise<void> {
    ensureActive(signal);
    if (originServerId === serverId) throw new DirectError("identity");
    if (!this.originIsDirect(originServerId)) throw new DirectError("unreachable");
    const origin = this.store.getSnapshot(originServerId)?.client;
    const host = this.host(serverId);
    if (!host.connections.some((c) => c.type !== "routed")) throw new DirectError("needs_fallback");
    const connection = host.connections.find((c) => c.type === "routed" && c.originServerId === originServerId);
    if (!connection) throw new DirectError("route_missing");
    const originUnchanged = () => {
      ensureActive(signal);
      if (!this.originIsDirect(originServerId) || this.store.getSnapshot(originServerId)?.client !== origin)
        throw new DirectError("unreachable");
    };
    const active = this.store.getSnapshot(serverId);
    if (active?.activeConnectionId === connection.id && active.connectionStatus === "online" && active.client) {
      const latency = await bounded(active.client.measureLatency({ timeoutMs }), signal, timeoutMs + 250);
      originUnchanged();
      if (!Number.isFinite(latency) || latency < 0 || this.store.getSnapshot(serverId)?.client !== active.client ||
        active.client.getConnectionState().status !== "connected") throw new DirectError("unreachable");
      return;
    }
    const verified = await this.verifyConnection(host, connection, signal, timeoutMs);
    try {
      await this.adoptConnection(serverId, connection, verified, signal, {
        timeoutMs, beforeCommit: async () => { await beforeCommit?.(); originUnchanged(); },
        guard: originUnchanged,
      });
      originUnchanged();
    } finally { await releaseProbe(verified); }
  }

  private async adoptConnection(serverId: string, connection: Connection, verified: VerifiedTransport, signal: AbortSignal,
    options: { timeoutMs: number; beforeCommit?: () => Promise<void>; guard?: () => void; shouldAdopt?: () => boolean }): Promise<void> {
    ensureActive(signal);
    const controller = this.handoffController(serverId);
    const deadline = Date.now() + 20_000;
    await bounded(controller.runProbeCycleNow(), signal, 20_000);
    // Reserve the core's existing probe serialization slot. This also covers
    // activateConnection awaiting asynchronous disposal of its previous client.
    while (controller.probeCycleInFlight !== null) {
      await bounded(controller.probeCycleInFlight, signal, Math.max(1, deadline - Date.now()));
    }
    ensureActive(signal);
    let release!: () => void;
    const lease = new Promise<void>((resolve) => { release = resolve; });
    controller.probeCycleInFlight = lease;
    const needed = () => {
      ensureActive(signal);
      options.guard?.();
      if (this.store.controllers.get(serverId) !== controller) throw new DirectError("cancelled");
      const saved = this.host(serverId).connections.find((c) => c.id === connection.id);
      if (!saved) throw new DirectError("route_missing");
      if (saved.type !== connection.type || saved.endpoint !== connection.endpoint ||
        (saved.useTls ?? false) !== (connection.useTls ?? false) || saved.originServerId !== connection.originServerId)
        throw new DirectError("connection_conflict");
      const active = this.store.getSnapshot(serverId);
      return options.shouldAdopt?.() !== false && !(active?.activeConnectionId === connection.id &&
        active.connectionStatus === "online" && active.client?.getConnectionState().status === "connected");
    };
    try {
      if (!needed()) return;
      // The core's active probe reads getLastLivenessRttMs, which measureLatency
      // does not populate. Prime it on the unowned socket before handing it over.
      verified.latencyMs = await bounded(typeof verified.client.livenessPing === "function"
        ? verified.client.livenessPing({ timeoutMs: options.timeoutMs })
        : verified.client.measureLatency({ timeoutMs: options.timeoutMs }), signal, options.timeoutMs + 250);
      await options.beforeCommit?.();
      if (!needed()) return;
      if (!Number.isFinite(verified.latencyMs) || verified.latencyMs < 0 || verified.closed ||
        verified.client.getConnectionState().status !== "connected") throw new DirectError("unreachable");
      if (verified.client.getLastServerInfoMessage()?.serverId !== serverId) throw new DirectError("identity");
      verified.handingOff = true;
      try {
        await controller.activateConnection({ connectionId: connection.id, existingClient: verified.client });
      } finally {
        verified.adopted = this.store.getSnapshot(serverId)?.client === verified.client;
        verified.handingOff = false;
      }
      const snapshot = this.store.getSnapshot(serverId);
      if (snapshot?.client?.getLastServerInfoMessage()?.serverId !== serverId) throw new DirectError("identity");
      if (snapshot.connectionStatus !== "online" || snapshot.activeConnectionId !== connection.id) throw new DirectError("unreachable");
    } finally {
      if (controller.probeCycleInFlight === lease) controller.probeCycleInFlight = null;
      release();
    }
  }

  /** Return to a verified saved non-routed path, reusing native credentials and socket handoff. */
  async restoreOriginal(serverId: string, originServerId: string, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
    const needsRestore = () => {
      const status = this.status(serverId);
      return status.status !== "online" || (status.type === "routed" && status.originServerId === originServerId);
    };
    ensureActive(signal);
    if (!needsRestore()) return true; // The core (or user) already selected another working path.
    const host = this.host(serverId);
    const probes = this.store.getSnapshot(serverId)?.probeByConnectionId;
    const originals = host.connections.filter((c) => c.type !== "routed").sort((a, b) => {
      const rank = (c: Connection) => probes?.get(c.id)?.status === "available" ? probes.get(c.id)!.latencyMs ?? Infinity : Infinity;
      return rank(a) - rank(b);
    });
    if (!originals.length) throw new DirectError("needs_fallback");
    const scope = new AbortController();
    const abort = () => scope.abort();
    signal.addEventListener("abort", abort, { once: true });
    let next = 0;
    let winner: { connection: Connection; verified: VerifiedTransport } | undefined;
    const worker = async () => {
      while (next < originals.length && !scope.signal.aborted) {
        const connection = originals[next++];
        try {
          const verified = await this.verifyConnection(host, connection, scope.signal, timeoutMs);
          if (winner || scope.signal.aborted) { await releaseProbe(verified); continue; }
          winner = { connection, verified };
          scope.abort(); // Pending connectors release late sockets; the winner has finished probing.
          return;
        } catch (error) {
          if (error instanceof DirectError && ["identity", "unsupported", "version"].includes(error.code)) throw error;
        }
      }
    };
    try {
      const results = await Promise.allSettled([worker(), worker()]);
      ensureActive(signal);
      if (!winner) {
        const fatal = results.find((r) => r.status === "rejected");
        if (fatal?.status === "rejected") throw fatal.reason;
        throw new DirectError("unreachable");
      }
      if (needsRestore()) await this.adoptConnection(serverId, winner.connection, winner.verified, signal, {
        timeoutMs, shouldAdopt: needsRestore,
      });
      return true;
    } finally {
      scope.abort(); signal.removeEventListener("abort", abort);
      if (winner) await releaseProbe(winner.verified);
    }
  }
  async removeManaged(serverId: string, managed: ManagedConnection): Promise<void> {
    const host = this.host(serverId);
    const match = host.connections.find((c) => c.type === "directTcp" && c.endpoint === managed.endpoint && (c.useTls ?? false) === managed.useTls);
    if (!match) return;
    if (this.store.getSnapshot(serverId)?.activeConnectionId === match.id) throw new DirectError("active_connection");
    if (!host.connections.some((c) => c.type === "relay")) throw new DirectError("needs_relay");
    await this.store.removeConnection(serverId, match.id);
  }
}
