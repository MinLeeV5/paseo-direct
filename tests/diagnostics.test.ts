import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeDiagnostics, runtimeDiagnostics, type DiagnosticClient, type DiagnosticRuntime } from "../client/diagnostics";
import { runtimeDiagnosticSchema } from "../shared/contracts";

function fixture() {
  let time = 1_000_000, monotonic = 1000;
  let tick: (() => void) | null = null;
  const runtimeListeners = new Set<() => void>();
  function makeClient() {
    let state = { status: "connected", reason: "" };
    const states = new Set<(value: typeof state) => void>();
    const messages = new Set<(value: { type: string }) => void>();
    const client = {
      getConnectionState: () => state,
      getLastLivenessRttMs: () => 47,
      subscribeConnectionStatus: (fn: (value: typeof state) => void) => {
        states.add(fn); fn(state); return () => { states.delete(fn); };
      },
      subscribeRawMessages: (fn: (value: { type: string }) => void) => { messages.add(fn); return () => { messages.delete(fn); }; },
      close: () => { assert.fail("Diagnostics must never close a client"); },
      measureLatency: () => { assert.fail("Diagnostics must never send probes"); },
      emit: (value: typeof state) => { state = value; states.forEach(fn => fn(state)); },
      message: (value: { type: string }) => messages.forEach(fn => fn(value)),
      subscriptions: () => states.size + messages.size,
    };
    return client;
  }
  const client = makeClient();
  const hosts = [{ serverId: "B", password: "secret-password", connections: [{ id: "direct-b", type: "directTcp", endpoint: "private.example:6767" }] }];
  const snapshots = new Map<string, { activeConnectionId: string; connectionStatus: string; client: DiagnosticClient | null; clientGeneration: number }>([
    ["B", { activeConnectionId: "direct-b", connectionStatus: "online", client, clientGeneration: 1 }],
  ]);
  const runtime: DiagnosticRuntime = {
    getHosts: () => hosts,
    getSnapshot: id => snapshots.get(id) ?? null,
    subscribeAll: fn => { runtimeListeners.add(fn); return () => { runtimeListeners.delete(fn); }; },
  };
  const recorder = new RuntimeDiagnostics(runtime, {
    now: () => time, monotonic: () => monotonic,
    setTimer: fn => { tick = fn; return fn; },
    clearTimer: () => { tick = null; },
  });
  return { recorder, runtime, client, hosts, snapshots, makeClient,
    emit: () => runtimeListeners.forEach(fn => fn()),
    subscriptions: () => runtimeListeners.size,
    advance: (ms: number) => { time += ms; monotonic += ms; const pending = tick; tick = null; pending?.(); },
    hasTimer: () => tick !== null,
  };
}

test("native disconnect reasons survive recovery without leaking arbitrary error text", () => {
  const f = fixture(), lease = f.recorder.acquire(true);
  try {
    f.client.emit({ status: "disconnected", reason: "Connection closed (1006) at wss://user:secret-password@private.example/ws?token=secret-token" });
    f.client.emit({ status: "connected", reason: "" });
    const report = lease.snapshot();
    assert.equal(report.hosts[0].clientStatus, "connected");
    assert(report.events.some(e => e.kind === "client" && e.clientStatus === "disconnected" && e.closeCode === 1006));
    assert(!JSON.stringify(report).includes("secret"));
    assert(!JSON.stringify(report).includes("private.example"));
    runtimeDiagnosticSchema.parse(report);
  } finally { lease.dispose(); }
});

test("client replacements detach retired sockets and distinguish the new client", () => {
  const f = fixture(), lease = f.recorder.acquire(true);
  try {
    const oldOrdinal = lease.snapshot().hosts[0].clientOrdinal;
    const next = f.makeClient();
    f.snapshots.get("B")!.client = next; f.snapshots.get("B")!.clientGeneration++;
    f.emit();
    assert.equal(f.client.subscriptions(), 0);
    assert.equal(next.subscriptions(), 2);
    assert.notEqual(lease.snapshot().hosts[0].clientOrdinal, oldOrdinal);
    const length = lease.snapshot().events.length;
    f.client.emit({ status: "disposed", reason: "Client closed" });
    assert.equal(lease.snapshot().events.length, length);
  } finally { lease.dispose(); }
});

