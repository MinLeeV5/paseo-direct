import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Platform, Text, View, type ScrollView as NativeScrollView } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, SettingsCard, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import type { DirectSession } from "./session";
import { Action, Badge, EmptyState, Fold, Notice, SectionTitle, Surface, Tabs, styles, type Tab } from "./controls";
import { ConnectionPath } from "./connection-path";
import { DiagnosticsPanel } from "./diagnostics-panel";
import { HostSettings } from "./host-settings";
import { HostForwarding } from "./forwarding";
import { messages } from "./messages";
import type { CurrentHostRpc } from "./rpc";
import type { PreferredRoutes, RoutingSnapshot } from "./routing";
import { publicError, type ErrorCode } from "./errors";

const emptyRoutes: RoutingSnapshot = { targets: {} };
const noSubscribe = () => () => {};
const noSnapshot = () => emptyRoutes;
type Props = PluginSurfaceProps & { session: DirectSession; rpc: CurrentHostRpc; routes: PreferredRoutes | null; settings?: boolean };

function Panel({ visible, children }: { visible: boolean; children: ReactNode }) {
  return <View accessibilityElementsHidden={!visible} importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
    style={{ display: visible ? "flex" : "none", gap: 22 }}>{children}</View>;
}

export function DirectScreen({ theme, session, rpc, routes, settings = false }: Props) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const routing = useSyncExternalStore(routes?.subscribe ?? noSubscribe, routes?.getSnapshot ?? noSnapshot, noSnapshot);
  const [tab, setTab] = useState<Tab>("connection");
  const [visited, setVisited] = useState({ connection: true, relay: false, settings: false });
  const [routeError, setRouteError] = useState<ErrorCode | null>(null);
  const [savingRoute, setSavingRoute] = useState(false);
  const [pcOpen, setPcOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const scroll = useRef<NativeScrollView>(null);
  const locale = session.locale();
  const { text: m, phase, error, route } = messages(locale);
  const c = theme.colors;
  const s = styles(theme);
  const preferences = state.preferences;
  const active = state.connection;
  const preferred = state.serverId ? routing.targets[state.serverId] : undefined;
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
  const update = (change: Parameters<DirectSession["updatePreferences"]>[0]) => { void session.updatePreferences(change); };
  function changeTab(value: Tab) {
    setTab(value); setVisited((previous) => ({ ...previous, [value]: true }));
    scroll.current?.scrollTo({ y: 0, animated: false });
  }
  const candidates = state.discovery?.candidates ?? [];
  const savedConnections = active?.directConnections ?? [];
  const addresses = [...new Set([...candidates.map((row) => row.endpoint), ...savedConnections.map((row) => row.endpoint)])];
  const addressRank = (endpoint: string) => savedConnections.some((row) => row.endpoint === endpoint && row.id === active?.connectionId) ? 0 :
    savedConnections.some((row) => row.endpoint === endpoint) ? 1 : 2;
  addresses.sort((a, b) => addressRank(a) - addressRank(b));
  const hostLabel = active?.hostLabel || state.discovery?.label || m.thisPc;
  const originLabel = active?.routedConnections?.find((row) => row.originServerId === active?.originServerId)?.label ??
    (preferred?.originServerId === active?.originServerId ? preferred?.originLabel : null) ?? m.relayPc;
  const pathNodes = [
    { icon: Platform.OS === "web" ? "Monitor" : "Smartphone", label: m.thisDevice },
    ...(active?.type === "routed" ? [{ icon: "Router", label: originLabel }] :
      active?.type === "relay" ? [{ icon: "Cloud", label: m.relay }] : []),
    { icon: "Laptop", label: hostLabel },
  ];
  function settingOptions(value: number, values: number[]) {
    return [...new Set([...values, value])].sort((a, b) => a - b).map((item) => ({ label: `${item} ${m.seconds}`, value: String(item) }));
  }
  const content = <View style={{ width: "100%", maxWidth: 780, alignSelf: "center", gap: 20, paddingBottom: 24 }}>
    <Tabs theme={theme} value={tab} onChange={changeTab} labels={{ connection: m.tabConnection, relay: m.tabRelay, settings: m.tabSettings }} />
    <Panel visible={tab === "connection"}>
      <Surface theme={theme} style={{ padding: 18, gap: 18 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text style={s.muted}>{m.current}</Text>
          <Badge theme={theme} label={statusLabel} dot tone={online ? "success" : active?.status === "connecting" ? "warning" : "neutral"} />
        </View>
        <View style={{ gap: 5 }}>
          <Text accessibilityRole="header" style={{ ...s.text, fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -0.6 }}>{typeLabel}</Text>
          <Text style={s.muted}>{phase(state.phase)}</Text>
        </View>
        <ConnectionPath theme={theme} nodes={pathNodes} online={online} label={`${m.connectionPath}: ${pathNodes.map((node) => node.label).join(" → ")}, ${statusLabel}`} />
        {active?.endpoint && <View style={{ backgroundColor: c.surface0, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
          flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name={active.activeTls ? "ShieldCheck" : "Link2"} size={14} color={c.foregroundMuted} />
          <Text selectable style={{ ...s.mono, flex: 1, fontSize: 12 }}>{active.endpoint}</Text>
        </View>}
        <View style={{ flexDirection: "row", gap: 9 }}>
          <Action theme={theme} primary compact icon="RefreshCw" label={state.busy ? m.checking : m.check}
            style={{ flex: 1 }} disabled={disabled || state.busy || !state.foreground || held} onPress={() => { void session.check(); }} />
          <Action theme={theme} compact icon={held ? "Play" : "ArrowLeftRight"} label={held ? m.resumeShort : m.relayShort}
            accessibilityLabel={held ? m.resume : m.useRelay} style={{ flex: 1 }}
            disabled={disabled || !active?.relaySaved || !state.foreground || state.busy}
            onPress={() => { void (held ? session.resumeDirect() : session.useRelay()); }} />
        </View>
        {held && <Text style={s.muted}>{m.cooldown} {Math.max(0, Math.ceil((holdUntil - now) / 1000))} {m.seconds}</Text>}
      </Surface>
      {state.error && <View style={{ gap: 9 }}>
        <Notice theme={theme} tone="warning" text={error(state.error)} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Action theme={theme} label={m.retry} icon="RefreshCw" disabled={state.busy} onPress={() => { void session.start(); }} />
          {["preferences_invalid", "storage"].includes(state.error) && <Action theme={theme} label={m.restoreDevice}
            onPress={() => { void session.restorePreferences(); }} disabled={state.savingPreferences} />}
        </View>
      </View>}
      <View style={{ gap: 10 }}>
        <SectionTitle theme={theme} title={m.connectionPolicy} />
        <SettingsCard>
          <SettingsSwitch label={m.automatic} hint={m.autoBrief} value={state.enabled}
            onValueChange={(enabled) => update({ enabled })} disabled={disabled} />
          {routes && state.serverId && (!!active?.routedConnections?.length || preferred) && <SettingsSelect
            label={m.preferredRelay} value={preferred?.originServerId ?? ""}
            options={[{ label: m.routeDefault, value: "" },
              ...(active?.routedConnections ?? []).map((row) => ({ label: row.label, value: row.originServerId })),
              ...(preferred && !active?.routedConnections?.some((row) => row.originServerId === preferred.originServerId) ?
                [{ label: preferred.originLabel, value: preferred.originServerId }] : [])]}
            disabled={disabled || savingRoute || !state.foreground} onValueChange={(value) => {
              setSavingRoute(true); setRouteError(null);
              void routes.select(state.serverId!, value || null).then(() => session.updatePreferences({}))
                .catch((value) => setRouteError(publicError(value))).finally(() => setSavingRoute(false));
            }} />}
        </SettingsCard>
        {preferred && <Text style={s.muted}>{preferred.originLabel} · {route(preferred.phase)}</Text>}
        {(routeError ?? preferred?.error) && <Notice theme={theme} tone="warning" text={error((routeError ?? preferred?.error)!)} />}
        {preferred && <Text style={s.muted}>{m.preferredRelayHint} {m.routeRecovery}</Text>}
      </View>
      <View style={{ gap: 10 }}>
        <SectionTitle theme={theme} title={m.addresses} trailing={addresses.length ? <Text style={s.muted}>{addresses.length} {addresses.length === 1 ? m.addressSingular : m.addressCount}</Text> : undefined} />
        <Surface theme={theme}>
          {!addresses.length && <EmptyState theme={theme} icon="Radar" title={m.noAddressesTitle}
            description={state.discovery?.reasonCode ? m[`reason_${state.discovery.reasonCode}`] : m.noAddresses}>
            <Action theme={theme} compact label={m.configureAddresses} onPress={() => { setPcOpen(true); changeTab("settings"); }} />
          </EmptyState>}
          {addresses.map((endpoint, index) => {
            const candidate = candidates.find((row) => row.endpoint === endpoint);
            const saved = savedConnections.find((row) => row.endpoint === endpoint);
            const managed = saved && preferences.managed.some((row) => row.endpoint === endpoint && row.useTls === saved.useTls);
            const current = saved?.id === active?.connectionId;
            const excluded = preferences.excludedEndpoints.includes(endpoint);
            const result = state.results.find((row) => row.endpoint === endpoint);
            const tags = [candidate?.source === "custom" ? m.customSource : candidate?.interfaceName === "listen" ? m.pcAddressSource : candidate?.interfaceName,
              saved ? managed ? m.managed : m.manual : m.notSaved, (saved?.useTls ?? candidate?.useTls) ? m.tls : null,
              excluded ? m.excluded : null].filter(Boolean);
            return <View key={endpoint} style={{ padding: 15, gap: 10, borderTopWidth: index ? 1 : 0, borderTopColor: c.border }}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
                  <Icon name={saved?.useTls || candidate?.useTls ? "ShieldCheck" : "Wifi"} size={16} color={current ? c.statusSuccess : c.foregroundMuted} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <Text selectable style={{ ...s.mono, fontSize: 12 }}>{endpoint}</Text>
                  <Text style={{ ...s.muted, fontSize: 11 }}>{tags.join(" · ")}</Text>
                </View>
                {current && <Badge theme={theme} label={m.active} tone="success" />}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 7, paddingLeft: 42 }}>
                <Text style={{ ...s.mono, fontSize: 11, color: result?.error ? c.statusWarning : c.foregroundMuted }}>
                  {result?.latencyMs != null ? `${result.latencyMs.toFixed(1)} ms` : result?.error ? error(result.error) : m.untested}
                </Text>
                {((candidate && !current) || (managed && !current)) && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 3 }}>
                  {candidate && !current && <Action theme={theme} compact label={m.connect} accessibilityLabel={`${m.connect} · ${endpoint}`}
                    disabled={disabled || state.busy || !state.foreground} onPress={() => { void session.check(true, endpoint); }} />}
                  {managed && !current && <Action theme={theme} compact variant="ghost" label={m.remove} accessibilityLabel={`${m.remove} · ${endpoint}`}
                    disabled={disabled || state.busy} onPress={() => { void session.removeAddress(endpoint); }} />}
                </View>}
              </View>
            </View>;
          })}
        </Surface>
        {preferences.excludedEndpoints.length > 0 && <View style={{ gap: 8 }}>
          <Text style={s.muted}>{m.excludedHint}</Text>
          <Text selectable style={{ ...s.mono, fontSize: 11 }}>{preferences.excludedEndpoints.join("\n")}</Text>
          <Action theme={theme} variant="ghost" label={m.restoreExcluded} disabled={disabled} onPress={() => update({ excludedEndpoints: [] })} />
        </View>}
        <Text style={{ ...s.muted, fontSize: 11 }}>{state.lastCheckedAt ? `${m.recentCheck} ${new Date(state.lastCheckedAt).toLocaleTimeString(locale,
          { hour: "2-digit", minute: "2-digit" })} · ` : ""}{m.foregroundOnly}</Text>
      </View>
    </Panel>
    {visited.relay && <Panel visible={tab === "relay"}>
      {state.serverId ? <HostForwarding theme={theme} locale={locale} rpc={rpc} serverId={state.serverId}
        routes={routes} foreground={state.foreground && tab === "relay"}
        direct={active?.type === "directTcp" || active?.type === "directSocket"}
        connectionKey={`${state.serverId}:${active?.connectionId}:${active?.status}`} /> : <Notice theme={theme} text={m.waiting} />}
    </Panel>}
    {visited.settings && <Panel visible={tab === "settings"}>
      <Fold theme={theme} icon="SlidersHorizontal" title={m.pc} subtitle={m.pcScope} open={pcOpen} onToggle={() => setPcOpen(!pcOpen)}>
        <HostSettings theme={theme} locale={locale} rpc={rpc} foreground={state.foreground && tab === "settings"}
          connectionKey={`${state.serverId}:${active?.connectionId}:${active?.status}`} onSaved={() => { void session.refreshDiscovery(); }} />
      </Fold>
      <View style={{ gap: 10 }}>
        <SectionTitle theme={theme} title={m.deviceSection} detail={m.deviceHint} />
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
        <Text style={s.muted}>{m.savedAddressHint}</Text>
        {Platform.OS === "web" && <Text style={s.muted}>{m.desktopHint}</Text>}
      </View>
      <Fold theme={theme} icon="Activity" title={m.diagnostics} subtitle={m.diagnosticsHint} open={diagnosticsOpen} onToggle={() => setDiagnosticsOpen(!diagnosticsOpen)}>
        <DiagnosticsPanel theme={theme} locale={locale} state={state} session={session} />
      </Fold>
    </Panel>}
  </View>;
  return settings ? content : <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: c.surface0 }}
    keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>{content}</ScrollView>;
}
