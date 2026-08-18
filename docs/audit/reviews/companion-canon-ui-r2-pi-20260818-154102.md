All verification complete. Here is my independent review.

---

# Dual/Triple Review — Companion-canon Side Panel UI R2

**Independence**: Inspected current working tree (`git status` matches patch file exactly — not stale: same 11 files, +398/−320). Ran `tsc --noEmit -p chrome-extension/tsconfig.json` → **0 errors**; `npm --prefix chrome-extension test` → **703 pass**. The Pi peer review file for this batch is empty (0 lines), so this review is the second independent pass.

## Capability checklist (ADR-020)

Declaration present in prompt: Surface L0 / Compose 装配 entry chrome / Autonomy none / Trust settings discoverable / Channel unchanged — fits this diff (panel chrome only). No new L2 tools, no new confirm dialect, no `securityConfirmations.request` changes (originWs untouched), no "中层 Agent" language. **Pack-first**: no new scenario added. **Trust monotonicity**: `config_override: {}` on blank threads falls through to live `state.config` (App.tsx:889-897 `effectiveModel`/`effectiveLlmBase`), identical to the pre-existing auto-create pattern (useWebSocket.ts:1007-1021). No DeepSeek stamp, no empty-trust default. **急停 not buried**: FocusBand priority machine (`focus-band-priority.ts`) unchanged; FocusBand renders above ChatView. ✓

## Implementer claims — verified

| Claim | Result |
|---|---|
| ModeBadge + ⋯ always on rail | ✓ StatusRail.tsx:219-224, 290-306 (unconditional) |
| Conn = dot; label only when not connected | ✓ StatusRail.tsx:256-286 |
| Gear → `connection` if disconnected else `model` | ✓ StatusRail.tsx:206-211 |
| `createBlankThread` uses `config_override: {}` | ✓ ThreadList.tsx:52-68 (poison removed) |
| L0 hint not 操作当前标签; L0 row 起草 not 随便聊 | ✓ ChatView.tsx:1534-1551 |
| Placeholder L0 描述任务 / L1 问这页 | ✓ meta-slash.ts:334-337 |
| 装配 button in composer + aria on attach/⋯ | ✓ App.tsx:1675-1699, StatusRail.tsx:296 |

## User-locked cuts

- **C″ (一条栏用到底) — HOLDS.** One rail for empty and work: settings + brand + ModeBadge + 新增对话 + 历史 + conn dot + ⋯. `hasMessages` only disables ⋯ export/skill items that genuinely need messages (functional, not costume). Chips hidden when stream empty (App.tsx:1659). Conn is a whisper dot; label only when disconnected.
- **D″ (Agent 诚实) — HOLDS.** L0: "问问题、写文案，或描述任务。" + rows 总结当前打开的页面 / 帮我起草一段说明 / 打开装配（技能、场景、知识） — no operate-the-tab, 起草 not 随便聊, 装配 glossed. 「随便聊」gone from the codebase; 「操作当前标签」 appears only in the L1 browser hint (page task). ✓

## Findings

**P1 — 320px rail: centered "CMspark" wordmark collides with the ModeBadge in every mode** (`StatusRail.tsx:207-217` brand absolute-centered; `:219-247` cluster). At 320px the wordmark (15px/600 ≈ 59-62px, centered ≈ [130,191]) overlaps the ModeBadge pill (L0 聊 ≈ [137,185], L1 网页 ≈ [126,185], L2 计算机 ≈ [115,185]); conn label when disconnected and the cruise pill widen the group further. Paint order puts the absolute brand above the badge → text-on-text muddle on the first screen. Corroborated by the Claude peer review against the approved mock (`comp-a-centered.html:62-71` — the mock had **one** 32px right icon, 88px clear of the title; the five right-rail affordances were never certified by the mock). This is a defect *within* the one rail — **does not falsify C″** (all controls present/operable), so per the agreed REJECT bar (C″/D″/trust) it is non-blocking — but it is the first follow-up fix.
- **P2 — L1 empty still carries the FocusBand 网页条 (R1-B leftover)** (`FocusBand.tsx` → `l1_context` → ContextStrip when nothing higher). Page strip sits between rail and greeting on the L1 first viewport. Arguably consistent with D″ ("L1 is page task"), but the R1-B consensus flagged it; confirm intent.
- **P2 — No EmptyState tests.** testIds `empty-state-chat/browser/computer` exist (ChatView.tsx:1557) but zero tests reference them or InvitationRows/CompanionMark. Composer placeholders and tokens got tests; the C″/D″ heart is eyeball-only.
- **P2 — Composer density vs quiet 看山 field** (App.tsx:1675-1699): capsule now carries 装配 + attach + (mic) + send = up to 4 controls + legal line. 装配 entry is required, but consider folding attach under 装配 later.
- **P2/P3 — Dead code**: `railStyles.brandMark / threadIdBadge / spacer / iconBtn` (StatusRail.tsx:515-544, 600) unreferenced in JSX; `IconPlus` (icons.tsx:169) exported but unused. tsc can't catch style-map orphans.
- **P3 — Enablement/route inconsistency**: ThreadList dropdown 设置 opens `model` always (ThreadList.tsx:1289) vs rail gear connection-aware; composer 装配/attach disabled under `needsThread` while the empty-state 装配 row works (two entries, divergent enablement).
- **P3 — Chip/empty divergence**: InputArea hides chips on `!isStreaming` (App.tsx:1659) while ChatView shows greeting on `!processingLabel` (ChatView.tsx:504) — fleet-processing with empty thread can hide the greeting but show chips.

## Prioritized UI/UX backlog (ship next)

1. Fix rail brand/ModeBadge collision at 320px (left-anchor brand beside gear, or conditional render on measured clearance, or CompanionMark glyph instead of wordmark).
2. Decide L1 FocusBand 网页条 on first viewport (character-first vs page context).
3. Add EmptyState unit tests (C″/D″ copy, InvitationRows action dispatch).
4. Composer density: fold attach into 装配 drawer or ⋯ menu; single entry.
5. Upgrade CompanionMark to full approved Comp A illustration (current minimal line-SVG reads flat vs "meet someone").
6. Unify settings routing (gear + ThreadList 设置) and 装配 enablement across entry points.
7. Disconnected-state rail audit at 320px (conn label + cruise pill + collision together, one render pass).
8. Delete dead styles (`brandMark`/`threadIdBadge`/`spacer`/`iconBtn`) and `IconPlus`.

## Bottom line

C″ and D″ both hold; the DeepSeek/trust poison is removed (`config_override: {}` + live-config fallback); machine green (tsc 0, 703 pass); ADR-020 axes clean. The P1 rail collision is a genuine visual defect at the canonical width but does not meet the agreed REJECT bar (C″/D″/Trust) — it is listed for immediate follow-up along with the P2s.

VERDICT: APPROVE_WITH_NITS