test("multiple host plugins share one recorder and the final release cleans subscriptions", () => {
  const f = fixture();
  assert.equal(runtimeDiagnostics(f.runtime), runtimeDiagnostics(f.runtime));
  const first = f.recorder.acquire(true), second = f.recorder.acquire(true);
  assert.equal(f.subscriptions(), 1);
  assert.equal(f.client.subscriptions(), 2);
  first.dispose(); first.dispose();
  assert.equal(f.subscriptions(), 1);
  second.dispose();
  assert.equal(f.subscriptions(), 0);
  assert.equal(f.client.subscriptions(), 0);
  assert.equal(f.hasTimer(), false);
  const reloaded = f.recorder.acquire(true);
  assert.equal(f.client.subscriptions(), 2);
  reloaded.dispose();
});

test("foreground timer delays are recorded while background time is excluded", () => {
  const f = fixture(), lease = f.recorder.acquire(true);
  try {
    f.advance(1000);
    assert(!lease.snapshot().events.some(e => e.kind === "event_loop_gap"));
    f.advance(9000);
    assert(lease.snapshot().events.some(e => e.kind === "event_loop_gap" && e.delayMs === 8000));
    lease.setForeground(false, "android_blur");
    assert.equal(f.hasTimer(), false);
    f.advance(60_000);
    lease.setForeground(true, "android_focus");
    f.advance(1000);
    assert.equal(lease.snapshot().events.filter(e => e.kind === "event_loop_gap").length, 1);
    assert(lease.snapshot().events.some(e => e.kind === "foreground" && e.source === "android_blur"));
  } finally { lease.dispose(); }
});

test("message timing reads only the message type and never the payload", () => {
  const f = fixture(), lease = f.recorder.acquire(true);
  try {
    const message = { type: "fetch_agent_timeline_response", get payload() { throw new Error("Payload must stay unread"); } };
    f.client.message(message);
    f.client.message({ type: "file_explorer_response" });
    const report = lease.snapshot();
    assert.equal(report.hosts[0].messages.timeline, 1);
    assert.equal(report.hosts[0].messages.file, 1);
    assert.equal(report.hosts[0].lastMessageAt, 1_000_000);
  } finally { lease.dispose(); }
});

test("history and host sampling remain bounded", () => {
  const f = fixture(), lease = f.recorder.acquire(true);
  try {
    for (let i = 0; i < 200; i++) f.client.emit({ status: i % 2 ? "connected" : "disconnected", reason: "Liveness check timed out (15000ms)" });
    for (let i = 0; i < 80; i++) f.hosts.push({ serverId: `host-${i}`, password: "secret-password", connections: [] });
    f.emit();
    const report = lease.snapshot();
    assert(report.events.length <= 120);
    assert(report.hosts.length <= 32);
    assert(report.events.some(e => e.reason === "liveness_timeout"));
    runtimeDiagnosticSchema.parse(report);
  } finally { lease.dispose(); }
});

test("Paseo 0.15 file subscriptions and timeline membership count metadata without reading payloads", () => {
  const f = fixture(), lease = f.recorder.acquire(true);
  try {
    for (const type of ["fs.file.subscribe.response", "fs.file.update", "agent.timeline.set_subscription.response"]) {
      const message = { type, get payload() { throw new Error("Payload must stay unread"); } };
      f.client.message(message);
    }
    const sample = lease.snapshot().hosts[0];
    assert.equal(sample.messages.file, 2);
    assert.equal(sample.messages.subscription, 1);
  } finally { lease.dispose(); }
});

test("optional native diagnostic APIs may be missing without affecting the connection", () => {
  const f = fixture();
  f.runtime.subscribeAll = undefined;
  f.snapshots.get("B")!.client = { getConnectionState: () => ({ status: "connected" }) };
  const recorder = new RuntimeDiagnostics(f.runtime), lease = recorder.acquire(false);
  try {
    const report = lease.snapshot();
    assert.equal(report.capabilities.runtimeSubscriptions, false);
    assert.equal(report.capabilities.clientStates, false);
    assert.equal(report.hosts[0].clientStatus, "connected");
  } finally { lease.dispose(); }
});
