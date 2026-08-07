All claims verified against the code. Compiling the review.

## Review: Wave D Reasoning UI + export — plan

**Object under review:** `docs/superpowers/plans/2026-08-07-wave-d-reasoning-ui-export.md` (plan-stage; the patch file contains only the git status header — no code diff, consistent with a G7 plan-dual gate. Base `e5f4bb0` matches current HEAD, so not stale).

### Rejection gates — all clear

**R1 (default export includes full reasoning): NOT triggered.** Verified `ExportMessage` (`companion/src/threads/markdown-export.ts:22-28`) has no `reasoning_content` field; `thread.export_obsidian` (`message-router.ts:1876-1967`) passes raw thread messages whose reasoning is structurally dropped — renderers only emit `content`/`tool_calls`. Default export is reasoning-free today, and the plan locks D-D7 (never include) + D-D8 (opt-in `include_reasoning` flag).

**R2 (trust elevation / L2): NOT triggered.** Plan declares `Trust: no elevation`; changes are a UI pref + a markdown render flag on an existing RPC. No confirmation changes.

**R3 (rebuild re-injects reasoning): NOT triggered.** Verified `rebuildMessagesFromHistory` (`companion/src/llm/adapter.ts:170+`) reconstructs only `content` + `tool_calls`; anthropic-convert drops reasoning (`anthropic-convert.ts:181`, "M7"). Plan D-D9 documents only, as claimed.

**R4 (server-side-only pref store): NOT triggered.** D-D2 stores client-side in `chrome.storage.local`, consistent with the existing pattern in `agentStore.tsx:600-606` (sendShortcut / voice prefs).

### ADR-020 checklist

- **Axes fit:** correct Surface-axis (L0 UI) change; no tools/gates; no "中层 Agent" language anywhere. Pack-first, confirm dialects, originWs, new runtime, experimental layers — all n/a. Trust monotonicity respected (default export omits thinking = privacy-preserving).
- **Capability declaration:** Surface / L2-classes / Compose / Trust present; **Autonomy and Channel lines missing** from the mandated template → nit at plan stage (diff is a plan doc; parent SoT already declared the capability).

### Verified plan claims

- `ReasoningBlock` current behavior (`ChatView.tsx:713`, `useState(live)` + userToggled) matches D-D3's "auto_live" description. Two call sites exist (line 511 streaming with `live={!streamingContent}`, line 651 historical) — Task 1's "live still forces open in auto_live" covers both.
- "模型与推理" settings section exists (`SettingsSlideout.tsx:695`) — placement claim plausible.
- Parent SoT §4.2 T1–T4 (`specs/2026-08-07-context-memory-thinking-knowledge-adversarial-analysis.md:268-271`) is faithfully mapped: T1→Task 1/D-D1, T3→Task 3/D-D7-D8, T4→Task 4/D-D9.

### Nits (non-blocking)

1. **D-D10 defers parent T2's "折叠全部思考"** — a scope reduction vs parent SoT §4.2 T2. Rationale is explicit (mode setting provides a global equivalent), so acceptable, but the plan should mark it as a deliberate deviation from the parent task list.
2. **Capability block omits `Autonomy` and `Channel`** from the mandated template.
3. **File map says "load/save LS"** (`agentStore.tsx` row) while D-D2 says `chrome.storage.local` — ambiguous terminology; agentStore's existing pattern is chrome.storage.local, so implementation should follow D-D2.
4. **`include_reasoning` semantics for `summary` scope unspecified** — `serializeSummaryToMarkdown` also consumes these messages for its conversation appendix; the plan is silent on whether the flag applies there.
5. **UI mode has no mandated test** (only "Optional: extension unit if any") — export strip/include tests are properly required in Task 4, which is the security-relevant surface.

No blocking issues found. All four rejection gates clear, code claims verified, parent SoT mapping accurate with one documented deferral.

VERDICT: APPROVE_WITH_NITS
