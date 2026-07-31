I have everything I need. Key findings from the code cross-check:
- `restoreSnapshot` already exists at `companion/src/packs/pack-engine.ts:362` — `pack.unapply` is a thin wrapper, P0 is realistic.
- `tool_not_allowed` at `companion/src/server.ts:557` indeed returns plain `{success:false, error:"..."}` — no `error_code`/`recoverable`/`suggested_action`, confirming R4.
- `pack.apply` validator (`server.ts:4591`) does NOT require `user_gesture:true` (unlike `netsec.authorize_task` at `server.ts:4644`) — gap with spec §2.3 #3.
- Git diff is stale-free; matches working tree.

---

## Summary

The Mission Pack UX redesign spec (`docs/superpowers/specs/2026-07-31-mission-pack-ux-redesign.md`) is a **product/UX SoT** that correctly diagnoses the `r21pj2` incident (user installed skill → mis-applied AppSec → `tool_not_allowed` flagged non-recoverable → god-mode useless). It proposes: status-first IA, `pack.unapply` exit, confirm-on-apply modal, recoverable error mapping, and skill-install path diversion. Capability declaration is present and correct; no ADR-014/020 regressions; no new runtime. The doc is honest about what's new versus exposed (e.g. `restoreSnapshot` already exists). Recommend **APPROVE_WITH_NITS**.

## User-job fit

- J2 (install skill) vs J3 (AppSec) decoupling is the strongest part: §3 mental model ("能力开关 / 本对话场景 / 工作区") + §4.1 top-of-page cross-link to Skills + §5.1 happy path with success criterion `mission_pack_id == null` directly kills the `r21pj2` trap.
- §6.5 error table mapping `tool_not_allowed` → `recoverable` + 退出场景 CTA is exactly what the LLM adapter's `non_recoverable` classifier (`companion/src/llm/adapter.ts:891`) needs to stop hard-stopping. Verified: current `companion/src/server.ts:557` returns bare `{success:false, error:"tool_not_allowed:X — not in thread tool_whitelist"}` with no envelope — spec is grounded.
- §4.2 naming table is a clean SoT; "用于本对话" / "退出场景，回到通用助手" are testable user-facing strings.

## Security / ADR fit

- Pack stays Composition; no new Surface / L2-class / Autonomy tier — consistent with ADR-020 §3 Axis B and the "no bare 中层 Agent" rule.
- Trust monotonicity preserved: §2.3 #5 ("god mode 不等于白名单全开") and §6.5 footnote ("god mode ≠ 场景限制") are explicit; the spec does not weaken L2 / shell / netsec gates.
- Channel untouched (`community | enterprise`); enterprise allowlist + L2 forceConfirm still apply post-unapply because unapply restores the **pre-pack snapshot**, not a global bump (verified at `pack-engine.ts:362 restoreSnapshot`).
- `pack.unapply` will need an audit entry — §7 already lists it. Good.

## IA & naming

- §4.1 scheme S (single entry, three vertical regions) is the right call for 320px Side Panel; deferring page rename to P1 is reasonable (avoids churning BottomBar chrome in P0).
- Residual confusion risk: §6.1 status bar shows BOTH "场景:X" and "工作区:Y" in ≤28px — at 320px with CJK + long basename, this will wrap or truncate. Not blocking; impl detail.
- §11 Q3 (Agent may not call `unapply`) is correct — keep it UI-only.

## P0 plan

Realistic. `restoreSnapshot` and `applyPackPatch` already exist (`pack-engine.ts:362, 362-380, 469`), so `pack.unapply` is a ~30-line handler wrapper + audit. The six P0 items in §9 are each independently testable and map to the failure modes in §1.3.

## Blocking

None.

## Nits

1. **`pack.apply` user_gesture gap (§2.3 #3 vs §7).** Spec states "Apply 仅用户手势（扩展点击）;Agent 不得 pack.apply 自己", but §7 P0 only says "UI 强制 confirm;校验 active thread". The existing analogous gate is `netsec.authorize_task`'s validator at `companion/src/server.ts:4644` (`m.user_gesture !== true → reject`). Recommend P0 also add `user_gesture:true` to the `pack.apply` validator (`server.ts:4591`) so the "Agent cannot self-apply" invariant isn't enforced only by UI convention — otherwise a prompt-injected LLM can still fire `pack.apply` over WS and narrow its own whitelist (or, worse, widen by switching packs mid-thread).

2. **Error envelope shape unspecified.** §7 lists `error_code` + `mission_pack_id` + `suggested_action: unapply_pack` but doesn't say whether they ride on the tool_result `data` field (the pattern at `server.ts:573 TAB_ID_REQUIRED` uses `data:{error_code}`). Pin this in the spec so the impl doesn't diverge from the recoverable-classifier path in `adapter.ts`.

3. **§6.2 modal "不适合" hardcodes AppSec copy.** §8 already acknowledges P2 will pull this from `pack.yaml` (`suitable_for` / `unsuitable_for`), but P0 §6.2 says "硬编码/元数据". Just confirm the hardcoded path is keyed to `pack_id === "appsec-prd-review"` only, so a third-party Pack doesn't inherit AppSec's "不适合：安装技能" copy.

4. **§5.3 F3 modal offers "[保持场景, 改用网页工具]" but doesn't define the recovery semantics** — does the LLM re-plan, or does it just retry a different tool name? Clarify (one line) so the Agent prompt increment in §6.6 can be implemented deterministically.

5. **§6.4 "退出场景" button co-existing with "应用到当前线程" on the same card** — when `isActive`, spec says "禁用应用 + 旁路退出". Just confirm both affordances can't fire simultaneously (defensive).

6. **§11 Q1 default "退出不清理工作区"** is correct (orthogonal axes), but consider stating explicitly that `workspace_root` survives across Pack switches within the same thread — otherwise impl may naively couple them.

VERDICT: APPROVE_WITH_NITS
