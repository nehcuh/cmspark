# Lane D — Independent post-merge adversary: persistence redaction + test honesty

**Date**: 2026-08-25  
**Lane**: D (persistence redaction + test honesty)  
**Reviewer**: independent adversary — did **not** implement PR #220; no production source edits  
**Range**: `c5b4242..1d16b0e`  
**HEAD**: `1d16b0ed8b7a8eb0fc75c529cd88e24089f9c2bb` (`1d16b0e fix(agent): fold post-#219 kimi nits after four-lane adversary (#220)`) `[executed]`  
**Frozen patch SHA256**: `b5e936cbf1dc66afc3fc7aef5898fb417692ed63325b9a4ed8bb11caf5c86021` `[executed]` matches `docs/audit/reviews/post220-merged-diff-20260825-085108.patch` and `git diff c5b4242..HEAD -- ':!docs/audit/reviews'`  
**Blast**: T2 (Trust-adjacent: `threads/*.json` secrets). No escalate to T3 — claimed secret shapes do not persist under probe.

Default **REFUTED** until `file:line` + `[executed]` / `[inspected]`. Do not treat r2 APPROVE_WITH_NITS as proof.

Exclusive production range:

- `companion/src/security/tool-persistence-redact.ts`
- `companion/src/threads/thread-manager.ts`
- `companion/tests/tool-persistence-redact.test.ts`
- `companion/tests/threads-history.test.ts`

Honesty-only (read, not owned): `companion/tests/adapter-steer-overflow.test.ts`, `companion/tests/composer-lease.test.ts`.

---

## Capability (ADR-020) — challenge

Implementer claim (shared prompt):

```text
Surface:      L0 (steer/nextRun composer + overlay hub; no new L2)
L2-classes:   none
Compose:      none (overlay-eligible pack already on main)
Autonomy:     steer / nextRun queue
Trust:        overlay never Allow/Deny; persistence redaction must not leak
Channel:      composer lease / overlay session token
```

Lane D challenge of that claim:

| Check | Result |
|-------|--------|
| Axes fit | Redact is Trust/Channel (durable thread JSON), not Surface/Compose. `thread-manager` trim is Autonomy-adjacent tape hygiene, not a new runtime. `[inspected]` |
| New tools / gates / primary UI | **None** in exclusive range. Missing-declaration BLOCK does not apply. |
| Trust monotonicity | No L2 skip, no overlay-as-confirm, no `auto_approve_*`. Persistence redaction is the Trust surface for this lane. |
| originWs | N/A — no `securityConfirmations.request` in exclusive files. |
| Persistence leak of secrets | Claimed Authorization / short code-`data` / INTERRUPTED extras on code/host/MCP-sensitive/thread_recall: **do not leak** `[executed]`. Residuals below stay nits (not T3). |

`history/store.ts` still uses the **pre-#220** key regex (no `authorization\|bearer\|apikey`) `[inspected]` `companion/src/history/store.ts:49`. That is a **parallel store** (history.db), not thread JSON, and is outside this exclusive range. Comment at `tool-persistence-redact.ts:4` still says it “Mirrors history/store.ts policy” — **stale**; thread JSON is now stricter. Nit, not a thread-JSON BLOCK.

---

## Method

1. Confirm HEAD + frozen patch SHA256 `[executed]`
2. Read live redact module, `createToolResultMessage`, `addMessage` / trim, exclusive tests `[inspected]`
3. Mandated tests from `companion/` `[executed]`
4. Private `/tmp/lane-d-mut` probes against live source `[executed]`
5. Mutation-kill: copy redact module, **strip `authorization` from `SENSITIVE_KEY_RE`**, replay Authorization pins — expect fail `[executed]`
6. Path-sim of composer-lease dual-candidate vs CI `.test-dist/tests` `__dirname` `[executed]`

Worktree had no `companion/node_modules`. First `npx tsx` (global) failed `Cannot find module 'gray-matter'` / `'openai'`. Linked main-repo `node_modules` for the run, then removed the symlink. Counts below are post-link.

---

## Machine `[executed]`

```text
cd companion
npx tsx --test tests/tool-persistence-redact.test.ts tests/threads-history.test.ts
→ tests 72, pass 72, fail 0
   (tool-persistence-redact: 14; threads-history: 58 including 2 new trim pins)

npx tsx --test tests/adapter-steer-overflow.test.ts
→ tests 13, pass 13, fail 0
```

