import { useState, type ReactNode } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

export type Theme = PluginSurfaceProps["theme"];
export type Tone = "neutral" | "success" | "warning" | "danger";
export type Tab = "connection" | "relay" | "settings";

export function styles(theme: Theme) {
  const c = theme.colors;
  return {
    text: { color: c.foreground, fontSize: 14, lineHeight: 21 },
    muted: { color: c.foregroundMuted, fontSize: 12, lineHeight: 18 },
    mono: { color: c.foreground, fontSize: 13, lineHeight: 20, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
    heading: { color: c.foreground, fontSize: 14, lineHeight: 21, fontWeight: "600" as const },
    input: { color: c.foreground, fontSize: 14, lineHeight: 21, minHeight: 48, paddingVertical: 12, paddingHorizontal: 14,
      borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.surface0 },
  };
}

export function toneColor(theme: Theme, tone: Tone) {
  return tone === "success" ? theme.colors.statusSuccess : tone === "warning" ? theme.colors.statusWarning :
    tone === "danger" ? theme.colors.statusDanger : theme.colors.foregroundMuted;
}

export function Action({ theme, label, accessibilityLabel, onPress, disabled, primary, compact, icon, variant = "secondary", style }: {
  theme: Theme; label: string; accessibilityLabel?: string; onPress: () => void; disabled?: boolean;
  primary?: boolean; compact?: boolean; icon?: string; variant?: "secondary" | "ghost" | "danger"; style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);
  const c = theme.colors;
  const color = primary ? c.accentForeground : variant === "danger" ? c.statusDanger : c.foreground;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [{ minHeight: 44, maxWidth: "100%", paddingVertical: compact ? 9 : 11,
      paddingHorizontal: compact ? 12 : 16, borderWidth: 1,
      borderColor: focused ? c.accent : primary ? c.accent : variant === "secondary" ? c.border : "transparent",
      backgroundColor: primary ? c.accent : pressed ? c.surface2 : variant === "secondary" ? c.surface1 : "transparent",
      borderRadius: 12, opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, style]}>
    {icon && <Icon name={icon} size={16} color={color} />}
    <Text style={{ ...styles(theme).text, color, fontSize: 13, fontWeight: "600", textAlign: "center", flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}

export function Surface({ theme, children, style }: { theme: Theme; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 18, overflow: "hidden" }, style]}>{children}</View>;
}

export function Badge({ theme, label, tone = "neutral", dot = false }: { theme: Theme; label: string; tone?: Tone; dot?: boolean }) {
  const color = toneColor(theme, tone);
  return <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, backgroundColor: theme.colors.surface2, borderRadius: 20, maxWidth: "100%" }}>
    {dot && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />}
    <Text style={{ color, fontSize: 12, lineHeight: 16, fontWeight: "500", flexShrink: 1 }}>{label}</Text>
  </View>;
}

export function SectionTitle({ theme, title, detail, trailing }: { theme: Theme; title: string; detail?: string; trailing?: ReactNode }) {
  return <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
    <View style={{ flex: 1, gap: 3 }}>
      <Text accessibilityRole="header" style={styles(theme).heading}>{title}</Text>
      {detail && <Text style={styles(theme).muted}>{detail}</Text>}
    </View>
    {trailing}
  </View>;
}

export function Notice({ theme, text, tone = "neutral" }: { theme: Theme; text: string; tone?: Tone }) {
  const color = toneColor(theme, tone);
  return <View accessibilityRole={tone === "danger" || tone === "warning" ? "alert" : undefined}
    accessibilityLiveRegion={tone === "success" ? "polite" : undefined}
    style={{ flexDirection: "row", gap: 9, alignItems: "flex-start", padding: 13, borderRadius: 12, backgroundColor: theme.colors.surface2 }}>
    <View style={{ paddingTop: 2 }}><Icon name={tone === "success" ? "Check" : tone === "warning" || tone === "danger" ? "CircleAlert" : "Info"} size={15} color={color} /></View>
    <Text style={{ ...styles(theme).muted, color, flex: 1 }}>{text}</Text>
  </View>;
}

