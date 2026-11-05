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

const diagnosticReasonSchema = z.enum(["liveness_timeout", "timeout", "disposed", "authentication", "protocol",
  "connection_reset", "network", "transport_closed", "other"]);
const diagnosticTransportSchema = z.enum(["directTcp", "directSocket", "directPipe", "remoteSsh", "relay", "routed", "unknown"]);
const diagnosticClientStatusSchema = z.enum(["connected", "connecting", "disconnected", "disposed", "unknown"]);
const diagnosticRuntimeStatusSchema = z.enum(["online", "offline", "connecting", "error", "unknown"]);
export const runtimeDiagnosticSchema = z.object({
  version: z.literal(1), startedAt: z.number(), capturedAt: z.number(), foreground: z.boolean(),
  capabilities: z.object({ runtimeSubscriptions: z.boolean(), clientStates: z.boolean(), rawMessageTimes: z.boolean(), timelineConnectionSync: z.boolean() }),
  hosts: z.array(z.object({
    serverId: z.string().max(128), clientOrdinal: z.number().int().nonnegative().nullable(),
    transport: diagnosticTransportSchema, originServerId: z.string().max(128).nullable(),
    runtimeStatus: diagnosticRuntimeStatusSchema, clientStatus: diagnosticClientStatusSchema,
    generation: z.number().nullable(), epoch: z.number().nullable(), reason: diagnosticReasonSchema.nullable(),
    closeCode: z.number().int().min(1000).max(4999).nullable(),
    lastMessageAt: z.number().nullable(), lastLivenessRttMs: z.number().nonnegative().nullable(),
    messages: z.object({ timeline: z.number().int().nonnegative(), file: z.number().int().nonnegative(),
      subscription: z.number().int().nonnegative(), routeClosed: z.number().int().nonnegative() }),
  })).max(32),
  events: z.array(z.object({
    at: z.number(), kind: z.enum(["runtime", "client", "foreground", "event_loop_gap"]),
    serverId: z.string().max(128).optional(), clientOrdinal: z.number().int().nonnegative().optional(),
    transport: diagnosticTransportSchema.optional(), runtimeStatus: diagnosticRuntimeStatusSchema.optional(),
    clientStatus: diagnosticClientStatusSchema.optional(), reason: diagnosticReasonSchema.optional(),
    closeCode: z.number().int().min(1000).max(4999).optional(),
    foreground: z.boolean().optional(), source: z.enum(["initial", "app_state", "android_blur", "android_focus", "plugin_release"]).optional(),
    delayMs: z.number().nonnegative().optional(),
  })).max(120),
});
export type RuntimeDiagnostic = z.infer<typeof runtimeDiagnosticSchema>;

export const reportSchema = z.object({
  deviceId: z.string().max(100),
  platform: z.enum(["ios", "android", "web"]),
  serverId: z.string().min(1),
  at: z.number(),
  pluginVersion: z.string().max(40).optional(),
  runtime: runtimeDiagnosticSchema.optional(),
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
