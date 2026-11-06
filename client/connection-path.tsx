import { Fragment } from "react";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { styles, type Theme } from "./controls";

export function ConnectionPath({ theme, nodes, online, label }: {
  theme: Theme; nodes: { icon: string; label: string }[]; online: boolean; label: string;
}) {
  const c = theme.colors;
  const color = online ? c.statusSuccess : c.foregroundMuted;
  return <View accessibilityLabel={label} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
    {nodes.map((node, index) => <Fragment key={`${index}-${node.icon}`}>
      <View style={{ width: nodes.length > 2 ? 76 : 88, alignItems: "center", gap: 8 }}>
        <View style={{ height: 44, width: 44, borderRadius: 14, borderWidth: 1, borderColor: c.border,
          backgroundColor: c.surface0, alignItems: "center", justifyContent: "center" }}>
          <Icon name={node.icon} size={21} color={index === 0 ? c.foregroundMuted : color} />
        </View>
        <Text numberOfLines={2} style={{ ...styles(theme).muted, color: c.foreground, textAlign: "center" }}>{node.label}</Text>
      </View>
      {index < nodes.length - 1 && <View style={{ flex: 1, minWidth: 10, flexDirection: "row", alignItems: "center", marginTop: 16, alignSelf: "flex-start" }}>
        <View style={{ height: 1, flex: 1, backgroundColor: online ? color : c.border, opacity: online ? 0.5 : 1 }} />
        <Icon name="ChevronRight" size={12} color={color} />
        <View style={{ height: 1, flex: 1, backgroundColor: online ? color : c.border, opacity: online ? 0.5 : 1 }} />
      </View>}
    </Fragment>)}
  </View>;
}
