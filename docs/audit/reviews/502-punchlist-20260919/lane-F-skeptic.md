# Lane F — SKEPTIC
HEAD: 022b2f60
VERDICT: REJECT

## Claims ledger (claim → evidence → hold/fail)

| Claim | Evidence | Hold/fail |
|---|---|---|
| PR #512: chrome-extension **1416/1416**; companion **零新增失败** vs base `c7986a62` | PR body. HEAD is 7 commits past that punch-list SHA (incl. #513/#514). [inspected] `test(` count in `chrome-extension/tests` = **1516** across 159 files — not 1416, not the later commit's 1442. Did **not** re-run the extension suite. | **FAIL** |
| 022b2f60 / 62d948a0: companion targeted **180/180** + **82/82**; extension **1442/1442** | [executed] `p2-deep-diagnosis-batch` **2 fail**; `spawn-rollback-demote` **3 fail**. Failures are `INVALID_ARGS` / missing `goal`, not Windows path skips. | **FAIL** |
| 022b2f60: `spawn_worker` **goal 必填** on production dispatch | [executed] `executeCompanionTool("spawn_worker", {role_label})` returns `spawn_worker requires goal`. Check lives in `companion-dispatch.ts` case `"spawn_worker"`, not a helper. | **HOLD** (path) / tests around it **FAIL** (below) |
| 022b2f60: **kickWorkerChat 立即起跑** on production path | Dispatch case calls `execOpts.kickWorkerChat` **if bound**. `server.ts` binds `scheduleWhenLlmSlotAvailable` → `chatCreate`. Tests inject a recorder; **deleting `server.ts` kick impl stays green**. Unbound kick still `success:true` (`kicked:false`). Expert-team `invokeKick` fail-closes; this path does not. | **FAIL** as stated (“立即起跑”) |
| #504 live mirror is **same-process only**; restart → stubs | Comments, CHANGELOG, PR body all say process-memory. Settings copy does **not** promise restart-safe full history. [inspected] `live-rebuild-continuity.test.ts` drives `chatCreate` twice on one `ThreadManager` + a fresh manager on disk id `live-01`. | **HOLD** |
| #513 CHANGELOG: accept **不激活续跑**; **no auto-spawn** | [inspected] `FleetSuggestCard.onAccept` sends `chat.send` + `fleet.suggest.dismiss` only. Propose happy-path asserts no new thread / no `loop_state`. | **HOLD** (product) / accept “no arm” **test** is a source slice (see P-F-4) |
| #513 spec §5 eval gate / remaining `[ ]` treated as shipped | CHANGELOG Unreleased ships the trigger surface. Spec still `[ ]` on executor tests, prompt lock, extension tests, **判据评测 ≥6/8 ≤2/8**, and **既有测试全绿**. Eval is labelled 带外, but “既有全绿” is false at HEAD. | **FAIL** |
| Design D Goal Driver shipped (except G1) | No `goal_state` / `maxGoalRounds` / 目标卡. CHANGELOG describes G1 换段, not Goal Driver. G1-DONE NEVER table honest. | **HOLD** (no leak) |
| Observatory / native workbench implied shipped | No `Observatory` string under `chrome-extension/src`. E-DONE + spec say 另票. CHANGELOG does not name them. | **HOLD** |
| A/B/C/E/G1-DONE + CHANGELOG + PR = extra independent coverage | Same A/B/C/E/G1 story restated with **mutually inconsistent** pass counts (1339 / 1341 / 1352 / 1353 / 1374 / 1382 / 1416 / 1442). | **FAIL** (docs-as-coverage) |
| #508/#505/#509 “mutation would go red” | #509 has a real 100-round `handleMessage` test. #508 and several fleet/G1 pins are `readFileSync` + regex. | **mixed** |

## Findings

### P-F-1 — BLOCK
- File: `companion/tests/p2-deep-diagnosis-batch.test.ts:93-140`; `companion/tests/spawn-rollback-demote.test.ts:70-98`; GitHub PR #512 body “验证”; commit `022b2f60` “180/180 + 1442/1442”; commit `62d948a0` “82/82 + 1442/1442”
- Evidence: [executed] compiled via `tsc -p tsconfig.test.json`, ran `node scripts/run-tests.mjs` on those two files.

