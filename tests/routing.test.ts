import assert from "node:assert/strict";
import test from "node:test";
import { PreferredRoutes, type RoutingBridge } from "../client/routing";
import type { ConnectionStatus } from "../client/bridge";
import { DevicePreferenceStore } from "../client/preferences";
import { DirectError, ensureActive } from "../client/errors";

function fixture() {
  let now = 1000;
  const rows = new Map<string, string>();
  const stores = new Map<string, DevicePreferenceStore>();
  const preferences = (id = "A") => {
    let store = stores.get(id);
    if (!store) { store = new DevicePreferenceStore({ getItem: async (key) => rows.get(key) ?? null,
      setItem: async (key, value) => { rows.set(key, value); } }, id); stores.set(id, store); }
    return store;
  };
  const native: ConnectionStatus = { status: "online", type: "relay", endpoint: null, connectionId: "original",
    relaySaved: true, originalSaved: true, directSaved: [], originServerId: null,
    routedConnections: [{ originServerId: "B", label: "PC B" }, { originServerId: "D", label: "PC D" }] };
  let target = { ...native };
  let origin: ConnectionStatus = { ...native, type: "directTcp", connectionId: "lan-b" };
  let routeAvailable = true, originalAvailable = true, attempts = 0, activations = 0, restores = 0, healthChecks = 0;
  const listeners = new Set<() => void>();
  const bridge: RoutingBridge = {
    routeHosts: () => [{ serverId: "A", label: "PC A" }, { serverId: "B", label: "PC B" }, { serverId: "D", label: "PC D" }],
    subscribeAll: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    status: (id) => id === "A" ? target : origin,
    originIsDirect: () => origin.type === "directTcp" && origin.status === "online",
    readPreferences: (id, mobile) => preferences(id).read(mobile),
    updatePreferences: (id, mobile, change) => preferences(id).update(mobile, change),
    preferRoute: async (id, _target, signal, _timeout, beforeCommit) => {
      attempts++; ensureActive(signal);
      if (!routeAvailable) throw new DirectError("unreachable");
      if (!target.originalSaved) throw new DirectError("needs_fallback");
      if (target.type === "routed" && target.originServerId === id && target.status === "online") { healthChecks++; return; }
      await beforeCommit?.(); ensureActive(signal);
      activations++;
      target = { ...target, status: "online", type: "routed", connectionId: `via:${id}`, originServerId: id };
    },
    restoreOriginal: async (_target, _origin, signal) => {
      restores++; ensureActive(signal);
      if (!target.originalSaved) throw new DirectError("needs_fallback");
      if (!originalAvailable) throw new DirectError("unreachable");
      target = { ...target, ...native }; return true;
    },
  };
  const policy = new PreferredRoutes(bridge, true, () => now);
  const lease = policy.acquire(true);
  return { policy, bridge, lease, preferences, rows, native,
    select: () => policy.select("A", "B"),
    counts: () => ({ attempts, activations, restores, healthChecks }),
    target: () => target,
    state: () => policy.getSnapshot().targets.A,
    advance: (ms: number) => { now += ms; },
    origin: (value: Partial<ConnectionStatus>) => { origin = { ...origin, ...value }; listeners.forEach((fn) => fn()); },
    setTarget: (value: Partial<ConnectionStatus>) => { target = { ...target, ...value }; listeners.forEach((fn) => fn()); },
    routeAvailable: (value: boolean) => { routeAvailable = value; }, originalAvailable: (value: boolean) => { originalAvailable = value; },
  };
}

test("one shared owner automatically prefers B, then verifies health without repeatedly switching", async () => {
  const f = fixture(); const secondLease = f.policy.acquire(true);
  try {
    await f.select();
    await Promise.all([f.policy.check(), f.policy.check()]);
    assert.equal(f.target().originServerId, "B");
    await f.policy.check();
    assert.deepEqual(f.counts(), { attempts: 1, activations: 1, restores: 0, healthChecks: 0 });
    f.advance(20_001); await f.policy.check();
    assert.equal(f.counts().healthChecks, 1);
    assert.equal(f.counts().activations, 1);
    assert.equal(f.state().phase, "routed");
  } finally { secondLease.dispose(); f.lease.dispose(); }
});

test("B being online through Relay does not qualify for automatic priority", async () => {
  const f = fixture();
  try {
    f.origin({ type: "relay" }); await f.select(); await f.policy.check();
    assert.equal(f.counts().activations, 0);
    assert.equal(f.target().type, "relay");
    assert.equal(f.state().phase, "waiting");
  } finally { f.lease.dispose(); }
});

test("losing B's direct transport restores A's original path and recovery respects cooldown across host reloads", async () => {
  const f = fixture();
  try {
    await f.select(); await f.policy.check();
    f.origin({ type: "relay" }); // B can remain online while the LAN path is gone.
    await f.policy.check();
    assert.equal(f.target().connectionId, "original");
    assert.equal(f.counts().restores, 1);
    f.lease.dispose(); const nextLease = f.policy.acquire(true);
    try {
      f.origin({ type: "directTcp" }); await f.policy.check();
      assert.equal(f.counts().activations, 1);
      assert.equal(f.state().phase, "cooldown");
      f.advance(30_001); await f.policy.check();
      assert.equal(f.counts().activations, 2);
      assert.equal(f.target().originServerId, "B");
    } finally { nextLease.dispose(); }
  } finally { f.lease.dispose(); }
});

