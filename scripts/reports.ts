import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
const runtime = JSON.parse(await readFile(join(home, "paseo.pid"), "utf8"));
const endpoint = String(runtime.listen).replace(/^0\.0\.0\.0:/, "127.0.0.1:").replace(/^\[?::\]?:/, "[::1]:");
const client = new DaemonClient({
  url: `ws://${endpoint}/ws`, clientId: "paseo-direct-reports", clientType: "cli", connectTimeoutMs: 5000,
  reconnect: { enabled: false },
  localCredential: async () => (await readFile(join(home, "local-credential"), "utf8")).trim(),
});
try {
  await client.connect();
  console.log(JSON.stringify(await client.invokePluginRpc("paseo-direct", "direct.reports", {}), null, 2));
} finally { await client.close(); }
