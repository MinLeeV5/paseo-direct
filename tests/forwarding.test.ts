import assert from "node:assert/strict";
import test from "node:test";
import type { HostSummary, PaseoApi } from "@getpaseo/client";
import { ForwardingManager } from "../server/forwarding";
import { forwardingInputSchema } from "../shared/forwarding";

function fixture() {
  const hosts: HostSummary[] = [];
  const connections: string[] = [];
  const removed: string[] = [];
  const api: Pick<PaseoApi, "hosts"> = { hosts: {
    list: async () => ({ self: { serverId: "pc-b", label: "PC B" }, hosts }),
    add: async (input) => {
      connections.push(input.connection);
      const host: HostSummary = {
        registrationId: String(hosts.length + 1), serverId: "pc-a", label: input.label ?? null,
        source: { id: "plugin:paseo-direct", key: input.sourceKey! }, metadata: input.metadata ?? {},
        enabled: true, status: "online", targetDescription: input.connection,
        lastOnlineAt: null, nextRetryAt: null, error: { code: "auth", message: input.connection },
      };
      hosts.push(host); return host;
    },
    remove: async (id) => { removed.push(id); hosts.splice(hosts.findIndex((host) => host.registrationId === id), 1); },
    observe: () => { throw Error("unused"); }, client: async () => { throw Error("unused"); },
    update: async () => { throw Error("unused"); },
  } };
  return { manager: new ForwardingManager(), api, hosts, connections, removed };
}
const input = (values = {}) => forwardingInputSchema.parse({ address: "10.23.11.104:16767", ...values });

test("B stores the target through the native host API, while directory and action responses exclude credentials and transport errors", async () => {
  const f = fixture();
  const password = "test-only&p?# 密码";
  const result = await f.manager.add(f.api, input({ address: "wss://TARGET.example:16767", label: "PC A", password }));
  assert.equal(result.code, "saved");
  const connection = new URL(f.connections[0]);
  assert.equal(connection.protocol, "tcp:");
  assert.equal(connection.host, "target.example:16767");
  assert.equal(connection.searchParams.get("ssl"), "true");
  assert.equal(connection.searchParams.get("password"), password);
  const directory = await f.manager.list(f.api);
  assert.equal(directory.serverId, "pc-b");
  assert.deepEqual(directory.hosts[0], { registrationId: "1", serverId: "pc-a", label: "PC A",
    address: "target.example:16767", useTls: true, status: "online" });
  assert(!JSON.stringify({ result, directory }).includes("password"));
  assert(!JSON.stringify(directory).includes("targetDescription"));
  assert(!JSON.stringify(directory).includes("test-only"));
});

test("equivalent and simultaneous target submissions are idempotent and preserve the saved password", async () => {
  const f = fixture();
  const results = await Promise.all([
    f.manager.add(f.api, input({ password: "original" })),
    f.manager.add(f.api, input({ address: "ws://10.23.11.104:16767", password: "replacement" })),
    f.manager.add(f.api, input()),
  ]);
  assert.deepEqual(results.map((result) => result.code), ["saved", "exists", "exists"]);
  assert.equal(f.connections.length, 1);
  assert.equal(new URL(f.connections[0]).searchParams.get("password"), "original");
  assert.equal((await f.manager.add(f.api, input({ address: "wss://10.23.11.104:16767" }))).code, "saved");
});

test("manual registrations cannot be listed or removed by the forwarding manager", async () => {
  const f = fixture();
  await f.manager.add(f.api, input());
  const manual = { ...f.hosts[0], registrationId: "manual", metadata: {}, source: { id: "cli", key: "manual" } };
  const lookalike = { ...f.hosts[0], registrationId: "lookalike", source: { id: "cli", key: "manual" } };
  f.hosts.push(manual, lookalike);
  assert.equal((await f.manager.list(f.api)).hosts.length, 1);
  assert.equal((await f.manager.remove(f.api, "manual")).code, "not_managed");
  assert.equal((await f.manager.remove(f.api, "lookalike")).code, "not_managed");
  assert.deepEqual(f.removed, []);
  assert.equal((await f.manager.remove(f.api, "1")).code, "removed");
  assert.deepEqual(f.removed, ["1"]);
  assert.equal(f.hosts.length, 2);
});

test("failed target mutations mask transport details and do not poison later changes", async () => {
  const f = fixture();
  const add = f.api.hosts.add;
  f.api.hosts.add = async () => { throw Error("tcp://target:16767?password=test-secret"); };
  assert.deepEqual(await f.manager.add(f.api, input()), { code: "unavailable" });
  f.api.hosts.add = add;
  assert.equal((await f.manager.add(f.api, input())).code, "saved");
  f.api.hosts.list = async () => { throw Error("secret transport details"); };
  await assert.rejects(f.manager.list(f.api), { message: "forwarding_unavailable" });
});

test("invalid forwarding addresses never register a target and concurrent additions respect the host limit", async () => {
  const f = fixture();
  for (const address of ["ws://user:password@target:16767", "10.23.11.104:16767?password=secret", "0.0.0.0:6767", "127.0.0.1:6767"]) {
    assert.equal(forwardingInputSchema.safeParse({ address }).success, false);
  }
  const results = await Promise.all(Array.from({ length: 17 }, (_, index) =>
    f.manager.add(f.api, input({ address: `target-${index}.example:16767` }))));
  assert.equal(f.connections.length, 16);
  assert.equal(results.at(-1)?.code, "limit");
});
