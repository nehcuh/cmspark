# Lane A — PRODUCT honesty audit (2026-09-08)

**Scope**: source + user-facing docs at HEAD `4a63de56` on `main`. Not the live NSIS install, except where a doc claim needs a code path. Independent of other lanes. All citations `[inspected]` unless marked `[executed]`.

## Verdict: REJECT

User-facing product docs would mislead a new user on **which version they have**, **what the Capture/Operate surfaces look like**, and **what knowledge injection does by default**. Companion / extension / installer lockstep is **0.6.6**; README, PRODUCT, GOAL, CLAUDE, docs/README, and the summoner guide still sell **0.6.0** with a **360×420** Capture card and **checkbox ∪ hostname / inject-all** knowledge. HEAD already contains the entire CHANGELOG `[Unreleased]` block (workspace UI #469–#485, enterprise slices #451–#456, summoner 1040×760 +「资料与工具」). A clone of `main` is not the NSIS 0.6.6 product; the docs describe neither.

## Executive summary

CMspark’s product sentence (logged-in Chrome hand, four surfaces, hard gates) is still the right story, and several 0.7.0 enterprise docs honestly say “开发中 / 未发布”. That honesty does not rescue the live cut. Version banners, Capture size, knowledge modes, and the Operate “home” drifted independently: lockstep files moved to 0.6.6, CHANGELOG kept shipping as Unreleased on `main`, and the 0.6.0 form contract was never rewritten. Default outbound L1 is still eight tools (`#228` respected). Voice/meeting base is shipped; PRODUCT still lists `#258`–`#260` as remaining work even though implementations exist. `#230` overlay-acl freeze remains a real leftover, not a stale label.

---

## Version / lockstep table

| Artifact | Claimed version | Evidence |
|----------|-----------------|----------|
| `companion/package.json` | **0.6.6** | L3 |
| `chrome-extension/package.json` | **0.6.6** | L4 |
| `chrome-extension/package-lock.json` | **0.6.3** | L3 — lockfile not bumped with package.json |
| `AGENTS.md` | **0.6.6** | L3, L69 |
| `scripts/installer.nsi` fallback | **0.6.6** | L14 |
| `companion/src/index.ts` banner | **0.6.6** | L31 |
| ACP `clientInfo` / outbound `serverInfo` | **0.6.6** | `companion/src/acp/jsonrpc-stdio.ts:164`, `companion/src/outbound-mcp/stdio-server.ts:252` |
| CHANGELOG last **released** section | **[0.6.6] — 2026-09-07** (Qwen3-VL #423 only) | `CHANGELOG.md:30–32` |
| CHANGELOG **[Unreleased]** | workspace/enterprise/UI already on HEAD | `CHANGELOG.md:5–28` |
| README live cut | **当前阶段（0.6.0）** | `README.md:980` |
| PRODUCT.md | **Version lock … 0.6.0** | `PRODUCT.md:4` |
| `docs/README.md` | **产品 0.6.0**; “事实以 **0.6.0 代码** … package.json 为准” | L3, L175 |
| `docs/GOAL.md` | **产品 0.6.0** (dated 2026-09-06) | L3, L11 |
| `CLAUDE.md` | **产品 0.6.0**; CHANGELOG “活切点 0.6.0” | L37, L137 |
| `docs/summoner-user-guide.md` | **产品 0.6.0** | L3 |
| `docs/meeting-and-dictation-user-guide.md` | **产品 0.5.0** | L3 |
| `docs/computer-use-user-guide.md` | **产品版本：0.5.0** | L4 |
| `docs/host-and-apps.md` | **产品版本：0.5.0** | L4 |
| Git tags | latest **v0.4.0**; `git describe` = `v0.4.0-785-g4a63de56`; **no v0.6.x tag** | `[executed]` |
| HEAD | `4a63de56` `fix(workspace): 修复听写与代码任务归属，补齐对话分类 (#485)` | `[executed]` |

CONTRIBUTING itself says product version is companion/extension `package.json` and “文档写 0.4.0 时勿回退叙事” (`CONTRIBUTING.md:123`). Live user docs violate that rule.

---

## Coverage matrix

Status = what a new user of **this HEAD** actually gets, vs what **tagged 0.6.6 changelog** and **user docs** say. `shipped` = code + user-reachable. `partial` = code on HEAD but gated, experimental, docs-stale, or not in 0.6.6 release notes. `docs-only` = documented as if product, not a complete user path. `missing` = claimed or leftover with no corresponding ship.

| Feature | Status | Notes (cite) |
|---------|--------|--------------|
| Chat / threads | **shipped** | Side Panel ChatShell; thread isolation. README L0 row `README.md:54`. Workspace rewrite on HEAD (`docs/workspace-ui.md:1–10`) not reflected in README Operate ~320px (`PRODUCT.md:35`). |
| CDP tools | **shipped** | Browser operate path. README examples `README.md:232–251`. GOAL still counts “26 种工具” (`docs/GOAL.md:110`) — stale inventory, not a missing product. |
| Skills | **shipped** | TF-IDF + `use_skill`. README `README.md:266–315`. |
| Knowledge inject | **partial** | Code = TF-IDF top-k + 8000-char budget (`companion/src/skills/skill-engine.ts:79–84,1424–1474`). README still checkbox ∪ hostname / 全选灌库 (`README.md:364–367`). UI copy is honest (`KnowledgeSubPanel.tsx:583–593`). |
| Knowledge graph | **shipped** (underclaimed) | `#427` in 0.6.2 (`CHANGELOG.md:54`). Canvas `chrome-extension/src/background/knowledge-graph.ts`. **Zero hits in README.md**. |
| Obsidian export | **shipped** | ADR-008; README `README.md:468`. Blob download, no host write. |
| Mermaid | **shipped** | ADR-009; README `README.md:469`. Settled messages only. |
| Mission Packs / enterprise modules | **shipped** (opt-in) | ADR-014; README `README.md:454–460`. shell/netsec need `capability_profile=enterprise`. |
| MCP inbound | **shipped** | `docs/mcp.md`; README `README.md:60`. |
| MCP outbound (租手) | **shipped** (experimental, not default-on) | Default 8 tools unchanged (`companion/src/outbound-mcp/profile.ts:21–30,60–67`). `#228` no-expand honored. Interact + `outbound_context_v1` are **named** profiles, not default. |
| Confirm Center | **shipped** | `docs/confirm-center-user-guide.md`. Overlay never Allow/Deny (`PRODUCT.md:36`). |
| Multi-agent / Board | **shipped** | ADR-015/016; README `README.md:488–492`. |
| CU / Qwen3-VL | **partial** | Opt-in, experimental locate, default off (`docs/computer-use-user-guide.md:23`). `#423` in 0.6.6 maps [0,1000] (`CHANGELOG.md:32`). `#363` gate still not passed (6/10 vs ≥0.85). Linux hard-refuse (`README.md:743`). |
| Host / Apps | **partial** | macOS/Windows path; Linux stub (`README.md:741–742`). Guide still banners 0.5.0. |
| Voice / meeting | **shipped** (base); leftovers mislabeled | User guide exists; Mtg0–3 + auto-K shipped. `#258` PTT in `useComposerVoice.ts:223`; `#259` SAPI in `stt-engine.ts:29`; `#260` embedding experimental, held-out FAIL (`docs/meeting-and-dictation-user-guide.md:118`). PRODUCT still lists `#258`–`#260` as remaining (`PRODUCT.md:5`). |
| Embedded terminal `#432` | **shipped** (default off) | 0.6.4 (`CHANGELOG.md:45`); `tabs/embedded-terminal.tsx`; `terminal.open` (`companion/src/ws/validate.ts:1646`). **README 已交付表无此行**. GOAL G19 still says 非目标「交互式 PTY」(`docs/GOAL.md:270`). |
| Summoner command palette `#433` / search `#439` | **partial** | 0.6.4–0.6.5 (`CHANGELOG.md:36–41`); `search_threads`/`search_knowledge` in catalog (`companion/src/bridge/companion-tools.ts:22–23`). HEAD summoner is a **workspace** (`summoner-web.ts:1505–1518`), not the 360×420 “命令面板壳” README describes. |
| Workspace UI `#469`–`#485` | **partial** (on main, not in 0.6.6 release) | `docs/workspace-ui.md`; CHANGELOG Unreleased L9–L19. Honest “未发版或替换安装程序” in CHANGELOG L19. README/PRODUCT still 0.6.0 Capture/Operate form. |
| `outbound_context_v1` `#456` | **partial** | Code + settings/CLI (`profile.ts:66`, `docs/mcp.md:419–447`). CHANGELOG Unreleased L28. Docs correctly say 开发切片 ≠ 0.7.0 已发布. Not in `[0.6.6]`. |
| 0.7.0 enterprise missions `#451`–`#455` | **partial** / **docs-gated** | Code under `companion/src/business-evidence/`. `docs/enterprise-pilot.md:1,37–45` and `docs/audit/0.7.0-20260907/release-acceptance.md:3` say not release-ready. |

---

## Findings

### P-01 · BLOCK · User-facing version is 0.6.0 while lockstep is 0.6.6 and HEAD is Unreleased

**Evidence**

- Lockstep 0.6.6: `companion/package.json:3`, `chrome-extension/package.json:4`, `AGENTS.md:3`, `scripts/installer.nsi:14`, `companion/src/index.ts:31`.
- User/docs still 0.6.0: `README.md:980`, `PRODUCT.md:4`, `docs/README.md:3,175`, `docs/GOAL.md:3,11`, `CLAUDE.md:37,137`, `docs/summoner-user-guide.md:3`.
- CHANGELOG `[0.6.6]` is only Qwen3-VL `#423` (`CHANGELOG.md:30–32`). `[Unreleased]` (`CHANGELOG.md:5–28`) is already on HEAD `#485` (`[executed]` `git log -1`).
- `docs/README.md:175` tells maintainers facts follow **0.6.0** `package.json` — that sentence is now false.
- Git has **no** `v0.6.x` tag; `git describe` = `v0.4.0-785-g4a63de56` (`[executed]`).

**Impact.** A new user reading README/PRODUCT thinks they are on product 0.6.0 (Capture 360×420, Side Panel Operate, 0.6.0 feature set). Cloning `main` yields 0.6.6 **plus** Unreleased workspace/enterprise. Installing the NSIS 0.6.6 build yields neither the README story nor HEAD. Three products, one name.

**fix_hint.** Pick one live cut. If HEAD is not a release: keep version 0.6.6, rewrite README/PRODUCT/GOAL/CLAUDE/docs/README banners to “0.6.6 + Unreleased on main”, and stop calling 0.6.0 the 活切点. If shipping the workspace/enterprise slices: bump to 0.7.0 **only** after the 0.7.0 acceptance ledger is actually green (it is not). Tag the release.

---

### P-02 · BLOCK · README knowledge modes describe a deleted default

**Evidence**

README (`README.md:364–367`):

- 自动（默认）= 手动勾选 ∪ 当前 hostname 的 `site_knowledge`
- 全选 = “所有知识文档全部注入”

Code (`companion/src/skills/skill-engine.ts:79–84,1424–1474`):

- Default `smartMatch=true` + non-empty query → TF-IDF, `KNOWLEDGE_DOC_TOPK_AUTO=5` / `ALL=8`, `KNOWLEDGE_SCORE_MIN=0.10`, pinned first, site boost sort-only.
- `KNOWLEDGE_INJECT_BUDGET_CHARS = 8000` always (ADR-026 `docs/adr/026-knowledge-retrieval-tfidf-no-embedding.md:12,26–28`).
- `smartMatch=false` is the **legacy** checkbox ∪ site / 全库 path — not the default.

UI is already honest (`chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx:583–593`): “按这轮问题选相关知识…全选：在全库里检索，仍受条数/长度上限.”

GOAL is also stale: G17 “知识 auto = **站点匹配**” (`docs/GOAL.md:254`) with no top-k/budget.

CHANGELOG `[0.5.9]` already documented the new machine (`CHANGELOG.md:141`).

**Impact.** A user who “全选” expecting the whole library into the prompt gets top-8 + 8000 chars. A user who trusts “自动 = 勾选 ∪ 站点” will not understand why pinned-but-irrelevant docs drop out when they type a query.

**fix_hint.** Replace README §知识库 三种注入模式 with the panel copy + ADR-026 constants. Keep a one-liner that 关掉智能匹配 recovers the old union, budget still applies.

---

### P-03 · BLOCK · Capture card is no longer 360×420; summoner now hosts 装配

**Evidence**

- PRODUCT/README/summoner guide still define Capture as **360×420** and “永不装配”: `PRODUCT.md:3,33,35`, `README.md:16,223–226,980`, `docs/summoner-user-guide.md:18,39`.
- Code default inner size is **1040×760**; 360×420 is the **compact** branch: `companion/src/summoner/shell-open.ts:29`, `companion/src/summoner-web.ts:1708–1710` (`if(compact){w=360;h=420}`).
- HEAD summoner aside includes **资料与工具** with 场景 / 知识 / 技能 / MCP / 浏览器: `companion/src/summoner-web.ts:1505–1518`. CHANGELOG Unreleased `#477/#476/#481` (`CHANGELOG.md:9–11`).
- Overlay still must not Allow/Deny (form constraint holds). The “no 装配 on the card” contract does not.

**Impact.** First-run story “hotkey → small Capture card → talk” is false on HEAD. The summoner is a wide workspace with resource rails. Users following the 0.6.0 guide will not recognize the window. Compact 360×420 still exists as a toggle (`windowMode`「紧凑窗口」, `summoner-web.ts:1526`), not as the product default.

**fix_hint.** Rewrite Capture docs to default 1040×760 + compact 360×420. Either admit 资料与工具 as Operate-lite on Capture, or remove those rails. PRODUCT “装配 stays outside the shell” (`PRODUCT.md:35`) must be updated or enforced.

---

### P-04 · MAJOR · Operate “home” drifted to a conversation workspace

**Evidence**

- Product sentence: home is **logged-in Chrome + hard gates**, Side Panel is Operate, not home (`PRODUCT.md:10`, `README.md:3,27`).
- New user guide `docs/workspace-ui.md:1–3`: “CMspark 的主界面围绕当前对话展开。宽屏左侧显示最近对话、资源和设置”. Listed first in `docs/README.md:14`.
- CHANGELOG Unreleased `#469` (`CHANGELOG.md:19`) says the redesign “未发版或替换安装程序” — honest for NSIS, dishonest for `main` checkout / unpacked extension.
- README related-docs table (`README.md:965–976`) does **not** link `workspace-ui.md`. Operate row still ~320px ChatShell empty state (`README.md:54,213`).

**Impact.** Two homes: Chrome+gates vs conversation workspace. A new user landing on `docs/README.md` hits workspace-ui first. The 0.6.0 form SoT (`PRODUCT.md:6`) was not revised.

**fix_hint.** Keep Chrome+gates as the product sentence. Describe the workspace as the Operate chrome (wide/narrow), not “the main interface”. Point README 已交付 at `workspace-ui.md` once the version story is fixed.

---

### P-05 · MAJOR · README 已交付矩阵 underclaims 0.6.1–0.6.6 user-visible ships

**Evidence.** `README.md:49–69` stops at 0.6.0 themes (cruise/plan/loop, expert packs, CU). Missing from that table, but in CHANGELOG 0.6.2–0.6.5 and code:

| Ship | CHANGELOG | Code |
|------|-----------|------|
| Knowledge graph AI-organize | `[0.6.2]` L54 | `chrome-extension/src/background/knowledge-graph.ts` |
| Embedded terminal | `[0.6.4]` L45 | `chrome-extension/src/tabs/embedded-terminal.tsx`, `companion/src/pty/session.ts` |
| Summoner command palette + `thread.search` | `[0.6.4]`/`[0.6.5]` L36–41 | `companion/src/ws/validate.ts:179`, `summoner-acl.ts:28` |
| `search_threads` / `search_knowledge` | `[0.6.5]` L41 | `companion/src/bridge/companion-tools.ts:22–23` |
| Outbound interact profile | `[0.6.1]` L75 | `profile.ts:40–67` |

`docs/README.md:171` requires new features to update the README matrix. That checklist failed for a month of 0.6.x ships.

**Impact.** Underclaim, not overclaim — but a new user of 0.6.6 still cannot discover terminal / history search / graph from the front page.

**fix_hint.** Add rows (with default-off / experimental flags). Do not fold Unreleased workspace into “已交付 0.6.6” until versioned.

---

### P-06 · MAJOR · `#258`–`#260` still sold as remaining work; implementations exist

**Evidence**

- Listed as leftover: `PRODUCT.md:5`, `docs/GOAL.md:3`, `CLAUDE.md:21`, `AGENTS.md:29`, `CONTRIBUTING.md:116`, `docs/README.md:123`.
- Code: `#258` PTT dual-mode `chrome-extension/src/sidepanel/hooks/useComposerVoice.ts:223`, `voice/ptt-reducer.ts:1`; `#259` Windows SAPI `stt-engine.ts:29`, `whisper-settings-copy.ts:41`; `#260` embedding diarize documented as **实验**, held-out FAIL `docs/meeting-and-dictation-user-guide.md:118`.
- Prior 0.7.0 readiness note already flagged this: `docs/audit/cmspark-0.7.0-readiness-2026-09-07.md:226` (“#258–#260 已关，但 PRODUCT 仍写剩余项”). This audit does **not** re-fetch GitHub issue state.

**Impact.** Looks like voice/meeting is unfinished. Base dictation+ / Whisper / meeting bench **are** shipped (README L56 is correct). The leftovers are Hex UX completeness, SAPI fallback, and experimental embedding quality — not “voice doesn’t exist”.

**fix_hint.** Move `#258`–`#260` out of “本季余项” or replace with residual quality (held-out diarize FAIL, Hex tier-3/4 not in scope). Keep `#230` freeze.

---

### P-07 · MAJOR · GOAL contradicts shipped PTY and knowledge scoring

**Evidence**

- G19 非目标 “交互式 PTY” (`docs/GOAL.md:270`) vs `#432` shipped (`CHANGELOG.md:45`, `companion/src/ws/validate.ts:1646`).
- G17 auto = site-matcher only (`docs/GOAL.md:254`) vs ADR-026 / `resolveKnowledgeIdsForThread`.
- GOAL still “活切点 0.6.0” (`docs/GOAL.md:11`).

**Impact.** Agent/human planners using GOAL as SoT will treat terminal as forbidden and knowledge as hostname union.

**fix_hint.** Mark G19 PTY ✅ with default-off + L2; rewrite G17 to ADR-026; bump GOAL header to the real live cut.

---

### P-08 · MAJOR · 0.7.0 enterprise is code-on-main, docs-honest, version-not-bumped

**Evidence**

- User nav includes `docs/enterprise-pilot.md` as “**0.7.0 开发中** … 尚未发布” (`docs/README.md:20`) — good.
- Architecture: “0.7.0 的职责是…” (`docs/enterprise-architecture.md:3`) without “未发布” in the first sentence; later L41 points at the acceptance ledger.
- `docs/mcp.md:419–447` “站点上下文档案（0.7.0 开发切片 / #456）” then “工具连通不等于 0.7.0 已发布”.
- Acceptance ledger: **“未达到发布条件。版本保持 0.6.6.”** (`docs/audit/0.7.0-20260907/release-acceptance.md:3`).
- Code exists: `companion/src/business-evidence/`, `outbound_context_v1` in `profile.ts:66`.
- CHANGELOG Unreleased L25–L28: dual-scene acceptance is a **0.7.0 release gate**; “当前版本未升级”.

**Impact.** A careful reader will not think 0.7.0 is the product version. A skimmer of `enterprise-architecture.md` L3 or settings「站点上下文档 outbound_context_v1」 (`chrome-extension/src/sidepanel/utils/outbound-profiles.ts:8,29`) might. Not as bad as P-01, but the 0.6.6 version number on a tree that contains 0.7.0 slices is the same split.

**fix_hint.** Keep the “not released” sentence in the **first** line of every 0.7.0 user doc. Do not bump package.json until the ledger’s 阻断项 are closed. Settings/CLI copy should say “开发中 / 试点”.

---

### P-09 · MAJOR · `#228` default outbound not expanded (positive); docs still need the named-profile map

**Evidence.** Default allowlist remains eight tools (`companion/src/outbound-mcp/profile.ts:21–30`). Interact extras are a separate profile (`L40–67`). `outbound_context_v1` = default ∪ `site_context` (`L66`). Grant CLI default profile is `outbound_l1_default` (`grant-cli.ts:5`). CHANGELOG 0.6.1 explicitly “**不扩**默认 outbound L1” (`CHANGELOG.md:73–76`).

**Impact.** No BLOCK on `#228`. Underclaim: README 租手 row (`README.md:61`) does not mention interact / context_v1 named profiles. Users may think every `cmg_` key is the same L1.

**fix_hint.** One table: default 8 / interact +11 / context_v1 + `site_context`. Repeat “default unchanged”.

---

### P-10 · MAJOR · chrome-extension lockfile version 0.6.3 vs package.json 0.6.6

**Evidence.** `chrome-extension/package.json:4` = 0.6.6; `chrome-extension/package-lock.json:3,9` = 0.6.3. Companion lockfile is 0.6.6 (`companion/package-lock.json:3`).

**Impact.** Packaging / `npm ci` identity drift. Not user-visible chrome by itself; lockstep tests that only read `package.json` will miss it.

**fix_hint.** Bump the lockfile `version` field with the next version PR.

---

### P-11 · NIT · Feature-guide version banners stuck at 0.5.0 / packaging examples at 0.6.0

**Evidence.** Meeting `docs/meeting-and-dictation-user-guide.md:3`; CU `docs/computer-use-user-guide.md:4`; Host `docs/host-and-apps.md:4`; TESTING `docs/TESTING.md:3`. README package example `CMspark-v0.6.0-macOS.dmg` (`README.md:845–846`).

**Impact.** Looks like those surfaces never left 0.5.0. Content is largely still valid (default-off CU, dual ack, etc.).

**fix_hint.** Banner “content current as of 0.6.6; product version see package.json”. Fix the DMG example.

---

### P-12 · NIT · `#230` freeze is still a real leftover, not a zombie

**Evidence.** PRODUCT/GOAL/CLAUDE/CONTRIBUTING still freeze F-S-10 / overlay-acl. Overlay confirm path still fans MCP to notice-only (`companion/src/mcp/dispatch.ts:89–136`, `MCP_OVERLAY_CONFIRM_NOTICE`). CHANGELOG 0.6.0 “ACL / 确认方言 / #230 不动” (`CHANGELOG.md:94`).

**Impact.** Correct to keep frozen. Incorrect to list it in the same breath as `#258`–`#260` as if all four were equally undone.

**fix_hint.** Keep `#230` as the only “本季冻” line in PRODUCT.

---

## Open questions

1. **What should a new user install tomorrow?** NSIS 0.6.6 (this machine), `main` HEAD, or wait for a 0.7.0 tag that does not exist? Docs do not answer.
2. **Is the Unreleased workspace the intended 0.6.6+ dogfood UI**, or must it stay off the installer? CHANGELOG L19 says the latter; HEAD is the former.
3. **GitHub state of `#258`–`#260` / `#230`:** this lane did not fetch issues. Code + local docs only. Prior readiness audit claimed `#258`–`#260` closed.
4. **Qwen3-VL `#363`:** 0.6.6 ships the coordinate fix (6/10). Is CU still “experimental locate only”, or will marketing treat 0.6.6 as “CU works”? Docs still experimental — keep it.
5. **Summoner MCP rail** (`summoner-web.ts:1515–1517`) vs CHANGELOG `#477` “MCP 保持只读” vs PRODUCT “overlay never 装配”: what is the allowed Capture tool surface?
6. **Default outbound + `outbound_context_v1` in settings:** does the settings dropdown imply context export is a normal 0.6.6 key type? (P-08.)

---

## Lane note

Routing: `vibe route` → FALLBACK_LLM (no skill). Followed the assigned PRODUCT audit brief. Read-only except this file.
