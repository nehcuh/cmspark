## DESIGN_VERDICT (#476)

The revision is a privilege design, not a shell restyle. Trust root is explicit: only the authenticated tray launch path may mint a daemon-resident 32-byte capability; overlay/HTTP/SSE/MCP/renderer cannot; role is resolved from that registry, not a client `surface` string; pairing shared-secret is a different domain. Bootstrap via inherited anonymous pipe (close-on-exec / Windows inherit allowlist; never argv, env, URL, file, HTML, cookie, logs), native-only proof, and pinned documents (`cmspark-desktop://app/` + bundle WKURLSchemeHandler; `https://cmspark-desktop.invalid/` + exclusive WebView2 map) are concrete. Same-user in-process attackers are correctly left inside the existing local-user boundary.

Slice order is the right fail-closed sequence. #477 is transitional Chromium and cannot close #476. Native read-only identity lands first; **native OS confirmation (NSAlert / TaskDialog) through the existing confirmation manager** is a hard gate before management, PTY/ACP, or Chrome foreground/tab control. Challenges bind connection, thread, normalized action/payload, expiry; single-use; disconnect/revoke/abort cancel; cancel wins an in-flight approve; renderer allowlist excludes approval. Singleton lock (including in-flight launch), parent-owned crash/kill teardown, no tray-credential fallback, no silent overlay promotion, no silent Chrome foreground fallback, and the compatibility matrix (explicit tray; omit-tray reject; extension cannot claim tray/desktop; summoner stays restricted; no `surface !== summoner` grant) match the baseline audit. Resource projection (no secrets/trust fields) and per-family schema/confirm/redaction bars are specific enough to implement against.

Nits for the owning later slice — not reasons to re-architect, and not work to dump on #480:

1. Store method-set version **or a frozen snapshot at issue**; remint on add must be mechanical in `desktop/capabilities.ts`, not a policy comment. A mutated global table must not enlarge live sessions.
2. Slice-2 negatives should **name** the legacy WS toggle allowlist: it must not bootstrap or grant desktop methods.
3. Slice-3 must test the inverse of “web id on desktop”: extension/overlay UI cannot approve a desktop-owned challenge.
4. T3 spawn must be the app-bundle binary (not `PATH`). Choose bootstrap/challenge TTLs against WebView2 cold start; test reconnect of an **activated** host after bootstrap TTL.
5. State WebView2 mapping as exclusive, no network fall-through.

Do not close #476 on #477 or #480. Launch identity + native confirmation remain prerequisites for slices 4–6.

DESIGN_VERDICT: APPROVE_WITH_NITS

## PROTOTYPE_VERDICT (#480)

`DesktopIdentityRegistry` is a bounded in-memory primitive, not a product grant. For that contract it is sound: 16-byte id + 32-byte secret; HMAC-SHA256 over the specified UTF-8 JSON array using the stored signing input; server-assigned connection id and protocol; `WeakMap` object-identity principals (cloned/claimed objects fail closed); frozen read-only method table excluding confirm/spawn/config writes; matching-connection failures consume the nonce; foreign sockets do not; `cancelChallenge` is connection-scoped; reconnect replaces `principal`; delayed old `disconnect` cannot drop the new one; `revoke` zeros the key; duplicate host session and 64-cap with reclaim of unactivated TTLs. Taking the stated tsc + six groups as passing, those groups are real negatives/lifecycle tests, not tautologies.

Keeping this unwired is correct. `issue()` remaining a public method is acceptable only while nothing in daemon/WS/HTTP/renderer imports it; integration must not expose it.

Nits — do **not** demand launcher, native host, pipe, auth-kind, or confirmation in this commit:

1. `DESKTOP_READ_METHODS` is process-global. Live principals would inherit later `includes()` growth without remint until restart. Snapshot at `issue` when moving to `capabilities.ts`.
2. Add (still isolated) cases: activated capability challengeable after bootstrap TTL; invalid `hostSessionId`; `protocolVersion` 0/NaN/non-integer; secret from capability A on id B.
3. Returned hex `secret` vs plan’s raw 32-byte pipe: define framing at the launcher slice; HMAC key must be raw bytes, not UTF-8 hex.
4. `challenge()` overwrites `pending` (reconnect-OK). A second host session is a launcher singleton problem, not this file’s.

#480 stays open. Passing this registry is not native hosting, not desktop WS, and not release evidence.

PROTOTYPE_VERDICT: APPROVE_WITH_NITS
