# Changelog

## 1.0.1 — 2026-10-29

- Support Paseo 0.13.0 and later without an upper version limit in the manifest and connection adapter. Keep runtime capability and PC identity checks.
- Update English / Simplified Chinese compatibility guidance and add regression coverage for newer versions and the minimum supported version.

## 1.0.0 — 2026-10-29

- Rename the prototype to Paseo Direct and add English / Simplified Chinese UI.
- Persist per-device, per-PC settings, connection preference, relay pause and plugin-owned addresses.
- Add shared PC settings for candidate discovery, additional WebSocket / TLS addresses and ignored interfaces.
- Support direct-first and Paseo-managed connection policies, explicit connection selection, and removal of inactive plugin-owned addresses.
- Cancel background probes, close unused and late sockets, serialize preference updates, and retry transient discovery failures.
- Resolve the current App connection for each RPC, including official host settings, so retained SDK closures do not break after transport changes.
- Preserve relay and existing authentication; verify PC identity before saving. Retain App-owned sockets across plugin reloads.
- Send diagnostics only on request. Add release packaging, checksums, CI and clean-install verification.
- Limit the private connection adapter to Paseo 0.13.0–0.13.2. IPv4 auto-discovery only; manually configured DNS / IPv6 / TLS endpoints are supported.

## 0.1.0

- Initial private-API prototype. Android v0.13.2 foreground discovery, saved direct connection, Wi-Fi-off relay fallback and Wi-Fi-on direct recovery were confirmed on a real phone.
