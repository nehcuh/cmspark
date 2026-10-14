I have completed my independent rereview. All files read end-to-end (context.md 6,742 lines in full chunks; all nine named reports; manifest/machine/run-host.py; raw host logs with test names; actual repo source spot-checks against every cited line).

---

# Final Pi independent rereview — DeepSeekV4Pro (this session), frozen 37-path batch

**Model identity:** this review is produced by the actual `deepseek-v4-pro` route via `pi --provider deepseek` (no-tools, read/grep/find/ls only). I did not read raw model-reasoning JSON (pi-pro.jsonl, grok-r3.stderr) — the complete visible reports plus model-identity JSON were sufficient. Grok R3 used actual `grok-4.6-build` (11 turns), not a substitution.

## 1. Machine-facts adjudication (the Kimi document-P2)

**Kimi's document P2 (host Companion arithmetic inflation) is FALSE. The correction stands. The frozen count 5939/5887/52 is correct.**

Independently reproduced from `run-host.py` and both raw logs:

- `run-host.py` enumerates every compiled `companion/.test-dist/tests/*.test.js` except `_`-helpers and `office-format-compatibility.test.js`, runs them to `host-companion.log`, then runs the excluded Office file exactly once to `host-office-native.log`.
- `host-companion.log` TAP receipts sum to **5919 tests / 5867 pass / 52 skip / 0 fail** across three groups:
  - `3493` (3445 pass, 48 skip)
  - `2406` (2402 pass, 4 skip)
  - `20` (20 pass, 0 skip) — this group is the **settings suite** (`settings-web server` 16 + `settings-cli` 4), confirmed by reading the actual subtest names at log lines 38334–38478. It is **not** the Office file and **not** a duplicated focused rerun.
- `host-office-native.log` = **20 tests / 20 pass / 0 skip** — the `#611 actual Office conversion, text integrity, refusal and rendering` suite (one-page.doc, one-sheet.xls, … real DOCX/XLSX …). Distinct test names.
- Total distinct inventory = **5919 + 20 = 5939 tests; 5867 + 20 = 5887 pass; 52 skip**. This equals `machine.json` exactly.

Conclusion: Kimi added only `host-companion.log` and misread its trailing 20-test settings group as the focused rerun while omitting the separate Office-native receipt. **No count downgrade and no invented green are warranted.** Both `kimi.md` (wrong claim) and `kimi-machine-facts-correction.md` (correction) are preserved as-is; I confirm the correction is the factual one.

Kimi's "complete Kimi report missing" was a self-observation artifact: `kimi.md` now contains a full `APPROVE_WITH_NITS` verdict and `kimi.stderr:394` shows `exit=0`. Not a missing reviewer.

## 2. Source verification against actual repo bytes (spot-checks, all match)

| Claim | Verified in repo |
|---|---|
| `handlers.ts:69,89` stamps `request_type` from dispatched op | ✓ (`request_type: type` on owner-mismatch and generic error) |
| `coding-control-message.ts:10–18` exact-string routing, no coercion | ✓ (cancel→`ACP_CONTROL_ERROR`; followup/prompt/apply→`ACP_OPERATION_ERROR`; else `null`) |
| `agentStore.tsx:1935–1936` closed/compacted latch; `:1998–2005` bounded ≤1000-char notice only for stored owner + active thread + selected session | ✓ |
| `coding-session-cache.ts` 16 rows / 256KiB, `cancelled` marker `:17` | ✓ |
| `win-spawn.ts:383–384` `MODE_C_TEMPFILE_TTL_MS = 60_000` unchanged | ✓ |
| `ui-progress.ts` 128KiB projection before listeners; canonical save precedes projection in `lifecycle.ts:660–667` | ✓ |
| `l2-preview-image.ts` one-shot `onUnavailable` from settled race winner; `finally` raw cleanup; late pipeline never re-reports | ✓ |
| `security-confirmation.ts:7` `DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS = 45000`; `:338–339` enum whitelist | ✓ |
| `l2-admission.ts:817,846` `timeoutMs: 5000`; `onUnavailable`; import/catch `preview_failed`; `:1562` reason only into details (never tool result) | ✓ |
| merged `useWebSocket.ts:4,7,928,1675–1676,2418` retains both preview spread and ACP cancel.ack/error deltas | ✓ |

**No source P0/P1/P2 found.** The R2 Office P2 (closed-session followup/prompt/apply refusals invisible) and its compacted sibling are genuinely fixed via typed dispatch + state-level operation notice, without weakening the owner/closed-latch/compacted/stopPending fences.

## 3. Capability and invariants

- **T2 (UI/cache/explicit local copy)** and **T3 (human-confirmation-only diagnostics)** hold. No new execution, focus/kill, token, ACL/nonce change, autoapproval, timeout increase, or capture-permission surface.
- nonce/ACL/deny 45s, preview 5s, settled-once reason, late-raw-cleanup, new-confirmation-ID image-error reset, and original 60s file TTL all confirmed in source.

## 4. Issue disposition

- **#484 / #532:** closure candidates only after remaining named reviews + exact head/native/main CI. Not closable now.
- **#522:** remains **PARTIAL**. Stop feedback + valid-command copy are correct; default-off/missing/oversize/expired CLI entry is still unimplemented (manual-switch advice is not entry). No `Closes #522`. Future leaf is outside the parent 37-path batch.
- Nits (non-blocking, retained, assigned to the existing 522 leaf — not source blockers): raw English `cancelled` beside 已停止 on uncompacted rows; preexisting non-Stop runtime `lastError` swallow; compacted "已保存的结果" over-promise for cancelled-no-handback sessions.

## 5. Remaining gates (explicit, not faked)

Exact **new-head CI / native Windows** (before merge) and exact **main 4 jobs** (after merge) are still pending. Native Windows/ScreenCaptureKit pixels, live business/T4, and full-Linux inventory are not claimed by any receipt in this packet.

---

## VERDICT: APPROVE_WITH_NITS

No confirmed source P0/P1/P2. The machine totals 5939/5887/52 are correct (Kimi's arithmetic P2 refuted and preserved with its correction). Both component and combined batch are push-ready in the 37-path scope, subject to: (1) the non-blocking nits above; (2) #522 remaining partial; (3) exact new-head/native-Windows and main-4-jobs CI still pending — do not merge or close #484/#532 until those gates complete.
