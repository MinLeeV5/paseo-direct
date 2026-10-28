import assert from "node:assert/strict";
import test from "node:test";
import { DirectSession, type Bridge } from "../client/session";
import type { ConnectionStatus, VerifiedProbe } from "../client/bridge";
import type { Discovery } from "../shared/contracts";
import { DevicePreferenceStore } from "../client/preferences";

let nextId = 0;
function fixture(foreground = true) {
  const serverId = `test-${++nextId}`;
  const data = new Map<string, string>();
  const preferences = new DevicePreferenceStore({ getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); } }, serverId);
  let now = 1_000;
  let probes = 0, saves = 0, closed = 0;
  const listeners = new Set<() => void>();
  let status: ConnectionStatus = { status: "online", type: "relay", endpoint: null, connectionId: "relay", relaySaved: true, directSaved: [] };
  const discovery: Discovery = { serverId, label: "PC", listen: "0.0.0.0:6767", reason: null,
    candidates: [{ endpoint: "192.168.1.10:6767", interfaceName: "en0", useTls: false }], generatedAt: now };
  const emit = () => listeners.forEach((listener) => listener());
  const bridge: Bridge = {
    status: () => status,
    subscribe: (_, listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    probe: async (_, candidate): Promise<VerifiedProbe> => {
      probes++;
      return { candidate, latencyMs: 2, adopted: false, client: { close: async () => { closed++; }, measureLatency: async () => 2,
        getConnectionState: () => ({ status: "connected" }), getLastServerInfoMessage: () => ({ serverId }) } };
    },
    save: async (_, probe, _signal, activate) => {
      saves++; probe.adopted = activate;
      const added = !status.directSaved.includes(probe.candidate.endpoint);
      const details = [...(status.directConnections ?? []).filter((c) => c.endpoint !== probe.candidate.endpoint),
        { id: "direct:" + probe.candidate.endpoint, endpoint: probe.candidate.endpoint, useTls: probe.candidate.useTls }];
      status = { ...status, ...(activate ? { type: "directTcp", endpoint: probe.candidate.endpoint, connectionId: "direct" } : {}),
        directSaved: details.map((c) => c.endpoint), directConnections: details };
      emit();
      return { added };
    },
    readPreferences: (_, mobile) => preferences.read(mobile),
    writePreferences: (_, values) => preferences.write(values),
    updatePreferences: (_, mobile, update) => preferences.update(mobile, update),
    removeManaged: async (_, managed) => {
      status = { ...status, directSaved: status.directSaved.filter((endpoint) => endpoint !== managed.endpoint),
        directConnections: status.directConnections?.filter((c) => c.endpoint !== managed.endpoint) };
      emit();
    },
    persisted: async () => saves > 0,
    activateRelay: async () => { status = { ...status, type: "relay", endpoint: null, connectionId: "relay" }; emit(); },
  };
  const create = (overrides: Partial<ConstructorParameters<typeof DirectSession>[0]> = {}) => new DirectSession({
    mobile: true, foreground, discover: async () => discovery, bridge: () => bridge, now: () => now, ...overrides });
  return { bridge, discovery, preferences, create, counts: () => ({ probes, saves, closed }),
    advance: (ms: number) => { now += ms; }, setStatus: (value: ConnectionStatus) => { status = value; emit(); } };
}

test("foreground mobile startup discovers, verifies, saves once and confirms persistence", async () => {
  const f = fixture(), session = f.create();
  try {
    await session.start();
    assert.equal(f.counts().saves, 1);
    assert.equal(session.getSnapshot().persisted, true);
    assert.equal(session.getSnapshot().directActivations, 1);
    await session.check();
    assert.equal(f.counts().saves, 1, "healthy direct connection is not repeatedly saved/switched");
  } finally { session.dispose(); }
});

test("background startup never probes or writes a connection", async () => {
  const f = fixture(false), session = f.create();
  try { await session.start(); await session.check(); assert.equal(f.counts().probes, 0); assert.equal(f.counts().saves, 0); }
  finally { session.dispose(); }
});

test("relay return and its cooldown survive plugin teardown/reinstallation", async () => {
  const f = fixture(), first = f.create();
  await first.start();
  await first.useRelay();
  assert.equal(first.getSnapshot().relayReturns, 1);
  first.dispose();
  const next = f.create();
  try {
    await next.start();
    assert.equal(f.counts().saves, 1, "reinstallation must not immediately undo a relay test");
    assert.equal(next.getSnapshot().relayReturns, 1);
    f.advance(61_000);
    await next.check();
    assert.equal(f.counts().saves, 2);
    assert.equal(next.getSnapshot().connection?.type, "directTcp");
  } finally { next.dispose(); }
});

test("unreachable candidates preserve the existing relay without mutating saved hosts", async () => {
  const f = fixture();
  f.bridge.probe = async () => { throw new Error("private url must never leak: relay://password"); };
  const session = f.create();
  try {
    await session.start();
    assert.equal(f.counts().saves, 0);
    assert.equal(session.getSnapshot().connection?.type, "relay");
    assert.equal(session.getSnapshot().phase, "unreachable");
    assert(!JSON.stringify(session.getSnapshot()).includes("password"));
  } finally { session.dispose(); }
});

test("late probe results after backgrounding are closed and never committed", async () => {
  const f = fixture();
  const original = f.bridge.probe;
  let resolve!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => { entered = r; });
  const wait = new Promise<void>((r) => { resolve = r; });
  f.bridge.probe = async (...args) => { entered(); await wait; return original(...args); };
  const session = f.create();
  try {
    const running = session.start();
    await started;
    session.setForeground(false);
    resolve();
    await running;
    assert.equal(f.counts().saves, 0);
    assert.equal(f.counts().closed, 1);
  } finally { session.dispose(); }
});

