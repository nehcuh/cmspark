# Lane D — Independent nits-fold adversary: persistence redaction + history.db

**Date**: 2026-08-25  
**Lane**: D (persistence redaction + `history.db`)  
**Reviewer**: independent adversary — did **not** implement the nits fold; no production source edits  
**Range**: `1d16b0e..9deff00`  
**HEAD**: `9deff00da9ee3e1d9d3014b5da1d509ce91116b6` (`9deff00 fix(agent): fold post-#220 residual nits (nextRun id, drain pause, redact)`) `[executed]`  
**Frozen patch SHA256**: `2625238075ef8720b4dc8ca73124742b068b54c8b7d721b1dfd2d4c793274b51` `[executed]` matches `docs/audit/reviews/post220-nits-diff-20260825-092457.patch`  
**Blast**: T2 (Trust-adjacent: `threads/*.json` + 30-day `history.db`). **No escalate to T3** — claimed shapes (passwd key, array/numeric secret keys, MCP history lock-step of regex+leaf) do **not** persist under live probe. Residuals below are call-site lock-step, not claimed-shape leaks.

Default **REFUTED** until `file:line` + `[executed]` / `[inspected]`. Do not treat implementer session as proof.

Exclusive files (this lane):

- `companion/src/security/tool-persistence-redact.ts`
- `companion/src/history/store.ts`
- `companion/tests/tool-persistence-redact.test.ts`
- `companion/tests/history.test.ts`

Diff this range on exclusive files: **+128 / −12** across the four files `[executed]`.

---

## Capability (ADR-020) — challenge

Implementer claim (shared prompt):

```text
Surface:      L0
L2-classes:   none
Compose:      none
Autonomy:     steer / nextRun queue plumbing
Trust:        persistence redaction tighter (passwd, non-string secret keys)
Channel:      overlay bind/reclaim live-gate
```

Lane D challenge (this slice is **Trust / persistence only**):

| Check | Result |
|-------|--------|
| Axes fit | Redact fold is Trust (durable thread JSON + history.db). No new Surface tool, no Pack/MCP/Skill composition, no Autonomy runtime. `[inspected]` |
| New tools / gates / primary UI | **None** in exclusive files. Missing-declaration BLOCK does not apply. |
| Trust monotonicity | No L2 skip, no `auto_approve_*`, no overlay-as-confirm. Tightening key regex + non-string leaf is monotonic. |
| originWs | N/A — no `securityConfirmations.request` in exclusive files. |
| Persistence leak of **claimed** secrets | Thread-JSON `passwd` / cookie extra Authorization / array `headers.Authorization` / numeric `apiKey`; history MCP `Authorization`+`passwd`+numeric `apiKey` (+ array, live-probed): **do not leak** `[executed]`. Call-site residuals (history cookie params extra keys; generic-tool history passthrough; object-valued secret keys) stay nits — not T3. |

---

## Method

1. Confirm HEAD `9deff00` + frozen patch SHA256 `[executed]`
2. Read live redact module, `history/store.ts`, exclusive tests, `createToolResultMessage` persist gate `[inspected]`
3. Mandated machine: `cd companion && npx tsx --test tests/tool-persistence-redact.test.ts tests/history.test.ts` `[executed]`
4. Private `/tmp/lane-d-nits-20260825` live probes against **unmodified** production modules `[executed]`
5. Mutation-kill (private copies only):
   - strip `passwd` from thread-JSON `SENSITIVE_KEY_RE` → official S-D1 passwd pins **red**
   - restore `typeof v === "string"` gate (pre-fold) → S-D2 array + numeric pins **red**
   - strip `passwd` from history regex → official S-D3 `hunter2-hist` pin **red**
6. Byte-compare regex + `redactSensitiveLeaf` + `redactSensitiveKeysDeep` across the two production files `[executed]`

Worktree had no `companion/node_modules`. Linked main-repo `node_modules` for the run, then removed the symlink. Counts below are post-link.

---

## Machine `[executed]`

```text
cd companion && npx tsx --test tests/tool-persistence-redact.test.ts tests/history.test.ts
→ tests 65, pass 65, fail 0
   tool-persistence-redact.test.ts: 17
   history.test.ts: 48 (including new S-D3 pin at :1010)
```

Mutation-kill (private copies; production untouched):

| Mutation | Pin | Result |
|----------|-----|--------|
| Strip `passwd` from thread-JSON regex | `passwd: "hunter2-secret"` + generic `get_page_text` `passwd: "hide-me"` | **2 fail / array+numeric still pass** |
| Restore `typeof === "string"` (drop leaf) | `headers.Authorization: ["Bearer array-secret"]` + `apiKey: 123456789` | **2 fail / string passwd still pass** |
| Strip `passwd` from history regex (`NODE_PATH` for `sql.js`) | `HistoryStore.record` MCP `passwd: "hunter2-hist"` | **1 fail** (`hunter2-hist` persists) |

