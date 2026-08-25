All checks are complete. Compiling the verdict.

---

# Dual external review — overlay-hud-expand-b1b4

## Machine verification [executed]

- `tsc --noEmit` exit 0 — reproduced.
- Full companion suite: **3590 tests, 0 failures** (superset of the claimed 119; summoner subset files: 171 pass).
- `SWIFT_TRAY_SHA256` in worktree `swift-tray-bridge.ts:59` = `ed4dbfa0…` = `shasum -a 256 companion/dist/cmspark-tray` — pin lockstep holds (R4).

## R-criteria (all inspected + test-backed)

- **R1** — `mcp.add`/`knowledge.import`/`config.set` absent from `SUMMONER_ALLOW` (summoner-acl.ts:14-45), enforced post-auth at lifecycle.ts:1038-1051; C-thin allowlist excludes them, no routes exist, HTTP-level test asserts non-dispatch (summoner-web.test.ts:377-405). Pass.
- **R2** — `thread.update` alias-only, `thread.delete` trash-only (summoner-acl.ts:77-106); handlers ride summonerClient so policy applies. Pass.
- **R3** — zero Allow/Deny/确认 chrome in SummonerOverlay.swift (regex-tested); protocol rejects `summoner.confirm.*`; SSE allowlist drops confirm frames. Pass.
- **R5** — router forces overlay-eligible + `allowTrust:false` + strips `workspace_path`/`force_takeover`/`confirmation_phrase` + trust-cookie/run-active checks (message-router.ts:3004-3040); HTML route additionally strips trust fields (HTTP test). Pass.
- **R6** — ACL strips extra keys (summoner-acl.ts:118-122, tested); router drops unknown ids (message-router.ts:2651-2652). Pass.
- **ADR-020** — declaration present and accurate; Composition axis via existing RPCs, no new runtime/confirm dialect; trust monotonic (overlay strictly weaker than tray); no new `securityConfirmations.request`. Pass.

## Blocking issue

**B1 — HUD ＋添加 MCP (and stdio toggle-on) dead-ends at the SEC-B L2 confirm; the add can never complete. Fail-closed, but DoD 2's "click toggles; ＋ 添加" is over-claimed.** [inspected — module-closed reasoning across five files]

- `handleSummonerMcpAdd` (menu-bar-agent.ts:918-938) hardcodes `transport:"stdio"` and sends `mcp.add` over the **tray** client with the default **5s** timeout (companion-client.ts:475).
- Router gate `requireMcpStdioSpawnConfirm` (message-router/handlers/mcp.ts:266, 398-410 for toggle-on of disabled stdio) awaits `session.requestConfirmation`, which lifecycle wires to `securityConfirmations.request(send, …, {originWs})` (lifecycle.ts:1294-1303) — the `security.confirmation.request` frame goes **only to the tray socket** (security-confirmation.ts:283; origin binding at :411 rejects any other responder).
- The tray `CompanionClient` has **no handler** for `security.confirmation.request` (companion-client.ts:541-581 just fans out to `appMessageCbs`; menu-bar-agent registers only the HUD-spike handler at :2000-2034). The P0a tray-parallel confirm (`tray.showConfirmDialog`) is wired **only** in tool/l2-admission.ts:1161 — not in the `session.requestConfirmation` path.
- Net effect: user fills the NSAlert form → 添加 → 5s hang → HUD shows raw English `Request timeout: mcp.add`; server denies at 45s; no server registered. Same dead-end for rail toggle-ON of a disabled stdio server. Toggling off / http servers / knowledge import (no gate, message-router.ts:2665) work.
- All four adversary reports marked DoD 2 pass on plumbing inspection only; no test exercises the tray-origin `mcp.add` end-to-end seam (unit tests inject `requestConfirmation`). Fix direction: answer `security.confirmation.request` on the launcher tray client with a Swift dialog (mirror P0a `showConfirmDialog`), or hide ＋添加/stdio-enable until wired.

## Non-blocking nits

1. **Stale git index**: staged `swift-tray-bridge.ts` still pins Slice-B `367b3e29…`; the compose HTML (234 lines summoner-web.ts), Tray.swift delta, and pin fix `ed4dbfa0…` are unstaged only. Committing the current index would land the wrong pin and drop the workbench. Restage before commit (external r2's original BLOCK; judged per worktree here).
2. C-thin HTML `/api/skills/toggle` hardcodes `on:true` (summoner-web.ts:923) — activate-only, cannot deactivate; Swift HUD does a real toggle.
3. C-thin HTML knowledge click replaces the whole active set with `[id]` (summoner-web.ts:938) instead of the Swift path's additive toggle (menu-bar-agent.ts:975-980).
4. Binary file fallback at SummonerOverlay.swift:719 base64-encodes non-UTF8 picks, which `handleSummonerKnowledgeImport` passes as plain `content` — imports gibberish instead of erroring.
5. No router-level test that unknown `knowledge.set_active` ids are silently dropped (message-router.ts:2651-2652, verified by inspection only).

Security posture is clean everywhere (R1-R6 pass, fail-closed); the blocker is functional over-claiming on the T3 path, same class as the r1 knowledge.import fold.

VERDICT: REJECT
