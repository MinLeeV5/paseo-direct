import { useEffect, useRef, useState } from "react";
import { settingsRpc } from "@getpaseo/plugin";
import type { SettingsState } from "@getpaseo/plugin/client";
import { hostValuesSchema, type HostValues } from "../shared/settings";
import type { CurrentHostRpc } from "./rpc";

const contracts = settingsRpc("connection");
type ReadState = { status: "loading" } | { status: "error"; error: string } |
  { status: "invalid"; revision: string; error: string } | { status: "ready"; revision: string; values: HostValues };

/** Official host settings protocol, using the current socket rather than the stale SDK hook closure. */
export function useHostSettings(rpc: CurrentHostRpc, connectionKey: string, foreground: boolean): SettingsState<typeof hostValuesSchema> {
  const [state, setState] = useState<ReadState>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mounted = useRef(true), writing = useRef(false), sequence = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  async function reload() {
    if (writing.current) return;
    const request = ++sequence.current;
    try {
      const read = await rpc.call(contracts.read, {});
      if (!mounted.current || request !== sequence.current) return;
      if (read.status === "invalid") setState({ status: "invalid", revision: read.revision, error: "settings_invalid" });
      else {
        const parsed = hostValuesSchema.safeParse(read.values);
        setState(parsed.success ? { status: "ready", revision: read.revision, values: parsed.data } :
          { status: "invalid", revision: read.revision, error: "settings_invalid" });
      }
    } catch { if (mounted.current && request === sequence.current) setState({ status: "error", error: "discovery" }); }
  }
  useEffect(() => {
    if (!foreground) return;
    void reload();
    const timer = setInterval(() => { void reload(); }, 10_000);
    return () => clearInterval(timer);
  }, [rpc, connectionKey, foreground]);
  async function write(values?: HostValues, revision?: string): Promise<boolean> {
    if (writing.current) return false;
    const expected = revision ?? ("revision" in state ? state.revision : null);
    if (expected === null) return false;
    writing.current = true; sequence.current++; setSaving(true); setSaveError(null);
    try {
      const result = values ? await rpc.call(contracts.write, { revision: expected, values }) :
        await rpc.call(contracts.reset, { revision: expected });
      if (result.status !== "saved") throw new Error("save_failed");
      const parsed = hostValuesSchema.parse(result.values);
      if (mounted.current) setState({ status: "ready", revision: result.revision, values: parsed });
      return true;
    } catch { if (mounted.current) setSaveError("save_failed"); return false; }
    finally { writing.current = false; if (mounted.current) setSaving(false); }
  }
  return { ...state, saving, saveError, save: (values, revision) => write(values, revision), reset: () => write(),
    reload: async () => { setSaveError(null); await reload(); } };
}
