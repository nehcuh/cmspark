# Lane D r2 — Incremental re-verify (post REJECT)

**Date**: 2026-08-25  
**Prior**: `docs/audit/reviews/post219-kimi-nits-lane-d-redact-tests-20260825.md` → **REJECT**  
**Lane**: D (redact + test completeness cross-check only)  
**Reviewer**: independent adversary — no source/test edits  
**Repo**: `C:\Users\HuChen\Projects\cmspark`

Do not REJECT the redact fold for M3 (out of slice) unless a **new** redact BLOCK appears.

Evidence: `[executed]` ran; `[inspected]` read; `[assumed]` inferred. Default REFUTED until pinned.

---

## Claimed folds — falsification

| ID | Claim | Result | Evidence |
|----|--------|--------|----------|
| **D-High keys** | `SENSITIVE_KEY_RE` includes `authorization`, `bearer`, `apikey` | **FOLDED** | Live regex line 35 `[inspected]`. Probe: top-level `Authorization`/`Bearer`/`apiKey` and nested `headers.Authorization` all redacted; secrets absent `[executed]`. Unit test `"Authorization / Bearer / apiKey keys…"` `[executed]` in 14/14 suite. |
| **D-High extras** | `plainErrorResult` reconstructs `{success,error,error_code?}` — no stdout/stack | **FOLDED** | Live reconstruct at lines 152–159 `[inspected]`. Probe A5: `stdout`/`stack` gone; `error_code=INTERRUPTED` kept `[executed]`. Unit test `"plainErrorResult drops extra keys…"` `[executed]`. |
| **D-High data** | `SENSITIVE_CODE_TOOLS` always collapse `data` (no ≤200 plaintext) | **FOLDED** | Codeish branch always emits `{ redacted, len, sha256 }` when `data` present `[inspected]` lines 234–239. Probe A1 `evaluate` `"short secret"` and A8 `host_read` `"root:x:0:0"` → collapsed, no plaintext `[executed]`. Unit test `"evaluate data payload is always collapsed…"` `[executed]`. |
| **S1** | `adapter-steer-overflow` 13/13 via provider prototype | **FOLDED** | File mocks `OpenAIProvider.prototype.streamChat` (CanonicalStreamEvent) `[inspected]`. `npx tsx --test tests/adapter-steer-overflow.test.ts` → **13 pass / 0 fail** `[executed]`. Prior 0/13 was the ESM completions dual-package miss; this seam is real. Lane D does not re-score LLM logic. |
| **S2** | composer-lease grep tests dual-candidate `companion/src` paths | **FOLDED** | `candidates = [../src/…, ../../src/…]` + `existsSync` before `readFileSync` `[inspected]` (~194–219, ~557). `npx tsx --test tests/composer-lease.test.ts` → **36/36 pass** `[executed]`. Still source-grep theater class, but path resolution claim holds. |

---

## MUST FALSIFY checklist

### 1. Redact unit suite `[executed]`
```text
cd companion; npx tsx --test tests/tool-persistence-redact.test.ts
→ tests 14, pass 14, fail 0
```

### 2. Replay prior BLOCK probes `[executed]`
| Probe | Leaks? | Notes |
|-------|--------|-------|
| `Authorization` / nested headers | **No** | redacted marker |
| `Bearer` / `apiKey` | **No** | redacted |
| `evaluate` data `"short secret"` | **No** | collapsed |
| INTERRUPTED + `stdout`/`stack` | **No** extras; **Yes** `error_code` | reconstruct |

### 3. Remaining key aliases `[executed]`
| Key | Matched by regex? | Persist? |
|-----|-------------------|----------|
| `x-api-key` / `X-Api-Key` | **Yes** (`api[_-]?key` substring) | redacted |
| `access_token` | **Yes** (`token`) | redacted |
| `passwd` | **No** | **plaintext remains** |
| `password` | Yes | redacted |
| generic tool key `value` (non-cookie tool) | **No** | **plaintext remains** on `get_page_text` |

`passwd` and bare `value` are **nits**, not Trust-path BLOCKs at the prior severity (Authorization / short evaluate / INTERRUPTED extras). Cookie tools still go through dedicated `redactOneCookie` (value → hash) — unchanged OK.

### 4. INTERRUPTED heal marker `[executed]`
`shell_exec` / `host_computer` / `thread_recall` / MCP sensitive-name fillers keep `error_code: "INTERRUPTED"`; data-bearing errors still collapse. No heal regression.

### 5. M3 pack.apply router tests
**Still OPEN** as a prior PR219 residual. **Out of Lane D redact slice** — not used to REJECT this fold. No new redact BLOCK found that would force REJECT.

---

## Prior residual roll-forward (status only)

| ID | r1 | r2 |
|----|----|----|
| D-R1 Authorization/Bearer | OPEN BLOCK | **FOLDED** |
| D-R2 ≤200 code/host data | OPEN BLOCK | **FOLDED** |
| D-R3 plainError extras | OPEN BLOCK | **FOLDED** |
| R2-N4 adapter-loop fake fold | OPEN BLOCK | **FOLDED** (13/13) |
| M3 router pack.apply tests | OPEN | OPEN (out of slice) |
| M1 overlay drain success integration | tests incomplete | still incomplete (not re-opened as redact BLOCK) |
| N9 / R2-N2 / R2-N3 / N1 | OPEN nits | unchanged nits |
| **D-R4** `passwd` key miss | — | **OPEN nit** |
| **D-R5** generic `value` key | — | **OPEN nit** |

---

## Verdict rationale

All three prior redact BLOCKs and the fake adapter-loop fold are **actually gone at call sites and under execution**. Remaining key aliases (`passwd`, generic `value`) are bounded nits. M3 stays open but is explicitly out of this slice. No new redact BLOCK found.

---

VERDICT: APPROVE_WITH_NITS
