import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { parseEndpoint } from "../shared/endpoints";
import {
  forwardingAddRpc, forwardingListRpc, forwardingRemoveRpc,
  type ForwardedHost, type ForwardingAction, type ForwardingDirectory, type ForwardingInput,
} from "../shared/forwarding";

const SOURCE_PREFIX = "paseo-direct:forward:";
const OWNER_KEY = "paseoDirectForwarding";
const MAX_HOSTS = 16;
type HostApi = Pick<PluginHandlerContext["paseo"], "hosts">;
type HostSummary = Awaited<ReturnType<HostApi["hosts"]["list"]>>["hosts"][number];

function sourceKey(address: string, useTls: boolean) { return `${SOURCE_PREFIX}${useTls ? "tls:" : "tcp:"}${address}`; }
function owned(host: HostSummary): boolean {
  return host.metadata[OWNER_KEY] === "1" && host.source.key.startsWith(SOURCE_PREFIX);
}
/** Only selected, credential-free fields may leave B's native host registry. */
function summary(host: HostSummary): ForwardedHost {
  return {
    registrationId: host.registrationId, serverId: host.serverId, label: host.label,
    address: host.metadata.address ?? "", useTls: host.metadata.useTls === "true", status: host.status,
  };
}

export class ForwardingManager {
  private changes: Promise<unknown> = Promise.resolve();
  private change(action: () => Promise<ForwardingAction>): Promise<ForwardingAction> {
    const pending = this.changes.then(action).catch(() => ({ code: "unavailable" as const }));
    this.changes = pending;
    return pending;
  }
  async list(paseo: HostApi): Promise<ForwardingDirectory> {
    try {
      const directory = await paseo.hosts.list();
      return { serverId: directory.self.serverId, hosts: directory.hosts.filter(owned).map(summary) };
    } catch { throw new Error("forwarding_unavailable"); }
  }
  add(paseo: HostApi, input: ForwardingInput): Promise<ForwardingAction> {
    return this.change(async () => {
      const parsed = forwardingAddRpc.input.parse(input);
      const { endpoint, useTls } = parseEndpoint(parsed.address);
      const key = sourceKey(endpoint, useTls);
      const directory = await paseo.hosts.list();
      // Repeated submissions never overwrite a working registration or its stored password.
      if (directory.hosts.some((host) => owned(host) && host.source.key === key)) return { code: "exists" };
      if (directory.hosts.filter(owned).length >= MAX_HOSTS) return { code: "limit" };
      const connection = new URL(`tcp://${endpoint}`);
      if (useTls) connection.searchParams.set("ssl", "true");
      if (parsed.password) connection.searchParams.set("password", parsed.password);
      await paseo.hosts.add({
        connection: connection.toString(), sourceKey: key,
        ...(parsed.label ? { label: parsed.label } : {}),
        metadata: { [OWNER_KEY]: "1", address: endpoint, useTls: String(useTls) },
      });
      return { code: "saved" };
    });
  }
  remove(paseo: HostApi, registrationId: string): Promise<ForwardingAction> {
    return this.change(async () => {
      const directory = await paseo.hosts.list();
      if (!directory.hosts.some((host) => host.registrationId === registrationId && owned(host))) return { code: "not_managed" };
      await paseo.hosts.remove(registrationId);
      return { code: "removed" };
    });
  }
}

export function registerForwarding(server: PluginServerContext) {
  const manager = new ForwardingManager();
  server.handle(forwardingListRpc, (_, { paseo }) => manager.list(paseo));
  server.handle(forwardingAddRpc, (input, { paseo }) => manager.add(paseo, input));
  server.handle(forwardingRemoveRpc, (input, { paseo }) => manager.remove(paseo, input.registrationId));
}
