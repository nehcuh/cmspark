All checks complete. Here is the review.

---

# Impl/Architecture Review — 产品形态深化 SoT (2026-08-26)

## Claim spot-checks (all executed against code)

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Overlay L2 binds `originWs` to overlay; overlay cannot respond | **TRUE** | `companion/src/tool/l2-admission.ts:1290-1293` — `confirmOriginOpts = isOutboundMcpCall ? undefined : { originWs: ws }`; `sendConfirm` (1241-1264) fan-outs **only** when `isOutboundMcpCall`, otherwise `ws.send` alone. `security.confirmation.response` absent from `SUMMONER_ALLOW` (summoner-acl.ts:14-45). Win/Linux: `trayEligible` requires Swift backend (l2-admission.ts:1139-1146) → 45s timeout, matching §7.1. |
| 2 | Overlay close `rejectAll` kills pending | **TRUE** | `companion/src/ws/lifecycle.ts:1399` calls `rejectAll("disconnect", ws)`; `security-confirmation.ts:508-525` rejects entries whose `originWs` matches → overlay-bound confirms die. Lifecycle.ts:1405 additionally cancels racing tray dialogs keyed by that ws. |
| 3 | confirm-target is `companion/src/mcp/confirm-target.ts` (not ws/); retarget ≠ L8 | **TRUE** | File exists; `ws/confirm-target.ts` does not (glob). `confirm-target.ts:12-29` — summoner-origin → extension if open, else fail-closed error; copy still 「侧栏」 (lines 7, 10), matching §7.2 “文案仍侧栏”. Distinct mechanism from L2 originWs — spec's "≠ L8 done" is accurate. |
| 4 | Grant issue UI is Side Panel only; no CLI | **TRUE** | `OutboundMcpSettingsSection.tsx` + handler `message-router.ts:3291` (`outbound_mcp.grants.issue` → `.issued`). Grep of `companion/src/index.ts` for grant: zero matches — CLI does not exist. §14's “不把未实现的 CLI 写成已存在” is honest. |
| 5 | 「展开工作台」 locked by summoner-overlay.test.ts | **TRUE** | `companion/tests/summoner-overlay.test.ts:110` — `assert.match(body, /展开工作台/)`. |
| 6 | Mac HUD mcp.add/knowledge.import via tray stdin, not SUMMONER_ALLOW | **TRUE** | `SummonerOverlay.swift:700/739` emit `summoner.mcp.add` / `summoner.knowledge.import`; handled in `menu-bar-agent.ts:1519-1530` (tray-origin `companionClient`), not summoner WS. `mcp.add` absent from SUMMONER_ALLOW. Corroborated by summoner-workbench-compose.test.ts:133-134 (doesNotMatch `summonerClient.sendAppRequest("mcp.add"…)`). |
| 7 | SUMMONER_ALLOW includes `mcp.toggle_server` and `skill.activate` | **TRUE** | summoner-acl.ts:35 and :39. |
| 8 | attachChromeOnly never openSidePanel; HUD attach CTAs hidden | **TRUE** | `summoner/client.ts:231-243` — only `openChrome`/`openChromeSilent`. `SummonerOverlay.swift:1349-1351` — `ctaBox/attachButton/silentAttachButton isHidden = true`. No companion-side `chrome.sidePanel.open` anywhere. HTML shell has no Chrome-closed CTA (zero hits for 打开浏览器/attachChromeOnly in summoner-web.ts) — §6 claim accurate. |
| 9 | stdio-server rejects ws_secret under require_grant; disclosure = caller ack | **TRUE** | `outbound-mcp/stdio-server.ts:73-91` — `require_grant` + empty grant throws `GRANT_REQUIRED`, ws_secret fallback only on the non-require path (line 90). `stdio-server.ts:137-176` — `cmspark__accept_data_disclosure` marks session off the caller's own `acknowledge:true`, dual-write to companion; no operator HITL → §8.4 “L4 违规自证” is accurate. |

**No false major claims found.** Every code citation in the spec that I checked resolves to real behavior.

## Questions

