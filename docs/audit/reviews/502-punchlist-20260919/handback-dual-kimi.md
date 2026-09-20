鈥?Source matches the diff. Now checking the executor lockstep, `applyHandbackPayload` error codes, and how failed tool rows persist (for the false-positive attack).

鈥?Now checking how tool rows persist on failure (false-positive attack) and running the board tests.

鈥?All checks done 鈥?diff inspected, tests executed (31/31 pass), edge cases executed live, archive stub and hint gate verified in source. Full review below.

  ```
  # Dual re-review (kimi)
  HEAD: dba48161 + uncommitted collect_handback diff
  ```

  ## Per-claim

  - **C1 incidental braces: FIXED** 鈥?`companion/src/board/schema.ts:342-347`. The first-brace parse-fail branch now returns `prose-only handback; no JSON structure` with `HANDBACK_MISSING_STRUCTURE`. Executed: the 3r2frm math string (`C_F = { C_n(X) + F_n(...) }`) rejects as prose, not "parse failed" (test `board-schema.test.ts:154` green; 31/31 pass via `npx tsx --test`). Executed edge: truncated real JSON with unclosed `{` (`{"schema_version": 1, "facts": [{"claim": "x"`) 鈫?`extractFirstJsonObject` never reaches depth 0 鈫?returns null 鈫?prose-only branch (`schema.ts:327-333`). Not silently accepted, not mislabeled. 鉁?  - **C2 in-flight gate: FIXED** 鈥?`companion/src/board/service.ts:873-892`. `workerLooksInFlight` (`service.ts:799-813`) runs **before** `ensureBoard` (895), returns recoverable `WORKER_STILL_RUNNING` with `suggested_action: "wait_workers"`, audits `board.handback_rejected`, and touches no sibling state. Later collect still inits the board 鈥?the init block at 895-909 is only skipped on the early return. 鉁?  - **C3 prose copy: FIXED (with nit N-1)** 鈥?`service.ts:951-965` replaces the error with `worker delivered a prose report, not structured handback JSON. Other workers are unaffected.` when `error_code === HANDBACK_MISSING_STRUCTURE` and content non-empty. Matches claim; test asserts it (`board-collect-handback.test.ts:140`). Over-broad trigger 鈥?see N-1.
  - **C4 UI hint vs archive stub: FIXED** 鈥?`ChatView.tsx:1072-1078` maps both codes to Chinese honesty copy. `stubFailureResult` (`companion/src/security/tool-persistence-redact.ts:361,365-368`) preserves top-level `error_code` and `data.{error_code,suggested_action}`, and keeps `success:false` (357), so the hint survives archive and still passes the gate. Confirmed gate: hint fires only on `result.success === false` (`ChatView.tsx:1066`) 鈥?true today; if anyone later returns `success:true` + warning, the hint silently dies. Latent, not introduced here. 鉁?  - **C5 catalog: FIXED** 鈥?`tool-definitions-catalog.json:1252` now tells the model not to collect while the worker is live and names both error codes. Executor lockstep verified: `tool-definitions.ts:5` serves this catalog; `companion-dispatch.ts:664-704` routes `collect_handback` to `collectWorkerHandback`, which implements exactly the documented codes. 鉁?
  ## New findings (only if grounded)

  ### N-1 鈥?NIT
  - File: `companion/src/board/service.ts:952-961`
  - Evidence: executed
  - Failure mode: the prose-copy override fires on **any** `HANDBACK_MISSING_STRUCTURE` with non-empty content 鈥?but that code also covers zod schema failures on *valid* JSON (`schema.ts:363-371`). Executed: `{"schema_version":1,"facts":[{"claim":1}],...}` fails with `facts.0.claim: Expected string, received number`; through `collectWorkerHandback` the model would instead see "worker delivered a prose report, not structured handback JSON", and the actionable zod detail is dropped from `error` (content survives in `data.last_assistant`). Classification and recoverability are unchanged, so this is honesty-copy drift, not a behavior break.

  ### N-2 鈥?NIT
  - File: `companion/src/board/service.ts:964`
  - Evidence: inspected
  - Failure mode: the prose-reject branch attaches `suggested_action: "wait_workers"`, but a finished worker's prose handback will never become structured by waiting 鈥?the catalog copy correctly says "use last_assistant". Mildly conflicting advice to the model; non-blocking.

  ## Attack-list dispositions

  - Truncated unclosed JSON 鈫?prose-only, not accepted: **executed, holds**.
  - Fenced ```json with incidental braces in prose 鈫?still parses: **executed, holds** (existing test + live run).
  - `WORKER_STILL_RUNNING` false-positive on failed tool: **not stuck**. Persisted tool rows always carry a non-null `result` object and no `status` field (`tool-batch-heal.ts:40-50`, INTERRUPTED filler `:101-120`); the gate's tool-branch needs `status==="running"` or `result==null`. Dead workers are further covered by heal inserting INTERRUPTED rows after unpaired assistants, so the last row stops looking in-flight.
  - `ensureBoard` after in-flight: later collect inits the board (`service.ts:895-909`) 鈥?inspected, holds.
  - Archive stub keeps `error_code`: holds (`tool-persistence-redact.ts:361`).
  - Hint gated on `success===false`: yes today (`ChatView.tsx:1066`); flagged as latent fragility.
  - New L2 / auto-spawn / arm: **none** 鈥?diff touches no `securityConfirmations`, spawn, kick, or gate code. ADR-016 board mode still rejects prose with `success:false` in both new paths.

  ## ADR-020

  - Surface: Side Panel tool-card hint + collect_handback tool result 鈥?matches declaration, no deeper surface.
  - L2-classes: none 鈥?confirmed, no new capability class.
  - Compose: Fleet ADR-015 / MissionBoard ADR-016 鈥?fits existing composition, no new runtime.
  - Autonomy: no new arm; collect never stops workers 鈥?confirmed in both new return paths.
  - Trust: structured handback still required when board present 鈥?monotonic, no loosening.
  - Channel/Blast: community / T1 鈥?copy + classification only; declaration present and accurate.

  ## Notes

  - Ran `npx tsx --test tests/board-collect-handback.test.ts tests/board-schema.test.ts`: 31 pass, 0 fail, including the new 3r2frm math-braces regression test and the in-flight gate test.
  - Both nits are copy/advice refinements on an error path that is recoverable and correctly classified; neither blocks merge.

  VERDICT: APPROVE_WITH_NITS

