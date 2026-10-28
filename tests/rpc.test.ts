import assert from "node:assert/strict";
import test from "node:test";
import { settingsRpc } from "@getpaseo/plugin";
import { CurrentHostRpc } from "../client/rpc";
import type { Discovery } from "../shared/contracts";

const discovery: Discovery = { serverId: "rpc-pc", label: "PC", listen: "0.0.0.0:6767", candidates: [], reason: null, generatedAt: 1 };

test("discovery bootstraps once, then every RPC borrows the current connection after handoffs", async () => {
  let bootstrap = 0, connection = "relay";
  const calls: string[] = [];
  const rpc = new CurrentHostRpc(async () => { bootstrap++; return discovery; }, () => ({
    invoke: async (id, method) => {
      assert.equal(id, "rpc-pc"); calls.push(connection + ":" + method);
      return method === "direct.discover" ? discovery : { status: "ready", revision: connection, values: {} };
    },
  }));
  await rpc.discover();
  connection = "direct"; await rpc.discover();
  const read = settingsRpc("connection").read;
  assert.equal((await rpc.call(read, {})).revision, "direct");
  connection = "relay-new"; await rpc.discover();
  assert.equal((await rpc.call(read, {})).revision, "relay-new");
  assert.equal(bootstrap, 1, "the SDK installation's captured client is never reused after bootstrap");
  assert.deepEqual(calls, ["direct:direct.discover", "direct:settings.connection.read", "relay-new:direct.discover", "relay-new:settings.connection.read"]);
});

test("current RPC cannot silently change the paired PC identity", async () => {
  const rpc = new CurrentHostRpc(async () => discovery, () => ({ invoke: async () => ({ ...discovery, serverId: "other-pc" }) }));
  await rpc.discover();
  await assert.rejects(rpc.discover(), /identity/);
});
