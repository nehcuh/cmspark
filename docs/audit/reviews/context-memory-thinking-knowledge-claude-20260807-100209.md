I have verified all major claims. Rendering verdict now.

---

## Summary

The analysis doc `2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md` is a pre-impl landing-analysis SoT that scores four user-facing optimization ideas (layered compact, default-collapsed thinking, history-thinking-as-compact, scene-bound knowledge). It correctly preserves the three-system glossary (Digest / Export / Runtime budget), forbids raw reasoning as compressed payload, preserves Trust monotonicity, and ranks a Pack-first scene-knowledge Wave A as P0. All code claims spot-checked below are TRUE in current code.

## Factual spot-check (all PASS)

| Doc claim | Result | Evidence |
|---|---|---|
| M1: system kept; assistant+tool paired drop; never drops last user; one omit notice | PASS | `companion/src/llm/context-budget.ts:199–300` (`dropBlockAt`, `compactMessagesTurnSafe`, `lastUserIdx` guard) |
| M2: 5–12 bullets via fixed system prompt; pre_loop only; threshold ≥3 msgs or ≥500 tok; default true unless opted out | PASS | `context-budget.ts:182–188` system prompt; `context-budget-m2.ts:82–91` `shouldRunM2` |
| ReasoningBlock: live=open, non-live=closed unless userToggled | PASS | `chrome-extension/src/sidepanel/components/ChatView.tsx:677–684` |
| Current turn `reasoning_content` enters `messages` array; persisted on disk | PASS | `companion/src/llm/adapter.ts:757–800` |
| `rebuildMessagesFromHistory` does NOT carry `reasoning_content` | PASS | `adapter.ts:163–228` — only `content` + `tool_calls` reconstructed |
| Anthropic wire intentionally drops reasoning (M7) | PASS | `companion/src/llm/providers/anthropic-convert.ts:181` |
| PacksPanel scene editor has NO knowledge field (system_prompt / skills / MCP / tools / trust only) | PASS | `chrome-extension/src/sidepanel/components/PacksPanel.tsx:78–113` (state), `627–639` (save payload) — no `knowledge` |
| Pack YAML DOES support `knowledge: string[]`; installed to global; thread_defaults has `knowledge_selection_mode` | PASS | `companion/src/packs/validator.ts:178, 216, 289`; `pack-engine.ts:520, 1475` |
| Digest = tldr+tags+bullets, no reasoning | PASS | `companion/src/threads/digest.ts:14–19, 192–194` |
| Obsidian export does not surface `reasoning_content` today | PASS | grep of `companion/src/obsidian/**` for `reasoning` = 0 hits |
| Three-system glossary matches sibling SoT | PASS | `2026-08-06-settings-thread-compact-ux.md §2` verbatim glossary; thread-history-ia SoT explicitly marks runtime-budget "正交" |
| User-scene SoT has no knowledge mention | PASS | grep on `2026-08-06-user-scene-tools-and-ai-create.md` returns 0 |

## Blocking issues

None. No rejection gate triggered:

- **R1** (false code facts): all 12 major claims verified TRUE.
- **R2** (merging budget into Digest/Export, default-persist omit): doc explicitly forbids both (§1.1, §3.2 F-I-A, §3.3 F-S-*), and M3 ThreadHandoff extends runtime budget only — schema lives in `runtime_context_budget` / thread meta per §3.2 item 1.
- **R3** (raw CoT as payload): doc explicitly rejects variant A in §2.6 and §4.3; reasoning permitted only as redacted *input* to a structured extractor.
- **R4** (knowledge/handoff elevates Trust): F-S-D explicit ("场景 trust 与 knowledge 正交；知识不能抬升 auto_approve").
- **R5** (silent cross-thread injection): F-S-C explicit ("thread_recall 不做跨 thread 隐式注入").
- **R6** (second agent runtime): "明确非目标" rules out embedding-based global memory as compact substitute; Waves A–D all ride Pack + thread meta + tool.

## Nits (non-blocking)

1. **Schema field names not locked**: §3.2/§4.1 lists `goals[]/decisions[]/constraints[]/open_todos[]/artifacts[]/knowledge_ids[]` as candidates; Wave B issue must freeze names + types + length caps before extract prompt can land.
2. **Wave A effort (2–4 人天)** is optimistic: needs schema in `validator.ts`+`pack-engine.ts` snapshot/undo, thread `active_knowledge_ids` apply/unapply lifecycle, site_knowledge preset × auto hostname-match semantics, and redact-reuse tests. 4–6 人天 more realistic.
3. **`thread_recall` (Wave C)** lacks redact specifics — should explicitly reuse `redactMessagesForCompaction` and `buildRedactedTranscript` cap rules; mirror `buildSummaryCard` from `context-refs.ts:32–57`.
4. **T1 setting key** `ui.show_reasoning: always_collapsed | auto_live | always_open` — current code is `auto_live` (`ChatView.tsx:678` `useState(live)` + `useEffect`); doc should note the default value explicitly.
5. **External citations** (§8) lack URLs — Anthropic "thinking block must not modify" is correctly stated but should cite Anthropic's `redacted_thinking` signature constraint explicitly (the 400 error mechanism is the signature mismatch, not generic "compaction rewrite").
6. **`docs/archive/2026-07/proposals/knowledge-mgmt-proposal/final-design.md`** referenced in header but not cited in body — confirm existence and add inline cite where §1.5 discusses "保守方案已实现模式+站点分组；知识预设 在折中方案才有".

## Priority / Wave A–D assessment

- **Wave A (scene knowledge, P0)** correctly ranked top: largest Compose asymmetry (Pack YAML has `knowledge`, scene UI doesn't), low blast radius (no L2/Trust/Surface-2 autonomy), aligns with product differentiation (global + site knowledge). No ADR-020 objection — Pack-first compliant.
- **Wave B (M3 ThreadHandoff, P0/P1)**: correctly framed as runtime-budget enhancement (not new system), replaces/augments M2散文 with session-end-style schema. Sensibly gated behind Wave A.
- **Wave C (cold recall, P1)**: tight scope (single-thread, redact, no embedding) correct.
- **Wave D (thinking polish, P1)**: small effort, defers correctly to existing UI behavior.
- **Explicit non-goals** correctly fence scope: no Digest/Export/runtime merge, no auto-write to `knowledge/global`, no default reasoning re-injection, no embedding dependency as compact substitute.

Capability declaration present and accurate (Surface L0 + Compose knowledge+pack; Autonomy n/a; Trust not elevated; Channel unchanged). Pre-impl docs-only diff — checklist applies to *proposed* landing; doc declares correctly.

VERDICT: APPROVE_WITH_NITS
