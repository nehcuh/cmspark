Review complete. All machine checks executed, all four adversary lanes read in full, I1–I8 re-verified on HEAD, R1–R6 gates checked.

# Dual review — overlay-post222-residual @ a58b78f

## Machine kernel `[executed]`

| Check | Result |
|---|---|
| `HEAD:companion/src/summoner-web.ts` blob | `16149a8e…` **== dfab3eb** ≠ `03de168` (`e10d872…`) |
| `git diff 03de168 HEAD -- summoner-web.ts` | 312 lines (−230/+92): entire `03de168` HUD restyle reverted by the merge |
| `npx --offline tsx --test tests/summoner-web.test.ts` | **27 tests, 2 fail** — `GET / → 200 HTML workbench` (test:112-125) and `C-thin skills toggle / knowledge attach` (test:539-544) |
| Third red (static, lanes ran it) | `tests/summoner-shell-open.test.ts:71` expects `--window-size=720,120` vs `src/summoner/shell-open.ts:55` = `800,720` |
| `shasum -a 256 dist/cmspark-tray` | `ed4dbfa0…5fda` == `SWIFT_TRAY_SHA256` (`swift-tray-bridge.ts:59`) — **R4 holds** |
| Working tree | clean except untracked review docs; patch file current vs HEAD |

## Core finding — merge a58b78f is a false-resolution revert (R5 fires)

The merge message claims "`companion/src/summoner-web.ts`: accept main branch version (new HUD design)". The tree took the **other parent's** blob: `dfab3eb` branched from `6ce291d` and never contained the `03de168` folds. Result on HEAD: the entire Windows paper-HUD deliverable is gone (`--paper`, `.rail-btn`, `.list-scroll`, collapsed `720,120`, `placeWindow`), and with it the I1/I2 folds — while the `03de168` lock tests were kept, so main ships **red**. `PROJECT_CONTEXT.md` handoff ("nits + 纸面 HUD；dual both_ok；应先见 720×120 条") is now stale vs the tree.

## I1–I8 verdicts on HEAD

| ID | Status | Evidence |
|----|--------|----------|
| I1 skill `on:true` activate-only | **OPEN — R5** | `summoner-web.ts:924`; folded in `03de168` (`on:!on`), reverted by merge; lock test red `[executed]` |
| I2 knowledge `ids:[id]` replace-all | **OPEN — R5** | `summoner-web.ts:939`; same revert; lock test red `[executed]` |
| I3 Swift non-UTF-8 → base64 as body | **OPEN** (never claimed) | `SummonerOverlay.swift:719` → `menu-bar-agent.ts:998-1003` posts it as markdown `content` |
| I4 stdio toggle L2 stall | **CLOSED** | `menu-bar-agent.ts:1628-1631` tray ride + green lock test. Nit: systray2 `showConfirmDialog` never-promise → Win/Linux still a ~45s dead click with `.then(loadCompose)` swallowing the error |
| I5 Mac caps, no list scroll | **OPEN** (never claimed) | `prefix(12)` ×5 (`SummonerOverlay.swift:369,562,577,595,615`), `slice(0,8)` (`menu-bar-agent.ts:791`); `threadListStack` bare `NSStackView`, no `NSScrollView` |
| I6 `set_active` silent unknown-id drop | **OPEN** (never claimed) | `message-router.ts:2620-2629` filter, no error, no unit test |
| I7 C-thin flexbox scroll | **CLOSED** `[inspected]` | `summoner-web.ts:621-641` dfab3eb recipe on the shipped shell; not pixel-run; the *independent* `.list-scroll` loss is counted under the merge regression |
| I8 F-I-5 / PEM END / F-S-1 | **CLOSED** | `skill-engine.ts:1401-1410`, `distill.ts` PEM-through-END, `content-sanitizer.ts:114-127` — files untouched by the merge side |

## R gates

R1/R2/R3/R6 **hold**: only 3 files diverge from `03de168` (summoner-web.ts, shell-open.ts, launch-hidden.vbs); `summoner-acl.ts` intact — no `mcp.add`/`knowledge.import`/`config.set`, `thread.update` alias-only, `pack.apply` strips `allowTrust`/`workspace_path`/`force_takeover`/`confirmation_phrase`, router double-denies knowledge.import on summoner surface (`message-router.ts:2638`). R4 holds. **R5 fires** (I1/I2 above). ADR-020: declaration present; pack-first, no middle-agent, no new confirm dialect, trust monotonicity all fine — but eval-gate order step 1 "MACHINE green" fails on the 3 red tests.

## Adversary lanes (read in full)

impl REJECT / product REJECT / external REJECT / security APPROVE_WITH_NITS. The security lane's AWN rests on it honestly grading I1/I2 OPEN — but the repo state itself (merge note + surviving lock tests) constitutes the over-claim, so R5 stands. I confirm the three REJECT lanes' core allegation; I do not adopt product's I4-OPEN (original stall is fixed; the Win/Linux never-promise residual is a UX-honesty nit under the adjudicated boundary).

## Blocking issues

1. `a58b78f` merge resolution reverted `03de168`'s `companion/src/summoner-web.ts` — restore `on:!on` / `ids:next` + the HUD HTML on top of dfab3eb's flex constraints (or port flex onto the HUD). **Do not** fix by editing the lock tests to match the reverted HTML.
2. `companion/tests/summoner-web.test.ts:539-544` and `:112-125` red on HEAD (I1/I2 + workbench HTML contract).
3. `companion/tests/summoner-shell-open.test.ts:71` vs `companion/src/summoner/shell-open.ts:55` — retarget test or source to one window-size story.
4. Merge commit message over-claims the resolution; `PROJECT_CONTEXT.md` handoff stale.

Non-blocking residuals: I3, I5, I6 (never claimed folded; T2/T3), I4 systray2 dead-click UX, I7 not pixel-verified, no `wrapKnowledgeBlock` breakout unit test.

VERDICT: REJECT
