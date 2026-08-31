# Docs / version / distinctive-capability audit — 2026-08-30

> Five independent lanes (no shared conclusions) then orchestrator spot-check.  
> Dual: kimi **AWN** + grok stand-in **AWN** (Claude CLI `-p` hung, no output). Nits folded below.  
> Runtime SoT: `companion/package.json` + `chrome-extension/package.json` = **0.5.5**.

## Executive verdict

**PARTIAL / FAIL as living SoT.** Distinctive product form exists in `PRODUCT.md` and later user guides. The documents a stranger or a new agent actually opens (`README.md`, `CLAUDE.md`, `docs/README.md`, `post-227-status`) still describe a **0.5.3 Side Panel chatbot**, list **closed GitHub issues as 本季余项**, and omit the Capture HTML card / ChatShell / 租手 how-to.

| Lane | Verdict |
|------|---------|
| A Version lockstep | **FAIL** — current-stage docs on 0.5.3; CLI/NSIS/tests on 0.5.5 |
| B Distinctive coverage | **PARTIAL** — PRODUCT yes; README/CLAUDE generic |
| C Skeptic stale/overclaim | **Badly misleading** if CLAUDE + docs/README + post-227 trusted |
| D User-facing discoverability | **Stranger test FAIL** |
| E Living vs shipped-after-0.5.3 | Hubs frozen; Capture/ChatShell/0.5.4–0.5.5 absent |

Orchestrator `[executed]` GitHub: **#228 CLOSED**, **#229 CLOSED**, **#235 CLOSED**, **#230 OPEN**.  
Orchestrator `[inspected]`: overlay `OVERLAY_WINDOW_SIZE = { w: 360, h: 420 }`; grant-cli unknown flags exit 1; README does not link `PRODUCT.md`; `docs/README.md` duplicate coding-handoff row; RunProgress on this tree = r1 always-collapsed.

---

## P0 — will mislead an operator or agent today

