All spot-checks complete. Here is my independent review.

---

## 1. Summary

Pre-implementation research/landing SoT (docs-only; `docs/superpowers/specs/2026-08-07-...adversarial-analysis.md`, untracked at HEAD 5a401f1 — patch is fresh). All seven "must answer" areas were checked against real code. Every major code fact in §1.4/§1.5/§1.2 verified TRUE. M3 ThreadHandoff correctly extends runtime budget only; raw-thinking-as-payload is explicitly rejected; Trust elevation is floor-blocked; Wave A (scene knowledge) is a real Compose gap. No rejection gate (R1–R6) triggered. Only non-blocking nits: a "M3" label collision with the related SoT, and citation polish.

## 2. Factual spot-check (all pass)

| Claim | Verdict | Evidence |
|---|---|---|
| M1 turn-safe head-drop, keeps system, drops assistant+tool pairs, `[context_omitted]`/`[context_summary]` | ✅ | `context-budget.ts:11-12,227` (`compactMessagesTurnSafe` doc comment), `:242+` |
| M2: redact-first, pre_loop only, ≥3 msgs or ≥500 tok, 5–12 bullets, sha+bytes audit | ✅ | `context-budget-m2.ts:80-90` (`shouldRunM2`), `context-budget.ts:182-192` (M2 prompt "Output 5–12 short bullet points"), `summarySha256/summaryBytes` `context-budget-m2.ts:8,15` |
| Sensitive-tool redaction (cookie → `[name: redacted]`, code → outcome redacted + len) | ✅ | `context-budget.ts:110-158` (`redactMessagesForCompaction`, `COMPACT_SENSITIVE_COOKIE_TOOLS`/`CODE_TOOLS`) |
| ReasoningBlock: live open / non-live collapsed, userToggled respected | ✅ | `ChatView.tsx:678-705` (`useState(live)`, `useEffect` `!live && !userToggled → setOpen(false)`); live at `:475` `live={!streamingContent}` |
| Current-turn reasoning enters messages array; `rebuildMessagesFromHistory` does NOT re-inject | ✅ | `adapter.ts:776,800` (push with `reasoning_content`); `adapter.ts:163-217` copies only `role/content/tool_calls` — never `reasoning_content` |
| Anthropic wire drops reasoning (M7) | ✅ | `anthropic-convert.ts:9,143,181` ("reasoning_content intentionally dropped") |
| `chat.reasoning` streaming event | ✅ | `adapter.ts:707`, `useWebSocket.ts:280` |
| Three-system separation (Runtime vs ThreadDigest vs Export; omit not persisted; digest only on explicit @) | ✅ | `digest.ts:1-3`; settings SoT line 43 "消息数组默认不持久化 omit"; `@ref` explicit-only in `message-router.ts:643-662` |
| Pack YAML `knowledge:` + install to global; builtin AppSec/NetSec baseline | ✅ | `validator.ts:178,238-244`; `pack-engine.ts:646-662` (install → `knowledge/global`); `builtin/appsec-prd-review/pack.yaml:15` (`knowledge: ./knowledge/owasp-baseline.md`) |
| PacksPanel has zero knowledge UI (only system prompt/skills/MCP/tools) | ✅ | `PacksPanel.tsx:83-107` (`system_prompt_append`, `skill_ids`, `tools_mode/allow`) — zero `knowledge` matches |
| `knowledge_selection_mode` auto\|all\|manual; auto = active ∪ site-match(hostname) | ✅ | `thread-manager.ts` validModes; `skill-engine.ts:505-527` (`resolveKnowledgeIdsForThread` auto union) |
| `knowledge.list` tool exists; `~/.cmspark-agent/knowledge/{global,sites}` | ✅ | `message-router.ts:2048,2113`; `config.ts:17` (`DATA_DIR`), `skill-engine.ts:70,150-151` |
| "知识预设 在折中方案才有，未做" | ✅ | `archive/.../final-design.md:54` (保守 不支持 / 折中 轻量 JSON / 激进 完整预设) |
| "查看已压缩摘要" chip exists | ✅ | `ChatView.tsx:79,125-127` (`summaryOpen`, `runtime_context_budget.rolling_summary`) |

No false major code claims found. The `[inspected]` evidence markers are honest.

## 3. Blocking issues

None. Rejection gates R1–R6 all clear:
- **R1**: no false code facts (see table).
- **R2**: three-system merge and auto-persist omit are explicitly non-goals (§5 "合并 Digest/Export/Runtime" 明确非目标; F-I-B "磁盘可选 meta" — optional, not default).
- **R3**: raw thinking as payload explicitly rejected; only capped redacted slices as *input* (§4.3, §2.6 variant A 拒绝).
- **R4**: F-S-D + Wave A "不碰 Trust" — knowledge/handoff cannot raise auto_approve.
- **R5**: `thread_recall` is same-thread, budgeted, redacted; cross-thread default vector injection is a non-goal; `@` stays explicit.
- **R6**: Wave plan = pack schema + tools + request-path budget; no second agent runtime.

ADR-020 checklist: capability declaration present and correct (Surface L0, L2 none, Compose knowledge+pack, Autonomy n/a, Trust 不抬升, Channel unchanged); Pack-first respected (extends pack schema, no new Side Panel primary chrome); no new confirmation family → originWs N/A; trust monotonicity preserved.

## 4. Nits (non-blocking)

- **N1 (glossary)**: "M3" collides with the related SoT — `settings-thread-compact-ux.md:211` non-goal list already uses "M3" for "UI 消息中间折叠" (mid-thread UI folding). The new doc's "M3 ThreadHandoff" is a different concept under the same label. Rename (e.g. "Handoff layer / H1") or add an explicit redefinition note, else cross-SoT glossary drift.
- **N2**: §8 external citations are title-only, no URLs — verifiability nit (e.g., Mem0 "Context Compression vs Memory", Factory anchored incremental summarization).
- **N3**: Wave A proposes `active_knowledge_ids` on thread, but today knowledge activation flows through `active_skill_ids` (`skill-engine.ts:320-330 getActiveForThread`). The archive proposal already specified `active_knowledge_ids` semantics (`final-design.md` D1), so the schema is not invented — but the Wave A issue should record the reuse-vs-new-field decision explicitly.
- **N4**: New `[context_handoff]` boundary marker (§4.3) joins `[context_omitted]`/`[context_summary]` — ensure the chip/`contextCompacted` UI recognizes it alongside `rolling_summary` (minor consistency item for Wave B).
- **N5**: Wave B 4–7 person-days vs Wave A 2–4 — acceptable, but the estimate implicitly includes product confirmation of the 5-field schema (goals/decisions/constraints/open_todos/artifacts); §9 already flags this as a required product decision — good.

## 5. Priority / Wave A–D assessment

Wave A (scene knowledge) ranked P0 over M3 is defensible and correct:
- It is a *verified* Compose asymmetry (pack YAML supports `knowledge:`; PacksPanel has zero controls), 2–4 person-days, high differentiation, zero overlap with M3.
- M3 keeps P0-B, preserving the primary user pain (long-thread degradation) as a near-term parallel track.
- ADR-020 axes fit: Wave A hangs on Compose (correct axis), Wave B/C on Surface L0 request-path (correct), no Autonomy change.
- Effort ordering (A < B < C ≈ D) and non-goals are coherent; the plan is closed enough to open issues — schema fields, tool names (`thread_recall`, `knowledge.list`), redaction/audit floors, and mode-default decision are all stated, with the two genuine product decisions explicitly gated on 产品确认 in §9.

---

VERDICT: APPROVE_WITH_NITS
