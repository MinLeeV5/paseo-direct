import { useEffect, useState } from "react";
import { SettingsCard, SettingsSwitch, TextInput } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { hostValuesSchema, type HostValues } from "../shared/settings";
import { messages } from "./messages";
import { Action, Field, Notice, styles, type Theme } from "./controls";
import { useHostSettings } from "./use-host-settings";
import type { CurrentHostRpc } from "./rpc";

export function HostSettings({ theme, locale, onSaved, rpc, connectionKey, foreground }: {
  theme: Theme; locale: "en" | "zh-CN"; onSaved: () => void; rpc: CurrentHostRpc; connectionKey: string; foreground: boolean;
}) {
  const settings = useHostSettings(rpc, connectionKey, foreground);
  const [draft, setDraft] = useState<HostValues>(hostValuesSchema.parse({}));
  const [addresses, setAddresses] = useState("");
  const [ignored, setIgnored] = useState("");
  const [revision, setRevision] = useState("");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<"validation" | "pcSaved" | null>(null);
  const m = messages(locale).text;
  const s = styles(theme);
  const ready = settings.status === "ready" ? settings : null;
  useEffect(() => {
    if (!ready || dirty) return;
    setDraft(ready.values); setAddresses(ready.values.customAddresses.join("\n"));
    setIgnored(ready.values.ignoredInterfaces.join("\n")); setRevision(ready.revision);
  }, [ready?.revision, dirty]);
  function change(values: Partial<HostValues>) { setDraft({ ...draft, ...values }); setDirty(true); setNotice(null); }
  const lines = (value: string) => [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  async function save() {
    const parsed = hostValuesSchema.safeParse({ ...draft, customAddresses: lines(addresses), ignoredInterfaces: lines(ignored) });
    if (!parsed.success) { setNotice("validation"); return; }
    if (await settings.save(parsed.data, revision)) { setDirty(false); setNotice("pcSaved"); onSaved(); }
  }
  const changedElsewhere = ready && dirty && revision !== ready.revision;
  if (!ready) return <View style={{ gap: 12 }}>
    <Notice theme={theme} tone={settings.status === "loading" ? "neutral" : "warning"}
      text={settings.status === "loading" ? m.loaded : settings.status === "invalid" ? m.invalidSettings : m.loadError} />
    {settings.status !== "loading" && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      <Action theme={theme} label={m.reload} onPress={() => { void settings.reload(); }} disabled={settings.saving} />
      {settings.status === "invalid" && <Action theme={theme} label={m.resetPc}
        onPress={() => { void settings.reset().then((saved) => { if (saved) onSaved(); }); }} disabled={settings.saving} />}
    </View>}
  </View>;
  const inputStyle = { ...s.input, ...s.mono, minHeight: 100, textAlignVertical: "top" as const };
  return <View style={{ gap: 18 }}>
    <SettingsCard>
      <SettingsSwitch label={m.pcEnabled} hint={m.pcEnabledHint} value={draft.enabled}
        onValueChange={(enabled) => change({ enabled })} disabled={settings.saving} />
      <SettingsSwitch label={m.autoDiscover} hint={m.autoDiscoverHint} value={draft.autoDiscover}
        onValueChange={(autoDiscover) => change({ autoDiscover })} disabled={settings.saving} />
    </SettingsCard>
    <Field theme={theme} label={m.custom} hint={m.customHint}>
      <TextInput accessibilityLabel={m.custom} value={addresses} onChangeText={(value) => { setAddresses(value); setDirty(true); setNotice(null); }}
        placeholder="192.0.2.10:6767" placeholderTextColor={theme.colors.foregroundMuted} multiline
        autoCapitalize="none" autoCorrect={false} editable={!settings.saving} style={inputStyle} />
    </Field>
    <Field theme={theme} label={m.ignored} hint={m.ignoredHint}>
      <TextInput accessibilityLabel={m.ignored} value={ignored} onChangeText={(value) => { setIgnored(value); setDirty(true); setNotice(null); }}
        placeholder="utun4" placeholderTextColor={theme.colors.foregroundMuted} multiline
        autoCapitalize="none" autoCorrect={false} editable={!settings.saving} style={inputStyle} />
    </Field>
    {(notice || settings.saveError || changedElsewhere) && <Notice theme={theme}
      tone={notice === "pcSaved" && !settings.saveError && !changedElsewhere ? "success" : "warning"}
      text={changedElsewhere ? m.changedElsewhere : settings.saveError ? m.saveError : m[notice!]} />}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      <Action theme={theme} primary icon="Check" label={settings.saving ? m.saving : m.save} onPress={() => { void save(); }}
        disabled={!dirty || !revision || settings.saving || Boolean(changedElsewhere)} />
      <Action theme={theme} variant="ghost" icon="RefreshCw" label={m.reload} onPress={() => { setDirty(false); setNotice(null); void settings.reload(); }} disabled={settings.saving} />
    </View>
  </View>;
}
