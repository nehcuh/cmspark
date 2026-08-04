# Pi Plan Review — Download Probe · ELEMENT_AMBIGUOUS UX · Thread Titles

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Reviewer | Pi (plan/architecture) |
| Spec | `docs/superpowers/specs/2026-08-04-download-ambiguous-title-fix-goals.md` |
| Review type | **Plan review** (implementation order step 2) — not final completion gate |
| Spot-check | `browser-bridge.ts`, `browser-download-handler.ts`, `adapter.ts` `generateThreadTitle`, `ThreadList.tsx` |

---

## 1. Path A locks — confirm or challenge

### Problem 1: `downloads_find` / `importScripts` — **CONFIRM Path A**

| Path | Plan choice | Pi judgment |
|------|-------------|-------------|
| **A** Static import of `downloads-find` | **Locked** | **Correct.** MV3 SW dynamic `import()` → separate chunk → `importScripts` load failure is a real production class (`#dagg58`). Static import eliminates the chunk boundary. |
| B Inline into bridge | Rejected | Agree — hurts unit-test surface and SW readability. |
| C Dynamic + retry hint only | Rejected | Agree — does not remove root cause. |

**Spot-check (repo as of review):** Path A is **already largely landed**.

```11:14:chrome-extension/src/background/browser-bridge.ts
// Static import (not dynamic): MV3 SW dynamic import("./downloads-find") was
// compiled to a separate chunk that failed importScripts in production
// (thread #dagg58: "downloads-find.xxx.js failed to load"). Goals G1.1.
import { runDownloadsFind } from "./downloads-find"
```

- `downloadsFind` at ~1259 wraps `runDownloadsFind` with structured `error_code` + `user_hint_zh` on throw.
- `browser-download-handler.ts` already **statically** imports `findPreferredExistingDownload` / `redactDownloadUrl` from `./downloads-find` (G1.2 satisfied structurally).

**Residual gaps vs G1 (implementation should close, not re-architect):**

1. **G1.3 field consistency** — `downloads-find.ts` failure paths use:
   - `DOWNLOADS_API_UNAVAILABLE` / `HINT_REQUIRED` with **no** `user_hint_zh`
   - `DOWNLOADS_SEARCH_FAILED` with `recovery_zh` (not the ChatView-preferred key)
2. ChatView only surfaces `result.data.user_hint_zh` (`ChatView.tsx` `toolResultUserHint`). Non-throw returns from `runDownloadsFind` that lack `user_hint_zh` will **not** show Chinese recovery in the tool card even if `recovery_zh` is present.
3. Catch-path still matches `/importScripts|failed to load/i` — fine as defensive residual messaging after static import; do not treat as “dynamic import still required.”

**Impl guidance:** treat G1 as **verify + normalize hints + tests**, not greenfield rewrites. Prefer a single key: `user_hint_zh` (keep `recovery_zh` only if dual-written for back-compat; do not rely on it alone).

---

### Problem 2: `ELEMENT_AMBIGUOUS` — **CONFIRM Path A**

| Path | Plan choice | Pi judgment |
|------|-------------|-------------|
| **A** Fail-closed + zh hint + keep `matches` | **Locked** | **Correct.** Multi-match on GitHub-style pages (Code / Download / Clone) is wrong-click territory. Fail-closed matches product safety posture. |
| B Auto-pick first interactive | Rejected | Agree — high wrong-click risk; conflicts with fail-closed download busy design. |
| C Soft success + matches only | Rejected | Agree — agents invent clicks. |

**Spot-check:** Path A payload is **already largely landed** in `browser-download-handler.ts`:

```162:179:chrome-extension/src/background/browser-download-handler.ts
      if (classification === "ELEMENT_AMBIGUOUS") {
        // ...
            error_code: "ELEMENT_AMBIGUOUS",
            count,
            matches: match?.matches?.slice(0, 5),
            user_hint_zh:
              `页面上有 ${count} 处匹配「${text}」，无法安全自动点击（防止点错）。` +
              // ...
            suggested_action: "disambiguate_selector_or_exact_text",
```

- G2.1 / G2.2: present in code.
- G2.3: ChatView already prefers `user_hint_zh` — no new UI path required.
- G2.4: unit test `runBrowserDownload: text multi-match → ELEMENT_AMBIGUOUS` asserts `error_code` / `count` but **not** `user_hint_zh` or `matches` — close with one assertion block.
- G2.5 optional interactive pool reduce: correctly optional; **do not** ship without tests proving unique interactive candidate cannot be a false exclusive (e.g. hidden “Download” in nav). Prefer leave as non-goal for this batch.

**No challenge to lock A.** Implementation work is mostly **assert + any remaining classify paths** (ELEMENT_NOT_FOUND already has zh; good symmetry).

---

### Problem 3: empty thread titles — **CONFIRM Path A, with a required design contract**

| Path | Plan choice | Pi judgment |
|------|-------------|-------------|
| **A** Provisional from first user text + LLM upgrade + list UI fallback | **Locked** | **Correct product shape.** Offline / API / short-preview failures still leave a useful list row. |
| B LLM-only retries | Rejected | Agree — empty list when title path fails. |
| C UI-only 「未命名」 | Rejected | Agree — history remains low-signal. |

**Spot-check: Path A is NOT done** — this is the main remaining delivery surface.