Honesty extra (not mandated for Lane D scoring of LLM semantics):

```text
npx tsx --test tests/composer-lease.test.ts
→ tests 36, pass 36, fail 0
```

Mutation-kill (private copy, `authorization` removed from regex):

```text
tsx --test /tmp/lane-d-mut/pin-authorization.test.ts
→ tests 2, pass 0, fail 2
   AssertionError: String(p.Authorization).startsWith("<redacted:")  is false
   nested headers.Authorization pin also fails
```

Official suite pin **dies** when the regex token is stripped. That is a real pin, not grep-theater.

---

## Persist path (disk vs in-flight) `[inspected]`

| Path | Redacted? |
|------|-----------|
| `createToolResultMessage` (`tool-batch-heal.ts:8-19`) → `redactToolPayloadForPersistence` → `threadManager.addMessage` → `threads/<id>.json` | **Yes** — only disk gate for tool `params`/`result` |
| Heal fillers `persistHealedToolRows` (`tool-batch-heal.ts:187-200`) | Same gate; params `{}`; result `{success:false, error, error_code:INTERRUPTED}` |
| In-flight LLM `messages[]` / WS tool.result | **No** — module comment is accurate |
| `ThreadManager.addMessage` itself | **Does not redact** — trusts caller |

No second unredacted thread-JSON writer of tool payloads found on the adapter → addMessage path.

---

## Must-falsify

### 1. D-High keys — `SENSITIVE_KEY_RE` covers authorization / bearer / apikey (incl. nested `headers.Authorization`)

Live regex `[inspected]` `tool-persistence-redact.ts:35`:

```text
/(secret|token|password|api[_-]?key|credential|private[_-]?key|authorization|bearer|apikey)/i
```

`redactSensitiveKeysDeep` (`:41-58`) recurses objects/arrays; string values whose **key** matches are replaced with `<redacted:len=:sha256=>`.

| Probe | Leaks? | Evidence |
|-------|--------|----------|
| Nested `{ headers: { Authorization: "Bearer nested-secret-XYZ" } }` on `mcp__http__fetch` | **No** | marker `len=24:sha256=a81a15ba8427`; secret absent `[executed]` |
| `AUTHORIZATION` / `authorization` / `Bearer` / `apiKey` / `apikey` / `api_key` / `x-api-key` | **No** | all markers `[executed]` |
| `createToolResultMessage` nested `headers.Authorization` | **No** | persist path redacts `[executed]` |
| Strip `authorization` from regex (mutation) | pin **fails** | official + nested tests 0/2 `[executed]` |

**FOLDED** for the claimed string-key shapes. Case-insensitive `/i`, no `g` flag (no `lastIndex` trap).

Caveat (nit, not BLOCK): values that are **not strings** skip the key test (`typeof v === "string"` at `:50`). See residuals.

Official unit test (`tool-persistence-redact.test.ts:62-74`) pins **top-level** keys on `mcp__http__fetch`, not nested `headers.Authorization`. Nested is implemented by the same deep walk; I probed it separately. Completeness nit.

### 2. D-High extras — `plainErrorResult` reconstructs a **fresh** object; INTERRUPTED fillers hit it

`[inspected]` `tool-persistence-redact.ts:145-160`: allowlists `{ success:false, error, error_code? }`. Comment at `:143` still says “Returns the row verbatim” — **stale** (r1 verbatim return was the BLOCK). Code reconstructs.

Wired at: `thread_recall` (`:183`), `host_computer` (`:212`), code-ish (`:222-225`), MCP sensitive-name (`:251`).

| Probe | Result |
|-------|--------|
| `shell_exec` `{INTERRUPTED, stdout:"SECRET_ENV=1", stack, env}` | extras **gone**; `{success:false, error:"interrupted", error_code:"INTERRUPTED"}` `[executed]` |
| Same object identity | `result === orig` **false** — fresh object `[executed]` |
| Data-less INTERRUPTED filler | keeps `error_code` for `shell_exec` / `evaluate` / `host_computer` / `thread_recall` / `mcp__fs__read_file` `[executed]` |

Heal filler shape (`tool-batch-heal.ts:86-87` and `:187-191`) is exactly `{success:false, error, error_code}` with `data === undefined` → hits this branch.

