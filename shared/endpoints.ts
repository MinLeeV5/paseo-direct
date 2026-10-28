export interface ParsedEndpoint { endpoint: string; useTls: boolean }

/** Credentials, paths and wildcard/loopback destinations never belong in a phone candidate. */
export function parseEndpoint(input: string): ParsedEndpoint {
  const value = input.trim();
  if (!value || value.length > 255 || /[\s@?#\\\u0000-\u001f]/.test(value)) throw new Error("invalid_endpoint");
  const schemeMatch = /^(ws|wss|tcp):\/\/(.*)$/i.exec(value);
  const scheme = schemeMatch?.[1].toLowerCase();
  let authority = schemeMatch?.[2] ?? value;
  if (schemeMatch && authority.endsWith("/ws")) authority = authority.slice(0, -3);
  if (authority.includes("/")) throw new Error("invalid_endpoint");
  const match = /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!match) throw new Error("invalid_endpoint");
  let host = match[1].toLowerCase();
  const bareHost = host.replace(/^\[|\]$/g, "");
  if (host.startsWith("[")) {
    const halves = bareHost.split("::");
    if (halves.length > 2 || !/^[0-9a-f:]+$/.test(bareHost)) throw new Error("invalid_endpoint");
    const left = halves[0] ? halves[0].split(":") : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part)) ||
      (halves.length === 1 ? left.length !== 8 : left.length + right.length >= 8)) throw new Error("invalid_endpoint");
    const groups = [...left.map((v) => parseInt(v, 16)), ...Array(8 - left.length - right.length).fill(0),
      ...right.map((v) => parseInt(v, 16))] as number[];
    if (groups.slice(0, 6).every((v) => v === 0) ||
      (groups.slice(0, 5).every((v) => v === 0) && groups[5] === 0xffff) ||
      (groups[0] & 0xffc0) === 0xfe80 || (groups[0] & 0xff00) === 0xff00) throw new Error("local_endpoint");
    let bestStart = -1, bestLength = 1;
    for (let i = 0; i < groups.length;) {
      if (groups[i] !== 0) { i++; continue; }
      let end = i;
      while (end < groups.length && groups[end] === 0) end++;
      if (end - i > bestLength) { bestStart = i; bestLength = end - i; }
      i = end;
    }
    const strings = groups.map((v) => v.toString(16));
    host = "[" + (bestStart < 0 ? strings.join(":") :
      strings.slice(0, bestStart).join(":") + "::" + strings.slice(bestStart + bestLength).join(":")) + "]";
  }
  if (!host.startsWith("[") && (host.startsWith(".") || host.endsWith(".") || host.includes("..") ||
    host.split(".").some((part) => part.length > 63 || part.startsWith("-") || part.endsWith("-")))) throw new Error("invalid_endpoint");
  if (bareHost === "localhost" || bareHost.endsWith(".localhost") || bareHost === "::" || bareHost === "::1" ||
    bareHost === "0.0.0.0" || /^127\./.test(bareHost) || /^fe[89ab][0-9a-f]:/i.test(bareHost)) throw new Error("local_endpoint");
  if (/^[\d.]+$/.test(bareHost)) {
    const parts = bareHost.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255) ||
      Number(parts[0]) === 0 || Number(parts[0]) === 127 || Number(parts[0]) >= 224 ||
      (Number(parts[0]) === 169 && Number(parts[1]) === 254)) throw new Error("invalid_endpoint");
    host = parts.map(Number).join(".");
  }
  const port = Number(match[2] ?? (scheme === "wss" ? 443 : scheme === "ws" ? 80 : 6767));
  if (port < 1 || port > 65535) throw new Error("invalid_endpoint");
  return { endpoint: `${host}:${port}`, useTls: scheme === "wss" };
}