test("at most two probes run concurrently and all unused successful sockets close", async () => {
  const f = fixture();
  f.discovery.candidates = Array.from({ length: 8 }, (_, i) => ({ endpoint: `192.168.1.${i + 1}:6767`, interfaceName: "en0", useTls: false }));
  let active = 0, max = 0;
  const original = f.bridge.probe;
  f.bridge.probe = async (...args) => {
    active++; max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return original(...args);
  };
  const session = f.create();
  try {
    await session.start();
    assert.equal(max, 2);
    assert.equal(f.counts().probes, 2);
    assert.equal(f.counts().closed, 1);
    assert.equal(f.counts().saves, 1);
  } finally { session.dispose(); }
});

test("disabled device settings survive reconstruction and remain separate from another PC", async () => {
  const f = fixture();
  await f.preferences.update(true, (values) => ({ ...values, enabled: false, intervalSeconds: 60, language: "en" }));
  const first = f.create();
  await first.start(); first.dispose();
  const next = f.create();
  const other = fixture(), second = other.create();
  try {
    await next.start(); await second.start();
    assert.equal(next.getSnapshot().enabled, false);
    assert.equal(next.getSnapshot().preferences.intervalSeconds, 60);
    assert.equal(next.locale(), "en");
    assert.equal(f.counts().probes, 0);
    assert.equal(other.counts().saves, 1);
  } finally { next.dispose(); second.dispose(); }
});

test("refreshing PC settings does not probe or switch while this device is paused", async () => {
  const f = fixture();
  await f.preferences.update(true, (values) => ({ ...values, enabled: false }));
  const session = f.create();
  try {
    await session.start();
    f.discovery.candidates.push({ endpoint: "pc.example:6767", useTls: false, interfaceName: "custom" });
    await session.refreshDiscovery();
    assert.equal(session.getSnapshot().discovery?.candidates.length, 2);
    assert.equal(f.counts().probes, 0);
    assert.equal(f.counts().saves, 0);
  } finally { session.dispose(); }
});

test("Paseo preference saves a new address without adopting the probe or repeatedly forcing it", async () => {
  const f = fixture();
  await f.preferences.update(true, (values) => ({ ...values, preferDirect: false }));
  const session = f.create();
  try {
    await session.start();
    assert.equal(session.getSnapshot().connection?.type, "relay");
    assert.equal(f.counts().saves, 1);
    assert.equal(f.counts().closed, 1, "probe ownership stays with the plugin in save-only mode");
    await session.check();
    assert.equal(f.counts().probes, 1);
    await session.check(true, f.discovery.candidates[0].endpoint);
    assert.equal(session.getSnapshot().connection?.type, "directTcp", "an explicit connection overrides the automatic strategy");
    assert.equal(f.counts().closed, 1, "the adopted socket must remain open");
  } finally { session.dispose(); }
});

test("removing an owned address excludes it from automatic rediscovery until explicitly allowed", async () => {
  const f = fixture(), session = f.create();
  const endpoint = f.discovery.candidates[0].endpoint;
  try {
    await session.start(); await session.useRelay();
    await session.removeAddress(endpoint);
    f.advance(61_000);
    await session.check();
    assert.equal(f.counts().saves, 1);
    assert(session.getSnapshot().preferences.excludedEndpoints.includes(endpoint));
    await session.updatePreferences({ excludedEndpoints: [] });
    await session.check();
    assert.equal(f.counts().saves, 2);
    await session.removeAddress("manual.example:6767");
    assert.equal(session.getSnapshot().error, "not_managed");
  } finally { session.dispose(); }
});

test("diagnostics are sent only on explicit request", async () => {
  const f = fixture(); let reports = 0;
  const session = f.create({ report: async () => { reports++; } });
  try {
    await session.start(); await session.check(); await session.useRelay();
    assert.equal(reports, 0);
    await session.sendReport(false); assert.equal(reports, 0);
    await session.sendReport(); assert.equal(reports, 1);
    assert.equal(session.getSnapshot().logs[0].message, "report_sent");
  } finally { session.dispose(); }
});

test("foregrounding during cancelled startup resumes discovery", async () => {
  const f = fixture(); let enter!: () => void, resolve!: () => void; let calls = 0;
  const entered = new Promise<void>((r) => { enter = r; });
  const wait = new Promise<void>((r) => { resolve = r; });
  const session = f.create({ discover: async () => { calls++; if (calls === 1) { enter(); await wait; } return f.discovery; } });
  try {
    const start = session.start(); await entered;
    session.setForeground(false); session.setForeground(true); resolve(); await start;
    await new Promise((r) => setTimeout(r, 20));
    assert(calls >= 2);
    assert.equal(f.counts().saves, 1);
  } finally { session.dispose(); }
});

test("ownership metadata finishes even when a successful handoff unloads the plugin", async () => {
  const f = fixture(); let second: DirectSession | undefined;
  const originalSave = f.bridge.save;
  const first = f.create();
  f.bridge.save = async (...args) => {
    const result = await originalSave(...args);
    first.dispose(); second = f.create(); await second.start();
    return result;
  };
  try {
    await first.start();
    const stored = await f.preferences.read(true);
    assert.equal(stored.values.managed[0]?.endpoint, f.discovery.candidates[0].endpoint);
    assert.equal(f.counts().saves, 1);
    assert.equal(f.counts().closed, 0);
  } finally { first.dispose(); second?.dispose(); }
});