test("B-to-A failure falls back even if both snapshots still say online, with exponential retry pauses", async () => {
  const f = fixture();
  try {
    await f.select(); await f.policy.check();
    f.routeAvailable(false); f.advance(20_001); await f.policy.check();
    assert.equal(f.target().connectionId, "original");
    const firstRetry = f.state().nextAttemptAt!;
    await f.policy.check(); assert.equal(f.counts().attempts, 2);
    f.advance(30_001); await f.policy.check();
    assert.equal(f.counts().attempts, 3);
    assert.equal(f.state().nextAttemptAt! - firstRetry, 60_001);
    assert.equal(f.counts().restores, 1, "healthy original path is not repeatedly replaced");
    f.routeAvailable(true); f.advance(60_001); await f.policy.check();
    assert.equal(f.target().originServerId, "B");
  } finally { f.lease.dispose(); }
});

test("native fallback is preserved instead of immediately forcing the failed route again", async () => {
  const f = fixture();
  try {
    await f.select(); await f.policy.check();
    f.setTarget({ ...f.native }); await f.policy.check();
    assert.equal(f.counts().activations, 1);
    assert.equal(f.counts().restores, 0);
    assert.equal(f.state().phase, "cooldown");
  } finally { f.lease.dispose(); }
});

test("if the original path is also down, keep every connection and retry the original and B independently", async () => {
  const f = fixture();
  try {
    await f.select(); await f.policy.check();
    f.originalAvailable(false); f.origin({ status: "offline" }); await f.policy.check();
    assert.equal(f.state().phase, "fallback_unavailable");
    const count = f.counts().restores;
    await f.policy.check(); assert.equal(f.counts().restores, count);
    f.originalAvailable(true); f.advance(20_001); await f.policy.check();
    assert.equal(f.target().connectionId, "original");
    assert.equal((await f.preferences().read(true)).values.preferredOriginServerId, "B");
    f.origin({ status: "online" }); f.advance(10_001); await f.policy.check();
    assert.equal(f.target().originServerId, "B");
  } finally { f.lease.dispose(); }
});

test("backgrounding cancels pending priority work and foregrounding resumes it without a visible panel", async () => {
  const f = fixture();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => { enter = r; });
  const wait = new Promise<void>((r) => { release = r; });
  const original = f.bridge.preferRoute;
  f.bridge.preferRoute = async (...args) => { enter(); await wait; return original(...args); };
  try {
    await f.select();
    const running = f.policy.check(); await entered;
    f.lease.setForeground(false); release(); await running;
    assert.equal(f.counts().activations, 0);
    await f.policy.check(); assert.equal(f.counts().activations, 0);
    f.lease.setForeground(true); await f.policy.check();
    assert.equal(f.counts().activations, 1);
  } finally { f.lease.dispose(); }
});

test("a healthy route resumes as soon as B reconnects even when Relay recovers first", async () => {
  const f = fixture();
  try {
    await f.select(); await f.policy.check();
    f.lease.setForeground(false);
    f.lease.setForeground(false); // Android blur and AppState may both report suspension.
    f.setTarget({ ...f.native });
    f.origin({ type: "relay" });
    f.advance(1000);
    f.lease.setForeground(true); await f.policy.check();
    assert.equal(f.target().connectionId, "original");
    assert.equal(f.state().phase, "waiting");
    assert.equal(f.state().nextAttemptAt, null, "background reconnects are not failed route probes");
    f.origin({ type: "directTcp" }); await f.policy.check();
    assert.equal(f.target().originServerId, "B");
    assert.equal(f.counts().activations, 2, "no manual retry or failure cooldown is needed");
  } finally { f.lease.dispose(); }
});

test("a previously healthy route is reverified on resume while its old client is reconnecting", async () => {
  const f = fixture();
  try {
    await f.select(); await f.policy.check();
    f.lease.setForeground(false);
    f.setTarget({ status: "connecting" });
    f.lease.setForeground(true); await f.policy.check();
    assert.equal(f.target().status, "online");
    assert.equal(f.target().originServerId, "B");
    assert.equal(f.counts().activations, 2);
    assert.equal(f.counts().restores, 0, "reverify the preferred route before replacing it with fallback");
  } finally { f.lease.dispose(); }
});

test("resume checks a route that still looks online without waiting for the pre-background health interval", async () => {
  const f = fixture();
  try {
    await f.select(); await f.policy.check();
    f.lease.setForeground(false);
    f.lease.setForeground(true); await f.policy.check();
    assert.equal(f.counts().healthChecks, 1);
    assert.equal(f.counts().activations, 1, "a working route keeps its current client");
  } finally { f.lease.dispose(); }
});

