import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { Icon, Modal, TextInput, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import {
  forwardingAddRpc, forwardingInputSchema, forwardingListRpc, forwardingRemoveRpc,
  type ForwardingAction, type ForwardingDirectory,
} from "../shared/forwarding";
import { PrivateBridge } from "./bridge";
import { publicError, type ErrorCode } from "./errors";
import { Action, Badge, EmptyState, Field, Notice, SectionTitle, Surface, styles, type Theme } from "./controls";
import { messages } from "./messages";
import type { CurrentHostRpc } from "./rpc";
import type { PreferredRoutes, RoutingSnapshot } from "./routing";

const emptyRoutes: RoutingSnapshot = { targets: {} };
const noSubscribe = () => () => {};
const noSnapshot = () => emptyRoutes;

export function HostForwarding({ theme, locale, rpc, serverId, connectionKey, foreground, direct, routes }: {
  theme: Theme; locale: "en" | "zh-CN"; rpc: CurrentHostRpc; serverId: string;
  connectionKey: string; foreground: boolean; direct: boolean; routes: PreferredRoutes | null;
}) {
  const routing = useSyncExternalStore(routes?.subscribe ?? noSubscribe, routes?.getSnapshot ?? noSnapshot, noSnapshot);
  const [directory, setDirectory] = useState<ForwardingDirectory | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ForwardingAction["code"] | "validation" | "connected" | "preference" | null>(null);
  const [connectionError, setConnectionError] = useState<ErrorCode | null>(null);
  const active = useRef(false), sequence = useRef(0), generation = useRef(0), writing = useRef(false);
  const { text: m, error, route } = messages(locale);
  const s = styles(theme);
  const c = theme.colors;

  async function reload() {
    if (!active.current || writing.current) return;
    const request = ++sequence.current;
    try {
      const value = await rpc.call(forwardingListRpc, {});
      if (value.serverId !== serverId) throw new Error("identity");
      if (active.current && request === sequence.current) { setDirectory(value); setLoadError(false); }
    } catch { if (active.current && request === sequence.current) setLoadError(true); }
  }
  useEffect(() => {
    active.current = foreground; generation.current++;
    setBusy(writing.current);
    if (!foreground) { setAdding(false); setPassword(""); return; }
    void reload();
    const timer = setInterval(() => { void reload(); }, 5000);
    return () => { active.current = false; generation.current++; sequence.current++; clearInterval(timer); };
  }, [rpc, serverId, connectionKey, foreground]);

  async function change(action: () => Promise<ForwardingAction | null>, success: "connected" | "preference" = "connected") {
    if (!active.current || writing.current) return;
    const current = generation.current;
    writing.current = true; sequence.current++; setBusy(true); setNotice(null); setConnectionError(null);
    try {
      const result = await action();
      if (active.current && generation.current === current) {
        setNotice(result?.code ?? success);
        if (result?.code === "saved" || result?.code === "exists") {
          setAdding(false); setAddress(""); setLabel("");
        }
      }
    } catch (value) {
      if (active.current && generation.current === current) setConnectionError(publicError(value));
    } finally {
      writing.current = false;
      if (active.current) { setBusy(false); void reload(); }
    }
  }
  function add() {
    const input = forwardingInputSchema.safeParse({ address, label, password });
    if (!input.success) { setNotice("validation"); return; }
    setPassword("");
    void change(() => rpc.call(forwardingAddRpc, input.data));
  }
  const disabled = busy || !foreground;
  const showForm = Boolean(directory && (adding || !directory.hosts.length));
  const modalOpen = Boolean(showForm && directory?.hosts.length && foreground);
  const statusLabels = { online: m.targetOnline, connecting: m.targetConnecting, offline: m.targetOffline,
    error: m.targetError, disabled: m.targetDisabled };
  const feedback = <>
    {notice && <Notice theme={theme} text={m[`forwardResult_${notice}`]}
      tone={["saved", "exists", "removed", "connected", "preference"].includes(notice) ? "success" : "warning"} />}
    {connectionError && <Notice theme={theme} tone="warning" text={error(connectionError)} />}
  </>;
  const form = <View style={{ gap: 17 }}>
    <Field theme={theme} label={m.forwardAddress}>
      <TextInput accessibilityLabel={m.forwardAddress} value={address} onChangeText={setAddress} placeholder="192.0.2.42:16767"
        placeholderTextColor={c.foregroundMuted} autoCapitalize="none" autoCorrect={false} editable={!disabled}
        style={{ ...s.input, ...s.mono }} />
    </Field>
    <Field theme={theme} label={m.forwardLabel}>
      <TextInput accessibilityLabel={m.forwardLabel} value={label} onChangeText={setLabel} placeholder="Workstation"
        placeholderTextColor={c.foregroundMuted} maxLength={128} editable={!disabled} style={s.input} />
    </Field>
    <Field theme={theme} label={m.forwardPassword} hint={m.forwardPasswordHint}>
      <TextInput accessibilityLabel={m.forwardPassword} value={password} onChangeText={setPassword} secureTextEntry
        autoCapitalize="none" autoCorrect={false} maxLength={1024} editable={!disabled} style={s.input}
        returnKeyType="done" onSubmitEditing={() => { if (!disabled && !loadError && address.trim()) add(); }} />
    </Field>
    <Action theme={theme} primary icon="Plus" label={busy ? m.saving : m.forwardSave}
      disabled={disabled || loadError || !address.trim()} onPress={add} />
  </View>;
  return <View style={{ gap: 20 }}>
    <View style={{ gap: 5 }}>
      <Text accessibilityRole="header" style={{ ...s.heading, fontSize: 18, lineHeight: 25 }}>{m.relayTitle}</Text>
      <Text style={s.muted}>{m.relaySubtitle}</Text>
    </View>
    {!direct && <Notice theme={theme} text={m.forwardDirectHint} />}
    {loadError && <Notice theme={theme} tone="warning" text={m.forwardLoadError} />}
    {!directory && !loadError && <Notice theme={theme} text={m.forwardLoading} />}
    {directory && <>
      <SectionTitle theme={theme} title={m.targets} trailing={!showForm ?
        <Action theme={theme} compact icon="Plus" label={m.addTarget} disabled={disabled}
          onPress={() => { setAdding(true); setNotice(null); setConnectionError(null); }} /> : undefined} />
      {!directory.hosts.length && <Surface theme={theme}>
        <EmptyState theme={theme} icon="Network" title={m.noTargetsTitle} description={m.noTargetsHint} />
      </Surface>}
      {directory.hosts.map((host) => {
        const selected = Boolean(host.serverId && routing.targets[host.serverId]?.originServerId === serverId);
        const targetRoute = host.serverId ? routing.targets[host.serverId] : null;
        return <Surface theme={theme} key={host.registrationId}>
          <View style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}>
                <Icon name="Monitor" size={18} color={c.foregroundMuted} />
              </View>
              <Text style={{ ...s.heading, flex: 1 }}>{host.label ?? host.address}</Text>
              <Badge theme={theme} dot label={statusLabels[host.status]}
                tone={host.status === "online" ? "success" : host.status === "error" ? "warning" : "neutral"} />
            </View>
            <Text selectable style={{ ...s.mono, fontSize: 12, color: c.foregroundMuted }}>{host.address}{host.useTls ? ` · ${m.tls}` : ""}</Text>
            {host.status === "error" && <Notice theme={theme} tone="warning" text={m.forwardTargetError} />}
          </View>
          {routes && host.serverId && host.serverId !== serverId && <View style={{ borderTopWidth: 1, borderTopColor: c.border }}>
            <SettingsSwitch label={m.autoForward} hint={m.autoForwardHint} value={selected} disabled={disabled}
              onValueChange={(value) => { void change(async () => { await routes.select(host.serverId!, value ? serverId : null); return null; }, "preference"); }} />
          </View>}
          {selected && targetRoute && <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
            <Text style={s.muted}>{route(targetRoute.phase)}</Text>
            {targetRoute.error && <Notice theme={theme} tone="warning" text={error(targetRoute.error)} />}
          </View>}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 12, borderTopWidth: 1, borderTopColor: c.border }}>
            <Action theme={theme} compact icon="ArrowUpRight" label={m.forwardConnect} accessibilityLabel={`${m.forwardConnect} · ${host.label ?? host.address}`}
              disabled={disabled || loadError || host.status !== "online" || !host.serverId || host.serverId === serverId}
              onPress={() => { void change(async () => { await PrivateBridge.fromGlobal().activateForwardedHost(serverId, host.serverId!); return null; }); }} />
            <Action theme={theme} compact variant="danger" label={m.forwardRemove} accessibilityLabel={`${m.forwardRemove} · ${host.label ?? host.address}`}
              disabled={disabled || loadError} onPress={() => { void change(() => rpc.call(forwardingRemoveRpc, { registrationId: host.registrationId })); }} />
          </View>
        </Surface>;
      })}
      {showForm && !directory.hosts.length && <Surface theme={theme} style={{ padding: 16, gap: 17 }}>
        <SectionTitle theme={theme} title={m.forwardAdd} />
        {form}
      </Surface>}
    </>}
    {modalOpen && <Modal title={m.forwardAdd} open={modalOpen} onOpenChange={(open) => {
      setAdding(open);
      if (!open) { setPassword(""); setNotice(null); setConnectionError(null); }
    }}>
      <Modal.Content>
        {feedback}
        {form}
      </Modal.Content>
    </Modal>}
    {!modalOpen && feedback}
    <View style={{ gap: 8 }}>
      <Text style={s.muted}>{m.forwardSharedHint}</Text>
      <View style={{ alignSelf: "flex-start" }}><Action theme={theme} variant="ghost" icon="RefreshCw" label={m.reload} disabled={disabled} onPress={() => { void reload(); }} /></View>
    </View>
  </View>;
}
