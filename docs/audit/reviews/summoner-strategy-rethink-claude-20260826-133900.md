All verification complete. Here is my review.

---

# Dual external review — `summoner-strategy-rethink` (design SoT)

**Patch freshness** `[inspected]`: `git status` shows the same 3 staged doc files (synthesis, prompt, spec) at HEAD `4ff0c7f` as recorded in the patch — not stale. Diff is pure docs (262 insertions, 0 code).

## Code-fact verification (R6 gate) — all claims survive Read/Grep `[inspected]`

| Spec claim (design.md) | Evidence | Result |
|---|---|---|
| §8: matchSkills = TF cosine, comment says TF-IDF, impl has no IDF | `companion/src/skills/semantic-match.ts:63-76` (`tokensToVec` = normalized TF only); `skill-engine.ts:526` comment "TF-IDF fast path" | **TRUE** |
| §8: ≥70 skips LLM, else `llmRerank` | `skill-engine.ts:550` (`topScore >= 70`), `:563` | **TRUE** |
| §8: tokenizer already ported from VibeSOP | `semantic-match.ts:2` "Ported from VibeSOP core/matching/tokenizers.py" | **TRUE** |
| §8: `skill.activate` doesn't flip manual; auto = checked ∪ match | `message-router.ts:2423-2432` (appends `active_skill_ids` only, no mode change); `skill-engine.ts:570` | **TRUE** |
| §8: knowledge auto = checked ∪ site, not query | `skill-engine.ts:655-658` | **TRUE** |
| §8: related doesn't count body | `knowledge-related.ts:32-34` (`textBlob` = title/name + description + tags) | **TRUE** |
| §2: summoner `chat.create` runs full tool-loop; `mcp.add`/`knowledge.get` denied; `mcp.toggle_server`/`skill.activate` already allowed | `ws/summoner-acl.ts:14-45`, `summoner-web.ts:19-42` | **TRUE** |
| §1: pack.apply overlay forces allowTrust=false + overlay-eligible | `summoner-acl.ts:125-142` (strips `allowTrust`), `packs/overlay-eligible.ts:8-18` | **TRUE** |
| §1: HUD Expand already benchmarks WorkBuddy/Codex | `2026-08-25-overlay-hud-expand-design.md:5` | **TRUE** |
| §7: T1 unrun | No bake-off result docs anywhere in `docs/`; ADR-022 P0d still roadmap | **TRUE** |
| §7: 0.5.2 = Windows NSIS installer, not summoner milestone | CLAUDE.md: "产品 0.5.2（…Windows 官方 NSIS 安装器）" | **TRUE** |
| §9: Board = L2 complete / trust tiers / default off | ADR-016:276 (`board_complete` L2 HITL), :91 (default = no board mode) | **TRUE** |

## Must-answer questions

1. **Overlay ACL / HUD-as-workbench actually killed?** Yes. NEVER list (design.md:144-149) names overlay confirm dialects, `knowledge.get/import`, `mcp.add`, `config.set`. §3 priorities contain zero ACL growth; §1.1/:160 freeze the HUD expand ("展开工作台 = 冻结，不再加轨"). The only open item (:166) is rollback-vs-freeze of existing `mcp.toggle_server`/`skill.activate` — a narrowing direction only. Not smuggled.
2. **Kimi handling accurate?** Yes — T1 unrun (no results exist), 0.5.2=NSIS matches CLAUDE.md, moat claim properly hedged as "尚未 T1 证伪".
3. **RunProgress vs ADR-016?** Distinct: Board is an Autonomy object (multi-agent, L2-complete, trust tiers, default off); RunProgress is L0 display, evidence-bound completion, model additions = draft requiring gesture, no new `thread.todo` SoT, summoner display-only (:134-138). Does not reopen ADR-016.
4. **TS IDF port without new runtime?** Yes — tokenizer already TS (`semantic-match.ts:2`); IDF is corpus-level document-frequency weighting over the existing TF vectors, pure TS, no Python/embedding. Consistent with F-E-10.
5. **New primary chrome/runtime?** No — summoner stays L0 capture bar, MCP/ACP stay Composition facades per ADR-020 Axis B; NEVER list bars new BottomBar tab.

## Rejection gates

R1 pass (explicitly NEVER'd) · R2 pass (adoption = `claude mcp add` path; CWS explicitly rejected :79) · R3 pass (Python/embedding REJECT :125) · R4 pass (:98) · R5 pass (:148, matches ADR-025 L3/L4) · R6 pass (all facts verified above) · R7 pass (Board's L2/complete/badge character explicitly declared :134).

## ADR-020 checklist

Declaration present and accurate (docs-only diff, so not strictly required anyway). Axes fit correct; no "中层 Agent" framing; Pack-first honored; no new confirm dialect (RunProgress reuses evidence semantics, not a new gate); trust monotonic (ACL freeze/narrow only, `grants ≠ ws_secret`); originWs N/A; no new runtime; experimental labeling honest ("研究编译，非全量实测").

## Nits (non-blocking)

1. `design.md:168` — open question "T1 未跑时 adoption 文档能否先发「实验」"： if later answered yes, it requires an explicit ADR-022 §8 Option A amendment (currently "无产品 ship"); record that dependency when resolving.
2. `design.md:76` — "Codex / Grok config.toml 同形" states the Grok config path flatly while the surrounding table is hedged as "研究编译，非全量实测"; soften or verify.
3. `design.md:55` — "召唤器不可以 … evaluate" is accurate in effect (confirmation cannot be answered from summoner), but the row sits near the F-S-10 pre-existing `mcp__*`-without-confirm hole; one cross-reference clause would preempt confusion.
4. `design.md:135` — RunProgress "完成绑定 tool_result / 用户确认" borrows ADR-016 evidence vocabulary; when the slice spec lands, state explicitly that the evidence predicate is board-style but the object is L0 display, to preempt ADR-016-reopening accusations.
5. Process: spec status "DRAFT · 待 Claude+Pi dual-review" should be updated once both verdicts land.

The spec strengthens every prior lock rather than weakening any, all six §8 mechanism claims are code-accurate, and the quarter ordering puts T1 falsification first.

VERDICT: APPROVE_WITH_NITS
