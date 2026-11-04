import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { TextInput, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import {
  forwardingAddRpc, forwardingInputSchema, forwardingListRpc, forwardingRemoveRpc,
  type ForwardingAction, type ForwardingDirectory,
} from "../shared/forwarding";
import { PrivateBridge } from "./bridge";
import { publicError, type ErrorCode } from "./errors";
import { Action, styles, type Theme } from "./controls";
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
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ForwardingAction["code"] | "validation" | "connected" | "preference" | null>(null);
  const [connectionError, setConnectionError] = useState<ErrorCode | null>(null);
  const active = useRef(false), sequence = useRef(0), generation = useRef(0), writing = useRef(false);
  const { text: m, error, route } = messages(locale);
  const s = styles(theme);

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
    if (!foreground) { setPassword(""); return; }
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
      if (active.current && generation.current === current) setNotice(result?.code ?? success);
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
  const inputStyle = { ...s.mono, padding: 12, minHeight: 44, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 8, backgroundColor: theme.colors.surface1 };
  return <View style={{ gap: 16 }}>
    <Text style={s.muted}>{m.forwardHint}</Text>
    {!direct && <Text style={s.muted}>{m.forwardDirectHint}</Text>}
    {loadError && <Text accessibilityRole="alert" style={{ ...s.text, color: theme.colors.statusWarning }}>{m.forwardLoadError}</Text>}
    {!directory && !loadError && <Text style={s.muted}>{m.forwardLoading}</Text>}
    {directory && <>
      {!directory.hosts.length && <Text style={s.muted}>{m.forwardEmpty}</Text>}
      {directory.hosts.map((host) => <View key={host.registrationId} style={{ gap: 8, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <Text style={s.text}>{host.label ?? host.address}</Text>
        <Text selectable style={s.mono}>{host.address}{host.useTls ? ` · ${m.tls}` : ""}</Text>
        <Text style={s.muted}>{m[`forwardStatus_${host.status}`]}</Text>
        {host.status === "error" && <Text style={s.muted}>{m.forwardTargetError}</Text>}
        {host.serverId && <Text selectable style={s.muted}>{host.serverId}</Text>}
        {routes && host.serverId && host.serverId !== serverId && <SettingsSwitch label={m.autoForward} hint={m.autoForwardHint}
          value={routing.targets[host.serverId]?.originServerId === serverId} disabled={disabled}
          onValueChange={(value) => { void change(async () => { await routes.select(host.serverId!, value ? serverId : null); return null; }, "preference"); }} />}
        {host.serverId && routing.targets[host.serverId]?.originServerId === serverId && <>
          <Text style={s.muted}>{route(routing.targets[host.serverId].phase)}</Text>
          {routing.targets[host.serverId].error && <Text style={{ ...s.text, color: theme.colors.statusWarning }}>{error(routing.targets[host.serverId].error!)}</Text>}
        </>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Action theme={theme} compact label={m.forwardConnect} accessibilityLabel={`${m.forwardConnect} · ${host.label ?? host.address}`}
            disabled={disabled || loadError || host.status !== "online" || !host.serverId || host.serverId === serverId}
            onPress={() => { void change(async () => { await PrivateBridge.fromGlobal().activateForwardedHost(serverId, host.serverId!); return null; }); }} />
          <Action theme={theme} compact label={m.forwardRemove} accessibilityLabel={`${m.forwardRemove} · ${host.label ?? host.address}`}
            disabled={disabled || loadError} onPress={() => { void change(() => rpc.call(forwardingRemoveRpc, { registrationId: host.registrationId })); }} />
        </View>
      </View>)}
      <Text style={s.heading}>{m.forwardAdd}</Text>
      <View style={{ gap: 7 }}>
        <Text style={s.text}>{m.forwardAddress}</Text>
        <TextInput accessibilityLabel={m.forwardAddress} value={address} onChangeText={setAddress} placeholder="192.0.2.42:16767"
          placeholderTextColor={theme.colors.foregroundMuted} autoCapitalize="none" autoCorrect={false} editable={!disabled} style={inputStyle} />
      </View>
      <View style={{ gap: 7 }}>
        <Text style={s.text}>{m.forwardLabel}</Text>
        <TextInput accessibilityLabel={m.forwardLabel} value={label} onChangeText={setLabel} placeholder="PC A"
          placeholderTextColor={theme.colors.foregroundMuted} maxLength={128} editable={!disabled} style={inputStyle} />
      </View>
      <View style={{ gap: 7 }}>
        <Text style={s.text}>{m.forwardPassword}</Text>
        <TextInput accessibilityLabel={m.forwardPassword} value={password} onChangeText={setPassword} secureTextEntry
          autoCapitalize="none" autoCorrect={false} maxLength={1024} editable={!disabled} style={inputStyle} />
        <Text style={s.muted}>{m.forwardPasswordHint}</Text>
      </View>
    </>}
    {notice && <Text accessibilityRole="alert" style={{ ...s.text,
      color: ["saved", "exists", "removed", "connected", "preference"].includes(notice) ? theme.colors.statusSuccess : theme.colors.statusWarning }}>
      {m[`forwardResult_${notice}`]}
    </Text>}
    {connectionError && <Text accessibilityRole="alert" style={{ ...s.text, color: theme.colors.statusWarning }}>{error(connectionError)}</Text>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {directory && <Action theme={theme} primary label={busy ? m.saving : m.forwardSave} disabled={disabled || loadError || !address.trim()} onPress={add} />}
      <Action theme={theme} label={m.reload} disabled={disabled} onPress={() => { void reload(); }} />
    </View>
    <Text style={s.muted}>{m.forwardSharedHint}</Text>
  </View>;
}
