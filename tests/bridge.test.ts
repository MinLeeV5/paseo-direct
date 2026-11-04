import assert from "node:assert/strict";
import test from "node:test";
import { PrivateBridge, releaseProbe, type PrivateStore, type ProbeClient, type Host, type RuntimeSnapshot } from "../client/bridge";

const candidate = { endpoint: "192.168.1.10:6767", interfaceName: "en0", useTls: false };
function fixture(serverId = "pc-a", version: string | undefined = "0.13.2") {
  let closed = 0;
  let saves = 0;
  let seenPassword: string | undefined;
  let savedClient: ProbeClient | undefined;
  const host: Host = { serverId: "pc-a", label: "PC", password: "test-only-password", connections: [{ id: "relay-a", type: "relay" }] };
  const client: ProbeClient = {
    close: async () => { closed++; }, measureLatency: async () => 3,
    getConnectionState: () => ({ status: "connected" }),
    getLastServerInfoMessage: () => ({ serverId, version }),
  };
  const store: PrivateStore = {
    getHosts: () => [host], getSnapshot: () => ({ activeConnectionId: "relay-a", connectionStatus: "online",
      client: { ...client, getLastServerInfoMessage: () => ({ serverId: "pc-a", version }) } }),
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

test("Paseo 0.13.0 and later versions can verify and save direct connections without an upper bound", async () => {
  for (const version of ["0.13.0", "0.13.1", "0.13.2", "0.13.3", "0.13.10", "0.14.0", "0.100.0", "1.0.0", "2.0.0",
    "0.13.0+build.1", "0.13.1-beta.1", "0.14.0-beta.1", "1.0.0-rc.1+build.1"]) {
    const f = fixture("pc-a", version);
    const signal = new AbortController().signal;
    const probe = await f.bridge.probe("pc-a", candidate, signal);
    await f.bridge.saveAndActivate("pc-a", probe, signal);
    assert.equal(f.counts().saves, 1, version);
    assert.equal(probe.adopted, true, version);
    assert.equal(f.bridge.status("pc-a").daemonVersion, version);
  }
});

test("versions below Paseo 0.13.0 and malformed versions are rejected before connecting", async () => {
  for (const version of ["0.0.0", "0.9.99", "0.12.99", "0.13.0-beta.1", "0.13.0-rc.1+build.1", "invalid", "0.13", "0.13.3oops", "0.13.0-", "0.13.0+"]) {
    const f = fixture("pc-a", version);
    await assert.rejects(f.bridge.probe("pc-a", candidate, new AbortController().signal), /version/, version);
    assert.equal(f.counts().seenPassword, undefined, version);
    assert.equal(f.counts().saves, 0, version);
  }
});

test("a host without reported version information still uses the capability checks", () => {
  const f = fixture();
  const snapshot = f.store.getSnapshot("pc-a")!;
  f.store.getSnapshot = () => ({ ...snapshot, client: { ...f.client, getLastServerInfoMessage: () => ({ serverId: "pc-a" }) } });
  assert.equal(f.bridge.status("pc-a").daemonVersion, null);
});

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

function routedFixture() {
  const f = fixture();
  const target: Host = { serverId: "target", label: "Target", connections: [
    { id: "via:other", type: "routed", originServerId: "other" },
    { id: "via:pc-a", type: "routed", originServerId: "pc-a" },
  ] };
  const originSnapshot = f.store.getSnapshot("pc-a")!;
  let targetSnapshot = { ...originSnapshot, activeConnectionId: "via:other", client: {
    ...f.client, getLastServerInfoMessage: () => ({ serverId: "target", version: "0.13.2" }),
  } };
  const activations: string[] = [];
  f.store.getHosts = () => [f.host, target];
  f.store.getSnapshot = (id) => id === "target" ? targetSnapshot : originSnapshot;
  f.store.controllers.set("target", { activateConnection: async ({ connectionId }) => {
    activations.push(connectionId); targetSnapshot = { ...targetSnapshot, activeConnectionId: connectionId };
  } });
  return { ...f, target, activations, setSnapshot: (value: Partial<typeof targetSnapshot>) => { targetSnapshot = { ...targetSnapshot, ...value }; } };
}

test("using B as a relay selects only the target's route through B, without adding direct addresses or needing a target relay", async () => {
  const f = routedFixture();
  await f.bridge.activateForwardedHost("pc-a", "target");
  assert.deepEqual(f.activations, ["via:pc-a"]);
  assert.equal(f.counts().saves, 0);
  assert.equal(f.target.connections.length, 2);
});

test("route activation rejects undiscovered targets, wrong origins, unavailable adapters and self routing", async () => {
  const f = routedFixture();
  await assert.rejects(f.bridge.activateForwardedHost("pc-a", "missing"), /route_missing/);
  f.target.connections = f.target.connections.slice(0, 1);
  await assert.rejects(f.bridge.activateForwardedHost("pc-a", "target"), /route_missing/);
  await assert.rejects(f.bridge.activateForwardedHost("pc-a", "pc-a"), /identity/);
  assert.deepEqual(f.activations, []);
  f.target.connections.push({ id: "via:pc-a", type: "routed", originServerId: "pc-a" });
  f.store.controllers.delete("target");
  await assert.rejects(f.bridge.activateForwardedHost("pc-a", "target"), /unsupported/);
});

test("route activation must confirm the target identity and selected route after the core operation", async () => {
  const f = routedFixture();
  f.setSnapshot({ client: { ...f.client, getLastServerInfoMessage: () => ({ serverId: "impostor", version: "0.13.2" }) } });
  await assert.rejects(f.bridge.activateForwardedHost("pc-a", "target"), /identity/);
  assert.deepEqual(f.activations, []);
  const next = routedFixture();
  next.store.controllers.set("target", { activateConnection: async () => {
    next.setSnapshot({ client: { ...next.client, getLastServerInfoMessage: () => ({ serverId: "impostor", version: "0.13.2" }) } });
  } });
  await assert.rejects(next.bridge.activateForwardedHost("pc-a", "target"), /identity/);
  const offline = routedFixture();
  offline.setSnapshot({ connectionStatus: "offline" });
  await assert.rejects(offline.bridge.activateForwardedHost("pc-a", "target"), /unreachable/);
});

function automaticFixture() {
  const f = routedFixture();
  f.host.connections.push({ id: "lan-b", type: "directTcp", endpoint: "192.168.1.64:6767" });
  f.target.connections.unshift({ id: "original", type: "relay" });
  let origin: RuntimeSnapshot = { activeConnectionId: "lan-b", connectionStatus: "online", client: f.client };
  let target: RuntimeSnapshot = { activeConnectionId: "original", connectionStatus: "online", client: {
    ...f.client, getLastServerInfoMessage: () => ({ serverId: "target", version: "0.15.0" }),
  } };
  let closed = 0;
  const connects: string[] = [], activations: string[] = [];
  const makeClient = (): ProbeClient => ({ ...f.client, close: async () => { closed++; },
    getLastServerInfoMessage: () => ({ serverId: "target", version: "0.15.0" }),
  });
  f.store.getSnapshot = (id) => id === "target" ? target : origin;
  f.store.deps.connectToDaemon = async ({ connection }) => {
    connects.push(connection.id); return { client: makeClient(), serverId: "target" };
  };
  f.store.controllers.set("target", { activateConnection: async ({ connectionId, existingClient }) => {
    assert(existingClient, "automatic switching must adopt a verified socket");
    activations.push(connectionId);
    target = { ...target, activeConnectionId: connectionId, connectionStatus: "online", client: existingClient };
  } });
  return { ...f, connects, activations, makeClient,
    setOrigin: (patch: Partial<RuntimeSnapshot>) => { origin = { ...origin, ...patch }; },
    setTarget: (patch: Partial<RuntimeSnapshot>) => { target = { ...target, ...patch }; },
    closed: () => closed };
}

test("automatic routing verifies and adopts only B's route, retaining the original registry and its credentials", async () => {
  const f = automaticFixture();
  const original = JSON.stringify(f.store.getHosts());
  await f.bridge.preferRoute("pc-a", "target", new AbortController().signal, 100);
  assert.deepEqual(f.connects, ["via:pc-a"]);
  assert.deepEqual(f.activations, ["via:pc-a"]);
  assert.equal(f.closed(), 0, "the adopted socket belongs to Paseo");
  await f.bridge.preferRoute("pc-a", "target", new AbortController().signal, 100);
  assert.equal(f.connects.length, 1, "a healthy active route uses its own liveness check");
  assert.equal(JSON.stringify(f.store.getHosts()), original);
  const status = f.bridge.status("target");
  assert.equal(status.originServerId, "pc-a");
  assert.equal(status.originalSaved, true);
  assert(!JSON.stringify(status).includes("test-only-password"));
});

test("automatic routing refuses B over Relay, absent fallback paths, and the wrong target identity", async () => {
  const f = automaticFixture();
  f.setOrigin({ activeConnectionId: "relay-a" });
  await assert.rejects(f.bridge.preferRoute("pc-a", "target", new AbortController().signal, 100), /unreachable/);
  assert.equal(f.connects.length, 0);
  f.setOrigin({ activeConnectionId: "lan-b" });
  f.target.connections = f.target.connections.filter((c) => c.type === "routed");
  await assert.rejects(f.bridge.preferRoute("pc-a", "target", new AbortController().signal, 100), /needs_fallback/);
  f.target.connections.unshift({ id: "original", type: "relay" });
  const client = f.makeClient();
  f.store.deps.connectToDaemon = async () => ({ client: { ...client,
    getLastServerInfoMessage: () => ({ serverId: "impostor" }) }, serverId: "impostor" });
  await assert.rejects(f.bridge.preferRoute("pc-a", "target", new AbortController().signal, 100), /identity/);
  assert.equal(f.closed(), 1);
  assert.equal(f.activations.length, 0);
});

test("B changing transports while a route probe is in flight cannot replace A's working original path", async () => {
  const f = automaticFixture();
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  f.store.deps.connectToDaemon = async () => { enter(); await wait; return { client: f.makeClient(), serverId: "target" }; };
  const pending = f.bridge.preferRoute("pc-a", "target", new AbortController().signal, 1000);
  await entered; f.setOrigin({ activeConnectionId: "relay-a" }); finish();
  await assert.rejects(pending, /unreachable/);
  assert.equal(f.closed(), 1);
  assert.equal(f.activations.length, 0);
  assert.equal(f.bridge.status("target").connectionId, "original");
});

test("fallback probes only saved non-routed paths, preserves the active path until a socket is verified and cleans up losers", async () => {
  const f = automaticFixture();
  f.target.connections.unshift({ id: "old-lan", type: "directTcp", endpoint: "192.168.99.10:6767" });
  f.setTarget({ activeConnectionId: "via:pc-a" });
  f.store.deps.connectToDaemon = async ({ connection }) => {
    f.connects.push(connection.id);
    assert.equal(f.bridge.status("target").connectionId, "via:pc-a");
    if (connection.id === "old-lan") throw Error("unreachable with secret context");
    return { client: f.makeClient(), serverId: "target" };
  };
  const registry = JSON.stringify(f.store.getHosts());
  await f.bridge.restoreOriginal("target", "pc-a", new AbortController().signal, 100);
  assert.deepEqual(f.activations, ["original"]);
  assert(!f.connects.some((id) => id.startsWith("via:")));
  assert.equal(JSON.stringify(f.store.getHosts()), registry);
  await f.bridge.restoreOriginal("target", "pc-a", new AbortController().signal, 100);
  assert.equal(f.activations.length, 1, "do not replace a working native fallback");
});

test("cancelled fallback releases late sockets and never adopts after backgrounding", async () => {
  const f = automaticFixture();
  f.setTarget({ activeConnectionId: "via:pc-a" });
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => { finish = resolve; });
  f.store.deps.connectToDaemon = async () => { await wait; return { client: f.makeClient(), serverId: "target" }; };
  const scope = new AbortController();
  const pending = f.bridge.restoreOriginal("target", "pc-a", scope.signal, 1000);
  scope.abort(); await assert.rejects(pending, /cancelled/);
  finish(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.closed(), 1);
  assert.deepEqual(f.activations, []);
});

test("simultaneous successful original probes hand off only one socket and close the other", async () => {
  const f = automaticFixture();
  f.target.connections.unshift({ id: "second-original", type: "directTcp", endpoint: "192.168.1.10:6767" });
  f.setTarget({ activeConnectionId: "via:pc-a" });
  await f.bridge.restoreOriginal("target", "pc-a", new AbortController().signal, 100);
  assert.equal(f.connects.length, 2);
  assert.equal(f.activations.length, 1);
  assert.equal(f.closed(), 1);
});