test("real route failures retain their retry deadline across background and foreground", async () => {
  const f = fixture();
  try {
    await f.select(); await f.policy.check();
    f.routeAvailable(false); f.advance(20_001); await f.policy.check();
    const retryAt = f.state().nextAttemptAt;
    const attempts = f.counts().attempts;
    f.lease.setForeground(false); f.routeAvailable(true);
    f.lease.setForeground(true); await f.policy.check();
    assert.equal(f.state().phase, "cooldown");
    assert.equal(f.state().nextAttemptAt, retryAt);
    assert.equal(f.counts().attempts, attempts);
    f.advance(30_001); await f.policy.check();
    assert.equal(f.target().originServerId, "B");
  } finally { f.lease.dispose(); }
});

test("a failed foreground revalidation restores fallback and starts a real failure cooldown", async () => {
  const f = fixture();
  try {
    await f.select(); await f.policy.check();
    f.lease.setForeground(false); f.routeAvailable(false);
    f.lease.setForeground(true); await f.policy.check();
    assert.equal(f.target().connectionId, "original");
    assert.equal(f.state().phase, "cooldown");
    assert.equal(f.state().error, "unreachable");
    assert.equal(f.state().nextAttemptAt, 31_000);
    await f.policy.check();
    assert.equal(f.counts().attempts, 2, "failed revalidation must not start a tight retry loop");
  } finally { f.lease.dispose(); }
});

test("foreground recovery respects a manual Relay pause saved before suspension", async () => {
  const f = fixture();
  try {
    await f.select(); await f.policy.check();
    await f.preferences().update(true, values => ({ ...values, relayPauseUntil: 61_000 }));
    f.lease.setForeground(false); f.setTarget({ ...f.native });
    f.lease.setForeground(true); await f.policy.check();
    assert.equal(f.target().connectionId, "original");
    assert.equal(f.state().phase, "paused");
    assert.equal(f.counts().attempts, 1);
  } finally { f.lease.dispose(); }
});

test("one host's background event cannot reset route health while another foreground lease remains", async () => {
  const f = fixture(); const other = f.policy.acquire(true);
  try {
    await f.select(); await f.policy.check();
    f.lease.setForeground(false);
    f.setTarget({ ...f.native }); await f.policy.check();
    assert.equal(f.state().phase, "cooldown");
    assert.equal(f.counts().activations, 1);
  } finally { other.dispose(); f.lease.dispose(); }
});

test("changing device preference while a probe is pending prevents an obsolete route commit", async () => {
  const f = fixture(); let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => { enter = r; });
  const wait = new Promise<void>((r) => { release = r; });
  const original = f.bridge.preferRoute;
  f.bridge.preferRoute = async (...args) => { enter(); await wait; return original(...args); };
  try {
    await f.select(); const running = f.policy.check(); await entered;
    // Another host's plugin instance writes the same target's per-device preferences.
    await f.preferences().update(true, (values) => ({ ...values, preferredOriginServerId: null }));
    release(); await running;
    assert.equal(f.counts().activations, 0);
    await f.policy.check(); assert.equal(f.state(), undefined);
  } finally { f.lease.dispose(); }
});

test("manual relay pause is respected, and device route preference is separate from direct discovery", async () => {
  const f = fixture();
  try {
    await f.select();
    await f.preferences().update(true, (values) => ({ ...values, enabled: false, relayPauseUntil: 61_000 }));
    await f.policy.check(); assert.equal(f.counts().attempts, 0);
    assert.equal(f.state().phase, "paused");
    f.advance(60_001); await f.policy.check(); assert.equal(f.counts().activations, 1);
  } finally { f.lease.dispose(); }
});

test("automatic routing requires an original path, selects one origin per target and preserves other host preferences", async () => {
  const f = fixture();
  try {
    f.setTarget({ originalSaved: false });
    await assert.rejects(f.select(), /needs_fallback/);
    await assert.rejects(f.policy.select("A", "A"), /identity/);
    await assert.rejects(f.policy.select("A", "unknown"), /route_missing/);
    f.setTarget({ originalSaved: true });
    await f.select(); await f.policy.select("A", "D"); await f.policy.check();
    assert.equal(f.target().originServerId, "D");
    assert.equal((await f.preferences("B").read(true)).values.preferredOriginServerId, null);
    await f.policy.select("A", null); await f.policy.check();
    assert.equal(f.state(), undefined);
    assert.equal(f.counts().activations, 1);
  } finally { f.lease.dispose(); }
});

test("corrupt preferences stop automatic changes without overwriting stored data", async () => {
  const f = fixture();
  try {
    await f.select(); await f.policy.check();
    f.rows.set("@paseo-direct:v1:A", "damaged");
    f.advance(30_001); await f.policy.check();
    assert.equal(f.counts().activations, 1);
    assert.equal(f.state(), undefined);
    assert.equal(f.rows.get("@paseo-direct:v1:A"), "damaged");
  } finally { f.lease.dispose(); }
});
