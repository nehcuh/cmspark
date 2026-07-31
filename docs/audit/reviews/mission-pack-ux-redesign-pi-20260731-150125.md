I've now read all required documents. Let me compile the review.

---

## Summary

The spec `2026-07-31-mission-pack-ux-redesign.md` proposes a product/UX-only redesign of the Mission Pack surface in the Side Panel. It correctly diagnoses the root causes of incident #r21pj2 (user confused module toggles with Pack apply; no unapply; jargon errors), proposes a status-first IA with explicit unapply, confirm-on-apply, recoverable errors, and skill-install diversion — all without reopening the ADR-014 security model. The diff is pure documentation (the spec itself is untracked new; the only staged change is a `PROJECT_CONTEXT.md` handoff note). No implementation code is present. The ADR-020 capability declaration is present and correct.

---

## User-job fit

The six jobs (J1–J6) are correctly identified and prioritized. The core insight — **J2 (install skill) and J3 (AppSec) sharing the same entry point** — is the product root cause of #r21pj2. The proposed diversion ("装技能请用 Skills") plus the confirm-on-apply modal directly severs this conflated path. The design principle "default = no scene = general assistant; scene = visible + reversible" is the right mental model. Users who never apply a scene carry zero cognitive burden (status bar is hidden when `mission_pack_id == null && workspace_root == null`).

**Verdict**: The jobs are correctly diagnosed and addressed.

---

## Security / ADR fit

| Check | Status | Evidence |
|-------|--------|----------|
| ADR-014 Module/Pack separation preserved | ✓ | Modules remain install-level (§2.3 item 2); Pack remains thread-level composition |
| ADR-020: Pack = Composition, not runtime | ✓ | §12 declaration; §2.3 item 1; non-goals "不新造 Agent runtime" |
| Trust monotonicity | ✓ | God mode ≠ whitelist bypass (§2.3 item 5, §2.2 kill C); unapply restores snapshot (§6.3), not escalates |
| Apply requires user gesture | ✓ | §2.3 item 3: "Apply 仅用户手势（扩展点击）；Agent 不得 pack.apply 自己"; §7: "UI 强制 confirm" |
| Agent cannot unapply | ✓ | §11 Q3: "否；仅 UI；Agent 只建议用户点" |
| Agent instructed not to suggest god mode | ✓ | §6.6: "禁止引导用户「开启 god mode 以绕过白名单」" |
| Enterprise channel preserved | ✓ | §2.3 item 4; §5 community vs enterprise banners |
| No new confirmation dialect | ✓ | Apply confirm is a standard modal (§6.2), not a new `security.confirmation.*` family |

One **nit** on the `pack.unapply` protocol entry (§7): the table lists `pack.unapply` as a Companion endpoint, but §11 Q3 says Agent cannot call it. The spec should **explicitly** state that `pack.unapply` is NOT registered as a tool in the LLM tool definitions (it's a UI-only RPC). Without this, an implementer might mistakenly add it to `getToolDefinitions()`, creating a path for Agent-invoked unapply. This is a specification gap, not a design flaw.

---

## IA & naming

The four-zone IA (§4.1 scheme S) is a significant improvement over the current PacksPanel, which dumps modules, workspace, NetSec, and pack list in a single undifferentiated scroll. The zones create clear visual priority:

1. **本对话状态** (always-on-top) — the most critical missing piece today
2. **开始一个场景** (templates) — the apply path, with "适合/不适合" education
3. **本机能力** (modules, collapsed) — de-emphasized; not confused with scenes
4. **网络扫描设置** (conditional) — gated behind netsec enabled

The naming table (§4.2) is well-considered. "用于本对话" replaces the ambiguous "应用到当前线程". "退出场景，回到通用助手" unambiguously signals reversibility.

**Nit on page name**: The spec hedges on renaming "任务包" → "场景与能力" until P1 (§11 Q2). This is pragmatic for shipping, but "任务包" in the current P0 with four-zone partitions + subtitles could still cause a flicker of confusion. Consider a P0 subtitle like "场景与能力" below the existing title, rather than deferring entirely.

**Nit on "能力" disambiguation**: The page title proposal "场景与能力" uses "能力" for both modules (本机能力) and the page-scope term. Consider "场景与模块" to maintain the distinction the spec works hard to create between modules (install-level) and scenes (thread-level).

---

## P0 plan

The six-item P0 scope (§9) is realistic and well-scoped:

1. `pack.unapply` + exit button — Companion RPC + UI
2. Confirm-on-apply modal — UI only
3. Status bar — UI only
4. `tool_not_allowed` → recoverable + human error — Companion + error mapping
5. Diversion CTA — UI only
6. Zone titles — UI only

This is a 1–2 PR scope. Items 1 and 4 touch Companion; items 2, 3, 5, 6 are extension-only.

**Gap**: The error mapping table (§6.5) shows human-readable tool names like "列出工作区文件", but the mapping from internal tool names (`workspace_list_dir`, `workspace_read_file`, etc.) to Chinese display names is not specified. An implementer will need a lookup table or naming convention. This is a nit — not blocking for approval but should be resolved before implementation.

**Gap**: The workspace-clear path is shown in the IA diagram as a button (`[清除工作区]`) but has no dedicated flow section and is deferred to P1. If the button is in the P0 status bar, the flow should be documented (even if just: "sends `workspace.clear` RPC, clears `workspace_root` on thread, no other side effects").

---

## Blocking

None.

---

## Nits

1. **§7 protocol table × §11 Q3 — `pack.unapply` tool exposure undefined.** The spec says Agent cannot call unapply ("仅 UI"), but §7 lists it as a protocol endpoint without stating it must NOT be registered in LLM tool definitions. Add: `pack.unapply is a Companion RPC endpoint only; it MUST NOT appear in getToolDefinitions() or the LLM tool list.`

2. **§6.3 exit flow — workspace clearing checkbox underspecified.** The spec says "可选二次确认是否保留" but doesn't show the exit modal design or specify how the checkbox is presented. If this checkbox is P0 (since the status bar already shows workspace), give it a 2-line spec.

3. **§6.5 — internal-to-Chinese tool name mapping table missing.** The human-readable error messages reference tool names like "列出工作区文件" but no mapping from internal tool IDs (`workspace_list_dir`, `workspace_read_file`, `browser_evaluate`, etc.) is provided. An implementer will need this.

4. **§4.1 page name deferral to P1.** Keeping "任务包" as the page name through P0, even with zone titles, risks residual confusion for users who've already learned "任务包 = the confusing panel that broke my thread". A P0 subtitle ("场景与能力") would mitigate this at near-zero cost.

5. **§1.4 R6 — "模块启用 ≠ 场景应用" unclear to users.** The spec correctly identifies this as a P1 root cause but the proposed IA addresses it only partially. The modules section (zone 3) is collapsed by default, which hides the distinction rather than teaching it. Consider an inline tooltip or hover text on the "用于本对话" button that says "与开启本机能力不同 — 场景会限制当前对话可用的工具" — this bridges the gap without redesigning modules UI.

---

VERDICT: APPROVE_WITH_NITS