```
p2: spawn_worker pack_id apply failure …     FAIL  actual error = "spawn_worker requires goal …"
p2: spawn_worker without pack_id still creates worker … FAIL  success false
#292 pack apply failure restores parent …    FAIL  actual error_code INVALID_ARGS (expected SPAWN_PACK_FAILED)
#292 intent claim failure restores parent …  FAIL  INVALID_ARGS (expected SPAWN_INTENT_FAILED)
#292 already-orchestrator pack-failure …     FAIL  INVALID_ARGS (expected SPAWN_PACK_FAILED)
```

  New file `fleet-suggest-dispatch.test.ts` is 16/16 green — that is the **180/180** neighborhood, not the suite. PR #512’s “27 failing files == base, 零新增失败” was computed against punch-list SHA `c7986a62`; HEAD `022b2f60` adds goal-required and BOARD_MISSING soft-skip **without updating the #292 / P2 spawn fixtures**. These are not Windows symlink/darwin skips; they fail the same way on this Windows host through the project runner.
- Overclaim / lying test: “zero new failures” / “1416/1416” / “1442/1442” / “180/180” presented as if the branch is clean. Extension 1416 is unreproducible at HEAD ([inspected] raw `test(` ≈ 1516; later commits already claimed 1421–1442). I did not run the full companion suite (Windows hang is disclosed in the PR — that disclosure does not license targeted-only green).
- What would still be green if production were broken: the **new** goal/kick tests in `fleet-suggest-dispatch.test.ts` plus any file they actually ran. The **old** spawn tests are currently red, so they cannot be cited as coverage.
- Distinct because: this is a verification lie about the branch, not a missing feature. Goal-required itself holds (see Overturned).
- Suggested fix: add `goal` to `mintedSpawnParams` / P2 fixtures; re-decide #292 intent test vs BOARD_MISSING (once goal is present that test would assert `SPAWN_INTENT_FAILED` on a path that now returns `success:true` + `intent_claim.skipped`); stop quoting historical 1416/1442; tick or unclaim spec §5 “既有测试全绿”. Do not merge on a “zero new failures” sentence.

### P-F-2 — MAJOR
- File: `companion/src/tool/companion-dispatch.ts:345-370`; `companion/src/server.ts:765-793`; `companion/src/orchestrator/expert-team.ts:395-397`; `companion/tests/fleet-suggest-dispatch.test.ts:351-390`
- Evidence: [inspected] production case:

```ts
if (typeof execOpts?.kickWorkerChat === "function") {
  await execOpts.kickWorkerChat({ threadId: r.worker.id, message: brief })
  kicked = true
}
return { success: true, data: { brief_persisted: true, kicked, ...(kicked ? {} : { note: "…no kick channel…" }) } }
```

  [executed] the “kicks the worker” test passes a **recorder** as `kickWorkerChat` and asserts `kicks.length === 1` and `r.data.kicked === true`. `kicked` is tautological with “we passed a function”. Catalog copy (`tool-definitions-catalog.json` spawn_worker description) says the worker “starts running on it immediately”.
- Overclaim / lying test: commit 022b2f60 “kickWorkerChat 立即起跑（走既有 LLM 并发闸）”. The test never enters `server.ts`’s `scheduleWhenLlmSlotAvailable` / `chatCreate`. Mutate-in-mind: **delete the `kickWorkerChat` closure in `server.ts`** → this test stays green; **delete the `if (execOpts?.kickWorkerChat)` call** → this test goes red. So the dispatch *call* is pinned; the production *start* is not. Contrast expert-team `invokeKick`: unbound kick **refuses** the empty worker. Plain `spawn_worker` still persists a brief and returns success.
- What would still be green if production were broken: `fleet-suggest-dispatch` kick test, catalog regex, any spawn test that does not pass `kickWorkerChat` (P2 — currently red for other reasons).
- Distinct because: P-F-1 is “they didn’t run old tests”. This is “the new kick test mocks away the production start”.
- Suggested fix: fail-close like `invokeKick` when the channel is missing; add one test that binds the **server** kick (or asserts `chatCreate` scheduled with `skipUserMessage:true` and the brief). Do not treat `kicked:true` as proof the LLM loop ran.

### P-F-3 — MAJOR
- File: `docs/superpowers/specs/2026-09-19-fleet-trigger-surface.md:69-76`; `CHANGELOG.md:7`; commit `21e3d18b` / `7ef7ecba`
- Evidence: [inspected] spec §5 still:

```
- [ ] companion 单测：executor 零变更 …   // tests actually exist in fleet-suggest-dispatch.test.ts
- [x] lockstep + 行为
- [ ] 提示词源码锁 …                      // test exists (source lock)
- [ ] extension 单测 …                    // fleet-suggest-card.test.ts exists
- [ ] 判据评测 … ≥6/8 / ≤2/8 【带外…关票前】
- [ ] 既有 fleet/task_loop/ws 测试全绿.   // false: P-F-1
```

  CHANGELOG Unreleased writes #513 as a delivered user-visible feature (“点「派 worker 并行做」仅发送…不激活续跑”). Commit 21e3d18b says the eval script is 关票前带外 — honest there — then still reports “companion 定向 131/131、extension 全量 1431/1431”.
- Overclaim / lying test: unchecked acceptance boxes + an explicit eval gate, while CHANGELOG/PR-adjacent copy treats the slice as shipped. “既有测试全绿” is not a stale checkbox: it is currently false (P-F-1).
- What would still be green if production were broken: the eval gate was never run, so a prompt that proposes on sequential tasks / never proposes on parallel tasks cannot fail CI.
- Distinct because: this is spec-vs-ship, not the spawn-kick mock.
- Suggested fix: either run/record the 8+8 eval or keep #513 open; check the boxes that really have tests; do not put “既有全绿” next to five red spawn tests.

### P-F-4 — MAJOR
- File: `chrome-extension/tests/message-quiet-pr6.test.ts:250-265`; `chrome-extension/tests/fleet-suggest-card.test.ts:110-133`; `companion/tests/fleet-suggest-dispatch.test.ts:211-248,392-394`; `companion/tests/round-limit-exit.test.ts:1-71`; `companion/tests/archive-stub-args.test.ts:108-115`
- Evidence: [inspected] these assert `readFileSync` + `assert.match` / `includes`, not the runtime effect.

  - #508 (PR #512’s answer to “mutate 后全套仍绿”) is **still** a ChatView source lock (`pendingConfirmIdsFromTools`, `itemIsLast && threadBusy`, `totalFailed > 0`). No reducer/render test of a worker pending confirm flipping a historical chip.
  - “accept must not inject loop autonomy” slices `FleetSuggestCard` source and `!includes("task_loop.arm")`. [inspected] production `onAccept` (LoopStatusRow.tsx:222-226) really only sends `buildFleetAcceptMessage` (`type:"chat.send"`) + dismiss — product holds. The lock misses `onAccept` calling `loopArmMessage()` (string lives outside the slice). Button still uses `styles.armBtn` (line 252).
  - Catalog `"required": ["goal"]` is a 4000-char window regex. Runtime goal check is real (P-F-1/Overturned); this regex is not.
  - `round-limit-exit.test.ts` is 100% adapter source lock. #509 `loop-status-broadcast.test.ts` **does** drive `handleMessage` for 100 mocked rounds — that one is a real passport for the armed G1 label. The G1-DONE table citing round-limit-exit #4 “恰好 2 处 circuit_breaker” as proof same-tool/API still break is counting assignment sites.
  - `archive-stub-args` still has the `#510` “type-safe kill mutation stays green” regex; `#510` added a real `chatCreate` persist test (`archive-stub-assistant-persist.test.ts`). Keeping the regex does not add coverage.
- Overclaim / lying test: PR #512 and lane DONE reports treat source locks as mutation evidence. Several would stay green under a behavior-preserving rename, a helper extract, or a second send of `task_loop.arm`.
- What would still be green if production were broken: #508 if the JSX kept those identifiers but wired the wrong props; no-arm if `onAccept` called `loopArmMessage()`; catalog lock if runtime dropped `goal` but JSON still said required; G1 adapter exit if only the kernel tests ran (they inject `terminal:"round_limit"` and never execute the adapter while-loop).
- Distinct because: P-F-1 is tests that are already red; this is tests that stay green when the thing they advertise breaks.
- Suggested fix: for #508, dispatch a pending confirm for thread B and assert thread A’s historical `ToolHistoryBlock` chipTone/live flags; for no-arm, assert the **messages** `onAccept` sends (or a spy on `chrome.runtime.sendMessage`) contain no `task_loop.arm`; delete or demote catalog/adapter regex once a behavior test exists.

