import { useEffect, useState, useSyncExternalStore } from "react";
import { Platform, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView, SettingsCard, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import type { DirectSession } from "./session";
import { Action, Fold, styles } from "./controls";
import { HostSettings } from "./host-settings";
import { messages } from "./messages";
import { VERSION } from "../shared/version";
import type { CurrentHostRpc } from "./rpc";

type Props = PluginSurfaceProps & { session: DirectSession; rpc: CurrentHostRpc; settings?: boolean };
export function DirectScreen({ theme, session, rpc, settings = false }: Props) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [pcOpen, setPcOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const locale = session.locale();
  const { text: m, phase, error, event } = messages(locale);
  const c = theme.colors;
  const s = styles(theme);
  const preferences = state.preferences;
  const active = state.connection;
  const online = active?.status === "online";
  const holdUntil = Math.max(state.holdDirectUntil, preferences.relayPauseUntil);
  const held = holdUntil > now;
  const disabled = !state.bridgeReady || !state.preferencesReady || state.savingPreferences;
  useEffect(() => {
    if (!state.foreground) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), held ? 1000 : 10_000);
    return () => clearInterval(timer);
  }, [state.foreground, held]);
  const typeLabel = active?.type === "directTcp" ? m.direct : active?.type === "relay" ? m.relay :
    active?.type === "directSocket" ? m.socket : active?.type === "routed" ? m.routed : active?.type === "remoteSsh" ? m.ssh : m.waiting;
  const statusLabel = online ? m.online : active?.status === "connecting" ? m.connecting : m.offline;
  const date = (value: number | null) => value ? new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : m.never;
  const update = (change: Parameters<DirectSession["updatePreferences"]>[0]) => { void session.updatePreferences(change); };
  const candidates = state.discovery?.candidates ?? [];
  const savedConnections = active?.directConnections ?? [];
  const addresses = [...new Set([...candidates.map((row) => row.endpoint), ...savedConnections.map((row) => row.endpoint)])];
  function settingOptions(value: number, values: number[]) {
    return [...new Set([...values, value])].sort((a, b) => a - b).map((item) => ({ label: `${item} ${m.seconds}`, value: String(item) }));
  }
  const content = <View style={{ width: "100%", maxWidth: 740, alignSelf: "center", gap: 22 }}>
    {!settings && <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={{ ...s.heading, fontSize: 18 }}>Paseo Direct</Text><Text style={s.muted}>v{VERSION}</Text>
    </View>}
    <View style={{ borderLeftWidth: 3, borderLeftColor: online ? active?.type === "directTcp" ? c.statusSuccess : c.accent : c.statusWarning,
      paddingLeft: 16, gap: 7 }}>
      <Text style={s.muted}>{m.current} · {statusLabel}</Text>
      <Text accessibilityRole="header" style={{ ...s.text, fontSize: 32, lineHeight: 40, fontWeight: "600", letterSpacing: -0.5 }}>{typeLabel}</Text>
      <Text selectable style={s.mono}>{active?.endpoint ?? state.discovery?.label ?? "—"}</Text>
      <Text style={s.muted}>{phase(state.phase)}</Text>
      {held && <Text style={s.muted}>{m.cooldown} {Math.max(0, Math.ceil((holdUntil - now) / 1000))} {m.seconds}</Text>}
    </View>
    {state.error && <View style={{ backgroundColor: c.surface1, padding: 14, gap: 12, borderRadius: 8 }}>
      <Text accessibilityRole="alert" style={{ ...s.text, color: c.statusWarning }}>{error(state.error)}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Action theme={theme} label={m.retry} disabled={state.busy} onPress={() => { void session.start(); }} />
        {["preferences_invalid", "storage"].includes(state.error) && <Action theme={theme} label={m.restoreDevice}
          onPress={() => { void session.restorePreferences(); }} disabled={state.savingPreferences} />}
      </View>
    </View>}
    <SettingsCard>
      <SettingsSwitch label={m.automatic} hint={m.automaticHint} value={state.enabled}
        onValueChange={(enabled) => update({ enabled })} disabled={disabled} />
    </SettingsCard>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      <Action theme={theme} primary label={state.busy ? m.checking : m.check} disabled={disabled || state.busy || !state.foreground || held}
        onPress={() => { void session.check(); }} />
      <Action theme={theme} label={held ? m.resume : m.useRelay} disabled={disabled || !active?.relaySaved || !state.foreground || state.busy}
        onPress={() => { void (held ? session.resumeDirect() : session.useRelay()); }} />
    </View>
    <View style={{ gap: 8 }}>
      <Text style={s.heading}>{m.addresses}</Text>
      {!addresses.length && <Text style={s.muted}>{state.discovery?.reasonCode ?
        m[`reason_${state.discovery.reasonCode}`] : m.noAddresses}</Text>}
      {addresses.map((endpoint) => {
        const candidate = candidates.find((row) => row.endpoint === endpoint);
        const saved = savedConnections.find((row) => row.endpoint === endpoint);
        const managed = saved && preferences.managed.some((row) => row.endpoint === endpoint && row.useTls === saved.useTls);
        const current = saved?.id === active?.connectionId;
        const excluded = preferences.excludedEndpoints.includes(endpoint);
        const result = state.results.find((row) => row.endpoint === endpoint);
        const tags = [current ? m.active : saved ? m.saved : m.notSaved,
          candidate?.source === "custom" ? m.customSource : candidate?.interfaceName,
          saved ? managed ? m.managed : m.manual : null, (saved?.useTls ?? candidate?.useTls) ? m.tls : null,
          excluded ? m.excluded : null].filter(Boolean);
        return <View key={endpoint} style={{ gap: 7, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <Text selectable style={s.mono}>{endpoint}</Text>
          <Text style={s.muted}>{tags.join(" · ")}</Text>
          <Text style={{ ...s.muted, color: result?.error ? c.statusWarning : c.foregroundMuted }}>
            {result?.latencyMs != null ? `${result.latencyMs.toFixed(1)} ms` : result?.error ? error(result.error) : m.untested}
          </Text>
          {current && managed && <Text style={s.muted}>{m.removeActive}</Text>}
          {((candidate && !current) || (managed && !current)) && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {candidate && !current && <Action theme={theme} compact label={m.connect} accessibilityLabel={`${m.connect} · ${endpoint}`} disabled={disabled || state.busy || !state.foreground}
              onPress={() => { void session.check(true, endpoint); }} />}
            {managed && !current && <Action theme={theme} compact label={m.remove} accessibilityLabel={`${m.remove} · ${endpoint}`} disabled={disabled || state.busy}
              onPress={() => { void session.removeAddress(endpoint); }} />}
          </View>}
        </View>;
      })}
      {preferences.excludedEndpoints.length > 0 && <View style={{ gap: 8, paddingTop: 10 }}>
        <Text style={s.muted}>{m.excludedHint}</Text>
        <Text selectable style={s.mono}>{preferences.excludedEndpoints.join("\n")}</Text>
        <Action theme={theme} label={m.restoreExcluded} disabled={disabled} onPress={() => update({ excludedEndpoints: [] })} />
      </View>}
    </View>
    <Fold theme={theme} title={m.device} open={deviceOpen} onToggle={() => setDeviceOpen(!deviceOpen)}>
      <Text style={s.muted}>{m.deviceHint}</Text>
      {Platform.OS === "web" && <Text style={s.muted}>{m.desktopHint}</Text>}
      <SettingsCard>
        <SettingsSelect label={m.strategy} hint={m.strategyHint} value={preferences.preferDirect ? "direct" : "paseo"}
          options={[{ label: m.directFirst, value: "direct" }, { label: m.paseoDefault, value: "paseo" }]}
          onValueChange={(value) => update({ preferDirect: value === "direct" })} disabled={disabled} />
        <SettingsSelect label={m.interval} value={String(preferences.intervalSeconds)} options={settingOptions(preferences.intervalSeconds, [10, 20, 30, 60, 120, 300])}
          onValueChange={(value) => update({ intervalSeconds: Number(value) })} disabled={disabled} />
        <SettingsSelect label={m.timeout} value={String(preferences.timeoutSeconds)} options={settingOptions(preferences.timeoutSeconds, [1, 3, 5, 10])}
          onValueChange={(value) => update({ timeoutSeconds: Number(value) })} disabled={disabled} />
        <SettingsSelect label={m.language} value={preferences.language} options={[{ label: m.system, value: "system" }, { label: "简体中文", value: "zh-CN" }, { label: "English", value: "en" }]}
          onValueChange={(language) => update({ language })} disabled={disabled} />
      </SettingsCard>
    </Fold>
    <Fold theme={theme} title={m.pc} open={pcOpen} onToggle={() => setPcOpen(!pcOpen)}>
      <HostSettings theme={theme} locale={locale} rpc={rpc} foreground={state.foreground}
        connectionKey={`${state.serverId}:${active?.connectionId}:${active?.status}`}
        onSaved={() => { void session.refreshDiscovery(); }} />
    </Fold>
    <Fold theme={theme} title={m.diagnostics} open={diagnosticsOpen} onToggle={() => setDiagnosticsOpen(!diagnosticsOpen)}>
      <Text style={s.muted}>{state.foreground ? m.foreground : m.background}</Text>
      {[
        [m.bridge, state.bridgeReady ? m.available : m.unavailable], [m.handshakes, state.handshakeConfirmed ? m.yes : m.pending],
        [m.storage, state.persisted ? m.yes : m.pending], [m.directCount, String(state.directActivations)],
        [m.relayCount, String(state.relayReturns)], [m.lastCheck, date(state.lastCheckedAt)],
        [m.nextCheck, date(state.nextCheckAt)], [m.version, VERSION], [m.pcVersion, active?.daemonVersion ?? m.unknown],
      ].map(([label, value]) => <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
        <Text style={{ ...s.muted, flex: 1 }}>{label}</Text><Text selectable style={{ ...s.text, flexShrink: 1 }}>{value}</Text>
      </View>)}
      <Text selectable style={s.mono}>{state.serverId ?? "—"}</Text>
      <Text style={s.muted}>{m.reportHint}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Action theme={theme} label={m.sendReport} disabled={!state.serverId} onPress={() => { void session.sendReport(); }} />
        <Action theme={theme} label={m.clearEvents} onPress={() => session.resetEvidence()} />
      </View>
      {!state.logs.length && <Text style={s.muted}>{m.noEvents}</Text>}
      {state.logs.map((entry, index) => <View key={`${entry.at}-${index}`} style={{ gap: 3, borderLeftWidth: 1, borderLeftColor: c.border, paddingLeft: 12 }}>
        <Text style={s.muted}>{date(entry.at)}</Text><Text style={s.text}>{event(entry.message)}</Text>
        {entry.endpoint && <Text selectable style={s.mono}>{entry.endpoint}</Text>}
      </View>)}
      <Text style={s.muted}>{m.privateApi}</Text>
    </Fold>
  </View>;
  return settings ? content : <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }}
    contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>{content}</ScrollView>;
}
