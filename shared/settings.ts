import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { parseEndpoint } from "./endpoints";

export const hostValuesSchema = z.object({
  enabled: z.boolean().default(true),
  autoDiscover: z.boolean().default(true),
  ignoredInterfaces: z.array(z.string().trim().min(1).max(128)).max(32).default([]),
  customAddresses: z.array(z.string().trim().min(1).max(255).refine((value) => {
    try { parseEndpoint(value); return true; } catch { return false; }
  }, "Use host:port, ws://host:port or wss://host:port without credentials.")).max(16).default([]),
});
export type HostValues = z.infer<typeof hostValuesSchema>;
export const hostPreferences = defineSettings({ id: "connection", scope: "host", version: 1, schema: hostValuesSchema });

export const managedConnectionSchema = z.object({
  endpoint: z.string().min(1).max(255), useTls: z.boolean(), addedAt: z.number().nonnegative(),
});
export type ManagedConnection = z.infer<typeof managedConnectionSchema>;
export const devicePreferencesSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  preferDirect: z.boolean().default(true),
  intervalSeconds: z.number().int().min(10).max(300).default(20),
  timeoutSeconds: z.number().int().min(1).max(10).default(3),
  language: z.enum(["system", "zh-CN", "en"]).default("system"),
  relayPauseUntil: z.number().nonnegative().default(0),
  excludedEndpoints: z.array(z.string().min(1).max(255)).max(64).default([]),
  managed: z.array(managedConnectionSchema).max(64).default([]),
});
export type DevicePreferences = z.infer<typeof devicePreferencesSchema>;
export function defaultDevicePreferences(mobile: boolean): DevicePreferences {
  return devicePreferencesSchema.parse({ version: 1, enabled: mobile });
}
