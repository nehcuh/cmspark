I read the complete `review/context.md` (5,088 lines incl. both full diffs and both implementer records), `machine.json`, `manifest.json`, both complete adversary reports, the complete `kimi-code-review.md`, `clarifications.md`, the failed `kimi-wrong-panel.md`/stderr, and the cited actual callers in `repo/`. No edits made.

# Final Pi review — Browser recovery + Windows owner diagnostics

## Frozen identity and method

- Base `e5b3511bc6e3ed36aca9c71314ec21ae1f3bf5a8`, 10 paths (8 browser, 2 Windows).
- I verified the actual source in `repo/` at every cited line matches the frozen changes (Bridge refusal, L2 refusal receipt, security registry, adapter notes/dedup, site-op enums, Windows probe). I did not independently recompute SHA256 (no shell in this session); the 10-file hashes are corroborated by `adversary-browser.md`, `adversary-windows-diagnostics.md`, and `clarifications.md`.
- The earlier wrong-scope panel (`kimi-wrong-panel.md`/`.stderr`) ended with **no verdict** on an OAuth TLS failure (`fetch failed`, exit 1). Its partial "MAJOR" labels are non-authoritative hints only. The proper structured `kimi-code-review.md` completed with APPROVE_WITH_NITS.

## Cross-author adjudication

| Reviewer | Verdict | Pi adjudication |
|---|---|---|
| `adversary-browser.md` (Browser only) | APPROVE | **CONFIRM** — no P0/P1 found; my read of the actual callers agrees. |
| `adversary-windows-diagnostics.md` (Windows only) | APPROVE_WITH_NITS | **CONFIRM** — nits are real, none blocking. |
| `kimi-code-review.md` | APPROVE_WITH_NITS (4×P2) | **CONFIRM, with P2#3 REJECTED as factually wrong** (see N0). |
| wrong panel | none | Disregarded as approval; two of its items surface below as non-blocking nits. |

No component self-approval conflict remains: each author reviewed only the other component.

## Ranked findings

**P0 / P1 — none.** The trust spine holds in the actual source:
- Bridge refuses evaluate before any CDP dispatch (`browser-bridge.ts:1831-1837`); the extension only checks token *presence*, companion remains the authoritative validator.
- L2 still calls real `securityPolicy.validateToken(token,"evaluate",code)` (binding/consume/expiry) and only adds the code to the existing refusal (`l2-admission.ts:1911-1921`); no `issueToken`, no auto-reconfirm.
- Only `EVALUATE_AUTH_REQUIRED` is registered recoverable (`security.ts:1015`); code-first precedence (`security.ts:1156+`) keeps `COOKIE_TRUST_DENIED` security and `PROFILE_FORBIDDEN/GRANT_DENIED/WORKER_DENIED` non_recoverable.
- `TAB_ID_REQUIRED` is code-only excluded (`site-op-memory.ts:70`); UNKNOWN/uncoded health still aggregates; locator=2 / origin=4 / same-tool=3 unchanged.
- Both new notes are literals (`adapter.ts:2003`, `:2320`); untrusted origin/locator are map keys only; the dedup sets are separate from the `locatorPivotIssued` pivot (`adapter.ts:1408-1412`).
- Windows probe keeps the byte-identical FILETIME query, `timeout:10000`, `killSignal:"SIGKILL"`, `maxBuffer:4096`, no `env`, and both callback+close settlement (`windows-owner.ts:55-72`); only allowlisted scalars reach the logger (no PID/command/env/stdout/stderr/message/stack/FILETIME).

**P2 / non-blocking nits (ranked):**

