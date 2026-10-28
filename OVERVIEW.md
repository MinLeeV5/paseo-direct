# Paseo Direct

Automatically find a direct path from your phone to your PC while Paseo is in the foreground. Paseo Direct verifies each reachable address against your paired PC before saving it, and keeps the existing relay connection available for fallback.

![Paseo Direct interface](assets/screenshot.png)

## Get started

Pair your phone with this PC using relay, enable the plugin, and open **Paseo Direct** in the sidebar or this host’s plugin settings. Allow local network access when requested. Mobile foreground checks start automatically; desktop and web checks are off by default.

The PC must expose a TCP endpoint reachable from your device. The plugin reads the actual daemon listener; it does not change the listener, firewall, port forwarding or relay configuration.

## Choose how to connect

**Prefer direct** saves and activates a verified connection. **Let Paseo choose** saves new verified addresses and lets Paseo’s latency policy choose the transport. You can also connect to a specific address, use relay for 60 seconds, and remove inactive addresses added by this plugin.

Device preferences persist separately for each PC. Shared PC settings support ignored interfaces and additional DNS, IPv4, IPv6 or TLS WebSocket addresses. Automatic interface discovery uses IPv4.

## Data access

The plugin reads PC network interfaces and the daemon’s runtime listener. On the device it uses Paseo’s existing authentication in memory, manages direct connections through the App, and saves preferences in its own local storage namespace. Existing passwords and pairing credentials are excluded from plugin settings and diagnostics.

Diagnostics are sent only when you press **Send diagnostics to PC**. They include addresses, connection state and recent events. The PC keeps up to 12 latest device reports in memory and also writes them to plugin logs.

## Compatibility

Supports Paseo **0.13.0–0.13.2** using a guarded private App connection API. Revalidation is required before upgrading Paseo. Android 0.13.2 has completed the direct → relay → direct Wi-Fi test; iOS still needs device validation.

Checks run only in the foreground. There is no background service, NAT traversal or automatic IPv6 discovery. Paseo itself handles failure of a saved connection and relay fallback. Plain WebSocket connections follow Paseo’s existing trust model and should be used on trusted LAN / VPN networks; use properly configured TLS on untrusted networks.

Disabling the plugin stops its checks and leaves saved connections available in Paseo.