export function Field({ theme, label, hint, children }: { theme: Theme; label: string; hint?: string; children: ReactNode }) {
  return <View style={{ gap: 7 }}>
    <Text style={{ ...styles(theme).text, fontWeight: "500" }}>{label}</Text>
    {children}
    {hint && <Text style={styles(theme).muted}>{hint}</Text>}
  </View>;
}

export function EmptyState({ theme, icon, title, description, children }: {
  theme: Theme; icon: string; title: string; description: string; children?: ReactNode;
}) {
  return <View style={{ alignItems: "center", paddingHorizontal: 20, paddingVertical: 26, gap: 9 }}>
    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: theme.colors.surface2,
      alignItems: "center", justifyContent: "center", marginBottom: 3 }}><Icon name={icon} size={22} color={theme.colors.foregroundMuted} /></View>
    <Text style={{ ...styles(theme).heading, textAlign: "center" }}>{title}</Text>
    <Text style={{ ...styles(theme).muted, textAlign: "center", maxWidth: 330 }}>{description}</Text>
    {children && <View style={{ marginTop: 5 }}>{children}</View>}
  </View>;
}

function TabButton({ theme, label, icon, selected, onPress, id }: {
  theme: Theme; label: string; icon: string; selected: boolean; onPress: () => void; id: Tab;
}) {
  const [focused, setFocused] = useState(false);
  const c = theme.colors;
  return <Pressable testID={`direct-tab-${id}`} accessibilityRole="tab" accessibilityState={{ selected }}
    onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 8, paddingVertical: 10,
      borderRadius: 10, borderWidth: 1, borderColor: focused ? c.accent : selected ? c.border : "transparent",
      backgroundColor: selected ? c.surface1 : "transparent", opacity: pressed ? 0.7 : 1,
      flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" })}>
    <Icon name={icon} size={16} color={selected ? c.foreground : c.foregroundMuted} />
    <Text style={{ ...styles(theme).text, fontSize: 13, fontWeight: selected ? "600" : "400",
      color: selected ? c.foreground : c.foregroundMuted, flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}

export function Tabs({ theme, value, onChange, labels }: {
  theme: Theme; value: Tab; onChange: (value: Tab) => void; labels: Record<Tab, string>;
}) {
  return <View accessibilityRole="tablist" style={{ flexDirection: "row", padding: 4, gap: 3,
    borderRadius: 14, backgroundColor: theme.colors.surface2 }}>
    {(["connection", "relay", "settings"] as const).map((id) => <TabButton key={id} theme={theme} id={id} label={labels[id]}
      icon={id === "connection" ? "Wifi" : id === "relay" ? "Network" : "Settings2"} selected={id === value} onPress={() => onChange(id)} />)}
  </View>;
}

export function Fold({ theme, title, subtitle, icon, open, onToggle, children }: {
  theme: Theme; title: string; subtitle?: string; icon?: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const s = styles(theme);
  return <Surface theme={theme} style={focused ? { borderColor: theme.colors.accent } : undefined}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onToggle}
      style={({ pressed }) => ({ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12,
        padding: 16, backgroundColor: pressed ? theme.colors.surface2 : "transparent" })}>
      {icon && <Icon name={icon} size={19} color={theme.colors.foregroundMuted} />}
      <View style={{ flex: 1, gap: 3 }}><Text style={s.heading}>{title}</Text>{subtitle && <Text style={s.muted}>{subtitle}</Text>}</View>
      <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} color={theme.colors.foregroundMuted} />
    </Pressable>
    {open && <View style={{ padding: 16, gap: 16, borderTopWidth: 1, borderTopColor: theme.colors.border }}>{children}</View>}
  </Surface>;
}
