import { devicePreferencesSchema, defaultDevicePreferences, type DevicePreferences } from "../shared/settings";
import { DirectError } from "./errors";

export interface PreferenceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const QUEUE_KEY = "__paseoDirectPreferenceWritesV1";
function queues(): Map<string, Promise<void>> {
  const existing = Reflect.get(globalThis, QUEUE_KEY);
  if (existing instanceof Map) return existing;
  const value = new Map<string, Promise<void>>();
  Reflect.set(globalThis, QUEUE_KEY, value);
  return value;
}

export class DevicePreferenceStore {
  constructor(private readonly storage: PreferenceStorage, private readonly serverId: string) {}
  private key(): string { return `@paseo-direct:v1:${this.serverId}`; }

  async read(mobile: boolean): Promise<{ values: DevicePreferences; warning: "storage" | "preferences_invalid" | null; fresh: boolean }> {
    await queues().get(this.key());
    return this.readRaw(mobile);
  }
  private async readRaw(mobile: boolean): Promise<{ values: DevicePreferences; warning: "storage" | "preferences_invalid" | null; fresh: boolean }> {
    try {
      const raw = await this.storage.getItem(this.key());
      if (raw === null) return { values: defaultDevicePreferences(mobile), warning: null, fresh: true };
      try {
        if (raw.length > 32_768) throw new Error("too_large");
        return { values: devicePreferencesSchema.parse(JSON.parse(raw)), warning: null, fresh: false };
      } catch {
        return { values: defaultDevicePreferences(false), warning: "preferences_invalid", fresh: false };
      }
    } catch { return { values: defaultDevicePreferences(false), warning: "storage", fresh: false }; }
  }

  private transaction<T>(run: () => Promise<T>): Promise<T> {
    const key = this.key();
    const next = (queues().get(key) ?? Promise.resolve()).then(run);
    const settled = next.then(() => {}, () => {});
    queues().set(key, settled);
    void settled.then(() => { if (queues().get(key) === settled) queues().delete(key); });
    return next;
  }
  private async save(values: DevicePreferences): Promise<void> {
    const serialized = JSON.stringify(devicePreferencesSchema.parse(values));
    try { await this.storage.setItem(this.key(), serialized); }
    catch { throw new DirectError("storage"); }
  }
  write(values: DevicePreferences): Promise<void> { return this.transaction(() => this.save(values)); }
  update(mobile: boolean, change: (values: DevicePreferences) => DevicePreferences): Promise<DevicePreferences> {
    return this.transaction(async () => {
      const loaded = await this.readRaw(mobile);
      if (loaded.warning) throw new DirectError(loaded.warning);
      const next = devicePreferencesSchema.parse(change(loaded.values));
      await this.save(next);
      return next;
    });
  }
}
