import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const candidateSchema = z.object({
  endpoint: z.string().min(1).max(255),
  interfaceName: z.string().max(128),
  useTls: z.boolean(),
  source: z.enum(["interface", "custom"]).optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;

export const discoverySchema = z.object({
  serverId: z.string().min(1),
  label: z.string(),
  listen: z.string().nullable(),
  candidates: z.array(candidateSchema).max(16),
  reason: z.string().nullable(),
  generatedAt: z.number(),
  enabled: z.boolean().optional(),
  reasonCode: z.enum(["no_tcp", "loopback", "no_ipv4", "settings_invalid", "disabled"]).nullable().optional(),
});
export type Discovery = z.infer<typeof discoverySchema>;

export const discoverRpc = defineRpc({
  name: "direct.discover",
  input: z.object({}),
  output: discoverySchema,
});

export const reportSchema = z.object({
  deviceId: z.string().max(100),
  platform: z.enum(["ios", "android", "web"]),
  serverId: z.string().min(1),
  at: z.number(),
  foreground: z.boolean(),
  stage: z.string().max(160),
  bridgeReady: z.boolean(),
  activeType: z.string().nullable(),
  activeEndpoint: z.string().nullable(),
  connectionStatus: z.string().nullable(),
  relaySaved: z.boolean(),
  savedEndpoints: z.array(z.string()).max(64),
  persisted: z.boolean(),
  directActivations: z.number().int().nonnegative(),
  relayReturns: z.number().int().nonnegative(),
  probes: z.array(z.object({ endpoint: z.string(), latencyMs: z.number().nullable(), error: z.string().nullable() })).max(16),
  events: z.array(z.object({ at: z.number(), message: z.string().max(300) })).max(40),
});
export type ClientReport = z.infer<typeof reportSchema>;
export const reportRpc = defineRpc({ name: "direct.report", input: reportSchema, output: z.object({ received: z.literal(true) }) });
export const reportsRpc = defineRpc({ name: "direct.reports", input: z.object({}), output: z.array(reportSchema).max(12) });
