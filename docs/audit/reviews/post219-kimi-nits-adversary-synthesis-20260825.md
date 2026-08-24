# 四路独立对抗合成 — post-#219 kimi nits WIP (2026-08-25)

| Field | Value |
|-------|--------|
| Date | 2026-08-25 |
| HEAD | `c5b4242` (S78 session-end; parent `daf8bc9` = #219) |
| Object | Uncommitted kimi fold of remaining #218/#219 nits (claimed halfway) |
| Frozen patch | `docs/audit/reviews/post219-kimi-nits-wip-20260825.patch` |
| SHA256 | `AD4794DCEFA42671E95C1FFA95466110C790FA9C15E92795743E3A48678F0AE4` |
| Method | 4 independent lanes (file-range exclusive). This session orchestrates; lanes did not implement. |
| Blast | T2 (LLM loop / overlay lease Channel). ADR-020: overlay never Allow/Deny. |

## Lane verdicts

| Lane | Range | Verdict | Headline |
|------|-------|---------|----------|
| **A** LLM loop | adapter / run-queues / heal / trim | **REJECT** | Production-path suite 0/13: mocks wrong OpenAI Completions prototype under `tsx`. Queue-full `dropSteer` after `takeSteer` can wipe successor steers. Filler match is id-global. |
| **B** drain / occupancy | message-router drainNextRun | **APPROVE_WITH_NITS** | PR219 M1 silent-drop **REFUTED**. High: gate-rejected drain can **replace** `file.uploaded`. No overlay-surface **success** drain test. |
| **C** overlay lease | overlay-session / composer-lease / menu-bar | **REJECT** | CAS self-unwind HOLDS. `reclaimLiveSummonerThread` uses lagged `summonerThreadId` after `beginOverlaySession` → exclusive claim can demote the newer live overlay thread. |
| **D** redact + tests | tool-persistence-redact + completeness | **REJECT** | `Authorization`/`Bearer` keys leak; code-tool `data` ≤200 persists; `plainErrorResult` returns extras verbatim. Adapter-loop fold is **fake**. M3 pack.apply router tests still missing (out of this WIP slice). |

Reports:

- `post219-kimi-nits-lane-a-llm-20260825.md`
- `post219-kimi-nits-lane-b-drain-20260825.md`
- `post219-kimi-nits-lane-c-lease-20260825.md`
- `post219-kimi-nits-lane-d-redact-tests-20260825.md`

### Cross-lane convergence (high confidence)

| ID | Defect | Independent evidence |
|----|--------|----------------------|
| **S1** | `adapter-steer-overflow.test.ts` never hits `OpenAIProvider.streamChat` | A 0/13 `[executed]` Connection error; D 0/13 same mock miss |
| **S2** | Composer-lease grep tests resolve `../../src` → repo-root ENOENT | B 2 fail; C 2 fail (same paths) |

## Must-fold before claiming the nits batch done

1. **A-BLOCK** Patch `OpenAIProvider.prototype.streamChat` (not the test's dummy Completions class) so leftover / overflow / filler / truncated folds are `[executed]`.
2. **A-High** After leftover `takeSteer`, do **not** `dropSteer` on queue-full (wipes concurrent/successor steers).
3. **A-High** Scope `replaceInterruptedFillerIfPresent` to the in-flight assistant's contiguous tool block.
4. **B-High** Gate-rejected drain must `sendToExtension` the error and **keep** `file.uploaded` / create-null; never replace the original ack.
5. **C-High** Reclaim live overlay only when `overlaySessionIsLive(token captured at bind)`. `beginOverlaySession` invalidates the old token so lagged `summonerThreadId` cannot steal.
6. **D-High** Reconstruct `plainErrorResult` (no extra keys); always collapse sensitive code-tool `data`; extend key regex with `authorization` / `bearer` / `apikey`.

## Intentionally not in this fold

- M3 overlay `pack.apply` router tests (main already has M2 `osascript_eval`; tests are a follow-up slice).
- N1 `chat.done` idle flash / N9 length output budget / R2-N2 over-cap growth.
- Continue UI, persist `running=true`, pending_confirms.

## Folds landed this session (post-adversary)

| ID | Fix | Call site |
|----|-----|-----------|
| A-BLOCK | Mock `OpenAIProvider.prototype.streamChat` | `adapter-steer-overflow.test.ts` — **13/13 pass** `[executed]` |
| A-High | leftover queue-full no longer `dropSteer` after `takeSteer` | `adapter.ts` finally |
| A-High | filler replace scoped to assistant contiguous tool block | `tool-batch-heal.ts` + adapter `savedAssistantId` |
| B-High | drain gate error `sendToExtension`; keep `file.uploaded` / create-null | `message-router.ts` `isDrainGateError` |
| C-High | reclaim only if `shouldReclaimLiveOverlayThread` (bound session token still live) | `overlay-session.ts` + `menu-bar-agent.ts` `bindSummonerThread` |
| D-High | reconstruct `plainErrorResult`; always collapse code-tool `data`; regex +authorization/bearer/apikey | `tool-persistence-redact.ts` |
| S2 | grep tests dual-candidate `companion/src` | `composer-lease.test.ts` |

### Machine after fold `[executed]`

- `npx tsc --noEmit -p tsconfig.json` (companion) exit 0
- `adapter-steer-overflow.test.ts` **13/13**
- `message-router-nextrun-drain.test.ts` **11/11** (incl. overlay-surface success drain + upload ack preserved)
- `tool-batch-heal` / `overlay-session` / `composer-lease` / `summoner-overlay` / `tool-persistence-redact` / `threads-history` related cases **pass**

## Eval gate card

**Blast tier**: T2  
**Capability**: Surface L0 · L2 none · Autonomy steer/nextRun · Trust unchanged · Channel composer lease

- MACHINE: **PASS** (targeted suites above)
- ADVERSARY: mixed REJECT / AWN → folds applied; incremental re-verify not yet a second independent round
- PI_REREVIEW: not yet
- MERGE: **NO** — wait incremental adversary + Pi; M3 pack.apply router tests still out of slice
