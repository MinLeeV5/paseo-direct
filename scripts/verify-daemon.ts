import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { createPaseoApi } from "@getpaseo/client";
import { hashSync } from "bcryptjs";
import { discoverySchema } from "../shared/contracts";
import { settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { hostValuesSchema } from "../shared/settings";
import { forwardingAddRpc, forwardingDirectorySchema, forwardingListRpc, forwardingRemoveRpc } from "../shared/forwarding";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "paseo-direct-verify-"));
const home = join(directory, "daemon");
const targetHome = join(directory, "target");
const clean = join(directory, "plugin");
const archive = process.argv[2] ? resolve(process.argv[2]) : null;
const cliAt = async (daemonHome: string, args: string[]) => (await exec("paseo", [...args, "--home", daemonHome], {
  cwd: root, timeout: 55_000, maxBuffer: 2 * 1024 * 1024,
})).stdout;
const cli = (args: string[]) => cliAt(home, args);
let startAttempted = false;
let stopped = false;
let targetStartAttempted = false;
let targetStopped = false;
let client: DaemonClient | null = null;
try {
  await mkdir(home, { mode: 0o700 });
  await mkdir(clean);
  if (archive) {
    const listing = (await exec("tar", ["-tzf", archive])).stdout.trim().split("\n");
    assert(listing.every((entry) => entry.startsWith("package/") && !entry.split("/").includes("..")), "Unexpected archive path");
    await exec("tar", ["-xzf", archive, "-C", clean, "--strip-components=1"]);
  } else {
    for (const name of ["package.json", "paseo-plugin.json", "index.client.tsx", "index.server.ts", "client", "server", "shared", "assets"]) {
      await cp(join(root, name), join(clean, name), { recursive: true });
    }
  }
  await writeFile(join(home, "config.json"), JSON.stringify({
    version: 1, pluginsEnabled: true,
    daemon: { listen: "127.0.0.1:0", relay: { enabled: false } },
  }), { mode: 0o600 });
  startAttempted = true;
  await cli(["daemon", "start", "--timeout", "45"]);
  await cli(["plugin", "install", clean, "--json"]);
  const entries = JSON.parse(await cli(["plugin", "ls", "paseo-direct", "--json"]));
  assert.equal(entries.find((row: { id: string }) => row.id === "paseo-direct")?.status, "running");
  const runtime = JSON.parse(await readFile(join(home, "paseo.pid"), "utf8"));
  client = new DaemonClient({
    url: `ws://${runtime.listen}/ws`, clientId: "paseo-direct-isolated-check", clientType: "cli",
    connectTimeoutMs: 5000, reconnect: { enabled: false },
    localCredential: async () => (await readFile(join(home, "local-credential"), "utf8")).trim(),
  });
  await client.connect();
  const catalog = await client.getPluginCatalog();
  const plugin = catalog.find((entry) => entry.id === "paseo-direct");
  assert(plugin, "Plugin missing from catalog");
  assert(plugin.clientBundle.length > 0, "Plugin client bundle was not compiled");
  const discovery = discoverySchema.parse(await client.invokePluginRpc("paseo-direct", "direct.discover", {}));
  assert.equal(discovery.serverId, runtime.serverId);
  assert.equal(discovery.listen, runtime.listen);
  assert.equal(discovery.candidates.length, 0, "Loopback daemon must not advertise LAN addresses");
  const settings = settingsRpc("connection");
  const readSettings = async () => z.object({ status: z.literal("ready"), revision: z.string(), values: hostValuesSchema })
    .parse(await client!.invokePluginRpc("paseo-direct", settings.read.name, {}));
  const initial = await readSettings();
  const custom = { ...initial.values, autoDiscover: false, customAddresses: ["wss://qa.example:443"], ignoredInterfaces: ["qa-interface"] };
  const saved = await client.invokePluginRpc("paseo-direct", settings.write.name, { revision: initial.revision, values: custom });
  assert.equal((saved as { status: string }).status, "saved");
  const current = await readSettings();
  assert.deepEqual(current.values, custom);
  const conflict = await client.invokePluginRpc("paseo-direct", settings.write.name, { revision: initial.revision, values: initial.values });
  assert.equal((conflict as { status: string }).status, "conflict");
  const invalid = await client.invokePluginRpc("paseo-direct", settings.write.name, { revision: current.revision,
    values: { ...custom, customAddresses: ["ws://user:password@qa.example:443"] } });
  assert.equal((invalid as { status: string }).status, "invalid");
  await cli(["plugin", "reload", "paseo-direct", "--json"]);
  assert.deepEqual((await readSettings()).values, custom, "Shared PC settings must survive plugin reload");
  const customDiscovery = discoverySchema.parse(await client.invokePluginRpc("paseo-direct", "direct.discover", {}));
  assert.deepEqual(customDiscovery.candidates, [{ endpoint: "qa.example:443", interfaceName: "custom", useTls: true, source: "custom" }]);
  const reports = await client.invokePluginRpc("paseo-direct", "direct.reports", {});
  assert.deepEqual(reports, [], "Discovery must not generate device diagnostic reports");

  // A separate password-protected daemon acts as A. B's native host link must carry C's requests to it.
  const ipv4 = Object.values(networkInterfaces()).flat().find((row) => row && row.family === "IPv4" && !row.internal)?.address;
  assert(ipv4, "A local IPv4 interface is needed for the authenticated forwarding check");
  const targetPassword = randomBytes(24).toString("hex");
  await mkdir(targetHome, { mode: 0o700 });
  await writeFile(join(targetHome, "config.json"), JSON.stringify({
    version: 1, daemon: { listen: `${ipv4}:0`, relay: { enabled: false }, auth: { password: hashSync(targetPassword, 12) } },
  }), { mode: 0o600 });
  targetStartAttempted = true;
  await cliAt(targetHome, ["daemon", "start", "--timeout", "45"]);
  const targetRuntime = JSON.parse(await readFile(join(targetHome, "paseo.pid"), "utf8"));
  const invoke = (method: string, input: unknown) => client!.invokePluginRpc("paseo-direct", method, input);
  const forwarded = async () => forwardingDirectorySchema.parse(await invoke(forwardingListRpc.name, {}));
  assert.deepEqual((await forwarded()).hosts, []);
  assert.equal((await forwarded()).serverId, runtime.serverId);
  assert.deepEqual(await invoke(forwardingAddRpc.name, { address: targetRuntime.listen, label: "QA target", password: targetPassword }), { code: "saved" });
  let nativeForwarding = await forwarded();
  const waitForTarget = async (expected: "online" | "error") => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      nativeForwarding = await forwarded();
      if (nativeForwarding.hosts[0]?.status === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.fail(`Native target did not become ${expected}: ${JSON.stringify(nativeForwarding)}`);
  };
  await waitForTarget("online");
  assert.equal(nativeForwarding.hosts[0].serverId, targetRuntime.serverId);
  assert(!JSON.stringify(nativeForwarding).includes(targetPassword), "Forwarding status must exclude credentials");
  assert.deepEqual(await invoke(forwardingAddRpc.name, { address: targetRuntime.listen }), { code: "exists" });
  const api = createPaseoApi(client);
  try {
    const targetApi = await api.hosts.client(targetRuntime.serverId);
    try {
      assert.equal((await targetApi.hosts.list()).self.serverId, targetRuntime.serverId, "Requests through B must reach A");
    } finally { await targetApi.dispose(); }
  } finally { await api.dispose(); }
  await cli(["plugin", "reload", "paseo-direct", "--json"]);
  assert.equal((await forwarded()).hosts[0].serverId, targetRuntime.serverId, "Native target must survive plugin reload");
  assert.deepEqual(await invoke(forwardingRemoveRpc.name, { registrationId: nativeForwarding.hosts[0].registrationId }), { code: "removed" });
  assert.deepEqual((await forwarded()).hosts, []);
  assert.deepEqual(await invoke(forwardingAddRpc.name, { address: targetRuntime.listen, password: "intentionally-incorrect-test-password" }), { code: "saved" });
  await waitForTarget("error");
  assert.deepEqual(await invoke(forwardingRemoveRpc.name, { registrationId: nativeForwarding.hosts[0].registrationId }), { code: "removed" });
  const latencyMs = await client.measureLatency({ timeoutMs: 3000 });
  const result = {
    passed: true, daemonVersion: client.getLastServerInfoMessage()?.version,
    cleanInstallWithoutNodeModules: true, compiledClientCatalog: true,
    packagedArchive: Boolean(archive), sharedSettingsRoundTrip: true, staleRevisionRejected: true,
    invalidAddressRejected: true, sharedSettingsSurviveReload: true, customTlsCandidate: true,
    pluginRpc: true, identityChecked: true, actualBoundPortChecked: true,
    websocketLatencyMs: latencyMs, nativePhoneVerified: false,
    nativeForwarding: true, authenticatedTarget: true, routedRequestIdentityChecked: true,
    forwardingSurvivesReload: true, forwardingCredentialsExcluded: true, incorrectTargetPasswordRejected: true,
  };
  const output = join(root, "test-results", "daemon.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client?.close().catch(() => {});
  if (targetStartAttempted) {
    try { await cliAt(targetHome, ["daemon", "stop", "--timeout", "10", "--force", "--json"]); targetStopped = true; }
    catch { console.error(`Could not confirm isolated target shutdown: ${targetHome}`); }
  }
  if (startAttempted) {
    try { await cli(["daemon", "stop", "--timeout", "10", "--force", "--json"]); stopped = true; }
    catch { console.error(`Could not confirm isolated daemon shutdown: ${home}`); }
  }
  if ((!startAttempted || stopped) && (!targetStartAttempted || targetStopped)) await rm(directory, { recursive: true, force: true });
  if (startAttempted && !stopped) throw new Error(`Isolated daemon cleanup was not confirmed: ${home}`);
  if (targetStartAttempted && !targetStopped) throw new Error(`Isolated target cleanup was not confirmed: ${targetHome}`);
}
