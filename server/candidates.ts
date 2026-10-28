import type { NetworkInterfaceInfo } from "node:os";
import type { Candidate } from "../shared/contracts";
import { parseEndpoint } from "../shared/endpoints";
import { hostValuesSchema, type HostValues } from "../shared/settings";

export function usableIPv4(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a !== 0 && a !== 127 && a < 224 && !(a === 169 && b === 254);
}

export function collectCandidates(
  listen: string | null,
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined>,
  settings: HostValues = hostValuesSchema.parse({}),
): { candidates: Candidate[]; reason: string | null; reasonCode: "no_tcp" | "loopback" | "no_ipv4" | "disabled" | null } {
  if (!settings.enabled) return { candidates: [], reason: "Direct connections are disabled for this host.", reasonCode: "disabled" };
  const custom: Candidate[] = settings.customAddresses.map((value) => ({ ...parseEndpoint(value), interfaceName: "custom", source: "custom" }));
  const finish = (automatic: Candidate[], reason: string | null, reasonCode: "no_tcp" | "loopback" | "no_ipv4" | null) => {
    const seen = new Set<string>();
    const candidates = [...custom, ...automatic].filter((candidate) => {
      if (seen.has(candidate.endpoint)) return false;
      seen.add(candidate.endpoint); return true;
    }).slice(0, 16);
    return { candidates, reason: candidates.length ? null : reason, reasonCode: candidates.length ? null : reasonCode };
  };
  if (!settings.autoDiscover) return finish([], null, null);
  const match = listen?.match(/^(\[[^\]]+\]|[^:]+):(\d+)$/);
  if (!match) return finish([], "No TCP listener is available.", "no_tcp");
  const host = match[1].replace(/^\[|\]$/g, "");
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return finish([], "No bound TCP port is available.", "no_tcp");
  }
  if (host === "localhost" || host === "::1" || host.startsWith("127.")) {
    return finish([], "The daemon listens on loopback only.", "loopback");
  }
  if (!["0.0.0.0", "::"].includes(host)) {
    return usableIPv4(host)
      ? finish([{ endpoint: `${host}:${port}`, interfaceName: "listen", useTls: false, source: "interface" }], null, null)
      : finish([], "No IPv4 listener is available. Add a custom address.", "no_ipv4");
  }
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const [name, rows] of Object.entries(interfaces).sort(([a], [b]) => a.localeCompare(b))) {
    if (settings.ignoredInterfaces.includes(name)) continue;
    for (const row of rows ?? []) {
      if (row.internal || row.family !== "IPv4" || !usableIPv4(row.address)) continue;
      const endpoint = `${row.address}:${port}`;
      if (seen.has(endpoint)) continue;
      seen.add(endpoint);
      candidates.push({ endpoint, interfaceName: name, useTls: false, source: "interface" });
    }
  }
  return finish(candidates, "No IPv4 interface address is available.", "no_ipv4");
}
