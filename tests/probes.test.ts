import assert from "node:assert/strict";
import test from "node:test";
import { PrivateBridge, type Connection, type Host, type PrivateStore, type ProbeClient } from "../client/bridge";
import { publicError } from "../client/errors";

interface NativeClient extends ProbeClient {
  connect(): Promise<void>;
  setReconnectEnabled(enabled: boolean): void;
}
interface FactoryInput { host: Host; connection: Connection; clientId: string; runtimeGeneration: number }
const host: Host = { serverId: "origin", label: "Origin", password: "test-password", connections: [] };
const connection: Connection = { id: "direct-origin", type: "directTcp", endpoint: "192.0.2.42:16767" };

function fixture() {
  const calls: FactoryInput[] = [], clients: NativeClient[] = [], reconnect: boolean[] = [];
  let routedOnline = true, oldCalls = 0, closes = 0;
  let onConnect: (() => Promise<void>) | undefined, onClose: (() => Promise<void>) | undefined;
  let info: { serverId: string; hostname: string } | null = { serverId: "actual-origin", hostname: "Example PC" };
  const deps = {
    createClient(input: FactoryInput): NativeClient {
      assert.equal(this, deps, "the native factory retains its receiver");
      calls.push(input);
      const client: NativeClient = {
        connect: async () => {
          if (input.clientId === "app-client-id") routedOnline = false;
          await onConnect?.();
        },
        setReconnectEnabled: enabled => { reconnect.push(enabled); },
        close: async () => { closes++; await onClose?.(); },
        getLastServerInfoMessage: () => info,
        getConnectionState: () => ({ status: "connected" }),
        measureLatency: async () => 1,
      };
      clients.push(client); return client;
    },
    async connectToDaemon(input: { host: Host; connection: Connection; timeoutMs?: number }) {
      oldCalls++;
      const client = deps.createClient({ ...input, clientId: "app-client-id", runtimeGeneration: 0 });
      await client.connect();
      return { client, serverId: input.host.serverId, hostname: null as string | null };
    },
  };
  const store: PrivateStore = {
    deps, getHosts: () => [host], getSnapshot: () => null, subscribe: () => () => {}, controllers: new Map(),
    storage: { getItem: async () => null, setItem: async () => {} },
    upsertDirectConnection: async () => {}, removeConnection: async () => {},
  };
  return { deps, store, calls, clients, reconnect,
    counts: () => ({ routedOnline, oldCalls, closes }),
    connect: (fn: () => Promise<void>) => { onConnect = fn; },
    close: (fn: () => Promise<void>) => { onClose = fn; },
    info: (value: typeof info) => { info = value; },
  };
}

test("native background probes keep an origin's existing routed sessions online", async () => {
  const f = fixture(); new PrivateBridge(f.store);
  const results = await Promise.all(Array.from({ length: 3 }, () => f.deps.connectToDaemon({ host, connection })));
  assert.equal(f.counts().routedOnline, true, "probing must not resume the app's active origin session");
  assert.equal(f.counts().oldCalls, 0);
  assert.equal(new Set(f.calls.map(call => call.clientId)).size, 3);
  for (const call of f.calls) {
    assert.notEqual(call.clientId, "app-client-id");
    assert.equal(call.host, host); assert.equal(call.connection, connection);
    assert.equal(call.runtimeGeneration, 0);
  }
  for (let i = 0; i < results.length; i++) {
    assert.equal(results[i].client, f.clients[i], "promotion adopts the original native client");
    await results[i].client.close();
  }
});

test("pairing returns the actual server identity and hostname without rejecting an empty input identity", async () => {
  const f = fixture(); new PrivateBridge(f.store);
  const result = await f.deps.connectToDaemon({ host: { ...host, serverId: "" }, connection });
  assert.equal(result.serverId, "actual-origin");
  assert.equal(result.hostname, "Example PC");
  assert.deepEqual(f.reconnect, [false], "probes cannot reconnect until native promotion enables them");
  result.client.setReconnectEnabled(true);
  assert.deepEqual(f.reconnect, [false, true]);
  await result.client.close();
});

