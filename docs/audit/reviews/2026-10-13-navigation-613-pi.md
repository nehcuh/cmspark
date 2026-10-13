# #613 Pi second confirmation

Pi0.85.1 / deepseek/deepseek-v4-flash. Full machine card, complete independent adversary report, and same full frozen patch supplied. SourceSHA256 a779f888ed566bc5d3f0ec03143f420647e2a0089684c7c92c8eee583a33b52b; basec570cb80c5799057e067ae0b55e6a3e4548288c3. Read-only; exit0.

Pi0.85.1; deepseek/deepseek-v4-flash; stagedsourcea779f888
Reader verification complete. I inspected the frozen worktree, recomputed the patch hash, read the actual source/tests/spec/CSS, and ran the existing compiled frontend tests and hygiene gate. I did not run the browser fixture, full 1517 suite, or any live browser/Companion.

## Frozen artifact identity

- `HEAD = c570cb80c5799057e067ae0b55e6a3e4548288c3`; 9-file patch, no unstaged tracked changes (`git status --porcelain -uno` only M/A for the 9 files).
- `git diff --cached | sha256sum` = `a779f888ed566bc5d3f0ec03143f420647e2a0089684c7c92c8eee583a33b52b`; identical to `/tmp/cmspark-613-full.diff`. Hash matches the machine card exactly.
- Patch touches only 3 src files, 2 tests, 2 companion harness scripts, 1 spec. No package/lock/config/dependency changes.

## Outcome/trajectory/component — confirmed

- `task-relationship.ts:11` — full Thread wins (`rows.get(activeId) ||`), Fleet is exact-ID only (`fleet.find(row => row.id === activeId)`). No title/run/role inference.
- `task-relationship.ts:13-17` — direct parent only via `active.parent_thread_id`; `parent` looked up in Thread rows only.
- `task-relationship.ts:20-29` — cycle walk restricted to explicit Thread links; missing/trashed/invalid each return without a `parentId`, so the action stays disabled.
- `TaskRelationshipNav.tsx:5-23` — parent + child labels visible, native button `disabled={!available}`, guard `if (available && relationship.parentId)` agrees with `disabled`; unavailable reasons rendered.
- `StatusRail.tsx:82,235` — mounts component and calls only preexisting `SET_ACTIVE_THREAD` + `thread.select`. No spawn/resume/restore/protocol change.
- Reconfirmed the reproduction vector: `FleetStrip.tsx:118-121` / `FleetWorkerList.tsx:65-67` dispatch `SET_ACTIVE_THREAD` with a Fleet worker ID without inserting it into `state.threads`; `agentStore.tsx:1094` confirms `SET_THREADS` can clear an active ID omitted from the list. The Fleet fallback is therefore a real fix, not speculative.

## Requested axes

- **exact-ID Fleet fallback / full-Thread wins**: `task-relationship.ts:11`; covered by tests 1 and 2.
- **direct parent**: multi-level test returns `middle`, not root; `parentId` only set when parent is found and non-trashed (`:29`).
- **state cache**: `applyActiveThreadSwitch` (`agentStore.tsx:972-1005`) preserves `messagesByThreadId`/`messagesCacheOrder`/`threadBusyById`; the switch case (`:1132`) spreads `...state`. Test 6 asserts both message caches and both busy entries survive.
- **draft semantics**: `composerRestore` and `composerUploadClearSeq` are untouched by `SET_ACTIVE_THREAD`; test 6 asserts both.
- **honest availability**: missing/trashed/invalid/cycle yield no `parentId`, disabled button, retained `子任务 ·` identity; `TaskRelationshipNav.tsx:8-23`.

## Independent test evidence I ran

- `node --test .test-dist/tests/task-relationship.test.js .test-dist/tests/thread-timeline.test.js .test-dist/tests/thread-busy.test.js` → **71 pass / 0 fail / 0 skipped**, Node v22.23.2. Compiled JS inspected and matches the frozen TS source.
- `node scripts/check-sidepanel-raw-colors.mjs` → **exit 0**, 0 raw colors/token fallbacks/tiny fonts (new CSS uses tokens only).
- Machine logs corroborate the card: frontend `1..1517` pass, ARM64 focused `1..71` pass, final Plasmo build `DONE`, UI fixture `PASS`; `shots/evidence.json` records 9 `thread.select` calls with busy map preserved and the three unavailable cases.

## Adversary report accuracy

The report's file:line citations, capability-axis table, and evidence-limits section (isolated `TaskRelationshipNav/helper/reducer/CSS` fixture, no `chrome.runtime.sendMessage`, no live WS/Companion, screenshots only at 320/390/900) all match the frozen patch and machine card. No misstatement found.

## Residual observations (not blockers)

- `task-relationship.ts:20-26` fails closed on a cycle anywhere in the ancestor chain, including a cycle above an otherwise-valid direct parent. This is consistent with the spec's stated "self/cycles: invalid relation" and fail-closed trust axis, and is not an evidenced product defect.
- `tests/thread-timeline.test.ts:750-751` replaces the literal `← 主任务` / `!t.trashed_at` source assertions with mount/helper assertions; equivalent rendered coverage now lives in `task-relationship.test.ts`. No coverage gap for the trashed case.

No evidenced defect file:line found; no P0/P1/P2 blocker.

VERDICT: APPROVE
