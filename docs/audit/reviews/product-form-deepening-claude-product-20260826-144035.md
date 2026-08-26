Review complete. All verifiable claims checked against code and docs; here is the Product review.

---

# Product Review — 产品形态深化 SoT (2026-08-26)

**Scope**: product-form-deepening-design.md (primary) · user-first spine · adversary synthesis · PRODUCT/GOAL/DESIGN · ADR-022 L2. Read-only; every checkable claim was executed against the working tree.

## Claim verification — no false major claims found

| SoT claim | Evidence | Level |
|---|---|---|
| `confirm-target.ts` in `mcp/` not `ws/` | `companion/src/mcp/confirm-target.ts` exists; `ws/confirm-target.ts` absent | [executed] |
| §7.1 L8 hole: overlay-origin L2 binds `originWs` to summoner; closing kills pending | `l2-admission.ts:1290-1293` (`{ originWs: ws }` for non-outbound) + `lifecycle.ts:1399` (`rejectAll("disconnect", ws)`) | [executed] |
| Tests lock old copy; slice 3 must change them | `summoner-overlay.test.ts:110` (展开工作台), `summoner-web.test.ts:132,136` (去侧栏处理), `mcp-confirm-target.test.ts:15,25` (侧栏) — exactly the three files §6 names | [executed] |
| Mac HUD attach CTA hidden today | `SummonerOverlay.swift:1349-1350` unconditional `ctaBox/attachButton isHidden = true` | [executed] |
| Chrome-closed surfaces raw error code; no 打开浏览器 anywhere | `SummonerOverlay.swift:755` dumps `系统: BROWSER_UNAVAILABLE`; no 打开浏览器 string in `companion/src` | [executed] |
| HUD five rails + stdin ＋添加MCP/＋导入知识 shipped | `SummonerOverlay.swift:513-522` (场景/知识/技能/MCP), `:585`, `:627` | [executed] |
| Grant issuance today = sidebar settings only; no CLI | No `outbound-grant` command; issuance only via WS handlers (`message-router.ts:3292`); `docs/mcp.md:260` | [executed] |
| `require_grant` default true; `cmg_` ≠ `ws_secret`; disclosure self-ack exists | `config.ts:402`; `stdio-server.ts:30-33,77-82`; `companion-http.ts:163` | [executed] |
| docs/mcp.md Grok snippet missing grant | `docs/mcp.md:304` env has CALLER_ID + PORT only | [executed] |
| §14 doc-sync complete in tree | PRODUCT.md / GOAL.md / DESIGN.md / README.md:46 / spine header / 08-25 F-UX-OVERLAY-1:82 / ADR-022 L2:45,70 — all carry the 08-26 narrative; mcp.md correctly deferred to slice 1 (won't write nonexistent CLI as shipped) | [executed] |

## Q1 — Capture→Operate→Confirm→租手 vs a real user day

Yes. Three concrete days (§3): hotkey-only user never opens the sidebar and gets L0-chat / 打开浏览器 / one-line 需要确认； sidebar watcher gets red-strip quick-approve (Operate face, correctly distinguished from overlay); Codex renter gets tray-green → key → mcp add → confirm lands on 确认台/托盘， never “请回侧栏”. 租手 is **not** engineer-splained away — the opposite: PRODUCT.md's Avoid list bans treating 租手 as "just MCP, not the product", ADR-022 L2 keeps it a Composition export without second-product identity, and §8's honesty preconditions (“缺一则不是五分钟，是安装日”) plus the experimental/T1-not-run label keep the promise honest. Naming lock (租手 vs 编程接力 vs `cmg_` vs `ws_secret`) kills the Handoff confusion at the user surface.

## Q2 — 「展开对话」 vs shipped 5-rail debt

Clear disposition, no ambiguity for the next PR. §5's per-rail table (对话 KEEP / 场景·知识·技能 FREEZE with explicit allowed/forbidden cells / MCP REMOVE-from-expand-chrome), NEVER #2 (no sixth rail, no WorkBuddy, no third chat), “本季不撕工作台架构”， rollback ticket explicitly deferred (§13). MCP stays managed in sidebar 装配 — the rail is removed from chrome, not the architecture. Verified the debt is real in code and that the three locked tests named for slice 3 are exactly the ones that would fail today. An implementer cannot invent a sixth rail without violating a NEVER, nor rip B0–B4 without violating the freeze column.

## Q3 — Copy contract implementable without inventing Allow/Deny

Yes. §6 gives paste-ready zh-CN strings for every state (chevron, three Chrome-closed variants, both browser buttons, 附言， confirm status + button, tray note, grant one-time notice, pack swaps), and the 4-point 打开确认台 behavioral spec (fan-out incl. extension peer; extension already opens Cockpit — consistent with DESIGN.md D10′; degrade to 打开浏览器； overlay reports only) leaves nothing to invent. “召唤器永不出现 允许/拒绝/Allow/Deny” appears in §4, §6, and §7 as an invariant. Both shells share the contract (§13 dual-shell ruling).

## Q4 — Missing user jobs

None that reopen a NEVER. Matching → slice 6 (IDF port into TS, no Python, gated behind 1–3). Checklist → slice 6 RunProgress (checkoff bound to `tool_result` or human gesture; 模型自勾 forbidden). Jira → NEVER #8 + §2 “入站 MCP 是第三件事” (page truth + user-supplied inbound MCP, not object sync). Gemini-ugly side panel → slice 5 看山 empty/composer + PRODUCT.md anti-references (banned: Connected Apps, Precision Instrument gray admin, per-tab native assistant).

## Capability checklist (ADR-020)

Declaration block present (SoT header) ✓ · Axes correct, “中层 Agent” explicitly banned ✓ · Pack-first, no new scenario chrome ✓ · No new confirm dialect (L8 reuses Cockpit/tray) ✓ · Trust monotonic (F-S-5 ACL freeze; freeze residues not precedent) ✓ · originWs **strengthened** per P1-2 (bind extension WS or unbound, never summoner) ✓ · No second runtime ✓ · Outbound labeled experimental / T1-not-run ✓.

## Nits (non-blocking)

1. §6's must-change test list omits the live notifier copy at `l2-admission.ts:1279` (“请在托盘或 Side Panel 批准/拒绝”) — §7.2's 「侧栏」→「确认台」 mandate covers the direction, but slice 2/3 should sweep this string too.
2. §5 知识/技能 FREEZE cells mix WS-forbidden entries and chrome-hide directives in one cell; readable but inconsistent with the table's 允许/禁止 column semantics.
3. §8 recipe is issue-only — no stated user path to revoke/rotate a `cmg_` key when a renter's machine is lost. Settings-side grants management exists today; worth one line in slice 1 docs.
4. Spine line 72's “Confirm 段的「工作台」= 确认台” disambiguation sentence is confusing given the diagram itself says 确认台/托盘 — historical usage cleanup, cosmetic.

None of these reopen a NEVER, none are false claims, and no journey is missing. All four lanes' folds (租手 naming, L8-as-DoD, hidden MCP rail, CLI grant) are present, mutually consistent, and mirrored across the doc set.

VERDICT: APPROVE_WITH_NITS