test("reloading the plugin installs a single connector and leaves the native factory intact", async () => {
  const f = fixture(), factory = f.deps.createClient;
  new PrivateBridge(f.store); const installed = f.deps.connectToDaemon;
  new PrivateBridge(f.store);
  assert.equal(f.deps.connectToDaemon, installed);
  assert.equal(f.deps.createClient, factory);
  await f.deps.connectToDaemon({ host, connection });
  assert.equal(f.counts().oldCalls, 0);
  assert.equal(f.calls.length, 1);
});

test("missing or immutable probe capabilities fail safely without using the colliding connector", () => {
  for (const capability of ["factory", "writable"] as const) {
    const f = fixture();
    if (capability === "factory") Reflect.deleteProperty(f.deps, "createClient");
    else Object.defineProperty(f.deps, "connectToDaemon", { writable: false });
    assert.throws(() => new PrivateBridge(f.store), /unsupported/);
    assert.equal(f.counts().oldCalls, 0);
  }
});

test("incomplete native clients are released before any handshake", async () => {
  for (const missing of ["connect", "setReconnectEnabled", "getLastServerInfoMessage", "close"] as const) {
    const f = fixture(), create = f.deps.createClient;
    f.deps.createClient = function (input) {
      const client = create.call(this, input); Reflect.deleteProperty(client, missing); return client;
    };
    new PrivateBridge(f.store);
    await assert.rejects(f.deps.connectToDaemon({ host, connection }), /unsupported/);
    assert.equal(f.counts().routedOnline, true);
    assert.equal(f.counts().closes, missing === "close" ? 0 : 1);
  }
});

test("probe authentication failures keep their native error identity and safe public category", async () => {
  const f = fixture(), error = Object.assign(new Error("private transport detail"), {
    name: "DaemonAuthenticationError", reason: "incorrect_password",
  });
  f.connect(async () => { throw error; }); new PrivateBridge(f.store);
  await assert.rejects(f.deps.connectToDaemon({ host, connection }), value => value === error);
  assert.equal(f.counts().closes, 1);
  assert.equal(publicError(error), "authentication");
  assert.equal(publicError({ name: "OtherError", reason: "incorrect_password" }), "unreachable");
});

test("missing server info releases a connected probe", async () => {
  const f = fixture(); f.info(null); new PrivateBridge(f.store);
  await assert.rejects(f.deps.connectToDaemon({ host, connection }), /identity/);
  assert.equal(f.counts().closes, 1);
});

test("an offline routed origin rejects before creating a native transport or waiting for a deadline", async () => {
  const f = fixture(); new PrivateBridge(f.store);
  await assert.rejects(f.deps.connectToDaemon({ host, connection: {
    id: "routed", type: "routed", originServerId: "offline-origin",
  } }), /unreachable/);
  assert.equal(f.calls.length, 0);
});

test("deadlines reject promptly even when close never finishes and release a late connection", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); let finish!: () => void;
  f.connect(() => new Promise(resolve => { finish = resolve; }));
  f.close(() => new Promise(() => {}));
  new PrivateBridge(f.store);
  let outcome = "pending";
  const pending = f.deps.connectToDaemon({ host, connection, timeoutMs: 25 }).then(
    () => { outcome = "resolved"; }, error => { outcome = publicError(error); },
  );
  await Promise.resolve(); t.mock.timers.tick(25);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(outcome, "timeout");
  assert.equal(f.counts().closes, 1);
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.counts().closes, 2, "a transport that connects after disposal is released again");
  await pending;
});

test("transport defaults keep native deadlines for Relay, SSH and direct probes", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const [type, deadline] of [["directTcp", 6000], ["relay", 10000], ["remoteSsh", 15000]] as const) {
    const f = fixture(); f.connect(() => new Promise(() => {})); new PrivateBridge(f.store);
    let outcome = "pending";
    const pending = f.deps.connectToDaemon({ host, connection: { ...connection, type } }).then(
      () => { outcome = "resolved"; }, error => { outcome = publicError(error); },
    );
    await Promise.resolve(); t.mock.timers.tick(deadline - 1);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(outcome, "pending");
    t.mock.timers.tick(1); await new Promise(resolve => setImmediate(resolve));
    assert.equal(outcome, "timeout", type); await pending;
  }
});
