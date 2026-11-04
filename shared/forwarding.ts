import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { parseEndpoint } from "./endpoints";

export const forwardingInputSchema = z.object({
  address: z.string().trim().min(1).max(255).refine((value) => {
    try { parseEndpoint(value); return true; } catch { return false; }
  }, "Use a reachable host:port, ws://host:port or wss://host:port without credentials."),
  label: z.string().trim().max(128).default(""),
  password: z.string().max(1024).default(""),
});
export type ForwardingInput = z.infer<typeof forwardingInputSchema>;

export const forwardedHostSchema = z.object({
  registrationId: z.string(),
  serverId: z.string().nullable(),
  label: z.string().nullable(),
  address: z.string(),
  useTls: z.boolean(),
  status: z.enum(["connecting", "online", "offline", "error", "disabled"]),
});
export type ForwardedHost = z.infer<typeof forwardedHostSchema>;
export const forwardingDirectorySchema = z.object({
  serverId: z.string().min(1),
  hosts: z.array(forwardedHostSchema),
});
export type ForwardingDirectory = z.infer<typeof forwardingDirectorySchema>;

const actionSchema = z.object({
  code: z.enum(["saved", "exists", "removed", "unavailable", "not_managed", "limit"]),
});
export type ForwardingAction = z.infer<typeof actionSchema>;
export const forwardingListRpc = defineRpc({ name: "direct.forwarding.list", input: z.object({}), output: forwardingDirectorySchema });
export const forwardingAddRpc = defineRpc({ name: "direct.forwarding.add", input: forwardingInputSchema, output: actionSchema });
export const forwardingRemoveRpc = defineRpc({
  name: "direct.forwarding.remove", input: z.object({ registrationId: z.string().min(1).max(256) }), output: actionSchema,
});
