# Reconnect diagnostics implementation plan

**Goal:** Distinguish a native transport failure, a client replacement, and a foreground JavaScript stall when the phone intermittently reconnects or catches up on messages.

**Architecture:** A single passive recorder per App runtime keeps a bounded memory buffer. Each plugin instance holds a lease; the last release removes all subscriptions and timers. Reports include this buffer only when the user sends diagnostics. Capture state categories and message types, never message bodies, URLs, credentials, file paths, or arbitrary error text.

## Steps

- [x] Add regression tests for native disconnect history surviving recovery, client replacement, subscription cleanup across plugin reloads, bounded storage, safe message metadata, and foreground timer delays.
- [x] Add `client/diagnostics.ts` and an optional, bounded `runtime` field in `shared/contracts.ts`. Use existing runtime and client subscriptions; do not issue probes or change connection selection.
- [x] Acquire the observer in `index.client.tsx`, record Android focus/AppState separately, include a snapshot in the existing manual report, and release it on disposal. Keep native timeline compatibility unchanged.
- [x] Run TypeScript and behavior tests, check clean archive compilation with Paseo 0.15.0, load the diagnostic build into the current Mac without restarting its daemon, and inspect a fresh phone report before proposing another connection fix.

## Evidence motivating the change

The latest Android report identifies version 1.2.2. The Mac observes abnormal direct socket closures (1006), including 23:45:11, 23:59:27, and 00:03:00. Adjacent server metrics show no request queue or significant event-loop stall. Existing manual reports retain only the current connection and plugin actions, losing the native client's disconnect reason after recovery. A passive TCP header capture complements these observations but cannot explain the phone's internal state.

The current cause remains unconfirmed. A diagnostic release is not a claim that the intermittent failure has been fixed. Real deployment addresses remain in ignored local evidence only.

## Local verification

98 tests and TypeScript pass. The actual installed 0.15.0 SDK through a disposable loopback TCP forwarder records an abnormal 1006, preserves the categorized state, and passes the report schema without retaining URLs. The clean archive installs and compiles in an independent 0.15.0 daemon, and authenticated forwarding passes. Reviewer feedback about native file/timeline subscription types was reproduced with a failing test and corrected.

The diagnostic build was hot-loaded into the Mac plugin checkout; the prior checkout is backed up in ignored local evidence. The daily supervisor and daemon remain running. The compiled client catalog contained 1.2.3-diagnostic.1, and a real forwarded request still reached the saved target.

## Follow-up: isolate probe identities

The enhanced phone report keeps B online on the same client while A's route disconnects around B's periodic inactive Relay probe. Actual 0.15.0 source and a synthetic-session reproduction confirm that same-identity probe handshakes resume the active origin session and unconditionally revoke its routes. A new probe identity preserves the route. The phone only retained a network category and a route-close count, so the mechanism is confirmed while attribution of every phone event remains pending.

Use the existing native `deps.createClient` with a fresh identity per invocation to replace shared `deps.connectToDaemon` once. Preserve native factory configuration and the actual client for promotion; disable probe reconnect, return actual server identity/hostname, preserve native authentication errors, and bound cleanup without waiting on a hung close. Retain the native offline-origin guard and transport timeout defaults. Unsupported capabilities stop plugin operations instead of invoking the colliding connector.

- [x] Add failing behavioral tests for identity isolation, concurrency, pairing, promotion, reloads, capability failures, authentication, offline routed origins, deadlines, and late completion; implement the isolated connector and constructor hook.
- [x] Verify TypeScript and 108 tests; use actual SDK/daemon with official factory code and compare native Controllers from 0.13.0, 0.13.2, 0.15.0. Confirm native fallback and explicit promotion.
- [x] Complete code review, stable packaging and independent 0.15.0 daemon installation. No review blockers remain; the authenticated target, settings persistence and incorrect-password checks pass, and temporary processes are cleaned up.
- [ ] Commit and publish 1.2.3 under the user's existing authorization, then update the local plugin without restarting the daily daemon.
- [ ] Confirm sustained phone behavior after the user loads the fixed bundle.