**FOLDED.**

### 3. D-High data — code-ish `data` always `{redacted:true, len, sha256}` (no ≤200 plaintext)

`[inspected]` `tool-persistence-redact.ts:227-239`: if `r.data !== undefined`, always collapse. The old `dataStr.length > 200 ? collapse : r.data` is gone.

| Tool | `data: "short secret"` | Persist |
|------|------------------------|---------|
| evaluate / osascript_eval / shell_exec / host_read / host_write / workspace_read_file | collapsed `len=14` | **no plaintext** `[executed]` |
| host_computer (early `collapseResult`) | whole-result redacted | **no plaintext** `[executed]` |

Unit test `"evaluate data payload is always collapsed (even under 200 chars)"` `[executed]`.

**FOLDED** for the claimed `{success, data}` object shape.

### 4. Residual `passwd` / bare `value` — nit vs BLOCK

Mission rule: BLOCK **only** if cookie/auth tools persist them, or a **new regression** of claimed coverage.

| Shape | Persist plaintext? | Class |
|-------|--------------------|-------|
| generic `get_page_text` param/result `passwd` | **Yes** `[executed]` | nit (regex is `password`, not `passwd`) |
| generic param/result `value` | **Yes** `[executed]` | nit |
| generic `password` | **No** (hashed) | OK |
| `set_cookie` / `get_cookies` **`value`** | **No** — params hashed (`:190-192`); cookie objects → `value_hash` / `value_length` (`:73-91`) `[executed]` | claimed cookie path **holds** |
| cookie extra key `passwd` on params **and** `redactOneCookie` `...rest` | **Yes** `[executed]` | nit — `passwd` is not a cookie protocol field; the secret field is `value` and is hashed |
| cookie params `Authorization` (cookie branch **skips** `redactSensitiveKeysDeep`) | **Yes** `[executed]` | nit — not a production get_cookies/set_cookie argument; early-return bypass of the generic key scan |

Not a new regression of claimed Authorization / short-`data` / INTERRUPTED-extras coverage. **Not BLOCK.**

### 5. Test honesty

#### `adapter-steer-overflow.test.ts` — mock seam

`[inspected]` file header `:10-12` and `before` `:114-121` patch **`OpenAIProvider.prototype.streamChat`**, not a dummy Completions class.

Production: `provider.ts:140` constructs `OpenAIProvider`; `adapter.ts:927` `for await (const ev of provider.streamChat({...}))`.

`[executed]` **13 pass / 0 fail**. r1 “fake production path / 0/13” is **gone**. Lane D does not re-litigate LLM semantics (Lane A).

#### `composer-lease.test.ts` — `.test-dist` path

File does **not** grep `menu-bar-agent.ts`. Greps that exist:

- `message-router.ts` dual-candidate `:194-199` — `../src` then `../../src`
- `lifecycle.ts` dual-candidate `:210-215` and `:552-557`

CI `scripts/run-tests.mjs` compiles to `.test-dist/tests/*.test.js` (`tsconfig.test.json` `rootDir: "."`, `outDir: ".test-dist"`). Compiled `__dirname` is `companion/.test-dist/tests`.

Path-sim `[executed]`:

| `__dirname` | `../src/*.ts` | `../../src/*.ts` |
|-------------|---------------|------------------|
| `companion/tests` (tsx) | **hit** `companion/src` | miss (`<repo>/src`) |
| `companion/.test-dist/tests` (CI) | **miss** `.test-dist/src/*.ts` (tsc emits `.js`) | **hit** `companion/src/*.ts` |

Old r1 **single** `../src` relative to the compiled file **still misses**. Dual-candidate is the actual fold. Same dual-candidate would also resolve `menu-bar-agent.ts` if this file grepped it (it does not; that grep lives in `companion-ui-rects.test.ts`, out of slice).

`[executed]` composer-lease **36 pass / 0 fail** under tsx.

**Honesty FOLDED** for the greps this file actually performs.

### 6. `thread-manager.ts` +5/−1 — do not skip

Diff `[inspected]` `trimMessagesTurnSafe` orphan-tool branch (`:243-248`):

```diff
-      start = k < messages.length ? k : Math.max(0, messages.length - max)
+      start = k < messages.length ? k : a
```

