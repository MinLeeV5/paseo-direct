interface TimelineOwner {
  setConnected(value: boolean): void;
  dispose(): void;
}
export interface TimelineRuntime {
  getSnapshot(serverId: string): {
    connectionStatus: string;
    client: { getConnectionState(): { status: string } } | null;
  } | null;
  subscribe(serverId: string, listener: () => void): () => void;
  createViewedTimelineOwner?(serverId: string, ports: unknown): unknown;
}

const installed = Symbol.for("paseo-direct.timeline-connection-sync.v1");

/** Keep native timeline owners connected when React batches an online-to-online handoff. */
export function installTimelineConnectionSync(runtime: TimelineRuntime): boolean {
  const create = runtime.createViewedTimelineOwner;
  if (typeof create !== "function") return false;
  if (Reflect.get(create, installed)) return true;
  const wrapped = function (this: TimelineRuntime, serverId: string, ports: unknown): unknown {
    const boundClient = this.getSnapshot(serverId)?.client;
    const value = create.call(this, serverId, ports);
    if (!value || typeof value !== "object" || typeof Reflect.get(value, "setConnected") !== "function" ||
      typeof Reflect.get(value, "dispose") !== "function") return value;
    const owner = value as TimelineOwner;
    const dispose = owner.dispose;
    let disposed = false, connected: boolean | undefined;
    let unsubscribe = () => {};
    if (!Reflect.set(owner, "dispose", () => {
      if (disposed) return;
      disposed = true; unsubscribe(); dispose.call(owner);
    })) return value;
    const sync = () => {
      if (disposed) return;
      const current = this.getSnapshot(serverId);
      const online = Boolean(boundClient && current?.client === boundClient && current.connectionStatus === "online" &&
        boundClient.getConnectionState().status === "connected");
      if (connected === online) return;
      connected = online; owner.setConnected(online);
    };
    unsubscribe = this.subscribe(serverId, sync);
    sync(); // Native subscribe registers a listener without replaying its snapshot.
    return value;
  };
  Reflect.set(wrapped, installed, true);
  return Reflect.set(runtime, "createViewedTimelineOwner", wrapped);
}
