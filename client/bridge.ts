import type { Candidate } from "../shared/contracts";
import type { DevicePreferences, ManagedConnection } from "../shared/settings";
import { DevicePreferenceStore, type PreferenceStorage } from "./preferences";
import { bounded, DirectError, ensureActive } from "./errors";

export interface Connection { id: string; type: string; endpoint?: string; useTls?: boolean }
export interface Host { serverId: string; label: string; password?: string; connections: Connection[] }
export interface ProbeClient {
  close(): Promise<void>;
  measureLatency(options: { timeoutMs: number }): Promise<number>;
  getConnectionState(): { status: string };
  getLastServerInfoMessage(): { serverId: string; version?: string } | null;
  invokePluginRpc?(pluginId: string, method: string, input: unknown): Promise<unknown>;
}
export interface RuntimeSnapshot { activeConnectionId: string | null; connectionStatus: string; client: ProbeClient | null }
export interface PrivateStore {
  getHosts(): Host[];
  getSnapshot(serverId: string): RuntimeSnapshot | null;
  subscribe(serverId: string, listener: () => void): () => void;
  deps: { connectToDaemon(input: { host: Host; connection: Connection; timeoutMs: number }): Promise<{ client: ProbeClient; serverId: string }> };
  controllers: Map<string, { activateConnection(input: { connectionId: string; existingClient?: ProbeClient }): Promise<void> }>;
  storage: PreferenceStorage;
  upsertDirectConnection(input: { serverId: string; endpoint: string; useTls: boolean; existingClient?: ProbeClient }): Promise<unknown>;
  removeConnection(serverId: string, connectionId: string): Promise<void>;
}
export interface DirectConnection { id: string; endpoint: string; useTls: boolean }
export interface ConnectionStatus {
  status: string; type: string | null; endpoint: string | null; connectionId: string | null;
  relaySaved: boolean; directSaved: string[];
  directConnections?: DirectConnection[]; activeTls?: boolean | null; daemonVersion?: string | null;
}
export interface VerifiedProbe {
  candidate: Candidate; latencyMs: number; client: ProbeClient;
  adopted: boolean; handingOff?: boolean; closed?: boolean;
}
export function connectionId(candidate: Candidate): string { return "direct:" + candidate.endpoint; }
export async function releaseProbe(probe: VerifiedProbe): Promise<void> {
  if (probe.adopted || probe.handingOff || probe.closed) return;
  probe.closed = true;
  await probe.client.close().catch(() => {});
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
  }
  static fromGlobal(): PrivateBridge {
    return new PrivateBridge(Reflect.get(globalThis, "__paseoHostRuntimeStore") as PrivateStore);
  }
  private host(serverId: string): Host {
    const host = this.store.getHosts().find((value) => value.serverId === serverId);
    if (!host) throw new DirectError("host_missing");
    const version = this.store.getSnapshot(serverId)?.client?.getLastServerInfoMessage()?.version;
    const info = this.store.getSnapshot(serverId)?.client?.getLastServerInfoMessage();
    if (info && info.serverId !== serverId) throw new DirectError("identity");
    if (version && !/^0\.13\.[012]$/.test(version)) throw new DirectError("version");
    return host;
  }
  private prefs(serverId: string): DevicePreferenceStore {
    this.host(serverId);
    let value = this.preferences.get(serverId);
    if (!value) { value = new DevicePreferenceStore(this.store.storage, serverId); this.preferences.set(serverId, value); }
    return value;
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
    };
  }
  subscribe(serverId: string, listener: () => void): () => void { return this.store.subscribe(serverId, listener); }

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
    let abandoned = false;
    const pending = this.store.deps.connectToDaemon({
      host, connection: { id: connectionId(candidate), type: "directTcp", endpoint: candidate.endpoint, useTls: candidate.useTls }, timeoutMs,
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
      if (result.serverId !== serverId || result.client.getLastServerInfoMessage()?.serverId !== serverId) throw new DirectError("identity");
      const latencyMs = await bounded(result.client.measureLatency({ timeoutMs }), signal, timeoutMs + 250);
      if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new DirectError("unreachable");
      ensureActive(signal);
      return { candidate, client: result.client, latencyMs, adopted: false };
    } catch (error) { await close(); throw error; }
    finally { signal.removeEventListener("abort", abort); }
  }

  async save(serverId: string, probe: VerifiedProbe, signal: AbortSignal, activate: boolean): Promise<{ added: boolean }> {
    ensureActive(signal);
    if (probe.closed) throw new DirectError("cancelled");
    const host = this.host(serverId);
    if (!host.connections.some((c) => c.type === "relay")) throw new DirectError("needs_relay");
    if (probe.client.getLastServerInfoMessage()?.serverId !== serverId) throw new DirectError("identity");
    if (probe.client.getConnectionState().status !== "connected") throw new DirectError("unreachable");
    const existing = host.connections.find((c) => c.type === "directTcp" && c.endpoint === probe.candidate.endpoint);
    if (existing && (existing.useTls ?? false) !== probe.candidate.useTls) throw new DirectError("connection_conflict");
    probe.handingOff = activate;
    try {
      await this.store.upsertDirectConnection({ serverId, endpoint: probe.candidate.endpoint, useTls: probe.candidate.useTls,
        ...(activate ? { existingClient: probe.client } : {}) });
      probe.adopted = activate;
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
  async removeManaged(serverId: string, managed: ManagedConnection): Promise<void> {
    const host = this.host(serverId);
    const match = host.connections.find((c) => c.type === "directTcp" && c.endpoint === managed.endpoint && (c.useTls ?? false) === managed.useTls);
    if (!match) return;
    if (this.store.getSnapshot(serverId)?.activeConnectionId === match.id) throw new DirectError("active_connection");
    if (!host.connections.some((c) => c.type === "relay")) throw new DirectError("needs_relay");
    await this.store.removeConnection(serverId, match.id);
  }
}
