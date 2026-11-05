import type { Connection, Host, ProbeClient } from "./bridge";
import { DirectError } from "./errors";

export interface NativeProbeClient extends ProbeClient {
  connect(): Promise<void>;
  setReconnectEnabled(enabled: boolean): void;
}
export interface ProbeDependencies {
  createClient?(input: { host: Host; connection: Connection; clientId: string; runtimeGeneration: number }): NativeProbeClient;
  connectToDaemon(input: { host: Host; connection: Connection; timeoutMs?: number }): Promise<{
    client: ProbeClient; serverId: string; hostname?: string | null;
  }>;
}
const installed = Symbol.for("paseo-direct.isolated-probe-identity.v1");
let sequence = 0;
function probeIdentity(): string {
  const unique = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() :
    `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `paseo-direct-probe-${unique}`;
}

/** Native probes must not resume an active session: session resume revokes its host routes. */
export function installIsolatedProbeConnector(deps: ProbeDependencies, isOriginConnected: (serverId: string) => boolean): boolean {
  const create = deps.createClient;
  if (typeof create !== "function" || typeof deps.connectToDaemon !== "function") return false;
  if (Reflect.get(deps.connectToDaemon, installed)) return true;
  const connect: ProbeDependencies["connectToDaemon"] = async ({ host, connection, timeoutMs }) => {
    if (connection.type === "routed" && (!connection.originServerId || !isOriginConnected(connection.originServerId))) {
      throw new DirectError("unreachable");
    }
    // Keep native transport, credentials, capabilities, and the client adopted on promotion.
    const client = create.call(deps, { host, connection, clientId: probeIdentity(), runtimeGeneration: 0 });
    const close = () => {
      try { if (typeof client?.close === "function") void Promise.resolve(client.close()).catch(() => {}); }
      catch { /* A cleanup failure must not delay or replace the original probe failure. */ }
    };
    if (!client || ["connect", "setReconnectEnabled", "getLastServerInfoMessage", "close"].some(key =>
      typeof Reflect.get(client, key) !== "function")) {
      close(); throw new DirectError("unsupported");
    }
    try { client.setReconnectEnabled(false); }
    catch (error) { close(); throw error; }
    const deadline = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs :
      connection.type === "relay" ? 10_000 : connection.type === "remoteSsh" ? 15_000 : 6_000;
    return new Promise((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true; close(); reject(new DirectError("timeout"));
      }, deadline);
      void Promise.resolve().then(() => client.connect()).then(() => {
        if (expired) { close(); return; } // Some native transports finish connecting after close().
        const info = client.getLastServerInfoMessage();
        if (!info || typeof info.serverId !== "string" || !info.serverId) throw new DirectError("identity");
        clearTimeout(timer);
        // Pairing also uses this connector with an empty input identity; callers reconcile it.
        resolve({ client, serverId: info.serverId, hostname: info.hostname ?? null });
      }).catch(error => {
        clearTimeout(timer); close(); reject(error); // Preserve native authentication error identity.
      });
    });
  };
  Reflect.set(connect, installed, true);
  return Reflect.set(deps, "connectToDaemon", connect);
}
