import { readFile } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { collectCandidates } from "./candidates";
import type { Discovery } from "../shared/contracts";
import { hostValuesSchema, type HostValues } from "../shared/settings";

const runtimeSchema = z.object({ serverId: z.string(), listen: z.string().nullable() });

export async function discover(_: unknown, context: PluginHandlerContext, settings: HostValues = hostValuesSchema.parse({})): Promise<Discovery> {
  const { self } = await context.paseo.hosts.list();
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  // The supervisor records the bound address, including an OS-assigned port and launch overrides.
  const runtime = runtimeSchema.parse(JSON.parse(await readFile(join(home, "paseo.pid"), "utf8")));
  if (runtime.serverId !== self.serverId) throw new Error("运行目录与当前 PC 身份不一致，停止地址发现。");
  return {
    serverId: self.serverId,
    label: self.label,
    listen: runtime.listen,
    ...collectCandidates(runtime.listen, networkInterfaces(), settings),
    enabled: settings.enabled,
    generatedAt: Date.now(),
  };
}