1. **Version split-brain.** Living “当前阶段 / Version lock / 产品” still **0.5.3** in `README.md:915`, `PRODUCT.md:4`, `CLAUDE.md:37`, `docs/README.md:3`, `docs/GOAL.md:3`, `docs/architecture.md:3`, `companion/README.txt:1` (`v0.5.3.zip`). `AGENTS.md` already **0.5.5**. `version-lockstep.test.ts` pins CLI/ACP/MCP/extension package, **not markdown**.
2. **Closed issues listed as 本季余项.** `CLAUDE.md:21`, `AGENTS.md:29`, `CONTRIBUTING.md:116`, `PRODUCT.md:5`, `docs/README.md:117-118` still `#228 T1 · #229 召唤器 P2 · #230`. GitHub: 228/229 closed; 230 open. Agents will re-implement 快与淡 / re-run T1 as if unscored.
3. **T1 wording fork.** README/CLAUDE/architecture/docs-README: “T1 **仍待 / 未跑 / 没跑完**”. GOAL + `docs/mcp.md:228` + scorecard: T1 **scored** (CMspark arm Y, Playwright `ERR_EMPTY_RESPONSE` not SSO). **禁扩 profile is still true.** The lie is “没跑”, not the freeze.
4. **Closed-ticket T1 pointer.** README/CLAUDE/architecture still say T1 **仍待 (#228)** after #228 closed. `docs/README.md:47` even **mis-summarizes** post-227 as “T1 仍待” while that snapshot’s own lead says scored + 禁扩. “没跑完禁止扩 profile” is still a valid freeze; the lie is “没跑 / 仍待 as live #228”.
5. *(demoted from P0 by dual → P1)* README identity vs PRODUCT, and 租手 buried as inbound MCP — coverage/stranger-test, not a false statement. README:3 is three-axis positioning; the generic Side Panel sentence is `:9`. Footer already name-drops 租手钥匙 CLI. ADR index still stops at **024**.

## P1 — distinctive shipped, hubs silent or wrong

| Item | Reality | Hub |
|------|---------|-----|
| Capture HTML card | Q&A / 📎 / 🎙 / 开始会议 / 打开侧栏; size **360×420** | Not in README 已交付 / 用户指南; PRODUCT header **400×520** vs table 360; DESIGN still 400×520 |
| ChatShell | `要对这页做什么？` + `弹出对话框` | README still “侧栏空态看山” (slice 5) |
| grant-cli unknown flags | exit 1, no grant (#235/#236) | **Do not rewrite** CHANGELOG 0.5.3 Honesty (accurate for that cut). Gap = **no 0.5.4/0.5.5 Changed entry**; #230 title/docs-README:119 still lists grant-cli |
| 0.5.4 Trust/UX | shell family deny, per-key export, honest `ui.open_sidepanel`, SSE 8s | In CHANGELOG; **absent from living hubs** (README/CLAUDE/docs README/GOAL) |
| 0.5.5 redacted-stub UX | reload no longer shows raw `{redacted:true}` | Same: CHANGELOG yes, living hubs no |
| README identity / 租手 how-to | PRODUCT four doors; inbound MCP ≠ 租手 ≠ ACP | README 使用指南 inbound-only; PRODUCT not in README 用户 row; ADR 至 024 |
| Overlay never Allow/Deny; Companion never `chrome.sidePanel.open` | Code + PRODUCT Constraints | Absent from README |
| `docs/README.md:171` | “事实以 **0.5.0 代码** 为准” | Stale maintenance line |
| `optimization-plan-post-adr-020.md` still **排序权威** | 0.4.0, P1 OPEN; disk FIXED | Agents will re-fix originWs/evaluate/shell |
| post-227 as 活状态 | Header is T0 snapshot 2026-08-27 | CLAUDE/docs README/GOAL still point here |

## P2 — badges, dupes, r2 trap

- User-guide banners frozen at **0.5.0** (CU, host, multi-agent, notebooklm, meeting, TESTING).
- `docs/README` coding-handoff row **duplicated** (lines 22 and 26).
- RunProgress **r1** on main (always collapsed, `aria-current="step"`, drafts in `m`). Spec r2 / PR #257 is **not** live — do not write r2 into hubs until merge.
- `package-lock.json` both packages still name **0.5.3** (P1 engineering).
- GOAL G1 “26 种工具”, G21 parks L8 in the future after L8 already shipped.

## Distinctive capabilities: what a stranger would not learn from README alone

1. Home is **already-logged-in Chrome + hard gates**, not the Side Panel.
2. Four doors, one hand: Capture (hotkey HTML card **360×420**) · Operate (panel or background CDP) · Confirm (确认台/tray, **never** overlay) · 租手 (Outbound MCP + `cmg_`).
3. Overlay never Allow/Deny; fail toast **请点工具栏 C**.
4. 租手 ≠ inbound MCP 面板 ≠ ACP 编程接力.
5. Empty Side Panel is ChatShell (`要对这页做什么` / `弹出对话框`), not a generic create-thread chatbot.

**OK in hubs (do not “rediscover”):** dual topology, Pack, dictation/meeting *as a linked guide*, Confirm Center *as a security feature*, Qwen3-VL *in footer*, Issue-first *for agents reading CLAUDE*.

## Recommended rewrite batches (no impl this audit)

**Batch 0 — honesty (docs exception, no new Issue):** bump current-stage 0.5.3→0.5.5 on README / PRODUCT / CLAUDE / docs README / GOAL / architecture / companion README.txt / memory overview; `AGENTS.md`/`CLAUDE.md` 余项 drop #228/#229; mark post-227 **SNAPSHOT** and fix docs-README:47 mis-summary; T1 sentence = scored + 禁扩 profile; overlay size 360×420; **add** grant-cli #235 to 0.5.4/Unreleased (do not rewrite 0.5.3 Honesty); #230 list only F-S-10 / overlay-acl / remaining click-only seeds.

**Batch 1 — identity front door:** README first paragraph = PRODUCT one-liner; link PRODUCT in 用户 row; 使用指南 add Capture / 租手 / 弹出; ADR index 025; remove coding-handoff dupe; demote July optimization-plan from 排序权威.

**Batch 2 — missing user-guide row:** first-class 召唤器/Capture how-to (or a short section in meeting + TROUBLESHOOTING + confirm-center “overlay never Allow/Deny”). Do **not** invent Wave 2 FocusBand or r2 RunProgress.

**Out of scope:** rewriting ADRs' birth versions (0.5.0 CU is OK); CHANGELOG historical 0.5.3 section (add a 0.5.4/0.5.5 pointer, don't rewrite history); merging PR #257.

## Lane disagreements (kept)

- Lane E called overlay size “~400×520 HTML path” in one leftover sentence; **code SoT is 360×420** (Lane B/C + orchestrator).
- Lane C could not fetch GitHub; orchestrator confirmed 228/229 closed.
- ACP missing from README 已交付 is a **coverage** hole, not a post-0.5.3 ship (Lane E correctly demoted).

## Dual (folded)

| Reviewer | VERDICT |
|----------|---------|
| kimi `-p` | **APPROVE_WITH_NITS** |
| grok stand-in (Claude CLI `-p` hung) | **APPROVE_WITH_NITS** |

Nits both confirmed: README:3 is three-axis, not a chatbot line; T1 freeze ≠ “没跑完” lie; CHANGELOG 0.5.3 Honesty is history; 0.5.4/0.5.5 exist in CHANGELOG. P0 that survive dual: version split-brain, closed issues as 余项, T1 live-ticket wording. Identity/租手 burial is P1 coverage.

## Dual (folded)

| Reviewer | VERDICT |
|----------|---------|
| kimi `-p` | **APPROVE_WITH_NITS** |
| grok stand-in (Claude CLI hung) | **APPROVE_WITH_NITS** |

Nits both confirmed: README:3 ≠ chatbot; T1 freeze ≠ “没跑完” lie; CHANGELOG 0.5.3 Honesty is history; 0.5.4/0.5.5 exist in CHANGELOG. Second reviewer demotes identity/租手 burial to P1 (stranger-test, not false statement). P0 that survive: version split-brain, closed issues as 余项, T1 live-ticket wording.