- **N1 `companion/src/process/windows-owner.ts:49-50` (also `:61-62`)** — `reportFailure(...)` runs before `reject(...)` inside `settle`. Current real `logger.logEvent` catches filesystem faults (`logger.ts:120-140`, independently EACCES-verified), so no observed failure; but if a future logger threw, the promise would hang instead of rejecting. Reorder reject-first is the robust fix.
- **N2 `companion/src/process/windows-owner.ts:38`** — `returned_elapsed_ms: elapsed()` is sampled at report entry (pre-log-write, pre-reject), i.e. settlement-decision elapsed, not end-to-end await latency. Adversary nit #2 confirmed; also `spawn_elapsed_ms` (`:37`,`:67`) is a Node spawn receipt, **not** proof PowerShell/.NET started, and `error_killed`/`child_killed` is an *attempt* while `close_signal` is the receipt. Describe accordingly in issue summaries.
- **N3 `companion/src/llm/adapter.ts:1997-2003`** — the locator-ban note is emitted for any `SITE_OP_BANNED`. For `evaluate` with no text/selector, `locatorKeyForTool` returns `"none"` (`site-op-memory.ts:150`), yet the fixed copy says “该定位路径…不要再重试同一路径”. Advice is still valid; wording is slightly inaccurate for locator-less tools.
- **N4 `companion/src/llm/adapter.ts:1998`** — dedup key `[originForSiteOp(execParams, tabUrl), locator]` can be `origin:unknown` when the tab-URL cache is cold (`site-op-memory.ts:167-173`), so two cold-cache sites with the same locator share one bucket and the second may not receive the fixed note. Only redundant-copy loss; no ban/count/authority impact.
- **N5 `companion/src/llm/adapter.ts:2523-2533` vs `:2555`** — if `shouldStop` is set in the same round that a note is pushed, the early `return` drops `pivotNotes`. For the new notes this edge only arises when a different recoverable/security failure stops the same round, so the turn is ending anyway; non-blocking, but the dedup flags then prevent re-delivery within that turn.
- **N6 machine card scope (claims only)** — the Linux card’s `153/148/5` equals browser focused `102/102` + Windows focused `51/46/5`, and extension `50/50` equals the browser focused extension run; that is a targeted subset, not a full-suite Linux pass. Host `5926/5874/52` and extension `1527/1527` are the full receipts. This is a labeling/clarity nit; no code impact, and exact-head native Windows / exact-main CI remain the actual gates.
- **N7 `companion/tests/browser-recovery-568-548.test.ts:114` vs `:159`** — L2 refusal (`:114`) and adapter recovery (`:159`) are exercised through separate seams; the L2→adapter join is not covered end-to-end. Both endpoints and code propagation are tested, so low risk.

**N0 — Kimi P2#3 rejected.** The real-execFile test writes only to the runner-owned data dir: `companion/scripts/run-tests.mjs:112-116` sets an absolute `CMSPARK_TEST_RUN_DIR` and preloads `companion/scripts/test-data-dir.cjs`, which sets `CMSPARK_DATA_DIR` to a `mkdtemp` before application imports; `getLogFilePath` resolves over live `getConfigDir()` (`config.ts:1548`, `logger.ts:107-110`). `npm test` uses `run-tests.mjs` (`companion/package.json:14`). Direct `node --test` is not an authorized runner. Kimi's “developer's actual log file” claim is factually wrong.

## DoD / claim boundary (unchanged)

- **#568**: exactly the returned-evaluate auth classification + missing-tab argument code are fixed, plus the same-family L2 invalid-token receipt. Broad positive-only CDP-health (#563) is **not** implemented; UNKNOWN still intentionally aggregates.
- **#548**: same-locator pre-execution guidance implemented while the ban, message, locator and the distinct-locator same-tool pivot remain intact. No website-success guarantee.
- **#623**: minimal sanitized telemetry implemented; the historical 10 s cold-start **root cause is unknown** and no flakiness-fixed claim is made.
- Host/ARM totals are recorded machine inputs, not nativeChrome accuracy or nativeWindows acceptance. `exacthead nativeWindows CI before merge` and `exactmain CI after landing` remain **pending**; this is a code gate only.

## Final verdict

**APPROVE_WITH_NITS** (0×P0, 0×P1, 7×non-blocking P2/claim nits; Kimi P2#3 rejected as incorrect). Cross-author conclusions are confirmed: Browser APPROVE, Windows APPROVE_WITH_NITS, Kimi APPROVE_WITH_NITS. No waiver, no merge/release authorization, no native-Windows or root-cause claim.
