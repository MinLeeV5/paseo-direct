import type { PluginServerContext } from "@getpaseo/plugin/server";
import { discoverRpc } from "./shared/contracts";
import { discover } from "./server/discover";
import { registerReports } from "./server/reports";
import { hostPreferences } from "./shared/settings";
import { hostValuesSchema } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(hostPreferences);
  server.handle(discoverRpc, async (input, context) => {
    const current = await settings.read();
    if (current.status !== "ready") {
      const result = await discover(input, context, hostValuesSchema.parse({ enabled: false }));
      return { ...result, reasonCode: "settings_invalid" as const, reason: "Direct connection settings are invalid." };
    }
    return discover(input, context, current.values);
  });
  registerReports(server);
  return () => {};
}
