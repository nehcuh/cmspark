All checks complete. Here's my review summary.

## Review: Wave D Reasoning UI + export — implementation

**Verification performed:** patch matches live working tree (7 files, 228+/37-); canonical `npm test` pipeline (tsc → node --test) for markdown-export → **30/30 pass** incl. both new Wave D tests; extension `tsc --noEmit` → clean exit 0.

### Rejection gates — all clear
- **R1 (default export leaks reasoning):** NO leak. `serializeThreadToMarkdown`/`serializeSummaryToMarkdown` strip unless `include_reasoning === true` (markdown-export.ts:113-120, 171-178); router gate is strict (`=== true`, message-router.ts:1925); StatusRail/ThreadList entry points don't even send the flag. Default is safe everywhere.
- **R2 (trust elevation):** none — no trust/confirmation code touched.
- **R3 (rebuild injects reasoning):** `rebuildMessagesFromHistory` (adapter.ts:159-235) never copies `reasoning_content` into rebuilt canonical messages; untouched by this diff. Same-turn tool-loop injection (adapter.ts:859) and H1 handoff (`includeReasoning: true`, adapter.ts:564) are pre-existing (M7/Wave B), not introduced here.

### ADR-020 checklist
Declaration present in the plan (`Surface: L0 UI + export policy; L2-classes: (none); Compose: none; Trust: no elevation`), partially omitted (Autonomy/Channel) in the impl dual-review prompt — **nit** since no tools/gates/primary chrome added; settings fields + copy button only. Correct axis (Surface L0), no "中层 Agent" framing, no new confirmations, no originWs involvement, no new runtime.

### Nits (non-blocking)
1. **Memo comparator staleness — ChatView.tsx:713-718.** MessageRow's custom `memo` comparator compares `msg.*`, `activeThreadId`, `sendShortcut` but **not `showReasoningMode`**. Changing the 思考过程展示 setting won't re-render already-rendered rows, so the primary Wave D UI feature silently doesn't apply to historical messages (works only for the live/inline block and newly mounted rows). Add `prev.showReasoningMode === next.showReasoningMode`.
2. **Opt-in export wiring is half-done.** Only the per-message export honors the setting (ChatView.tsx:328). StatusRail.tsx:319/342 and ThreadList.tsx:441 (导出线程 / 导出摘要) never send `include_reasoning`, and the summary branch (message-router.ts:1944) doesn't forward the flag at all — so `serializeSummaryToMarkdown`'s new appendix include-path (markdown-export.ts:171-178) is **dead code**. Users enabling the checkbox then using thread/summary export get silent no-op. Safe, but the setting label ("导出到 Obsidian 时包含思考过程") overpromises.
3. **Test gap:** new tests cover only `serializeThreadToMarkdown`; no test exercises `serializeSummaryToMarkdown` appendix strip/include (and the include path is currently unreachable — see #2).
4. **Help-text overclaim:** SettingsSlideout copy "历史消息不会把思考回灌给模型" is accurate for the rebuild path but overstated globally — same-turn tool loops push `reasoning_content` into the OpenAI-compatible wire payload (anthropic drops it, M7), and H1 handoff feeds reasoning slices to the model. Pre-existing, but the new UI copy asserts more than guaranteed.
5. **Plan deviation:** D-D8 specified a `> 思考过程` Obsidian callout; impl renders HTML `<details><summary>思考过程</summary>` — renders fine in Obsidian Reading view, tests assert `<details>`. Cosmetic deviation only.

Security posture is solid and the core deliverable (privacy-preserving default export) is correct, tested, and type-checked. Items #1–#2 are genuine functional gaps worth closing, but none trip the rejection gates.

VERDICT: APPROVE_WITH_NITS
