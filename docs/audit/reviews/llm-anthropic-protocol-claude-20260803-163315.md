I have all I need. Patch is current (git status matches the diff file content); no Anthropic SDK exists in `companion/package.json` (only `openai`); settings-web.ts:459 hardcodes `/chat/completions` + `Bearer`; `api.anthropic.com` only appears in `LLM_HOST_ALLOWLIST` (settings-web.ts:94). All brief claims about the repo verify.

---

# Independent re-review: `llm-anthropic-protocol` design brief

## 1. Findings

### Repo-claim verification (R6 pass)

| Brief claim | Verified against | Result |
|---|---|---|
| `package.json` has `openai` only, no `@anthropic-ai/sdk` | `companion/package.json:36` | ✓ |
| `adapter.ts` is OpenAI-only stream + tool loop | `companion/src/llm/adapter.ts:1,439-510` | ✓ |
| `llm-extract.ts` uses `new OpenAI({baseURL,apiKey})` → `chat.completions.create` | `companion/src/llm/llm-extract.ts:27-43` | ✓ |
| `config.llm` shape = 5 fields, DeepSeek default | `companion/src/config.ts:152-158, 211-219` | ✓ |
| settings-web test hardcodes `/chat/completions` + Bearer | `companion/src/settings-web.ts:459-465` | ✓ |
| Default `model_name = deepseek-v4-flash` | `companion/src/config.ts:217` | ✓ |
| No code today references `claude-cli` / `x-api-key` | grep `companion/src` | ✓ only `api.anthropic.com` in SSRF allowlist |

R6 cleared — no material false claims.

### Rejection-gate check

| Gate | Result |
|---|---|
| R1 first-party spoof | ✓ L7 hard-deny; profile default `none` (L6); brief §10 explicitly rejects |
| R2 OAuth/Max/cookie | ✓ L8 red-line; R2-enforcing `claude.ai` cookie never an auth path |
| R3 thread-schema migration | ✓ L1 locks internal OpenAI shape; Anthropic is wire-only |
| R4 silent auto-detect | ✓ L3 explicit user choice; §10 rejects silent probe |
| R5 cc-switch clone / Max product | ✓ §1 positioning, §10 rejections, Non-goals line 10 |
| R6 false repo claim | ✓ all claims verified above |

No rejection triggered.

### Non-blocking nits

N1. **§3 first-party denylist is under-specified.** Lists `api.anthropic.com` + `*.anthropic.com` only. `claude.ai` (Anthropic consumer domain) is not in L7's denylist — it should be, even though cookie auth is already banned (R2/L8), for defense-in-depth. Must-fix-before-P0.

N2. **§3 suffix-match algorithm not pinned.** Brief says "后缀匹配" but a naive `endsWith("anthropic.com")` would match `evilanthropic.com`. Implementer must use either PSL-aware logic or precise `.anthropic.com` (with leading dot) + exact-host match. Must-fix-before-P0 (one-line spec addition).

N3. **§4 Anthropic `thinking` block → Canonical mapping missing.** `adapter.ts:550` already handles DeepSeek `reasoning_content`. The SSE mapping table covers `content_block_delta` / `message_delta` but not Anthropic's `thinking` blocks (gated by `anthropic-beta` §3 mentions but doesn't map). Decide before P0: map `thinking` → `reasoning`, or drop. Nit.

N4. **§7 server.ts probe claim unverified.** I did not find a model probe in `server.ts` via targeted grep (could not load full file in budget). Implementer: confirm whether a probe exists today; if yes, add protocol-aware branching (openai `/models` vs anthropic `/v1/models` with `x-api-key` + `anthropic-version`). If no probe exists, drop the row from §7 to avoid phantom work. Nit.

N5. **§8 vs §11 Q4 consistency.** §8 P0 acceptance literally says "Anthropic 兼容端点 tool 多轮对话通" (real endpoint multi-turn works), but §11 Q4 asks whether a real gateway smoke test is required. If Q4 is decided B (contract tests sufficient), §8 P0 row should be rewritten to "fixture-based SSE contract test + multi-turn mock". Doc-consistency nit.

N6. **§4 `tool_call.id` normalization one-sided.** Brief says normalize outgoing ids to `^[a-zA-Z0-9_-]+$` for Anthropic round-trip — good. But should also state OpenAI side passes through unchanged (its `call_…` ids already conform); otherwise an implementer might over-normalize. Nit.

N7. **§3 `anthropic_version` default `"2023-06-01"`** is the documented GA version — fine. But pin it as a constant with a comment pointing to the Anthropic changelog so it doesn't drift silently. Nit.

N8. **Doc CN/EN mix.** Consistent with project convention (CLAUDE.md is mixed). Non-blocking.

## 2. Design questions (1–5)

**1. L1–L10 coherent & complete for P0?** Yes. L1 fixes the canonical shape, L2 the abstraction, L3 the protocol switch, L4 the implementation substrate, L5 the axis separation, L6/L7 the opt-in + hard-deny (the security crux), L8 the auth red-line, L9 the version-pin discipline, L10 the vision scope cut. The Anthropic-specific gotchas (`max_tokens` required, base_url normalization, `tool_call.id` charset, `system` top-level) are all called out in §4. No missing *blocking* lock — only the nits above.

