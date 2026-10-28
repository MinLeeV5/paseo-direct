import assert from "node:assert/strict";
import test from "node:test";
import { parseEndpoint } from "../shared/endpoints";
import { defaultDevicePreferences, hostValuesSchema } from "../shared/settings";
import { collectCandidates } from "../server/candidates";
import { DevicePreferenceStore, type PreferenceStorage } from "../client/preferences";

test("custom addresses normalize scheme, TLS, ports and equivalent IP spellings", () => {
  assert.deepEqual(parseEndpoint("wss://Build.Example.com/ws"), { endpoint: "build.example.com:443", useTls: true });
  assert.deepEqual(parseEndpoint("192.168.001.051:06767"), { endpoint: "192.168.1.51:6767", useTls: false });
  assert.deepEqual(parseEndpoint("tcp://build.local"), { endpoint: "build.local:6767", useTls: false });
  assert.deepEqual(parseEndpoint("[2001:0db8:0:0:0:0:0:1]:6767"), { endpoint: "[2001:db8::1]:6767", useTls: false });
});

test("custom addresses reject credentials, paths, queries, invalid IPv6 and phone-local destinations", () => {
  for (const input of ["ws://user:secret@host:6767", "host:6767?password=secret", "host:6767/path", "file:///tmp/x",
    "localhost:6767", "127.0.0.1:6767", "127.000.0.1:6767", "169.254.000.001:6767", "0.0.0.0:6767", "[::1]:6767", "[0:0:0:0:0:0:0:1]:6767",
    "[::ffff:7f00:1]:6767", "[::::]:6767", "[2001:db8:1]:6767", "[fe80::1]:6767", "[ff02::1]:6767", "host:70000"]) {
    assert.throws(() => parseEndpoint(input), { name: "Error" }, input);
  }
});

test("custom candidates work with loopback bindings and are retained when automatic discovery is off", () => {
  const settings = hostValuesSchema.parse({ autoDiscover: false, customAddresses: ["wss://build.example.com", "wss://BUILD.example.com:443"] });
  const result = collectCandidates("127.0.0.1:6767", {}, settings);
  assert.deepEqual(result.candidates.map((c) => c.endpoint), ["build.example.com:443"]);
  assert.equal(result.candidates[0].useTls, true);
});

test("PC master switch disables even custom candidates", () => {
  assert.equal(collectCandidates("0.0.0.0:6767", {}, hostValuesSchema.parse({ enabled: false, customAddresses: ["build.local:6767"] })).candidates.length, 0);
});

function memory(): PreferenceStorage & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return { rows, getItem: async (key) => rows.get(key) ?? null, setItem: async (key, value) => { rows.set(key, value); } };
}

test("device preferences survive reconstruction without modifying the App host registry", async () => {
  const storage = memory();
  storage.rows.set("@paseo:daemon-registry", "unchanged");
  const first = new DevicePreferenceStore(storage, "pc-a");
  const values = { ...defaultDevicePreferences(true), enabled: false, intervalSeconds: 60 };
  await first.write(values);
  assert.deepEqual((await new DevicePreferenceStore(storage, "pc-a").read(true)).values, values);
  assert.equal((await new DevicePreferenceStore(storage, "pc-b").read(true)).values.enabled, true);
  assert.equal(storage.rows.get("@paseo:daemon-registry"), "unchanged");
});

test("corrupt or unreadable saved preferences disable automatic changes and retain raw data", async () => {
  const storage = memory();
  storage.rows.set("@paseo-direct:v1:pc-a", "not json");
  const result = await new DevicePreferenceStore(storage, "pc-a").read(true);
  assert.equal(result.values.enabled, false);
  assert.equal(result.warning, "preferences_invalid");
  assert.equal(storage.rows.get("@paseo-direct:v1:pc-a"), "not json");
  const denied = await new DevicePreferenceStore({ ...storage, getItem: async () => { throw Error("denied"); } }, "pc-a").read(true);
  assert.equal(denied.warning, "storage");
  assert.equal(denied.values.enabled, false);
});

test("preference writes serialize and a failed write does not poison subsequent saves", async () => {
  const storage = memory();
  let calls = 0;
  const store = new DevicePreferenceStore({ ...storage, setItem: async (key, value) => {
    calls++;
    if (calls === 1) throw Error("temporary failure");
    await storage.setItem(key, value);
  } }, "pc-a");
  await assert.rejects(store.write(defaultDevicePreferences(true)), /storage/);
  await store.write({ ...defaultDevicePreferences(true), enabled: false });
  assert.equal((await store.read(true)).values.enabled, false);
});

test("overlapping instances update device choices and handoff ownership without losing either", async () => {
  const storage = memory();
  const first = new DevicePreferenceStore(storage, "concurrent-pc");
  const next = new DevicePreferenceStore(storage, "concurrent-pc");
  await first.write(defaultDevicePreferences(true));
  await Promise.all([
    first.update(true, (values) => ({ ...values, managed: [{ endpoint: "pc.example:6767", useTls: false, addedAt: 1 }] })),
    next.update(true, (values) => ({ ...values, enabled: false, language: "en" })),
  ]);
  const result = await next.read(true);
  assert.equal(result.values.enabled, false);
  assert.equal(result.values.language, "en");
  assert.equal(result.values.managed[0]?.endpoint, "pc.example:6767");
});
