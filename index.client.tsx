import type { PluginClientContext, PluginSurfaceProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AppState, Platform } from "react-native";
import { DirectSession, type SessionState } from "./client/session";
import { DirectScreen } from "./client/screen";
import { discoverRpc, reportRpc, type ClientReport } from "./shared/contracts";
import { CurrentHostRpc } from "./client/rpc";

const DEVICE_KEY = "__paseoDirectDeviceV1";
function deviceId(): string {
  const previous = Reflect.get(globalThis, DEVICE_KEY);
  if (typeof previous === "string") return previous;
  const value = `direct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  Reflect.set(globalThis, DEVICE_KEY, value);
  return value;
}

function reportFrom(state: SessionState): ClientReport {
  return {
    deviceId: deviceId(), platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
    serverId: state.serverId!, at: Date.now(), foreground: state.foreground, stage: state.stage,
    bridgeReady: state.bridgeReady, activeType: state.connection?.type ?? null,
    activeEndpoint: state.connection?.endpoint ?? null, connectionStatus: state.connection?.status ?? null,
    relaySaved: state.connection?.relaySaved ?? false, savedEndpoints: state.connection?.directSaved ?? [],
    persisted: state.persisted, directActivations: state.directActivations, relayReturns: state.relayReturns,
    probes: state.results.slice(0, 16), events: state.logs,
  };
}

function SidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Network" active={currentScreen?.screenId === "diagnostics"}
    onPress={() => openScreen({ screenId: "diagnostics" })} />;
}

export default function contribute(client: PluginClientContext) {
  const mobile = Platform.OS === "ios" || Platform.OS === "android";
  const rpc = new CurrentHostRpc(() => client.rpc(discoverRpc, {}));
  const session = new DirectSession({
    mobile, foreground: !mobile || AppState.currentState === "active",
    locale: () => client.i18n?.locale ?? Intl.DateTimeFormat().resolvedOptions().locale,
    discover: () => rpc.discover(),
    report: async (state) => { await rpc.call(reportRpc, reportFrom(state)); },
  });
  const Screen = (props: PluginSurfaceProps) => <DirectScreen {...props} session={session} rpc={rpc} />;
  const Settings = (props: PluginSurfaceProps) => <DirectScreen {...props} session={session} rpc={rpc} settings />;
  const removeScreen = client.addScreen({ id: "diagnostics", title: "Paseo Direct", Component: Screen });
  const removeSidebar = client.addSidebarHeaderItem({ id: "direct", title: "Paseo Direct", Component: SidebarItem });
  const removeSettings = client.addSettingsScreen({ id: "diagnostics", title: "Paseo Direct", icon: "Network", Component: Settings });
  const appState = AppState.addEventListener("change", (state) => session.setForeground(state === "active"));
  const blur = Platform.OS === "android" ? AppState.addEventListener("blur", () => session.setForeground(false)) : null;
  const focus = Platform.OS === "android" ? AppState.addEventListener("focus", () => session.setForeground(AppState.currentState === "active")) : null;
  void session.start();
  return () => {
    session.dispose();
    appState?.remove();
    blur?.remove(); focus?.remove();
    removeSettings(); removeSidebar(); removeScreen();
  };
}
