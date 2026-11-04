import assert from "node:assert/strict";
import test from "node:test";
import { installTimelineConnectionSync } from "../client/timeline";

function fixture() {
  const listeners = new Map<string, Set<() => void>>();
  const snapshots = new Map<string, { connectionStatus: string; client: { getConnectionState(): { status: string } } | null }>();
  const client = () => ({ getConnectionState: () => ({ status: "connected" }) });
  snapshots.set("B", { connectionStatus: "online", client: client() });
  const owners: { connected: boolean; calls: boolean[]; disposed: number; setConnected(value: boolean): void; dispose(): void }[] = [];
  const runtime = {
    getSnapshot: (id: string) => snapshots.get(id) ?? null,
    subscribe: (id: string, listener: () => void) => {
      const set = listeners.get(id) ?? new Set(); listeners.set(id, set); set.add(listener);
      return () => { set.delete(listener); };
    },
    createViewedTimelineOwner: (_id: string, _ports: unknown) => {
      const owner = { connected: false, calls: [] as boolean[], disposed: 0,
        setConnected(value: boolean) { this.connected = value; this.calls.push(value); },
        dispose() { this.disposed++; },
      };
      owners.push(owner); return owner;
    },
  };
  const emit = (id = "B") => listeners.get(id)?.forEach((listener) => listener());
  return { runtime, owners, snapshots, emit, client,
    create: (id = "B") => runtime.createViewedTimelineOwner(id, {}),
    subscriptions: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

test("an online-to-online client replacement starts the new timeline owner without a connection-status change", () => {
  const f = fixture(); installTimelineConnectionSync(f.runtime);
  const old = f.create();
  old.setConnected(true); // The initial React [isConnected] effect runs once.
  old.dispose();
  f.snapshots.set("B", { connectionStatus: "online", client: f.client() });
  const next = f.create(); // React does not rerun [isConnected], which is still true.
  assert.equal(next.connected, true);
  next.dispose();
});

test("timeline connectivity follows the bound client and isolates different hosts", () => {
  const f = fixture(); installTimelineConnectionSync(f.runtime);
  f.snapshots.set("A", { connectionStatus: "online", client: f.client() });
  const b = f.create(), a = f.create("A");
  f.snapshots.set("B", { connectionStatus: "online", client: f.client() }); f.emit();
  assert.equal(b.connected, false, "an owner bound to a retired client must stop observing it");
  assert.equal(a.connected, true);
  const next = f.create();
  assert.equal(next.connected, true);
  b.dispose(); a.dispose(); next.dispose();
});

test("native status changes update timeline connectivity without resetting it on unrelated probes", () => {
  const f = fixture(); installTimelineConnectionSync(f.runtime); const owner = f.create();
  f.emit(); f.emit();
  assert.deepEqual(owner.calls, [true]);
  const snapshot = f.snapshots.get("B")!;
  snapshot.connectionStatus = "offline"; f.emit();
  assert.equal(owner.connected, false);
  snapshot.connectionStatus = "online"; f.emit();
  assert.deepEqual(owner.calls, [true, false, true]);
  owner.dispose();
});

test("plugin reloads install one hook and disposed owners release every subscription", () => {
  const f = fixture();
  assert.equal(installTimelineConnectionSync(f.runtime), true);
  assert.equal(installTimelineConnectionSync(f.runtime), true);
  const owner = f.create();
  assert.equal(f.subscriptions(), 1);
  owner.dispose(); owner.dispose();
  assert.equal(owner.disposed, 1);
  assert.equal(f.subscriptions(), 0);
  f.emit(); assert.deepEqual(owner.calls, [true]);
});

test("runtimes without the optional timeline-owner API retain their connection behavior", () => {
  const f = fixture();
  const runtime = { getSnapshot: f.runtime.getSnapshot, subscribe: f.runtime.subscribe };
  assert.equal(installTimelineConnectionSync(runtime), false);
  assert.equal(f.subscriptions(), 0);
});
