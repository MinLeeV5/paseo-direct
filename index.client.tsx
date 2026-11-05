import type { PluginClientContext, PluginSurfaceProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AppState, Platform } from "react-native";
import { DirectSession, type SessionState } from "./client/session";
import { DirectScreen } from "./client/screen";
import { discoverRpc, reportRpc, type ClientReport } from "./shared/contracts";
import { CurrentHostRpc } from "./client/rpc";
import { preferredRoutes, type PreferredRoutes } from "./client/routing";
import { VERSION } from "./shared/version";
import { PrivateBridge } from "./client/bridge";
import type { DiagnosticLease } from "./client/diagnostics";

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
    serverId: state.serverId!, pluginVersion: VERSION, at: Date.now(), foreground: state.foreground, stage: state.stage,
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
  const foreground = !mobile || AppState.currentState === "active";
  let diagnostics: DiagnosticLease | null = null;
  try { diagnostics = PrivateBridge.fromGlobal().observeDiagnostics(foreground); } catch { /* Optional native metadata. */ }
  let routes: PreferredRoutes | null = null;
  try { routes = preferredRoutes(mobile); } catch { /* DirectSession presents missing bridge capabilities. */ }
  const routeLease = routes?.acquire(foreground);
  const rpc = new CurrentHostRpc(() => client.rpc(discoverRpc, {}));
  const session = new DirectSession({
    mobile, foreground,
    locale: () => client.i18n?.locale ?? Intl.DateTimeFormat().resolvedOptions().locale,
    discover: () => rpc.discover(),
    report: async (state) => { await rpc.call(reportRpc, { ...reportFrom(state), ...(diagnostics ? { runtime: diagnostics.snapshot() } : {}) }); },
  });
  const Screen = (props: PluginSurfaceProps) => <DirectScreen {...props} session={session} rpc={rpc} routes={routes} />;
  const Settings = (props: PluginSurfaceProps) => <DirectScreen {...props} session={session} rpc={rpc} routes={routes} settings />;
  const removeScreen = client.addScreen({ id: "diagnostics", title: "Paseo Direct", Component: Screen });
  const removeSidebar = client.addSidebarHeaderItem({ id: "direct", title: "Paseo Direct", Component: SidebarItem });
  const removeSettings = client.addSettingsScreen({ id: "diagnostics", title: "Paseo Direct", icon: "Network", Component: Settings });
  const setForeground = (value: boolean, source: "app_state" | "android_blur" | "android_focus") => {
    session.setForeground(value); routeLease?.setForeground(value); diagnostics?.setForeground(value, source);
  };
  const appState = AppState.addEventListener("change", (state) => setForeground(state === "active", "app_state"));
  const blur = Platform.OS === "android" ? AppState.addEventListener("blur", () => setForeground(false, "android_blur")) : null;
  const focus = Platform.OS === "android" ? AppState.addEventListener("focus", () => setForeground(AppState.currentState === "active", "android_focus")) : null;
  void session.start();
  return () => {
    session.dispose();
    routeLease?.dispose();
    diagnostics?.dispose();
    appState?.remove();
    blur?.remove(); focus?.remove();
    removeSettings(); removeSidebar(); removeScreen();
  };
}
