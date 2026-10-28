import { useEffect, useState } from "react";
import { SettingsCard, SettingsSwitch, TextInput } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { hostValuesSchema, type HostValues } from "../shared/settings";
import { messages } from "./messages";
import { Action, styles, type Theme } from "./controls";
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
    <Text style={s.muted}>{settings.status === "loading" ? m.loaded : settings.status === "invalid" ? m.invalidSettings : m.loadError}</Text>
    {settings.status !== "loading" && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      <Action theme={theme} label={m.reload} onPress={() => { void settings.reload(); }} disabled={settings.saving} />
      {settings.status === "invalid" && <Action theme={theme} label={m.resetPc}
        onPress={() => { void settings.reset().then((saved) => { if (saved) onSaved(); }); }} disabled={settings.saving} />}
    </View>}
  </View>;
  const inputStyle = { ...s.mono, minHeight: 86, padding: 12, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 8, backgroundColor: theme.colors.surface1, textAlignVertical: "top" as const };
  return <View style={{ gap: 16 }}>
    <Text style={s.muted}>{m.pcHint}</Text>
    <SettingsCard>
      <SettingsSwitch label={m.pcEnabled} hint={m.pcEnabledHint} value={draft.enabled}
        onValueChange={(enabled) => change({ enabled })} disabled={settings.saving} />
      <SettingsSwitch label={m.autoDiscover} hint={m.autoDiscoverHint} value={draft.autoDiscover}
        onValueChange={(autoDiscover) => change({ autoDiscover })} disabled={settings.saving} />
    </SettingsCard>
    <View style={{ gap: 7 }}>
      <Text style={s.text}>{m.custom}</Text><Text style={s.muted}>{m.customHint}</Text>
      <TextInput accessibilityLabel={m.custom} value={addresses} onChangeText={(value) => { setAddresses(value); setDirty(true); setNotice(null); }}
        placeholder="192.168.1.10:6767" placeholderTextColor={theme.colors.foregroundMuted} multiline
        autoCapitalize="none" autoCorrect={false} editable={!settings.saving} style={inputStyle} />
    </View>
    <View style={{ gap: 7 }}>
      <Text style={s.text}>{m.ignored}</Text><Text style={s.muted}>{m.ignoredHint}</Text>
      <TextInput accessibilityLabel={m.ignored} value={ignored} onChangeText={(value) => { setIgnored(value); setDirty(true); setNotice(null); }}
        placeholder="utun4" placeholderTextColor={theme.colors.foregroundMuted} multiline
        autoCapitalize="none" autoCorrect={false} editable={!settings.saving} style={inputStyle} />
    </View>
    {(notice || settings.saveError || changedElsewhere) && <Text accessibilityRole="alert" style={{ ...s.text,
      color: notice === "pcSaved" ? theme.colors.statusSuccess : theme.colors.statusWarning }}>
      {changedElsewhere ? m.changedElsewhere : settings.saveError ? m.saveError : m[notice!]}
    </Text>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      <Action theme={theme} primary label={settings.saving ? m.saving : m.save} onPress={() => { void save(); }}
        disabled={!dirty || !revision || settings.saving || Boolean(changedElsewhere)} />
      <Action theme={theme} label={m.reload} onPress={() => { setDirty(false); setNotice(null); void settings.reload(); }} disabled={settings.saving} />
    </View>
  </View>;
}
