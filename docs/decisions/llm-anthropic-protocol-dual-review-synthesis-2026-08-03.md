# Dual-review synthesis: Anthropic Messages + Coding-Plan header compat

**Date:** 2026-08-03  
**Batch:** `llm-anthropic-protocol`  
**Verdict JSON:** `docs/audit/reviews/llm-anthropic-protocol-verdict-20260803-163315.json`

| Reviewer | Verdict | Artifact |
|----------|---------|----------|
| Claude | **APPROVE_WITH_NITS** | `docs/audit/reviews/llm-anthropic-protocol-claude-20260803-163315.md` |
| Pi | **APPROVE_WITH_NITS** | `docs/audit/reviews/llm-anthropic-protocol-pi-20260803-163315.md` |
| Combined | **both_ok=true** | exit 0 |

**Primary SoT:** `docs/decisions/llm-anthropic-protocol-design-2026-08-03.md`

---

## Consensus

1. **No R1–R6 rejection gate fires.** Design direction is sound.
2. **Architecture:** Internal OpenAI shape + Anthropic wire-only + `fetch`/SSE in P0 — both approve.
3. **L7 first-party hard-deny + L8 no OAuth/Max** — both approve; implement carefully.
4. **System-prompt Claude Code identity injection** — stay **out of v1** (and prefer out entirely unless separate ADR).
5. **ADR-020:** Composition/infra (transport), not Surface / not new runtime.

---

## Open questions — DECISIONS

| # | Question | Claude | Pi | **LOCKED** |
|---|----------|--------|-----|------------|
| **Q1** | UI label for header profile | **A** Claude Code 兼容请求头 | **B** Coding Plan 网关兼容头 | **B primary + Claude Code in helper** (see below) |
| **Q2** | P0 scope | **B** config/CLI+tests, UI P1 | **B** | **B** |
| **Q3** | User-Agent customization | **A** version pin only | **A** | **A** |
| **Q4** | P0 acceptance | **B** fixture/contract tests | **B** | **B** |

### Q1 resolution (split → synthesis)

| Role | Text |
|------|------|
| **Primary checkbox label** | `Coding Plan 网关兼容头` (Pi: avoid productizing “伪装 Claude Code” framing) |
| **Helper (always visible when Anthropic)** | 明确写：部分中继检查 **类似 Claude Code** 的 `User-Agent` / `x-app`；开启后附加兼容头；**不会**登录官方订阅 (Claude: discoverability via helper) |
| **Config enum** | keep `claude_code_compat` (technical, not user-facing marketing) |

Rejected defaults: Q1-A as primary loses; Q2-A = P1; Q3-B = P2 `extra_headers` only with same L7 union deny; Q4-A = optional P1 user smoke checklist, not merge gate.

---

## Must-fix before P0 code (union Claude + Pi)

| ID | Source | Fix |
|----|--------|-----|
| **M1** | Claude N1 | First-party denylist includes `claude.ai` (+ existing `api.anthropic.com` / `*.anthropic.com`) |
| **M2** | Claude N2 | Host match: exact host **or** suffix `.anthropic.com` with leading dot — **not** bare `endsWith("anthropic.com")` |
| **M3** | Pi #1 | L7 applies to **union** of profile headers **and** `extra_headers` / any UA override on first-party hosts |
| **M4** | Pi #2 | Deterministic `max_tokens` rule (e.g. `min(8192, floor(context_window/8))`); document openai-path parity difference |
| **M5** | Claude N5 + Q4=B | P0 acceptance = fixture SSE + multi-turn mock; not “real gateway multi-turn” as merge gate |
| **M6** | Claude N3 | Document: Anthropic `thinking` blocks → map to Canonical `reasoning` if present, else drop (pick one line) |
| **M7** | Pi #3 | Cross-provider thread-resume unit tests (openai→anthropic wire rebuild both directions); drop `reasoning_content` on Anthropic wire |

---

## Non-blocking nits (implement or defer)

- Silent no-op if `profile=claude_code_compat` + `protocol=openai` → warn or document
- `auth_style` may wait P1
- Logger test: header **values** never logged; `x-api-key` already covered by regex — still add assert
- Pin exact `claude-cli` version later in P1 against real relay
- Anthropic thinking/reasoning mapping polish
- settings-web SSRF path must reuse `validateTestBaseUrl` for anthropic probe (when UI ships)

---

## Phase gating after dual-review

| Stage | Allowed? |
|-------|----------|
| Fold must-fix into design brief; status → **DIRECTION LOCKED** | **Yes** |
| P0 code (Provider + convert + adapter + extract + L7 + contract tests) | **Yes** after M1–M7 folded into brief |
| P1 UI (settings-web + Side Panel, Q1 copy) | After P0 green |
| Real third-party gateway smoke | Optional P1; not merge-blocking for P0 |
| OAuth / Max / system-prompt CC identity | **No** |

---

## Recommended next step

1. Update design brief: status LOCKED, Q1–Q4 locked, M1–M7 folded.  
2. Write implementation plan / start P0.  
3. Do **not** start UI until P0 provider tests green (Q2=B).

---

*Both external reviewers APPROVE_WITH_NITS · 2026-08-03.*
