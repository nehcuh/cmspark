All verification complete. Here's my review.

---

## Dual review — summoner surface local STT origin (ADR-023 narrow amend)

### ⚠️ Process finding first: the attached patch is the WRONG diff

The review task describes the **`voice.stt.*` origin gate** (committed at HEAD as `42e1172` feat(summoner): allow local STT from summoner surface + `1d481af` docs + `b0f7642` fix). But `os-summoner-stt-origin-diff-20260822-233427.patch` contains the **uncommitted working-tree diff** (`wait_for` mode parsing, vault-browser one-shot `host_computer` L2, adapter Rule-12 text). Verified via `git status` / `git show`: none of the STT files (stt-handlers.ts, summoner-acl.ts, lifecycle.ts surface plumbing, ADR-023 §7.2) appear in the patch. I re-derived the real diff with `git show 42e1172` and reviewed the code at HEAD. **Review-pipeline nit: regenerate the patch for this batch.**

### What the real change is (committed)

- `stt-handlers.ts`: new `isVoiceSttOriginAllowed(origin, surface)` = `chrome-extension://` **OR** (`cmspark-tray://local` **AND** `surface==="summoner"`). `handleVoiceSttMessage` now uses it.
- `summoner-acl.ts`: `voice.stt.start/chunk/end/abort/partial_request` added to `SUMMONER_ALLOW`.
- `lifecycle.ts`: `surface: wsAuth.get(ws)?.surface` threaded into `handleMessage` session ctx.
- `message-router.ts`: passes `session?.surface` into STT handler ctx.
- ADR-023 §7.2 amended; tests for all gates; source-lock test for the surface plumbing.

### Hunt results

**1. Tray surface runs STT? Must NO — confirmed NO.** `stt-handlers.ts:62-65`: tray origin alone, with surface `tray`/`undefined`, → `origin_denied`. Tested (`voice-stt-handlers.test.ts` "handler rejects tray origin when surface is tray", plus missing-origin and `undefined` cases). ✅

**2. Can a tray connection spoof `surface=summoner`? — YES at handshake, but NOT an escalation.** `lifecycle.ts:990-991`: `st.surface = rawSurface === "summoner" ? "summoner" : "tray"` — the handshake field is client-claimed; the server "stamps" it from the auth message (there is no overwrite of the *handshake* claim — `stampCmsparkSurface` only overwrites per-message `__cmspark_surface`, composer-lease.ts:96-99). Any peer passing the HMAC proof can self-declare summoner. However: a secret-holding peer can already connect as **tray**, and tray is **not ACL-gated at all** (`summoner-acl.ts:31` `if (surface !== "summoner") return { ok: true }` — tray can call every tool). So claiming summoner unlocks only local whisper STT — strictly weaker than what tray already grants. This matches the documented threat model ("the shared secret is the real gate", lifecycle.ts:196-206). The "tray surface still origin_denied" guarantee is therefore client-honesty defense-in-depth, not a crypto boundary — consistent with S21, worth a one-line doc clarification (nit).

**3. ACL vs handler double gate — correct.** Summoner: voice.stt.* passes ACL + passes handler. Tray: passes ACL, denied by handler. `voice.model.*`: **denied at ACL for summoner** (test: "summoner denies voice.model.*"), **denied at handler for tray** (whisper-handlers.ts:218-235 chrome-extension only). Extension: unchanged. ✅

**4. Audio/base64 logging — clean.** `summarizeMessage` (lifecycle.ts:170-180) logs only type/thread_id/tool_name/skill_count. stt-handlers logs sessionId/seq/bytes/textLen/ms/modelId — never `rest.data`, never full transcript (header comment states the invariant). ✅

**5. God-mode / auto_approve skipping privacy ack — no bypass.** `privacy_ack_v2` enforced server-side in `stt-handlers.ts:192-194` and `whisper-handlers.ts:452-455`; no config auto-approve path reaches it. Summoner client hardcodes `privacy_ack_v2: true` (summoner/client.ts:205) but the mic press is the real user gesture (menu-bar-agent.ts:699). ✅

### Extra verifications
- **Session hijack**: `stt-session-service` binds session→peerId, `requirePeer` rejects cross-connection feed (stt-session-service.ts:636-645). ✅
- **No download from summoner**: `start()` probes model dir → `model_missing`; download only via `voice.model.download` (extension-gated). ✅
- **Engine guard**: server enforces `voice.sttEngine==="local"` (stt-handlers.ts:186-191). ✅
- **Tests**: 24/24 pass (voice-stt-handlers + summoner-acl) — tray-denied, summoner-allowed, voice.model ACL denial, handshake surface validation, source-lock plumbing test. ✅

### ADR-020 checklist
- Capability declaration present and accurate (Surface L0 overlay / L2 none / Compose local whisper only / Trust origin gate / Channel community). STT is composition on L0 — correctly not framed as L2 or a "中层 Agent". ✅
- Trust monotonicity: summoner is ACL-**restricted** (whitelist), strictly narrower than tray; no looser semantics inherited; no L2 unlocked. ✅
- originWs: no new `securityConfirmations.request` in this change. ✅
- Pack-first / no new runtime / no new confirm dialect (privacy_ack_v2 unchanged). ✅

### Nits (non-blocking)
1. Patch file mismatch (working-tree wait_for/vault-browser diff shipped under an STT-origin review label) — regenerate per-batch patches.
2. ADR-023 §7.2 could state explicitly that `surface` is a handshake-declared client claim (defense-in-depth, not proof) so the "tray still denied" guarantee isn't over-read.
3. Pre-existing (not new): any `chrome-extension://` id passes the scheme gate; documented residual, unchanged by this diff.

VERDICT: APPROVE_WITH_NITS
