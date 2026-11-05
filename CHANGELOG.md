# Changelog

## 1.2.3 — 2026-11-06

- Give every native connection probe its own client identity. Paseo 0.15.0 resumes the active session when a background probe reuses its identity, revoking that session's forwarded host channels while the origin remains online.
- Reuse the native client factory, authentication, transport configuration and promotion. Keep native timeout defaults and reject offline routed origins immediately; release failed, expired and late connections without delaying the probe deadline.
- Keep bounded, passive connection history in memory for manually submitted diagnostics: disconnect categories, client replacements, heartbeat latency, foreground delays and message-type counters. No automatic uploads or message/file contents are collected.

## 1.2.2 — 2026-11-05

- Prevent stale native connection probes from replacing a newly verified direct or forwarded connection. Serialize handoff through the native probe slot, including asynchronous disposal of the previous connection, and recheck device preferences before activation.
- Keep native message synchronization connected when a connection replacement remains online. This addresses Paseo 0.15.0 leaving a new timeline owner disconnected and showing “Updating messages” after switching workspaces.
- Verify manual relay selection before replacing the active connection, preserve already working selections, and retain address ownership when a native connection change unloads the plugin during save.
- Include the plugin version in manually submitted diagnostics. Restart the client app once after upgrading to recreate any timeline owner that was already stuck.

## 1.2.1 — 2026-11-05

- Fix discovery with a long-running legacy supervisor whose `paseo.pid` omits `serverId`. Validate the runtime home using the daemon's explicit identity override or persisted `server-id`, so plugin initialization and forwarding management can proceed after a Paseo upgrade.
- Replace deployment addresses in documentation, the forwarding input placeholder, tests, and the distribution screenshot with documentation-only example addresses.

## 1.2.0 — 2026-11-04

- Add a per-device preferred relay PC for each target. Verify the direct connection to B and the route from B to A before adopting the verified native connection.
- Restore a verified original Paseo connection when B's direct transport or its upstream route fails. Retry with 30–300 second backoff, retaining cooldown across host plugin reloads.
- Keep one foreground policy owner across all host plugin instances. Respect manual connection pauses, cancel background work, and prevent direct discovery from overriding a selected relay preference.
- Add English / Simplified Chinese controls on forwarded targets and the target's plugin page. Require a saved original pairing before enabling automatic routing.

## 1.1.0 — 2026-11-04

- Add a host-forwarding section to use a Paseo PC as a VPN relay for other hosts. Manage native target registrations and explicitly select the app's route through that PC.
- Keep target credentials in the relay PC's native host registry. Exclude connection URIs and transport errors from plugin responses, preserve existing registrations, and limit removal to plugin-owned targets.
- Extend clean-install verification with a separate authenticated target daemon and requests routed through the relay PC.

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