**1. Can slices 1–3 be implemented without inventing grant UI, overlay confirm, or rail rollback?**
Yes. Slice 1: grant store + issue handler already exist (message-router.ts:3291); the spec gives the exact CLI shape, print-once + env snippet contract, and explicit prohibitions (no overlay WS issue, no HUD `mcp.add` as issuance) — the implementer adds a CLI front-end, not new UI. Slice 2: every §7.1 directive maps to verified machinery — `getWsSurface` exists (server.ts:870), outbound fan-out exists (l2-admission.ts:1241-1264) and is extended rather than invented, tray race exists, `mcp.confirm.pending` notice-only exists (client.ts:359, mcp/dispatch.ts:73), and the extension SW already calls `openOrFocusCockpit` on `security.confirmation.request` (background/index.ts:419-424). Slice 3: copy contract is verbatim, `attachChromeOnly` + honest 「我们不能替你打开侧栏」 copy already exist and are test-locked (summoner-client.test.ts:66/444/448); §5/§13 explicitly forbid ACL rollback in slices 1–3.

**2. Is L8 file-level enough? Did we miss `activeTrayConfirmsByWs` keyed by overlay?**
File-level enough — each of the seven §7.1 directives names a real artifact I located. `activeTrayConfirmsByWs` was **not** missed: §7.1 item 6 explicitly requires it must not key overlay, and today's code indeed registers tray dialogs under the origin ws (l2-admission.ts:1178-1185) and cancels them on close (lifecycle.ts:1405) — the spec correctly identifies both kill paths (rejectAll **and** tray-cancel).

**3. Does hiding MCP chrome (slice 3) conflict with five-rail tests?**
Partially — real but avoidable, and the spec understates it (nit). `summoner-workbench-compose.test.ts:137-153` ("HUD workbench rails are live for packs/mcp/skills/knowledge") asserts SummonerOverlay.swift **source** contains `summoner.mcp.toggle`, `summoner.mcp.add`, `applyMcpServers`, etc. These are source-regex locks, not behavior tests: implementing “浮窗不展示 MCP 轨” via hiding (isHidden — the same mechanism already used for attach CTAs) satisfies the slice-3 DoD (“MCP 图标不在展开铬上”) while keeping the test green, consistent with “藏起来冻结” rather than delete. But if the implementer deletes the rail code, that test breaks and it is **not** in the spec's §6 test-change list (which names only summoner-overlay / summoner-web / mcp-confirm-target). Same file's stdin-handler assertions (lines 115-135) survive freezing since handlers stay.

## Capability checklist (ADR-020)

- **Declaration present** (spec lines 10-17) with Surface/L2-classes/Compose/Autonomy/Trust/Channel. ✓
- **Axes fit**: overlay stays Surface/Capture; 租手 = Composition export (curated L1) — no “中层 Agent”. ✓
- **Confirm dialects**: slice 2 reuses L2/Confirm Center/tray — no new confirmation family. ✓
- **Trust monotonicity**: overlay ACL frozen (F-S-5), nothing loosened; fail-closed preserved. ✓
- **originWs (item 5)**: L8 leaves summoner-origin unbound-or-extension-bound — a deliberate, documented deviation that matches the existing outbound mode (l2-admission.ts:1290) and preserves the property (overlay can never respond; fan-out to authenticated non-summoner peers + privileged tray only). Not a regression.
- **No new runtime**; experimental labeling enforced (§8.1/§8.6). ✓

## Nits

1. §6's slice-3 test-change list omits `companion/tests/summoner-workbench-compose.test.ts:137-153`, which locks MCP-rail code presence in the Swift HUD. Hide-not-delete avoids the conflict, but the spec should name the file so “remove from expand chrome” isn't implemented as deletion that breaks an unlisted test.
2. §7.1 directive 7's “attachChromeOnly 等到扩展 WS，或显式失败” — the extension-connected trigger for re-fan-out (poll vs. connect event) is left open; any choice works, but the implementer should record it in the slice plan.
3. §8.5 says Grok's `docs/mcp.md` snippet “漏了 grant” — that's a doc bug tracked in §14; fine, just confirming it is correctly gated on slice 1 ("实现切片 1 再改").

VERDICT: APPROVE_WITH_NITS