Official suite pins **die** when the claimed token / leaf is stripped. Not grep-theater.

---

## Persist path `[inspected]`

| Path | Redacted? |
|------|-----------|
| `createToolResultMessage` (`companion/src/llm/tool-batch-heal.ts:8-19`) → `redactToolPayloadForPersistence` → `threadManager.addMessage` → `threads/<id>.json` | **Yes** — disk gate for tool `params`/`result` |
| `HistoryStore.record` (`history/store.ts:497-507`) → `redactForStorage` → `history.db` | **Yes** — parallel store; MCP/cookie/code branches, **not** generic-tool key scan |
| In-flight LLM `messages[]` / WS tool.result | **No** — module comment is accurate |

No second unredacted thread-JSON writer of tool payloads found on the adapter → addMessage path.

---

## Must-falsify

### S-D1 — `passwd` in regex (both files); cookie extra keys scanned; generic `value` not blanket

Live regex `[inspected]` identical in both files:

```text
companion/src/security/tool-persistence-redact.ts:35
companion/src/history/store.ts:49
/(secret|token|password|passwd|api[_-]?key|credential|private[_-]?key|authorization|bearer|apikey)/i
```

No `/g` flag (no `lastIndex` trap). `/i` covers `Authorization` / `apiKey`.

| Probe | Persist plaintext? | Evidence |
|-------|--------------------|----------|
| Thread-JSON `mcp__http__fetch` `passwd: "hunter2-secret"` | **No** | marker; secret absent. Official test `:76-95` `[executed]` |
| Thread-JSON `get_page_text` `{value:"visible-field", passwd:"hide-me"}` | `value` **stays**; `passwd` **redacted** | Official `:97-106` + live probe `[executed]` |
| Thread-JSON `set_cookie` params extra `Authorization` + `passwd` | **No** | `redactSensitiveKeysDeep` on cookie params `:206-214`. Official Authorization pin `:108-119`; live also kills `cookie-passwd` `[executed]` |
| Thread-JSON cookie **result** rest `Authorization` / `passwd` | **No** | `redactOneCookie` `restRedacted` `:96-98`; live `Bearer rest-auth` / `rest-passwd` gone; `value` → `value_hash` `[executed]` |
| Strip `passwd` from thread-JSON regex | official passwd pins **fail** | mutation `[executed]` |

**FOLDED** for thread-JSON (the surface the cookie-branch diff actually changed).

Generic `value` is **not** in `SENSITIVE_KEY_RE` — intentional, and pinned. Blanket-`value` remains out of slice (shared prompt).

### S-D2 — array / numeric sensitive keys redacted (not only `typeof === "string"`)

`[inspected]` `redactSensitiveLeaf` (`tool-persistence-redact.ts:41-57`, byte-equal at `history/store.ts:57-73`) hashes string / number / boolean leaves; arrays map primitives through the leaf and objects through `redactSensitiveKeysDeep`. Call site no longer requires `typeof v === "string"` (`:68-69` / history `:84-85`).

| Probe | Persist plaintext? | Evidence |
|-------|--------------------|----------|
| `headers.Authorization: ["Bearer array-secret"]` on `mcp__http__fetch` | **No** | `[0]` is `<redacted:len=19:…>`; `array-secret` absent `[executed]` |
| `apiKey: 123456789` | **No** | `<redacted:len=9:…>`; digits absent `[executed]` |
| boolean `apiKey: true` / `Bearer: false` / empty `Authorization: ""` | **No** | all markers `[executed]` (extra; not a claimed pin) |
| Restore pre-fold `typeof === "string"` | array **and** numeric official pins **fail**; string `passwd` still holds | mutation `[executed]` |

**FOLDED** for the claimed array-of-strings and numeric leaves.

History MCP path uses the same leaf: live `headers.Authorization: ["Bearer hist-array"]` did **not** persist (`HIST_ARRAY_LEAKS false`) `[executed]`. Official history S-D3 test (`:1010`) pins numeric `apiKey` via `!includes("987654321")` but does **not** pin the array shape — completeness nit, not a leak.

### S-D3 — history regex + leaf lock-step with thread-JSON; history test `[executed]`

Byte-compare `[executed]`:

| Symbol | Equal across files? |
|--------|---------------------|
| `SENSITIVE_KEY_RE` source line | **Yes** |
| `redactSensitiveLeaf` body | **Yes** |
| `redactSensitiveKeysDeep` body | **Yes** |

Official history pin `:1010-1040` (`mcp__http__fetch` `Authorization` / `passwd` / numeric `apiKey`) **passed** as part of 48/48 `[executed]`. Mutation stripping `passwd` from a private copy of `store.ts` makes `hunter2-hist` persist — pin is real `[executed]`.

**FOLDED** for the **claimed** lock-step (regex + leaf functions + MCP call site).

Call sites are **not** fully mirrored — see residuals. That is not a failed S-D3 regex/leaf fold.