When the cut lands on tool rows with **no assistant owner**, and the remainder of the tape is all tools, keep the pre-block non-tool anchor `a` (over-cap) instead of re-applying the raw `length-max` window (tool-leading).

Pins `[executed]` in `threads-history.test.ts:354-380`:

- `[user, tool, tool, tool]` max=3 → keep 4, first role `user`
- `[system, tool, tool]` max=2 → keep system + tools

**Persistence / redaction interaction:** trim runs **inside** `addMessage` (`:995-999`) **after** `createToolResultMessage` has already redacted. Trim does not un-redact. The change keeps **more** rows (over-cap) rather than dropping the owner-side message; if those tool rows were redacted, disk stays redacted. No Trust leak introduced. Over-cap vs 1000-cap remains a pre-existing nit (R2-N2 class), not a new redact BLOCK.

---

## Additional residuals (adversary extras — not r2 copy)

All `[executed]` unless noted. **None** meet the BLOCK bar in the mission rule.

| ID | Finding | Class |
|----|---------|-------|
| D-N1 | `passwd` / bare `value` on generic tools | nit (r2-class) |
| D-N2 | Array-valued `headers.Authorization: ["Bearer array-secret"]` persists — key match requires `typeof v === "string"` (`:50`) | nit (Node `IncomingHttpHeaders` can be `string[]`; not the claimed string fold) |
| D-N3 | Numeric `apiKey: 123456789` persists | nit |
| D-N4 | `{ password: { value: "nested-pw-LEAK" } }` — object value skips key redact; inner `value` unmatched | nit |
| D-N5 | Code-ish **non-object** result (`evaluate` result `"raw-string-SECRET"`) bypasses the object rebuild (`:221` `typeof result === "object"`) and passes through | nit — claimed fold is `data` on object results; production `ToolExecutionResult` is an object `[inspected]` |
| D-N6 | Code-ish `error` string ≤200 kept raw (`:231-233`); `error: "token=ERRORSECRET"` persists next to collapsed `data` | nit |
| D-N7 | Cookie / MCP-non-sensitive INTERRUPTED extras: cookie branch `{...r, data}` (`:198-201`) keeps `stdout`; `mcp__http__ping` uses deep-key scan only → `stdout` persists | nit — heal fillers have no extras; `plainErrorResult` is not wired on these branches |
| D-N8 | Cookie params skip `redactSensitiveKeysDeep` (only `value` hashed) | nit |
| D-N9 | Official suite does not pin nested `headers.Authorization` (top-level only) | completeness nit; production walk still redacts |
| D-N10 | JSDoc `:143` “verbatim” vs reconstruct | comment drift |
| D-N11 | `history/store.ts` regex not updated (out of exclusive range) | parallel-store nit |
| D-N12 | `apikey` is redundant with `api[_-]?key`; `host_computer` is in `SENSITIVE_CODE_TOOLS` but returns earlier | dead/redundant |

---

## Score

| Axis | Score | Note |
|------|-------|------|
| **Outcome** | claimed D-High BLOCKs **gone** at live call sites + probes | Authorization string keys (incl. nested headers); INTERRUPTED reconstruct; code-ish `data` always hashed |
| **Trajectory** | r1 BLOCK → r2 claimed fold → **independent re-verify holds** | mutation-kill proves the Authorization pin is load-bearing |
| **Component** | redact module + persist gate (`createToolResultMessage`) + trim hygiene | thread-manager change does not weaken redaction |

---

## Verdict rationale

Re-executed, not rubber-stamped:

- Three D-High attacks (keys / extras / short `data`) **fail to leak** the claimed secret shapes `[executed]`.
- Authorization pin **mutation-kills** `[executed]`.
- Adapter-loop mock is the real `OpenAIProvider.prototype.streamChat` seam; 13/13 `[executed]`.
- Composer-lease source greps use dual-candidate paths that resolve both tsx `tests/` and CI `.test-dist/tests` `[executed]`.
- `thread-manager` +5/−1 is orphan-trim over-cap; no redact bypass.

Remaining holes (`passwd`/`value`, non-string Authorization, cookie extra keys, error-string passthrough, history.db regex drift) are bounded nits under the mission’s BLOCK rule. No new confirm skip, overlay-as-Trust, or persistence leak of the claimed secrets → blast stays T2.

VERDICT: APPROVE_WITH_NITS
