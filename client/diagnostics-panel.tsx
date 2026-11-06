import { Text, View } from "react-native";
import { Action, Badge, Notice, styles, type Theme } from "./controls";
import { messages } from "./messages";
import type { DirectSession, SessionState } from "./session";
import { VERSION } from "../shared/version";

export function DiagnosticsPanel({ theme, locale, state, session }: {
  theme: Theme; locale: "en" | "zh-CN"; state: SessionState; session: DirectSession;
}) {
  const { text: m, event } = messages(locale);
  const s = styles(theme);
  const date = (value: number | null) => value ? new Date(value).toLocaleTimeString(locale,
    { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : m.never;
  return <View style={{ gap: 18 }}>
    <Badge theme={theme} label={state.foreground ? m.foreground : m.background} dot tone={state.foreground ? "success" : "neutral"} />
    <View style={{ gap: 11 }}>
      {[
        [m.bridge, state.bridgeReady ? m.available : m.unavailable], [m.handshakes, state.handshakeConfirmed ? m.yes : m.pending],
        [m.storage, state.persisted ? m.yes : m.pending], [m.directCount, String(state.directActivations)],
        [m.relayCount, String(state.relayReturns)], [m.lastCheck, date(state.lastCheckedAt)],
        [m.nextCheck, date(state.nextCheckAt)], [m.version, VERSION], [m.pcVersion, state.connection?.daemonVersion ?? m.unknown],
      ].map(([label, value]) => <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", gap: 20 }}>
        <Text style={{ ...s.muted, flex: 1 }}>{label}</Text>
        <Text selectable style={{ ...s.mono, fontSize: 12, flexShrink: 1, textAlign: "right" }}>{value}</Text>
      </View>)}
    </View>
    {state.serverId && <Text selectable style={{ ...s.mono, fontSize: 11, color: theme.colors.foregroundMuted }}>{state.serverId}</Text>}
    <Notice theme={theme} text={m.reportHint} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Action theme={theme} icon="Send" label={m.sendReport} disabled={!state.serverId} onPress={() => { void session.sendReport(); }} />
      <Action theme={theme} variant="ghost" label={m.clearEvents} onPress={() => session.resetEvidence()} />
    </View>
    {!state.logs.length && <Text style={s.muted}>{m.noEvents}</Text>}
    <View style={{ gap: 14 }}>
      {state.logs.map((entry, index) => <View key={`${entry.at}-${index}`} style={{ flexDirection: "row", gap: 12 }}>
        <Text style={{ ...s.mono, fontSize: 11, color: theme.colors.foregroundMuted, paddingTop: 1 }}>{date(entry.at)}</Text>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.text}>{event(entry.message)}</Text>
          {entry.endpoint && <Text selectable style={{ ...s.mono, fontSize: 11, color: theme.colors.foregroundMuted }}>{entry.endpoint}</Text>}
        </View>
      </View>)}
    </View>
    <Text style={s.muted}>{m.privateApi}</Text>
  </View>;
}
