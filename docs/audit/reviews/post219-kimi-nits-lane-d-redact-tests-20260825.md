# Lane D — Independent adversary: persistence redaction + WIP test completeness

**Date**: 2026-08-25  
**Lane**: D (redact + cross-cut TEST COMPLETENESS only)  
**Reviewer**: independent adversary — did **not** implement WIP; no source/test edits  
**Branch / HEAD**: `main` @ `c5b4242` (ancestor of claimed PR #219 tip `daf8bc9`; WIP uncommitted)  
**Frozen patch**: `docs/audit/reviews/post219-kimi-nits-wip-20260825.patch`  
**SHA256**: `AD4794DCEFA42671E95C1FFA95466110C790FA9C15E92795743E3A48678F0AE4` `[executed]` matches prompt  
**Blast**: T2; redact path is Trust-adjacent (secrets on disk). ADR-020: no new tools; Channel/privacy only.

Evidence tags: `[executed]` ran code; `[inspected]` read call sites; `[assumed]` inferred. Default **REFUTED** until pinned.

Exclusive production range reviewed:
- `companion/src/security/tool-persistence-redact.ts`
- `companion/tests/tool-persistence-redact.test.ts`

Cross-cut (read-only): untracked `adapter-steer-overflow.test.ts`, `message-router-nextrun-drain.test.ts`, and other modified tests in `git status`.

---

## Capability (ADR-020)

```text
Surface:      unchanged
L2-classes:   none
Compose:      none (Lane D)
Autonomy:     none
Trust:        Trust-adjacent — durable thread JSON must not store cookie/MCP/eval secrets
Channel:      privacy / persistence redaction only
```

WIP under this lane: `plainErrorResult` INTERRUPTED passthrough so heal fillers keep `error_code` on disk. No new tools.

---

## Method / commands

1. `git diff HEAD -- companion/src/security/tool-persistence-redact.ts companion/tests/tool-persistence-redact.test.ts` `[executed]`
2. Read live redact module + tests + `createToolResultMessage` / `addMessage` call chain `[inspected]`
3. `npx tsx --test tests/tool-persistence-redact.test.ts` → **11/11 pass** `[executed]`
4. Redact attack probes via `npx tsx` writing `.tmp-redact-probe.json` `[executed]`
5. Spot-check `overlay-eligible.ts` (M2 / N5) vs PR219 adversary text `[inspected]`
6. `npx tsx --test tests/adapter-steer-overflow.test.ts` → **0/13 pass, 13 fail** `[executed]`
7. `npx tsx --test tests/message-router-nextrun-drain.test.ts` → **9/9 pass** `[executed]`
8. Skim composer-lease / overlay-eligible / pack.apply router test presence `[inspected]`

---

## WIP delta (redact only)

`[inspected]` Diff vs HEAD adds `plainErrorResult`:

- Matches `{ success: false, error: string, data === undefined }`
- Returns the **whole result object verbatim** (cast), else `null`
- Wired into: `thread_recall`, `host_computer`, codeish tools, MCP sensitive-name collapse paths

Tests added: INTERRUPTED passthrough for `shell_exec` / `host_computer` / `thread_recall` / MCP file-like; data-bearing error still redacts; `createToolResultMessage` keeps `INTERRUPTED`.

`[executed]` Those unit tests pass. That does **not** mean the redact surface is tight (see attacks below).

---

## Persist path (disk vs in-flight)

`[inspected]`

| Path | Redacted? |
|------|-----------|
| `createToolResultMessage` → `redactToolPayloadForPersistence` → `threadManager.addMessage` → `threads/<id>.json` | **Yes** (only disk gate for tool rows) |
| In-flight LLM `messages[]` / `tool.result` WS to extension | **No** — comment in module is accurate |
| `history/store.ts` `redactForStorage` | Separate DB path; same key regex family |

No second unredacted thread-JSON writer of tool `params`/`result` found on the adapter→addMessage path. Export/Obsidian would re-read already-persisted (hopefully redacted) rows — not re-audited here.

---

## Redact attacks `[executed]`

Probe results (abbreviated):

| # | Attack | Outcome |
|---|--------|---------|
| A1 | `evaluate` result `data: "sid=SECRET123"` (len ≪ 200) | **LEAK** — raw data persisted |
| A2 | MCP params `headers.Authorization: "Bearer sk-LEAK"` | **LEAK** — `SENSITIVE_KEY_RE` misses `Authorization` |
| A3 | `apiKey: "sk-KEY"` | **OK** — `api[_-]?key` matches |
| A4 | key `Bearer: "tok"` | **LEAK** |
| A5 | `shell_exec` plainError `{…INTERRUPTED, stdout: "SECRET_OUT"}` | **LEAK** — `plainErrorResult` returns full object; WIP **widens** this footgun |
| A6 | `env.MYSECRET` | **OK** (substring `secret`); `env.HOME` kept (expected) |
| A7 | `set_cookie` value in params + result | **OK** — hash/length only |
| A8 | `host_read` short `data: "root:x:0:0"` | **LEAK** — same ≤200 passthrough as evaluate |

### Cookie value still persisted?
**No** for normal cookie object shapes `[executed]` A7. Non-object/array cookie `data` → `null` `[inspected]`.

### MCP env/headers/tokens in tool rows?
- Nested keys matching `secret|token|password|api[_-]?key|…`: redacted.
- **`headers.Authorization` / `Bearer` key names: not redacted** `[executed]` A2/A4.
- MCP tool names matching `MCP_SENSITIVE_RESULT_RE` collapse results; others only deep-key scan.

### evaluate / osascript / host_ / shell results?
- Params `code` / `expression` / `command` / `security_token` / `body`: hashed `[inspected]`.
- Results: object rebuild; **`data` JSON length ≤ 200 kept raw** → short secrets land on disk `[executed]` A1/A8. Parity with `history/store.ts` cap-but-keep for code tools — still a Trust-adjacent hole for thread JSON.
- `shell_exec` / `host_*` success payloads same ≤200 rule.

### Key-name regex miss?
`SENSITIVE_KEY_RE = /(secret|token|password|api[_-]?key|credential|private[_-]?key)/i`  
Misses: `Authorization`, `Bearer`, `auth`, `header(s)` as keys. `apiKey` OK.

### In-flight LLM bypass?
Comment is correct: only persist path redacts. Disk SoT is `createToolResultMessage`. Not a bypass of the claimed contract; residual risk is extension/LLM memory, not `threads/*.json`.

### Hash of secret reconstructible?
12-hex SHA256 prefix — not practical reconstruction. **Nit only.**

### INTERRUPTED passthrough correctness
Heal fillers without `data` keep `error_code` — required for supersede replace `[inspected]` + tests `[executed]`.  
**Defect**: verbatim return does not strip unknown keys → A5. Should allowlist `{success, error, error_code}` only.

---

## Prior residuals — folded vs OPEN

Live code checked; do not trust prior review comments alone.

### From `pr218-remainder-nits-r2-adversary`

| ID | Topic | Live status | Evidence |
|----|-------|-------------|----------|
| **N7** | `validate.ts` empty_steer string vs handler | **FOLDED** | `validate.ts:49` now `"empty_steer"`; router `:605` same `[inspected]` |
| **N9** | length retry may not enlarge output budget | **OPEN** (nit) | Length path still `runContextBudgetPass("mid_loop")` only; OpenAI provider still omits `max_tokens` `[inspected]`. Compaction shrinks *input*, not output cap. |
| **R2-N1** | `dropSteer` finally vs supersede race | **MOSTLY FOLDED** | Finally converts leftover steers → `enqueueNextRun` when `!signal?.aborted`; abort/supersede path skips wipe `[inspected]` `adapter.ts` finally. Narrow race if predecessor non-abort finish races successor steers remains theoretical — not re-BLOCKed. |
| **R2-N2** | over-cap can disable 1000-cap | **OPEN** (nit) | `trimMessagesTurnSafe` still prefers over-cap assistant+tools `[inspected]` WIP comment reinforces. |
| **R2-N3** | `isLengthStop` finish_reason-only | **OPEN** (nit) | `overflow.ts:10-12` unchanged `[inspected]`. |
| **R2-N4** | adapter-loop untested | **CLAIMED FOLDED — REFUTED** | New `adapter-steer-overflow.test.ts` exists but **`npx tsx --test` → 0/13 pass** `[executed]`. Patches ESM `import("openai")` completions prototype; production `OpenAIProvider` is constructed via provider module (drain tests explicitly use `createRequire` for CJS dual-package). File does not pin the loop. |
| **R2-N5** | `dropSteer` finally vs pre-loop compact throw | **FOLDED** | `await runContextBudgetPass("pre_loop")` now **inside** the `try` (`adapter.ts:877-878`) `[inspected]`. |

### From `pr219-code-adversary` (REJECT)

| ID | Topic | Live status | Test coverage (Lane D) |
|----|-------|-------------|------------------------|
| **M1** | overlay nextRun drain surface stamp | **Production FOLDED** `[inspected]`: `drainNextRun` pre-gates with `session?.surface`, `followUpCreateFromQueue(..., session?.surface)`. | **TEST INCOMPLETE**: `composer-lease.test.ts` unit-tests the helper + lease gate `[inspected]`; `message-router-nextrun-drain.test.ts` covers **reject** path (tray drain + overlay lease → `OVERLAY_STANDBY`, queue kept) `[executed]` 9/9. `makeSession()` **never sets `surface: "summoner"`** — no handleMessage integration proving overlay drain **runs** and empties queue because it ran. Adversary’s required success test still missing. |
| **M2** | `osascript_eval` eligible hole | **FOLDED on main+WIP** | `DANGEROUS_TOOL` includes `osascript_eval` (and `spawn_worker`, `create_tab`) at `daf8bc9` already; WIP does not touch file. Unit test asserts deny `[inspected]`. |
| **M3** | router tests pack.apply overlay | **Production gates present** `[inspected]` (`pack_overlay_forbidden_fields` / `pack_run_active` / `pack_not_overlay_eligible` / `pack_trust_cookie_present`; `allowTrust: !overlayApply`). | **TEST STILL MISSING**: no `handleMessage` tests for allowTrust lie / cookie / extras / live loop under summoner stamp. `packs-engine` / `summoner-web` tests are not router overlay SoT. |
| **N1** | `chat.done` idle flash | **OPEN** | Adapter still emits `chat.done` before router drain; `run_status` only on `thread.select` `[inspected]`. |
| **N5** | `create_tab` still eligible? | **FOLDED for `create_tab`** | In `DANGEROUS_TOOL`. Residual: cookie tools (`get_cookies` / `set_cookie` / …) and `close_tab` / `board_*` tools still not matched if allowlisted without `board_mode` `[inspected]`. No overlay-eligible test for `create_tab`/`get_cookies` specifically. |

---

## Test-theater findings

| Finding | Severity | Evidence |
|---------|----------|----------|
| **`adapter-steer-overflow.test.ts` is dead theater** | **BLOCK for claimed R2-N4 fold** | `[executed]` **13 fail / 0 pass**. Assertions never see `chat.done` / streamParams / leftover nextRun. Same seam hazard the drain file documents (`createRequire` vs bare `import("openai")`) — this file did not apply that fix. Claiming “adapter-loop covered” is a **fake fold**. |
| **M1 success drain untested** | High (coverage hole) | Helper stamp test ≠ recursive `handleMessage` drain under overlay lease + `session.surface=summoner`. Reject-path only. |
| **M3 router pack.apply overlay untested** | High (prior REJECT residual) | Still no production `handleMessage` assertions. |
| **Redact tests are real, narrow** | OK / incomplete | `[executed]` 11/11 pass; execute `redactToolPayloadForPersistence` + `createToolResultMessage`. Do **not** cover Authorization headers, ≤200 evaluate/host data, or plainError extra keys. Not grep-theater. |
| **Drain tests are real** | OK for their claims | `[executed]` 9/9; hit `handleMessage`. Do not over-claim M1 success. |
| **`summoner-overlay.test.ts` source greps** | Pre-existing theater class | `fs.readFileSync` + `assert.match` on Swift/TS sources `[inspected]`. Not introduced by this WIP; do not treat as runtime proof. |
| **Either-or identifier greps** | Not found in redact tests | Redact assertions require concrete secret absence / `error_code` equality. |

---

## OPEN residual table (Lane D SoT)

| ID | Status | Note |
|----|--------|------|
| N7 empty_steer | FOLDED | validate + handler agree |
| N9 length output budget | OPEN nit | mid_loop compact ≠ enlarge max_tokens |
| R2-N1 dropSteer supersede | MOSTLY FOLDED | abort skip; convert leftover |
| R2-N2 over-cap growth | OPEN nit | trim trade unchanged |
| R2-N3 finish_reason-only | OPEN nit | unchanged |
| R2-N4 adapter-loop test | **OPEN — fake fold** | new file 0/13 `[executed]` |
| R2-N5 pre_loop outside try | FOLDED | pre_loop inside try |
| M1 overlay drain | prod FOLDED / **tests incomplete** | missing success integration |
| M2 osascript_eval | FOLDED | on main regex + unit test |
| M3 pack.apply router tests | **OPEN** | still none via handleMessage |
| N1 chat.done idle flash | OPEN | unchanged |
| N5 create_tab eligible | FOLDED (`create_tab`); cookie/board tool residual OPEN | |
| **D-R1** Authorization/Bearer key miss | **OPEN** | `[executed]` A2/A4 |
| **D-R2** ≤200 code/host result passthrough | **OPEN** | `[executed]` A1/A8 |
| **D-R3** `plainErrorResult` verbatim extras | **OPEN (WIP-introduced)** | `[executed]` A5 |

---

## Verdict rationale

Lane D does **not** re-score Lane A/B/C production except where tests fail to pin them.

- Redact INTERRUPTED fix is directionally correct and unit-tested `[executed]`.
- Trust-adjacent holes remain (Authorization headers; short evaluate/host payloads); WIP adds plainError verbatim leak.
- The headline test completeness claim for this WIP — new adapter-loop file folding R2-N4 — is **refuted by execution** (0/13).
- M1/M3 test obligations from the PR219 REJECT are still not met (M1 success path; M3 router).

That is enough to refuse rubber-stamp approval of the claimed “halfway fold.”

---

VERDICT: REJECT