**2. Internal OpenAI shape + Anthropic at wire only — right architecture?** Yes. Adopting `@anthropic-ai/sdk` would (a) add a hard dependency the brief rightly rejects for header-control reasons — the gateway-compat feature *requires* per-request header injection that the SDK fights, and (b) doesn't help anyway since the tool loop / thread tape is already OpenAI-shaped. Dual persistence is R3-rejected. This is the same approach LiteLLM / Vercel AI SDK / OpenRouter take, and matches the small-surface-area discipline.

**3. L7 hard-deny correct & implementable?** Both. The check is config-time *and* per-request (§6: "启动该轮 LLM 前失败" — explicitly pre-flight, not just saveConfig). The only implementation hazards are N1 (`claude.ai` omission) and N2 (suffix algorithm). With those two fixed, L7 is shippable.

**4. System-prompt Claude Code identity injection — out of v1?** Yes, correctly excluded. The header gate is what coding-plan relays actually check (UA / x-app); prompt-pattern gating is rarer and much harder to detect reliably. Injecting "You are Claude Code…" would also change model behavior and billing semantics (§3 footnote is right to flag this). If a specific gateway ever demands it, the existing `system_prompt_append` (already in thread `config_override`, see `adapter.ts:387-390`) or a Pack covers the power user without a built-in feature. No need for v1.

**5. ADR-020 framing correct?** Yes. This is textbook Composition / transport infra: no new Surface (browser tools unchanged), no new Autonomy (single tool-loop preserved), no new Pack/Skill primitive, no new agent runtime. The capability declaration in the dual-review prompt matches the ADR-020 §6 template precisely. Trust labeling (opt-in profile, hard-deny, no agent-writable) is well-scoped.

## 3. DECISIONS

| # | Question | Pick | Rationale |
|---|---|---|---|
| Q1 | UI label | **A** `Claude Code 兼容请求头` | Discoverability wins; users searching "Claude Code 中继" find it. Honest helper text (§5) + L7 hard-deny neutralize the spoofing undertone. Use B as a sub-label/helper line. |
| Q2 | P0 scope | **B** config/CLI + tests first, UI in P1 | Matches brief §8 phasing. Core adapter is the riskiest part; UI parity is mechanical and can ride on validated Provider abstraction. |
| Q3 | User-Agent customization | **A** version pin only | Pin covers all known gateway patterns (`claude-cli/<ver>`). Free-form UA invites PII leak / abuse vector; defer to P2 `extra_headers` allowlist with explicit review for the rare power user. |
| Q4 | P0 acceptance | **B** fixture/mock + contract tests | Public Anthropic wire spec + fixture SSE streams catch the mapping bugs. Requiring a real gateway creates a vendor dependency the brief explicitly avoids (§11 Q4 ack). Users with accounts can smoke in P1. |

**Recommended defaults for rejected options:** Q1-B as helper subtitle; Q2-A as P1 follow-up (already in brief §8); Q3-B as P2 `extra_headers` allowlist item with security review; Q4-A as a user-facing smoke checklist (not merge-blocking).

## 4. Must-fix before P0 code

- **M1 (N1):** Add `claude.ai` to the §3 first-party denylist.
- **M2 (N2):** Pin the suffix-match algorithm in §3 — precise `.anthropic.com` (with leading dot) plus exact host match; reject bare `endsWith('anthropic.com')`.
- **M3 (N5):** Reconcile §8 P0 acceptance with the Q4 decision (B) — rewrite the P0 acceptance row to "fixture-based SSE contract test + multi-turn mock" instead of "Anthropic 兼容端点 tool 多轮对话通".
- **M4 (N3):** Decide and document in §4 whether Anthropic `thinking` blocks map to Canonical `reasoning` or are dropped (one-line spec).

All four are one-line spec additions to the brief — no redesign.

## 5. ADR-020 capability checklist

| Check | Result |
|---|---|
| Axes fit — Composition (not mis-tagged Surface/Autonomy) | ✓ brief declaration correct |
| Not labeled "中层 Agent" / new runtime | ✓ explicitly transport adapter |
| Pack-first — new scenario has Pack alternative? | n/a (infra, not scenario) |
| Confirm dialect — reuses existing gates? | ✓ no new confirmation family (uses settings save path, same trust as `api_key`) |
| Trust monotonicity — looser semantics not inherited? | ✓ hard-deny *raises* the bar, doesn't lower it |
| originWs — new confirms bind originWs? | n/a (no new `securityConfirmations.request`) |
| No new agent runtime | ✓ same tool-loop, same Surface |
| Experimental layer not on write path | n/a |
| Capability declaration present & complete | ✓ matches ADR-020 §6 template |

## 6. Verdict

Nits N1–N8 above (with M1–M4 must-fix spec edits before P0 code).

VERDICT: APPROVE_WITH_NITS
