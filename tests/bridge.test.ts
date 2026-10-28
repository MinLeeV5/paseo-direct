import assert from "node:assert/strict";
import test from "node:test";
import { PrivateBridge, releaseProbe, type PrivateStore, type ProbeClient, type Host } from "../client/bridge";

const candidate = { endpoint: "192.168.1.10:6767", interfaceName: "en0", useTls: false };
function fixture(serverId = "pc-a") {
  let closed = 0;
  let saves = 0;
  let seenPassword: string | undefined;
  let savedClient: ProbeClient | undefined;
  const host: Host = { serverId: "pc-a", label: "PC", password: "test-only-password", connections: [{ id: "relay-a", type: "relay" }] };
  const client: ProbeClient = {
    close: async () => { closed++; }, measureLatency: async () => 3,
    getConnectionState: () => ({ status: "connected" }),
    getLastServerInfoMessage: () => ({ serverId, version: "0.13.2" }),
  };
  const store: PrivateStore = {
    getHosts: () => [host], getSnapshot: () => ({ activeConnectionId: "relay-a", connectionStatus: "online",
      client: { ...client, getLastServerInfoMessage: () => ({ serverId: "pc-a", version: "0.13.2" }) } }),
    subscribe: () => () => {}, controllers: new Map([["pc-a", { activateConnection: async () => {} }]]),
    storage: { getItem: async () => JSON.stringify([{ serverId: "pc-a", password: "test-only-password", connections: host.connections }]), setItem: async () => {} },
    removeConnection: async () => {},
    deps: { connectToDaemon: async (input) => { seenPassword = input.host.password; return { client, serverId }; } },
    upsertDirectConnection: async (input) => {
      saves++; savedClient = input.existingClient;
      host.connections.push({ id: `direct:${input.endpoint}`, type: "directTcp", endpoint: input.endpoint });
    },
  };
  return { bridge: new PrivateBridge(store), store, client, host,
    counts: () => ({ closed, saves, seenPassword, savedClient }) };
}

test("mismatched PC identity closes the socket without modifying the phone registry", async () => {
  const f = fixture("pc-other");
  await assert.rejects(f.bridge.probe("pc-a", candidate, new AbortController().signal), /identity/);
  assert.equal(f.counts().saves, 0);
  assert.equal(f.counts().closed, 1);
});

test("the verified socket is handed to the App, existing auth is reused, relay is preserved and persistence is read", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const probe = await f.bridge.probe("pc-a", candidate, signal);
  assert.equal(f.counts().saves, 0);
  await f.bridge.saveAndActivate("pc-a", probe, signal);
  assert.equal(f.counts().savedClient, probe.client);
  assert.equal(f.counts().seenPassword, "test-only-password");
  assert.equal(f.host.connections[0].type, "relay");
  assert.equal(await f.bridge.persisted("pc-a", candidate.endpoint), true);
  assert.equal(probe.adopted, true);
  assert.equal(f.counts().closed, 0);
});

test("background cancellation before commit prevents local mutations", async () => {
  const f = fixture();
  const scope = new AbortController();
  const probe = await f.bridge.probe("pc-a", candidate, scope.signal);
  scope.abort();
  await assert.rejects(f.bridge.saveAndActivate("pc-a", probe, scope.signal), /cancelled/);
  assert.equal(f.counts().saves, 0);
  await probe.client.close();
});

test("missing private capabilities fail closed", () => {
  assert.throws(() => new PrivateBridge({} as PrivateStore), /unsupported/);
});

test("a removed relay or disconnected verified socket is never committed", async () => {
  const f = fixture();
  const scope = new AbortController();
  const probe = await f.bridge.probe("pc-a", candidate, scope.signal);
  f.host.connections = [];
  await assert.rejects(f.bridge.saveAndActivate("pc-a", probe, scope.signal), /needs_relay/);
  assert.equal(f.counts().saves, 0);
  await probe.client.close();
});

test("a private connector that resolves after cancellation closes its late socket", async () => {
  const f = fixture();
  let resolve!: (value: { client: ProbeClient; serverId: string }) => void;
  f.store.deps.connectToDaemon = () => new Promise((r) => { resolve = r; });
  const scope = new AbortController();
  const pending = f.bridge.probe("pc-a", candidate, scope.signal);
  scope.abort();
  await assert.rejects(pending, /cancelled/);
  resolve({ client: f.client, serverId: "pc-a" });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.counts().closed, 1);
  assert.equal(f.counts().saves, 0);
});

test("manual TLS choices are not overwritten and only inactive owned addresses can be removed", async () => {
  const f = fixture();
  f.host.connections.push({ id: "existing", type: "directTcp", endpoint: candidate.endpoint, useTls: true });
  await assert.rejects(f.bridge.probe("pc-a", candidate, new AbortController().signal), /connection_conflict/);
  assert.equal(f.counts().saves, 0);
  const owned = { endpoint: candidate.endpoint, useTls: true, addedAt: 1 };
  const snapshot = f.store.getSnapshot("pc-a")!;
  f.store.getSnapshot = () => ({ ...snapshot, activeConnectionId: "existing" });
  await assert.rejects(f.bridge.removeManaged("pc-a", owned), /active_connection/);
  let removed = "";
  f.store.getSnapshot = () => snapshot;
  f.store.removeConnection = async (_, id) => { removed = id; };
  await f.bridge.removeManaged("pc-a", owned);
  assert.equal(removed, "existing");
});

test("handoff owns a socket while the private save is still pending", async () => {
  const f = fixture(); let finish!: () => void;
  const scope = new AbortController();
  const probe = await f.bridge.probe("pc-a", candidate, scope.signal);
  f.store.upsertDirectConnection = () => new Promise<void>((r) => { finish = r; });
  const saving = f.bridge.save("pc-a", probe, scope.signal, true);
  await releaseProbe(probe);
  assert.equal(f.counts().closed, 0);
  finish(); await saving; await releaseProbe(probe);
  assert.equal(f.counts().closed, 0);
});

test("RPC resolves the active client anew after relay/direct replacement", async () => {
  const f = fixture();
  const snapshot = f.store.getSnapshot("pc-a")!;
  let current = { ...f.client, invokePluginRpc: async () => "relay" };
  f.store.getSnapshot = () => ({ ...snapshot, client: current });
  assert.equal(await f.bridge.invoke("pc-a", "direct.discover", {}), "relay");
  current = { ...f.client, invokePluginRpc: async () => "direct" };
  assert.equal(await f.bridge.invoke("pc-a", "settings.connection.read", {}), "direct");
  f.store.getSnapshot = () => ({ ...snapshot, connectionStatus: "offline" });
  await assert.rejects(f.bridge.invoke("pc-a", "direct.discover", {}), /discovery/);
});
