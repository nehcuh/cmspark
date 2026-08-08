# Multi-adversarial synthesis — Vision reuse main LLM P0

**Date**: 2026-08-08  
**Brief**: `docs/decisions/vision-reuse-main-llm-brief-2026-08-08.md`  
**Method**: 3 independent explore subagents (Product / Security / Architecture) + orchestrator lock  
**Blast**: T2

## Lane verdicts

| Lane | VERDICT | Blocking themes |
|------|---------|-----------------|
| Product/UX | APPROVE_WITH_NITS | Banner honesty; Anthropic hard-block; real key path; kill Ollama-required copy; CU rail disambiguation |
| Security | **REJECT** (as brief written) | Hostname disclosure; Q2=A toast-only insufficient; Anthropic soft-B; no POST with placeholder key to cloud |
| Architecture | APPROVE_WITH_NITS | protocol≠anthropic hard gate; companion key inherit without new schema; Side Panel primary |

## Locked decisions (implementer MUST)

| # | Decision |
|---|----------|
| Q1 | **A** — never offer reuse when `protocol === "anthropic"` |
| Q2 | **Server inherit** — if after save vision url+model match main and vision key is empty/`ollama`/placeholder, copy `llm.api_key` into `vision.api_key` |
| Q3 | Banner only on **false→true** enable; session dismiss; chip when reused |
| Q4 | Side Panel full UX; settings-web **honesty** mandatory; full banner optional (avoid untested dual heuristic) |
| Privacy | Banner + chip show **destination hostname** |
| Architecture honesty | Copy must say pre-analyze → text; main chat does not receive images |
| Overwrite | Only on explicit「使用主模型」; confirm if vision looks custom |
| Runtime | Fail closed: non-loopback vision host + empty/placeholder key → **no POST** |
| Schema | **No** new config fields in P0 |
| Gates | **Zero** change to IMAGE_FETCH / tool defs / L2 |

## Overall design gate

**CONDITIONAL APPROVE for implementation** after Security must-fix are in the **implementation**, not just the brief.

Security REJECT was against the *draft brief* open choices (soft B + Q2=A). Locked table above resolves those.

## Implementation gate (post dual-review)

| Check | Result |
|-------|--------|
| MACHINE | PASS — extension vision-reuse 13; companion inherit 7; config inherit 2 |
| Multi-path adversary (design) | Product/Arch APPROVE_WITH_NITS; Security REJECT on draft → locked table |
| Dual Claude+Pi (impl) | both **APPROVE_WITH_NITS** — `vision-reuse-main-llm-p0-verdict-20260808-144622.json` |
| Nits folded post-dual | masked key not copied; overwrite copy honesty; mask as placeholder; inherit comment |
| Leftovers closed | settings-web Use main + passthrough honesty; anthropic protocol skip inherit; brief DoD; project-knowledge; commit `c89b4fb` |

**MERGE**: Landed on local `main` as `c89b4fb` (not pushed). Push/PR optional; dual was APPROVE_WITH_NITS.

## Implementation DoD (machine)

1. Pure `likelyMultimodal` / `shouldOfferVisionReuse` / `applyVisionReuseFromMain` / `isVisionReusingMain` / hostname helper — unit tests  
2. Companion inherit on save — unit test  
3. vision-pipeline fail-closed non-loopback + placeholder key — unit test  
4. Settings help: no “需要 Ollama 等本地推理服务” as requirement  
5. No tool/security gate diffs  

## Capability declaration (amended)

```text
Surface:      L0 (settings UX)
L2-classes:   (none)
Compose:      existing vision side-pipeline (config.vision → analyzeImage);
              reuse may bind vision endpoint to main LLM after explicit opt-in
Autonomy:     single
Trust:        HITL gates unchanged; privacy: screenshots go to vision.base_url (hostname disclosed)
Channel:      community
```