Comment at `tool-persistence-redact.ts:4-7` still says it “Mirrors history/store.ts policy”. Regex+leaf now match, so the prior-round “stale regex” challenge is **closed**. The comment is still **overselling** if read as implementation lock-step: cookie-param extra-key scan, generic-tool deep scan, and code-tool `data` collapse remain one-sided (thread-JSON stricter). Nit on the comment, not a BLOCK.

### Prior D-High still holds

| Claim | Live? | Evidence |
|-------|-------|----------|
| Nested `headers.Authorization` **string** | **No leak** | `Bearer nested-secret-XYZ` absent `[executed]` |
| `plainErrorResult` reconstructs; extras dropped | **Holds** | `shell_exec` INTERRUPTED + `stdout`/`stack` → `{success:false, error, error_code}` and `result !== orig` `[executed]`. Wired at thread_recall / host_computer / code-ish / MCP-sensitive. |
| Code-tool `data` always collapsed on thread-JSON | **Holds** | `evaluate` `data: "short secret"` → `{redacted:true,…}`; plaintext absent `[executed]` |

Stale prose: `plainErrorResult` header still says “Returns the row verbatim, else null” (`tool-persistence-redact.ts:162`) while the body reconstructs (`:171-178`). Same leftover as post-merge Lane D. Nit.

---

## Residuals (none meet T3 / REJECT)

Mission: REJECT only if claimed secret shapes still persist. These do **not**.

| ID | Finding | Class |
|----|---------|-------|
| D-N1 | **history cookie params** still skip `redactSensitiveKeysDeep`. `redactCookieParams` (`store.ts:187-197`) only hashes string `value` then `{...parsed}` passthrough. Live `set_cookie` params kept `Authorization: "Bearer cookie-extra"` and `passwd: "cookie-passwd-hist"`; cookie **value** hashed. Cookie **result** extra keys are dropped (not scanned) so `Bearer rest-auth` did **not** land in `result_summary`. Thread-JSON cookie branch **does** scan extras (`:206-214`, `:96-98`). Unusual production shape (prior D classified cookie extra Authorization as nit). | nit — call-site lock-step, not regex |
| D-N2 | **history generic tools** still skip the key scanner (`redactForStorage` returns after MCP branch; no generic `redactSensitiveKeysDeep`). Live `get_page_text` persisted `passwd: "generic-passwd-hist"` and `Authorization: "Bearer generic-auth"`; `value` stayed. Thread-JSON generic path **does** scan (`:278-284`). Pre-existing; S-D3 claimed regex+leaf, not expanding history to generic tools. | nit |
| D-N3 | Object-valued secret keys still recurse instead of collapsing the subtree. Live `{Authorization:{scheme:"Bearer", value:"object-secret-LEAK"}}` leaked on **both** thread-JSON and history MCP. Same family as post-merge **D-N4** (`password: {value: …}`). S-D2 claimed array/numeric, not object bags. | nit (open from prior D) |
| D-N4 | history `evaluate` `result_summary` still 200-char cap (`store.ts:159-164`), not always-collapse. Live `"short secret"` persisted in history.db. Thread-JSON D-High collapse is unchanged and holds. Pre-existing parallel-store gap. | nit / out of claimed nits |
| D-N5 | Official history S-D3 test does not pin array `Authorization` (live probe holds). | test completeness nit |
| D-N6 | “Mirrors history/store.ts policy” comment + `plainErrorResult` “verbatim” comment still imprecise. | comment nit |

Intentionally **not** REJECT: blanket generic `value` (out of slice; pinned to stay).

---

## Scores

| Axis | Score | Note |
|------|-------|------|
| Outcome | **Hold claimed folds** | S-D1 thread-JSON, S-D2 array/numeric, S-D3 regex+leaf+MCP history test all `[executed]` + mutation-killed |
| Trajectory | **Clean** | Exclusive diff +128/−12; regex/leaf extracted once per file; cookie extra scan only on the thread-JSON cookie branch that prior D named |
| Component | **Leaf + two call sites** | Hotspot: `redactSensitiveLeaf` / `SENSITIVE_KEY_RE`. Leftover hotspot: `redactCookieParams` (`store.ts:187`) and generic fall-through (`store.ts:182-184`) |

---

## Eval gate card — `post220-nits` Lane D

**Blast tier**: T2  
**Capability**: Surface L0 · L2 none · Trust tighter persistence redaction (passwd, non-string leaves) · Channel n/a this lane

| Gate | Result |
|------|--------|
| MACHINE | **PASS** — 65/65 + three mutation kills |
| ADVERSARY | **APPROVE_WITH_NITS** (this report) |
| PI_REREVIEW | N/A this lane |
| MERGE | Not this agent's call. No T3 claimed-shape persist. Nits are call-site lock-step / object bags / comments. |

---

Private `/tmp/lane-d-nits-20260825` copies deleted after this report. Production files untouched.

VERDICT: APPROVE_WITH_NITS
