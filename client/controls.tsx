import type { ReactNode } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Platform, Pressable, Text, View } from "react-native";

export type Theme = PluginSurfaceProps["theme"];
export function styles(theme: Theme) {
  const c = theme.colors;
  return {
    text: { color: c.foreground, fontSize: 14, lineHeight: 21 },
    muted: { color: c.foregroundMuted, fontSize: 13, lineHeight: 20 },
    mono: { color: c.foreground, fontSize: 13, lineHeight: 20, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
    heading: { color: c.foreground, fontSize: 16, lineHeight: 24, fontWeight: "600" as const },
  };
}
export function Action({ theme, label, accessibilityLabel, onPress, disabled, primary, compact }: {
  theme: Theme; label: string; accessibilityLabel?: string; onPress: () => void; disabled?: boolean; primary?: boolean; compact?: boolean;
}) {
  const c = theme.colors;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ maxWidth: "100%", minHeight: compact ? 40 : 44, paddingVertical: compact ? 8 : 11, paddingHorizontal: 14,
      borderWidth: 1, borderColor: primary ? c.accent : c.border, backgroundColor: primary ? c.accent : pressed ? c.surface2 : c.surface1,
      borderRadius: 8, opacity: disabled ? 0.45 : pressed ? 0.8 : 1, justifyContent: "center" })}>
    <Text style={{ ...styles(theme).text, color: primary ? c.accentForeground : c.foreground, fontWeight: "500", textAlign: "center" }}>{label}</Text>
  </Pressable>;
}
export function Fold({ theme, title, open, onToggle, children }: {
  theme: Theme; title: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return <View style={{ gap: 14, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }}
      onPress={onToggle} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ ...styles(theme).heading, flexShrink: 1 }}>{title}</Text>
      <Text style={styles(theme).muted}>{open ? "−" : "+"}</Text>
    </Pressable>
    {open ? children : null}
  </View>;
}
