# Product Review — slices 1–3 implementation plan

**Scope reviewed:** `docs/superpowers/plans/2026-08-26-product-form-slices-123.md` against SoT `2026-08-26-product-form-deepening-design.md` §6/§11, with the dual-review capability checklist applied. Read-only; no edits made.

## Prompt-mandated checks

**1+2 same milestone — PASS.** PR table marks PR-A 五分钟 DoD "Not green" and PR-B "Required"; Task 4 carries an explicit "Do not claim 五分钟完成" stop; Task 10 marks "五分钟租手 machine DoD now checkable (CLI exists + L8 + HITL)"; UAT fails the milestone if steps 4–6 fail "even if 1 is pretty." This is exactly SoT §11's "切片 1 与 2 同一里程碑：五分钟租手未完成 = L8 未绿". Nit: the Blast line's "PR-B T2.7" label maps to neither the plan's Task 1–12 numbering nor the synthesis's numbering — intent (end of PR-B / Task 10) is inferable but the cross-ref is dangling.

**CLI-first keys — PASS.** Task 2 ships `outbound-grant issue/revoke/list` as argv handler with no server; sidebar checkbox demoted to backup with copy 「推荐命令行签发（五分钟主路）。这里是备用与撤销。」; mcp.md makes CLI the 拿钥匙 main path. Tray grant window explicitly deferred, which SoT §8.3 permits ("和/或"). Overlay/HUD issuance is on the BLOCK list, and Task 2 has a grep test forbidding `acceptOutboundDisclosure` import.

**Copy contract present — PASS.** Task 11's strings table is SoT §6 verbatim for both shells (展开对话/收起对话, the three Chrome-down states, 打开浏览器/打开并前置浏览器, the 不能替你打开侧栏 footnote). Task 9's confirm copy (确认台 not 侧栏) and pack copy flips match §6 exactly, including keeping 侧栏占用了输入. Grant one-time line appears in a Task 2 test assertion. The mic replacement 听写在侧栏 is plan-authored (SoT prescribes the flip of 去侧栏处理, not the replacement string) and stays within the honesty contract.

**Tests flipped, not preserved — PASS.** Task 11 explicitly flips `展开工作台` → `展开对话` and inverts `ctaBox isHidden = true`; `summoner-web.test.ts` stops matching 去侧栏处理; the compose test's Allow/Deny regex is narrowed to *actions* so the new 打开确认台 copy doesn't false-trip the ban — a subtle trap the plan caught. Task 12 keeps `summoner-workbench-compose.test.ts` green via hide-not-delete (mcp.toggle/add stay in source), matching SoT §5's MCP row verbatim.

**mcp.md 租手 not Handoff — PASS.** H2 becomes 「5 分钟租手（Outbound MCP · 实验）」; printUsage user name is 租手钥匙 with "never Handoff"; the coding-handoff guide gets the disambiguation paragraph (Outbound = 租手, guide = 编程接力); user-facing `Handoff` is grep-forbidden.

**Windows snippet — PASS.** CLI stdout prints platform command/args including `%LOCALAPPDATA%\CMspark\node.exe` + `cmspark-agent.js`; docs require the Windows NSIS snippet and the docs test asserts `LOCALAPPDATA|Local\\CMspark`; every `mcp-outbound` fenced block must contain `CMSPARK_OUTBOUND_GRANT`; bake-off/TROUBLESHOOTING drop `Bearer $SECRET`.

**T1 disclaimer — PASS.** §8.1 verbatim and first under the H2; docs test asserts 尚未跑; 无缝对接-class claims grep-forbidden.

## Capability checklist

- **Declaration block** present (Surface/L2-classes/Compose/Autonomy/Trust/Channel). ✓
- **Axes fit**: 租手 stays a composition/trust concern; no middle-agent framing. ✓
- **Confirm dialects**: no new family — reuses 确认台 + Swift tray; overlay is notice-only. ✓
- **Trust monotonicity**: gates only tighten — POST-ack e2e must go red, exfil fail-closed without flag and HITL, Confirm Center approve must not write the 30-day grant flag, revoke kills exfil even with a live session Map. ✓
- **originWs**: summoner socket deliberately never bound — this is SoT §7's designed L8 invariant, locked by Tasks 5/6 tests, not a regression of the watchlist item. ✓
- **No new runtime**: helper + argv handler; no HTTP grant routes (keeps 404); CLI MUST NOT `listen()`/`createServer`. ✓
- **Experimental labeling**: T1 disclaimer + 实验 in the H2. ✓

## Nits (non-blocking)

1. Dangling "T2.7" cross-reference in the Blast line (see above).
2. File map assigns `summoner-web.ts` to PR-C only, but Task 9 (PR-B) also modifies it (~1130 fallback) — map is slightly stale against the tasks.
3. Docs-test regex `Local\\\\CMspark` matches two literal backslashes — correct for JSON-in-markdown, but worth an eyeball at impl time.

The plan is faithful to the SoT on every product-facing contract checked, the BLOCK list preemptively encodes the relevant NEVERs, and the test-flip discipline is explicit rather than assumed.

VERDICT: APPROVE_WITH_NITS
