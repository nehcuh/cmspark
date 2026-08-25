All evidence gathered. Here is my independent dual review.

## Dual external review — `overlay-hud-expand-b1b4` (worktree judge)

**Patch freshness**: diff header (`185345`) matches the current worktree state; I re-ran `git status`, `git diff HEAD`, `shasum`, and the compose test suite. Judging the **worktree** per the dual instruction (index still holds the stale Slice-B pin `367b3e29`; worktree pin `ed4dbfa0` == binary, verified byte-identical — R4 holds).

### Machine re-verified
- `SWIFT_TRAY_SHA256` (worktree `swift-tray-bridge.ts:59`) == `shasum -a 256 companion/dist/cmspark-tray` == `ed4dbfa0…9a5fda` ✓
- `summoner-workbench-compose.test.ts`: fail 0 ✓
- r1 folds confirmed closed: `handleSummonerKnowledgeImport` sends plaintext `content` (`menu-bar-agent.ts:996-1004`) → router text branch (`message-router.ts:412-414`); C-thin HTML has `data-sec` tabs + `loadCompose` fetching `/api/packs|mcp|skills|knowledge` ✓

### ADR-020 / REJECT gates (R1–R6) — all dark
- R1: `SUMMONER_ALLOW` has no `mcp.add`/`knowledge.import`/`config.set`; HTML allowlist matches; T3 hops hard-wire `companionClient` (tray). ✓
- R2: `thread.update` policy rewrites `updates` to `{ alias }` only. ✓
- R3: overlay source has zero Allow/Deny/确认; protocol rejects `summoner.confirm.*`. ✓
- R4: pin == binary. ✓
- R5: router overlay branch (`stampedSurface === "summoner"`) forces `allowTrust: !overlayApply` + `isOverlayEligiblePack` + forbidden-fields reject (`message-router.ts:3004-3038`). ✓
- R6: policy strips extra keys; router `known` filter drops unknown ids (`message-router.ts:2648-2657`). ✓

### Blocking issue — HUD rail state is dead; toggles are one-way on the primary Mac surface

The Mac HUD workbench — the core deliverable of this batch — reads skill/knowledge thread state from `sel?.thread?.active_skill_ids` / `sel?.thread?.active_knowledge_ids` where `sel` is the `thread.select` response. But `thread.select` returns `{ type: "thread.messages", messages, thread_id, trashed, run_status?, pending_tools? }` — **no `thread` key** (`message-router.ts:2075-2095`). I verified the handler end-to-end.

Chain of consequences (all confirmed in worktree code):

1. **State indicators never light**: `pushSummonerRail` (`menu-bar-agent.ts:830`, `:855`) — `activeSkills` / `attached` are always empty, so `on: activeSkills.has(s.name)` (`:842`) and `attached: attached.has(id)` (`:869`) are always `false`. The HUD never shows `●` on a toggled-on skill or attached knowledge doc.
2. **`skill.deactivate` is unreachable**: Swift `skillRowClicked` computes `on` from the always-false cached row and sends `!on` = `true` every time (`SummonerOverlay.swift:687`). DoD 3 "click toggles activate/deactivate" — only activate exists; a second click re-activates.
3. **Knowledge detach and multi-attach broken**: `handleSummonerKnowledgeAttach` (`menu-bar-agent.ts:976-977`) — `current` is always `[]`, so `next` is always `[id]`; clicking doc B replaces doc A, and there is no way to detach. DoD 4's `set_active` works as a one-slot add-only, and the ● display is dead.

This is the same defect class that triggered the r1 REJECT (a functional data-path hole invisible to the grep-level tests) — and it affects the **Mac HUD itself**, which product-r2 assumed was "能 toggle 双向" (`adversary-product-r2:150`). No test catches it: `summoner-workbench-compose.test.ts` greps for `summoner.skill.toggle`/`summoner.knowledge.attach` strings and never invokes the handlers against live thread state.

Supporting (same root cause, C-thin side): `summoner-web.ts:923` always posts `on:true` and `:938` posts `ids:[id]` (replace semantics) — one-way controls on the HTML page too (already flagged as product P12).

Fix direction (not blocking the verdict): read the active ids from `thread.list` (already summoner-allowed; `listWithPreviews` returns the full `Thread` incl. `active_skill_ids`/`active_knowledge_ids`) or add them to a select response, then drive both `●` state and the toggle computation off that.

### Non-blocking nits
- Binary (non-UTF-8) NSOpenPanel import stores base64 **as text** (`SummonerOverlay.swift:719` `?? base64EncodedString()` vs router `content` text branch) — `.md`/`.txt` primary case is correct.
- Pin comment still says "B0.5" (`swift-tray-bridge.ts:57`) though hash is B1–B4 (cosmetic; hash itself matches).
- Index hygiene (external-r2 BLOCK): restage only overlay compose files + pin `ed4dbfa0` before committing; index would still fail R4 (`367b3e29`).
- `handleSummonerInbound` switch has no `never`-typed default.

R1–R6 security gates hold and the r1 folds are genuinely closed, but the batch's primary surface ships with a dead state read that makes half of the advertised compose toggles non-functional and the status indicators inert — blocking per DoD 3/4 as written.

VERDICT: REJECT
