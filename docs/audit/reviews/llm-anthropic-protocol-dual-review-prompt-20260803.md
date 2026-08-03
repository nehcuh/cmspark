# Dual external re-review: Anthropic Messages protocol + Coding-Plan gateway header compat

**Stage:** Product design brief — **implementation has NOT started**  
**Date:** 2026-08-03  
**Repo:** `/Users/huchen/Projects/cmspark`  
**Batch id:** `llm-anthropic-protocol`

## Required reading (in order)

1. **Primary SoT (design brief)**  
   `docs/decisions/llm-anthropic-protocol-design-2026-08-03.md`  
   Focus: §0 Why, §1 positioning, §2 L1–L10, §3 config, §4 architecture, §5 UX, §6 security, §8 phases, §10 rejections, **§11 open questions**.

2. **Current LLM stack (repo truth — verify with tools)**  
   - `companion/src/llm/adapter.ts` (header comment + OpenAI client + stream/tool loop)  
   - `companion/src/llm/llm-extract.ts`  
   - `companion/src/config.ts` (`llm` shape, defaults DeepSeek OpenAI-compatible)  
   - `companion/src/settings-web.ts` (test connection currently hardcodes `/chat/completions` + Bearer)  
   - `companion/package.json` (deps: `openai` only — no Anthropic SDK)

3. **Capability ontology**  
   `docs/adr/020-capability-model-three-axes.md` — this feature is **Composition/infra** (LLM wire), not a new Surface/Autonomy. Challenge if brief mis-frames it.

4. **Do NOT treat as SoT**  
   Chat paraphrases; only the design brief + repo files.

## Product premise (under review)

```text
1. Support native Anthropic Messages API (/v1/messages) as a second wire protocol.
2. Keep internal messages/tools OpenAI-shaped (no thread schema migration).
3. Optional "Claude Code compatible headers" for third-party Coding Plan gateways
   that gate on User-Agent / x-app — DEFAULT OFF.
4. Hard-deny applying those headers when base_url host is Anthropic first-party.
5. Never ship OAuth / Max subscription hijack / Claude.ai cookie auth.
6. Not becoming cc-switch (multi-CLI config switcher).
```

## Capability declaration (challenge if wrong)

```text
Surface:      unchanged (browser agent tools)
L2-classes:   n/a — this is LLM transport only
Compose:      protocol adapter (openai | anthropic wire)
Autonomy:     unchanged
Trust:        opt-in client_header_profile; first-party host hard deny; no agent-writable headers
Channel:      community default
```

## Your job

Independent **product + security + architecture** review of the **design brief**.  
There may be **no implementation code** beyond the new design doc — verify current stack claims against repo.

### Must answer (all required)

**Design quality**

1. Are locks **L1–L10** coherent and complete enough to implement P0 without redesign? Missing **blocking** lock?  
2. Is “internal OpenAI shape + Anthropic at wire only” the right architecture, or should we adopt Anthropic SDK / dual persistence?  
3. Is **L7** (hard deny compat headers on `api.anthropic.com`) correct and implementable?  
4. Should **system-prompt Claude Code identity injection** (as cc-switch does) stay **out of v1**, or is it required for real coding-plan gateways?  
5. ADR-020 framing: is this correctly non-Surface / non-new-runtime?

**Open questions — YOU MUST DECIDE** (pick A or B; if split rationale, still pick one recommended)

| # | Question | Options |
|---|----------|---------|
| **Q1** | UI label for header profile | **A** `Claude Code 兼容请求头` (discoverability) · **B** `Coding Plan 网关兼容头` (neutral/compliance) |
| **Q2** | P0 scope | **A** include settings-web + Side Panel UI · **B** config/CLI + tests first, UI in P1 |
| **Q3** | User-Agent customization | **A** version pin only · **B** full custom UA string (allowlisted header) |
| **Q4** | P0 acceptance | **A** require one real third-party gateway smoke · **B** fixture/mock + contract tests sufficient for merge; gateway smoke optional later |

Also state: **recommended default for any option you reject**, and **must-fix nits** before implementation.

### Rejection gates (any fail → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Brief requires or defaults to Claude Code header spoof against **first-party Anthropic** |
| R2 | Ships OAuth / Max / claude.ai session as auth path |
| R3 | Migrates thread storage to Anthropic-native shapes as P0 requirement without justification |
| R4 | Auto-detect protocol from base_url that silently changes behavior without user intent |
| R5 | Treats CMspark as Claude Code clone / Max subscription product |
| R6 | Material false claim about current repo (e.g. “already has Anthropic SDK”) without correction path |

### Non-blocking nits (→ APPROVE_WITH_NITS)

- Naming polish between protocol fields  
- Exact `claude-cli` version pin value  
- Whether `auth_style` needed in P0 or can wait  
- Side Panel vs settings-web parity timing  
- Extra test matrix items  
- Doc language Chinese/English mix  

### Output format

1. **Findings** — blocking vs nits (cite brief § or file:line for repo claims)  
2. **Explicit answers** to design questions 1–5  
3. **DECISIONS table** for Q1–Q4 with your pick (A/B) + one-line rationale each  
4. **Must-fix before P0 code** (if any)  
5. **ADR-020 checklist** (axes fit)  
6. Final line exactly one of:  
   `VERDICT: APPROVE`  
   `VERDICT: APPROVE_WITH_NITS`  
   `VERDICT: REJECT`
