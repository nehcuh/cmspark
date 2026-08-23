All checks are complete. Compiling the review verdict.

## Review — summoner surface local STT origin (commit `42e1172`)

**Scope note (process finding):** the attached patch (`os-summoner-stt-origin-diff-20260822-233427.patch`) is stale/mismatched — it captured the working-tree diff of the *other* in-progress batch (`wait_for` / vault-browser `host_computer`), not the STT change, because `42e1172` was already committed before the snapshot (base `b0f7642`). I reviewed the actual commit plus current worktree state via `git show` and direct reads.

### Hunt findings

1. **Tray surface STT — correctly denied.** `isVoiceSttOriginAllowed` (companion/src/voice/stt-handlers.ts:56-62) requires `surface === "summoner"` for `cmspark-tray://local`; lifecycle stamps omitted/other surfaces as `"tray"` server-side (companion/src/ws/lifecycle.ts:991). Behavior-tested (`voice-stt-handlers.test.ts` tray/undefined-surface cases). `[executed]` — targeted tests pass 24/24.

2. **Surface spoofing — not possible from message fields.** `surface` is stamped only during `auth.handshake` from the server-verified connection state (lifecycle.ts:990-991); duplicate handshakes post-auth are ignored (lifecycle.ts:965); the handler ctx reads `wsAuth.get(ws)?.surface` (lifecycle.ts:1313), never a client field; `stampCmsparkSurface` always overwrites client-supplied `__cmspark_surface` (companion/src/ws/composer-lease.ts:97-100). A local process holding `ws_secret` can claim `surface:"summoner"` — but it can equally forge `chrome-extension://` Origin (pre-existing documented residual, lifecycle.ts:191-194); trust anchors to the HMAC proof, no regression.

3. **ACL vs handler double gate — sound.** Summoner-surface connections must pass `SUMMONER_ALLOW` (lifecycle.ts:1038; the five `voice.stt.*` methods added in companion/src/ws/summoner-acl.ts:20-24); tray surface is un-gated by ACL but origin-denied by the handler. Extension connections send no `surface` (chrome-extension/src/background/ws-client.ts handshake = `{type, proof, protocol_version}`) → stamped `"tray"` → un-gated → extension STT unaffected. `voice.model.*` stays extension-only at both layers (whisper-handlers.ts:230; not on `SUMMONER_ALLOW`, test-locked).

4. **Audio/base64 logging — clean.** Handler logs byte counts only, never `rest.data`/transcripts (stt-handlers.ts:240-255, 325-331); session-service logs `audioBytes`/`textLen` (stt-session-service.ts:417-440); `summarizeMessage` excludes payload fields (lifecycle.ts:170-178).

5. **No god-mode/auto_approve bypass.** `privacy_ack_v2` enforced on the wire (validate.ts:474) and in the handler belt (stt-handlers.ts:192); `engine=local` precondition (stt-handlers.ts:185) means the user already completed the extension settings-page ack (`voice.model.set_engine` is extension+settings+privacy_ack gated). No `auto_approve*` path touches voice.

### ADR-020 checklist
Axes fit (composition on L0, no new runtime/agent) ✓ · no new confirm dialect ✓ · trust monotonicity holds (summoner surface strictly narrower than extension; no trust-elevation methods on `SUMMONER_ALLOW`) ✓ · no new `securityConfirmations.request` (originWs N/A) ✓ · capability declaration present in prompt ✓.

### Nits (non-blocking)
- The batch's diff snapshot captured the wrong diff (see scope note) — review-harness issue worth fixing, not a code defect.
- stt-handlers.ts:156 error string still says "requires chrome-extension:// origin" — now inaccurate for the summoner path; client-visible message text only.
- The "overlay mic press counts as `privacy_ack_v2` gesture" semantic lives only in code comments (summoner/client.ts:225, menu-bar-agent.ts:699); ADR-023 §7.2 says only "privacy_ack_v2 不放松" — a one-line ADR statement of the gesture-as-ack rule would make the privacy posture auditable.
- summoner-acl.test.ts:98-103 source-regex lock (reads lifecycle.ts/message-router.ts source text) is brittle to refactors; behavior coverage already exists elsewhere.

VERDICT: APPROVE_WITH_NITS