| Touchpoint | Current state | Gap vs Path A / G3 |
|------------|---------------|---------------------|
| `generateThreadTitle` (`adapter.ts` ~1105) | Requires **user + assistant**; skips if `alias` set and `!force`; **silent** `catch {}` | G3.1 provisional missing; G3.4 log missing; G3.2 upgrade blocked if provisional alias is written without `force` / source flag |
| Call site (`adapter.ts` ~625) | Fires only after final assistant turn (`chat.done` path) | Provisional never set on first user message |
| `ThreadList.tsx` ~132 | `{t.alias \|\| t.id}` | G3.3 wants human fallback (「未命名」+ short id), not bare empty / not full opaque id alone as primary label |
| Fork path (`message-router.ts` ~1002–1038) | Empty alias intentionally; `void generateThreadTitle` silent | Align with G3.4 logging; provisional from first forked user content if present |

**Critical design contract the goals doc under-specifies (must lock before coding G3):**

Today:

```typescript
if (thread.alias && !force) return
```

If G3.1 **persists** a provisional alias from the first user message, **G3.2 will never upgrade** unless implementers:

1. Call `generateThreadTitle` with `force: true` when upgrading from provisional, **and/or**
2. Store a marker such as `title_source: "provisional" | "llm" | "user"` (or equivalent) so auto-title may overwrite provisional **but never** user-edited / LLM-final aliases without explicit force.

**Pi recommendation (implementation default):**  
- Provisional: truncate first user text (e.g. ≤16–24 chars, strip newlines, CJK-safe slice), persist as alias **and** mark source provisional if a field exists; if no schema field, use `force: true` only from the auto post-assistant path when current alias equals the computed provisional (or always force once per first assistant completion when alias length ≤ N and matches first-user prefix).  
- Prefer an explicit `title_source` (or reuse an existing metadata slot) over string heuristics if thread update schema allows a one-field additive change with low blast radius.  
- Manual `thread.generate_title` already uses `force: true` — keep that.

Do **not** challenge Path A; **do** require the upgrade contract to be written into the working plan / PR description so dual review can verify G3.2.

---

## 2. Missing / weak acceptance criteria

Goals G1–G3 are generally well-scoped and non-goals are correctly bounded. Add or tighten:

| # | Gap | Why it matters | Suggested AC |
|---|-----|----------------|--------------|
| M1 | **Provisional → LLM upgrade contract** | Without it G3.1 and G3.2 are mutually exclusive under current `alias && !force` guard | G3.2a: After first assistant completes, alias is LLM title **or** provisional remains only if LLM fails; user-set aliases never overwritten without force |
| M2 | **`user_hint_zh` key normalization (G1)** | ChatView ignores `recovery_zh` | G1.3a: All user-visible download-find failures include `data.user_hint_zh` (not only throw path in bridge) |
| M3 | **Provisional truncation rules** | Unbounded first user paste can wreck list layout / storage | G3.1a: max length + newline collapse + no empty-only whitespace titles |
| M4 | **G2 test depth** | Code has hint/matches; tests do not lock them | G2.4a: assert `user_hint_zh` non-empty and `matches` array length ≥ 1 on multi-match |
| M5 | **Status honesty for already-landed G1/G2** | Risk of “fixing” static import again or conflicting patches | Plan note: G1/G2 = close residual + tests; G3 = primary code delta |
| M6 | **Optional smoke** | `#dagg58` was runtime/SW chunk, not unit-reproducible | Optional G1.6: after extension rebuild, `downloads_find` and prefer_existing path do not error with chunk load (manual / checklist) |
| M7 | **thread.updated after provisional** | Empty flash or stale list if no push | G3.1b: provisional set emits same list-refresh path as LLM title (`thread.updated` or equivalent) |

None of M1–M7 are reasons to reject Path A; M1 and M2 are **blocking for a clean G3 / G1 green final gate**.

---

## 3. Go / no-go for implementation

| Axis | Assessment |
|------|------------|
| Problem framing | Clear; maps to real code + `#dagg58` class |
| Path A locks (1/2/3) | All three **confirmed** |
| Non-goals | Appropriate — no Downloads allowlist redesign, no full title quality SLA, no panel redesign |
| Blast radius | Contained: extension SW import/hints, download handler messaging, companion title path, ThreadList display |
| ADR-020 / capability axes | No new Surface / L2 / compose / confirm dialect implied — OK for this batch |
| Order | Sensible (G1 → G2 → G3); dual review + Pi final gate correct |
| Repo readiness | G1/G2 mostly present; G3 needs real design care (upgrade contract) |

**GO for implementation**, with nits:

1. Document G3 provisional/LLM upgrade contract before/while coding G3.  
2. Normalize `user_hint_zh` on all downloads_find failure returns.  
3. Treat G1/G2 as residual + tests; invest main risk budget in G3.  
4. Do not implement G2.5 auto-unique-interactive in this batch unless tests prove safety (default: skip).

Final completion remains governed by the goals doc Pi final gate (G1.1–G4.4), not this plan review.

---

## Spot-check summary

| File | Exists | Supports Path A? | Notes |
|------|--------|------------------|-------|
| `chrome-extension/src/background/browser-bridge.ts` | Yes | **Yes (landed)** | Static import ~L14; `downloadsFind` wrapper + zh ~L1259 |
| `chrome-extension/src/background/browser-download-handler.ts` | Yes | **Yes (landed)** | ELEMENT_AMBIGUOUS + matches + `user_hint_zh` ~L162 |
| `companion/src/llm/adapter.ts` `generateThreadTitle` | Yes | **Partial** | Upgrade path exists; silent catch; blocks on existing alias — needs G3 work |
| `chrome-extension/src/sidepanel/components/ThreadList.tsx` | Yes | **Partial** | `alias \|\| id` only — needs G3.3 human fallback |

---

## Verdict rationale

Path A locks for problems 1/2/3 are architecturally sound and aligned with existing code patterns. The goals document is implementable and correctly scopes non-goals. Remaining issues are specification tightness (especially G3 upgrade semantics and G1 hint field name), not plan rejection.

VERDICT: APPROVE_WITH_NITS
