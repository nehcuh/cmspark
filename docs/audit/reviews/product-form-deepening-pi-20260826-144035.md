All spot-checks complete. Summary of the re-review:

## Confirmations

**Four-lane deepening** — locked and consistent across spine (LOCKED 脊柱), deepening SoT, PRODUCT.md (Jobs 1–4, Surfaces table), GOAL.md line 9 ("家是已登录的 Chrome + 硬闸…Side Panel 是 Operate 面之一，不是家"). Capture=召唤器 / Operate=侧栏或后台 CDP / Confirm=确认台/托盘 / 租手=Outbound MCP.

**User insistences honored:**
- **Docs first, no code, 发心 first** — §0 opens with user language verbatim; "本文件不写代码" explicit; blast = T0 doc. Code spot-checks confirm nothing implemented yet: summoner-web.ts still 「展开工作台」(754, 794–795), confirm-target.ts still 侧栏 copy, tests still lock old copy (summoner-overlay.test.ts:110, summoner-web.test.ts:132/136, mcp-confirm-target.test.ts:15/25). Exactly as §6/§11 predict for slice 3.
- **租手 first-class** — 4th lane in every doc; ADR-025 L7 `无 cmspark__acp_* 导出`; outbound-grants.ts emits `cmg_` tokens, sha256-hash only, `GRANT_REQUIRED`, never falls back to `ws_secret`.
- **Overlay grows as conversation, not WorkBuddy** — §5 「展开对话」/「收起对话」, MCP rail removed from expand chrome, 场景/知识/技能 FREEZE, no sixth rail. PRODUCT.md: "Expand = 展开对话, not a five-rail workbench".

**No reopening of overlay Allow/Deny** — summoner-web.ts:217 blocks all `confirm` dispatch except `mcp.confirm.pending` notice; §4/§9/§12 forbid; ACL unchanged.

**No second Chrome extension** — single chrome-extension source (mv3-prod/dev builds only); §1/§12 NEVER #1.

**租手 vs ACP** — clean split: 租手 (they→us, `cmspark__*`/`cmg_`, opt-in) vs 编程接力 ACP (us→them, `acp_*`, ADR-025). User-facing "Handoff" banned for outbound.

**L8 genuinely required for 5-min** — code verifies the hole: tool/l2-admission.ts:1293 binds `{ originWs: ws }` to the requesting peer (overlay-originated L2 confirms die with the overlay), lifecycle.ts:319–333 grace-kills pending on socket close; outbound fan-out exists but Win/Linux 确认台 reachability ("打开 Chrome → Cockpit") is unbuilt. The 5-min promise "人能够到确认台…不自动过" cannot hold without slice 2; "五分钟未完成 = L8 未绿" is honest and internally consistent.

## Nits (non-blocking)

1. §7.1 wording "lifecycle.ts rejectAll 杀掉 pending" — mechanism is actually `applyConnectionCloseGracePeriod` scoped 5s grace-kill, not `rejectAll`. Same observable effect.
2. docs/mcp.md is partially ahead of the SoT: Bearer table/prose already document `cmg_` + `require_grant=true` + 禁止 ws_secret, but the actual JSON/TOML env snippets still omit `CMSPARK_OUTBOUND_GRANT` (SoT's "漏了 grant" claim is accurate), grant issuance still billed as "Side Panel 设置（推荐）" not CLI, and the mandated 实验/T1-未跑 banner is absent — all gated to slice 1 per §14. Live gap today, correctly deferred.
3. summoner-acl.ts still allows frozen `mcp.toggle_server`/`skill.activate` — acknowledged in §10 with `overlay-acl-rollback` ticket; "不涨", slices 1–3 do not roll back. Consistent.

VERDICT: APPROVE_WITH_NITS