### P-F-5 — NIT
- File: `docs/superpowers/specs/2026-09-18-agent-operate-surface-design.md:291-297` (AC-D); `chrome-extension/src/sidepanel/components/LoopStatusRow.tsx:27-28`; `G1-DONE.md:7-9,67-69`; `companion/tests/loop-kernel.test.ts:386-391`
- Evidence: AC-D: 用户不再看到「(100)」. Shipped unarmed copy: `这一段跑满了 100 步工具调用，任务尚未收尾。回复“继续”可接着执行。` G1-DONE: 未武装则建议卡. Kernel test #18 only emits that card when `setProgress` left an unticked item — no checklist ⇒ 0 suggest frames (exactly why #505 added `RoundLimitHint`).
- Overclaim / lying test: leftover Goal/G1 copy still names 100; G1-DONE over-generalizes the unarmed path. Not a Goal Driver leak (no `goal_state` object).
- What would still be green if production were broken: G1-DONE’s “建议卡” citation stays green for unarmed+unticked; unarmed+no-plan is a different UI that G1-DONE does not mention.
- Distinct because: product-copy vs AC-D, not CI greenwash.
- Suggested fix: change AC-D or the hint so they agree; G1-DONE should say “未武装 + 有未勾项 → loop 建议卡；否则 #505 RoundLimitHint”.

### P-F-6 — NIT
- File: repo-root `A-DONE.md:22-23`, `B-DONE.md:97-101`, `C-DONE.md:70-74`, `E-DONE.md:23`, `G1-DONE.md:77-81`; `CHANGELOG.md:7-9`; PR #512
- Evidence: five DONE reports + CHANGELOG + PR all re-narrate A/B/C/E/G1 (and later punch-list) with pass counts that cannot all be true of HEAD. C-DONE still lists “意图单次消费后状态不复位” as residual; #506 on this same branch claims that closed.
- Overclaim / lying test: duplicate documentation presented as additional verification. Stale residuals + stale counts read as extra coverage.
- What would still be green if production were broken: every DONE.md (they are not tests).
- Distinct because: docs-as-passport, not a code path.
- Suggested fix: move DONE files out of repo root or mark them SHA-scoped; one CHANGELOG paragraph is enough; do not stack 1339/1416/1442 as if they were independent runs of the same tree.

## Overturned (claim actually holds)

- **`spawn_worker` goal required is on the production dispatch path**, not a helper. [executed] `executeCompanionTool` case `"spawn_worker"` (`companion-dispatch.ts:179-186`) rejects missing `goal`/`task` with `INVALID_ARGS`. That is why P2/#292 went red.
- **Live mirror is documented and tested as same-process.** [inspected] `thread-manager.ts:514-519` (“dropped on process exit”); CHANGELOG.md:9 (“仅进程内存，磁盘仍只存指纹”); Settings (`SettingsSlideout.tsx:3468`) says omitted bodies do not come back when the toggle is opened — it does **not** claim restart-safe full history. `live-rebuild-continuity.test.ts` substitutes via `getLiveMirror` on the same manager and falls back to stubs on a new `ThreadManager` for id `live-01` (`create(alias, id)`).
- **Accept path does not arm; propose does not spawn.** [inspected] `onAccept` → `chat.send` + dismiss (`LoopStatusRow.tsx:222-226`); SW already has `case "chat.send"` and `case "task_loop.arm"` as distinct arms (`background/index.ts:689,1642`). Propose happy-path: no extra thread, `loop_state` still null. CHANGELOG “不激活续跑” holds on the code path; the *test* for it is weak (P-F-4).
- **Design D did not leak.** No `goal_state` type, no 目标卡 UI, no `maxGoalRounds`. G1 is the declared exception. CHANGELOG does not pretend Goal Driver shipped.
- **Observatory / native workbench not implied in UI copy.** Grep of `chrome-extension/src` has zero `Observatory`. Spec + E-DONE keep them 另票.
- **#510 assistant-row archive is no longer regex-only.** `archive-stub-assistant-persist.test.ts` drives production `chatCreate` and asserts disk arguments per tier. (The old adapter regex remains as dead weight, P-F-4.)
- **#509 lastTerminal broadcast** is a real `handleMessage` 100-round test, not a source lock (`loop-status-broadcast.test.ts:205-231`). G1 adapter exit has at least one behavior passport.

## Residual

- Did **not** run chrome-extension full suite or companion full suite on Windows. Extension 1416/1442 remain unreproduced ([inspected] `test(` ≈ 1516 only).
- BOARD_MISSING vs #292 `SPAWN_INTENT_FAILED` is currently **masked** by missing `goal` (P-F-1). After fixtures gain `goal`, that #292 test should invert unless rewritten.
- `params.task` still aliases `goal` at runtime while catalog `required` is only `"goal"` — extra, not less.
- Unarmed 100-round UI still says “100 步” (P-F-5). Spec AC-D vs G1 “数字保留” were never reconciled.
- #508 worker-pending × idle-thread behavior is still not exercised as UI behavior (P-F-4).

VERDICT: REJECT
