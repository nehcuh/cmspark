# Lane D — Skeptic review (S107 health, 2026-09-08)

Independent of other lanes. Read-only except this file. Evidence tagged `[inspected]` (source/docs) unless noted.

- **HEAD (task fact):** `4a63de56`
- **Package SoT:** `companion/package.json` `0.6.6`; `chrome-extension/package.json` `0.6.6`; `companion/src/index.ts` banner `v0.6.6`; `scripts/installer.nsi` fallback `0.6.6`
- **Not SoT:** README / PRODUCT / CLAUDE / GOAL / `docs/README.md` / `docs/architecture.md` still lock **0.6.0**

---

## Verdict: **REJECT**

A new user who follows README → PRODUCT → 召唤器指南 → 知识库节 would build a **false product model**: version 0.6.0 Capture 卡 360×420, knowledge「全选」injects the whole library, Hex/SAPI/diarize still “remaining”, interactive PTY a non-goal. The tree at HEAD is **0.6.6 plus a large Unreleased workspace/enterprise wave** (1040×760 summoner shell, TF-IDF top-k inject, darwin PTY, Hex/SAPI/embedding code, 0.7.0 slices on main without a bump).

CHANGELOG `[0.6.6]` does **not** overclaim the #423 eval gate (honest 6/10 vs ≥0.85). Enterprise pilot docs are mostly honest. That is not enough: **front-door living docs are a 0.6.0 snapshot sold as live.**

`APPROVE` would require README/PRODUCT/summoner/knowledge/GOAL/docs-nav lockstep with `0.6.6` + Unreleased-on-main, and Capture geometry matching `OVERLAY_WINDOW_SIZE`.

---

## False beliefs a new user would form

1. **“Current product is 0.6.0.”** README footer, PRODUCT version lock, CLAUDE “当前阶段”, GOAL, `docs/README`, architecture header all say 0.6.0. Packages and CLI say 0.6.6. Unreleased work is already in the tree.
2. **“Summoner is a 360×420 Capture card (`OVERLAY_WINDOW_SIZE`).”** README and PRODUCT cite that constant. Code is `{ w: 1040, h: 760 }`. CHANGELOG 0.6.4 sold a 720-wide Raycast palette. User guide still describes the old card.
3. **“知识「全选」= inject every document.”** README still says that. Runtime is TF-IDF top-k (auto=5 / all=8) + 8000-char budget. The Side Panel hint is honest; the README is not. Historical skeptic hit, still live.
4. **“#258–#260 voice/meeting are unfinished remaining work.”** PRODUCT / AGENTS / GOAL / `docs/README` backlog still list them. Hex page PTT, Windows SAPI, and embedding diarize are in the tree. Inverse: a user of the meeting guide may think Hex/SAPI do not exist.
5. **“Interactive PTY is a non-goal / I have Zed Terminal Threads.”** GOAL G19 still bans interactive PTY. CHANGELOG 0.6.4 claims Zed parity. Code is **macOS-only** naked login shell; Mode C TUI is P1; spawn hard-fails on win32/linux.
6. **“Qwen3-VL locate shipped as product CU.”** README “已交付” L2 + “CU 完整性链” (0.6.0 theme). Locate is still experimental; #363 gate 6/10 < 0.85. CHANGELOG is honest; the front-door “delivered” table is easy to over-read.
7. **“Knowledge graph = graph intelligence.”** Canvas CTA「让 AI 整理」is one-shot LLM over title/tags/description, not embeddings/graph DB. Retrieval remains Wave A TF-IDF. README knowledge section omits the graph entirely.
8. **“0.7.0 enterprise materials are a product I can run.”** If they treat `docs/README` user-guide table + Unreleased bullets as GA. `enterprise-pilot.md` itself says 开发中 / 真实场景未验 — that page is not the lie; the **nav placement + Unreleased-on-main without bump** is.
9. **“TinyClick is still in the CU test map.”** `docs/TESTING.md` still lists TinyClick suites. Production locator is Qwen3-VL; TinyClick remnants are spikes.

---

## Claim / code mismatch table

| # | Claim (quote) | Code / contradicting SoT | Severity |
|---|----------------|--------------------------|----------|
| 1 | PRODUCT.md:4 `Version lock: companion/extension **0.6.0**` | `companion/package.json:3` `"version": "0.6.6"`; `chrome-extension/package.json:4` `0.6.6`; `companion/src/index.ts:31` `cmspark-agent v0.6.6` | BLOCK |
| 2 | README.md:980 `当前阶段（0.6.0）`; CLAUDE.md:37 `产品 0.6.0`; GOAL.md:3 `产品 0.6.0`; docs/README.md:1 `产品 **0.6.0**`; architecture.md:3 `同步 **0.6.0**` | Same 0.6.6 SoT. CHANGELOG Unreleased (lines 5–28) already on main: workspace #469/#471/#473/#477/#481, enterprise #451–#457, dictation #482 | BLOCK |
| 3 | README.md:16,53,223 Capture `360×420`（代码 `OVERLAY_WINDOW_SIZE`）; PRODUCT.md:3,32; summoner-user-guide.md:1,18; DESIGN.md:13 | `companion/src/summoner/shell-open.ts:29` `OVERLAY_WINDOW_SIZE = { w: 1040, h: 760 }` | BLOCK |
| 4 | README.md:366 `全选：所有知识文档全部注入（上下文大，适合文档研读）` | `skill-engine.ts:80-84` `KNOWLEDGE_DOC_TOPK_AUTO=5`, `ALL=8`, `KNOWLEDGE_INJECT_BUDGET_CHARS=8000`; resolve `slice(0, topk)` at 1472–1474. Panel copy is honest (`KnowledgeSubPanel.tsx:588` 「仍受条数/长度上限」) | BLOCK |
| 5 | CHANGELOG.md:36-40 0.6.5: 召唤器从「命令面板壳」变成真正能读历史、控插件、跑后台任务; P1 真检索 / P2 `ui.command` / P3 后台任务 | WS ACL has `thread.search` / `knowledge.search` / `ui.command` (`summoner-acl.ts:28-59`). HTML overlay HTTP allowlist does **not** (`summoner-web.ts:53-87`: `thread.list`/`knowledge.list`/`chat.create`, no search/peek/`ui.command`). Overlay comment: page never upgrades companion WS | MAJOR |
| 6 | CHANGELOG.md:45 `#432，对标 Zed Terminal Threads` … `P0 为裸 login shell` | Honest residual in same bullet, but “对标 Zed” is the headline. `pty/session.ts:224-228` `ptyHostPlatform() !== "darwin"` → `内嵌终端仅支持 macOS`. GOAL.md:270 still `非目标：交互式 PTY`. README has **zero** terminal section | MAJOR |
| 7 | PRODUCT.md:5 remaining `#258–#260` voice/meeting; AGENTS.md:29; GOAL.md:3; docs/README.md:123 | Code: `chrome-extension/src/contents/voice-ptt.ts` (#258 Hex page chord); `companion/src/voice/win-sapi.ts` (#259); `meeting/diarize-cluster.ts` `experimental: true` (#260). User guide: Hex/SAPI absent; embedding experimental **is** documented | MAJOR |
| 8 | README.md:19 租手 `实验、非 default-on`; PRODUCT.md:37 same | `config.ts:480` `require_grant: true` — grant-gated, not auto-on. **This claim matches code.** Historical false-default is fixed. Keep as control, not a hit | OK |
| 9 | CHANGELOG.md:32 `#423` 评测门 `0/10 → 6/10` … `#363` 摘帽门（需 ≥0.85）仍未过 | Same file; 0.6.0 residual line 128 still says “待真实模型跑分” (stale vs 6/10 already run). Does **not** claim pass. qwen-vl-experimental-layer.md still experimental | NIT on residual; CU “delivered” over-read is MAJOR |
| 10 | README L2 table “Computer Use · Host Use · Apps … 已交付”; computer-use-user-guide.md:4 `产品版本：0.5.0` | Locate still experimental; #363 blocked at 6/10. Guide §6.1 is honest. Version lock 0.5.0 on a 0.6.6 tree | MAJOR (stale lock + easy over-read) |
| 11 | CHANGELOG.md:54 `#427` 画布闸 `KNOWLEDGE_GRAPH_MIN_DOCS=1`；2–19 篇 CTA「让 AI 整理」 | `knowledge-graph.ts:40` `MIN_DOCS = 1`. UI leftover: `copy.ts:5` `知识不足 20 篇，暂无图谱` still pinned by `knowledge-graph-view.test.ts:91`. Organize = one-shot LLM on title+tags+description, not graph DB (ADR-026) | MAJOR (copy) / OK (engine honesty in CHANGELOG) |
| 12 | docs/README.md:20 enterprise-pilot `0.7.0 开发中` / `尚未发布`; enterprise-pilot.md:1,45 真实场景待验 | Code exists: `companion/src/site-context/`, `business-evidence/`, `outbound_context_v1` in validate.ts. Plan `2026-09-07-cmspark-0.7.0-upgrade.md:5` `版本保持 0.6.6`. Honest if read; **Unreleased-on-main without bump** still looks shipped | MAJOR (process) / OK (pilot page) |
| 13 | docs/TESTING.md:83 TinyClick tokenizer/locator/golden-eval still in CU test map | No `tinyclick*.ts` under companion/src. architecture.md:704 TinyClick/Florence 已移除. Spikes remain `scripts/spike/s1-tinyclick-onnx` | MAJOR (dead living test map) |
| 14 | post-227-status.md:3 `活切点是包装 **0.5.6**` (SNAPSHOT header) | File is marked SNAPSHOT; docs/README:52 correctly says not live. Header still names 0.5.6 as 活切点 — trap if opened from search | NIT |
| 15 | chrome-extension/package.json `0.6.6` | chrome-extension/package-lock.json:3 `"version": "0.6.3"` | MAJOR (lockstep) |
| 16 | meeting-and-dictation-user-guide.md:1 `产品 **0.5.0**`; §2.3 `前置 Side Panel 打开且获得键盘焦点`; `OS 级全局热键属后续增强` | Hex spec + `voice-ptt.ts` inject `<all_urls>` editable-field PTT (tier-2). SAPI: `win-sapi.ts` exists; user guide grep = 0 hits. Embedding experimental flag remains (`auto-diarize.ts` / `diarize-cluster.ts` `experimental: true`; held-out FAIL 2026-09-05) | MAJOR |
| 17 | Root AUDIT_REPORT_2026-06-16.md still describes live `privilege-manager.ts` / `risk-engine.ts` | `companion/src/security/` has no those files. CLAUDE.md:98 and architecture.md:157 correctly say deleted 2026-06-16 | NIT if archived-by-name; **root-level audit reports still look live** |
| 18 | AGENTS.md:3 `Version 0.6.6` vs CLAUDE.md:37 `产品 0.6.0` | Agent-config split: AGENTS lockstepped, CLAUDE/PROJECT context did not | MAJOR |

---

## Findings

### BLOCK

**B1. Front-door version is a 0.6.0 snapshot; tree is 0.6.6 + Unreleased-on-main.**  
Living entry points (README, PRODUCT, CLAUDE, GOAL, docs/README, architecture) lock 0.6.0 and Capture-era copy. `companion/package.json` / extension package / CLI / NSIS fallback are 0.6.6. CHANGELOG `[Unreleased]` (workspace #469–#481, enterprise #451–#457, dictation #482, coding-handoff #483) is already merged without a bump. A user installing from README thinks they are on the 0.6.0 Capture-card cut.

**B2. Summoner geometry claim is a direct lie against the named constant.**  
README.md:223 `尺寸：**360×420**（代码 \`OVERLAY_WINDOW_SIZE\`）` and PRODUCT.md:3 `#241 … code OVERLAY_WINDOW_SIZE`. Actual: `shell-open.ts:29` `{ w: 1040, h: 760 }`. summoner-user-guide.md:1 still `产品 **0.6.0**` and §1 `360×420` HTML Capture 卡. DESIGN.md:13 same. workspace-ui.md describes the new shell; PRODUCT/README do not.

**B3. Knowledge inject-all vs TF-IDF top-k — historical hit, still in README.**  
README.md:364-367 still teaches 自动 = 勾选 ∪ site; 全选 = **全部注入**. ADR-026 + `skill-engine.ts` Wave A: query-aware TF-IDF, auto top-5 / all top-8, 8000-char budget; smart-match default on. Side Panel `KnowledgeSubPanel.tsx:583-593` already says 「仍受条数/长度上限」. README is the only remaining inject-all brochure.

### MAJOR

**M1. Summoner P0/P1/P2/P3 completeness vs user docs vs HTML overlay.**  
CHANGELOG 0.6.4–0.6.5 claims Raycast 三段式 720 宽 + 真检索 + `ui.command` 五动词 + 后台任务. WS `summoner-acl.ts` allowlist includes `thread.search` / `thread.peek` / `knowledge.search` / `ui.command` / `task_loop.arm`. HTML overlay `SUMMONER_WEB_DISPATCH_ALLOW` does not — Overlay never opens companion WS (`summoner-web.ts:3-6`). Win/Linux primary path is that HTML `--app` window. User guide still: 问答、📎、听写、会议、打开侧栏 — **no command palette, no search, no 五动词**. Three mutually inconsistent models (360 card / 720 palette / 1040 workspace).

**M2. Embedded terminal “Zed Terminal Threads” is marketing; GOAL still forbids PTY.**  
CHANGELOG.md:45 headline 对标 Zed; same bullet admits P0 裸 login shell, Mode C TUI = P1. `spawnPtySession` darwin-only. GOAL.md:270 `明确 **非目标**（本阶段）：交互式 PTY`. README silent. A macOS user might expect agent-in-terminal; a Windows user following CHANGELOG will hit `unsupported`.

**M3. Voice/meeting remaining-work list is inverted.**  
PRODUCT/AGENTS/GOAL/docs-README still list #258–#260 as 本季余项. Code shipped: Hex content-script PTT, SAPI helper, embedding diarize (still `experimental: true`, held-out FAIL). meeting-and-dictation-user-guide.md:1 still `产品 **0.5.0**`; Hex page-insert and SAPI are **under-disclosed**; embedding experimental **is** disclosed (§3.2 Mtg3.5). CHANGELOG `[0.5.6]` Known residuals still list #258–#260 as if open.

**M4. CU experimental vs “已交付”.**  
Qwen3-VL remains experimental (`docs/qwen-vl-experimental-layer.md`, confirm `experimental_suggestion`). #363 gate: 6/10, need ≥0.85; CHANGELOG `[0.6.6]` honest. README “已交付能力” L2 row + 0.6.0 theme “CU 完整性链” reads as product-ready locate. computer-use-user-guide.md:4 still `产品版本：0.5.0`.

**M5. Knowledge graph “AI 整理” ≠ graph intelligence; leftover 20-篇 copy.**  
Engine: `KNOWLEDGE_GRAPH_MIN_DOCS=1`; organize = batch LLM on metadata; TF edges via `scoreRelatedKnowledge`; no embedding DB (ADR-026/028). User-visible strings: 「让 AI 整理现有 N 篇」「AI 关联」「AI 生成」(`copy.ts`). `KNOWLEDGE_GRAPH_TOO_FEW_COPY` still 「知识不足 20 篇，暂无图谱」while too_few is n=0. README knowledge section never mentions the graph.

**M6. 0.7.0 / enterprise on main without version bump.**  
`enterprise-pilot.md` and the 0.7.0 plan correctly say 开发中 / 真实双场景未验收 / 版本保持 0.6.6. `docs/README.md` puts enterprise-pilot in the **用户指南** table. CHANGELOG Unreleased describes Missions #454/#455 and MCP context export as merged. Code dirs exist. Not a “we shipped 0.7.0” sentence — it is **shipped-looking code + user-guide nav** on a 0.6.6 label.

**M7. Dead living docs: TinyClick test map, root 2026-06 audits, CLAUDE vs AGENTS.**  
TESTING.md:83 TinyClick. Root `AUDIT_REPORT_2026-06-16.md` / `audit-report-cmspark-2026-07-25.md` still talk as if risk-engine / TinyClick are live (CLAUDE/architecture correctly say deleted). CLAUDE.md product stage 0.6.0 vs AGENTS.md 0.6.6. chrome-extension `package-lock.json` version `0.6.3`.

**M8. Outbound “not default-on” is OK now.**  
`require_grant: true` (`config.ts:480`). mcp.md:254 agrees. Empty grant → `GRANT_REQUIRED`. Not a skeptic hit this round (historical default-false is gone).

### NIT / local stale

- CHANGELOG `[0.6.0]` Known residual “#363 待真实模型跑分” superseded by `[0.6.6]` 6/10.
- post-227-status SNAPSHOT header still names 0.5.6 as 活切点.
- GOAL.md “待” leftover: only 待办 in Obsidian P3 (not the historical T1 待). T1 已记分 is consistent. G19 PTY 非目标 is the real GOAL lie (M2).
- 0.5.3 as current: living docs mostly mark post-227 as SNAPSHOT. Not sold as current except via search on that file’s stale 活切点 line.

---

## Must-inspect checklist (this pass)

| Item | Result |
|------|--------|
| 1. README / PRODUCT / CLAUDE / AGENTS / GOAL / docs/README vs 0.6.6 | **Mismatch.** AGENTS 0.6.6; others 0.6.0. Extension lockfile 0.6.3 |
| 2. CHANGELOG Unreleased in tree? 0.6.6 overclaim #423? | Unreleased **is** in tree. **0.6.6 does not overclaim** 6/10 vs ≥0.85 |
| 3. enterprise-pilot / architecture / 0.7.0 plan as shipped? | Pilot+plan **honest**. Nav + Unreleased-on-main **look shipped** |
| 4. CU still Qwen3-VL experimental? #363? | **Yes experimental.** #363 blocked 6/10 |
| 5. Knowledge graph “AI 整理” vs graph intelligence | LLM grouping overlay; TF retrieval unchanged |
| 6. Summoner command palette P0–P3 vs docs | CHANGELOG claims complete; user guide 360 card; HTML overlay missing search/`ui.command` |
| 7. Embedded terminal vs Zed | Headline overclaim; P0 darwin naked shell |
| 8. Outbound not default-on vs `require_grant` | **Aligned** (default true) |
| 9. Voice Hex / SAPI / embedding flags vs user guide | Code present; Hex/SAPI under-documented; embedding still experimental |
| 10. Dead: risk-engine, privilege-manager, 0.5.3-as-current, TinyClick | Engines deleted (good). Root audits + TESTING.md TinyClick still live-looking. 0.5.3 SNAPSHOT mostly labeled |

---

## Open questions

1. Is HTML overlay (`summoner-web` HTTP dispatch) **intentionally** without `thread.search` / `ui.command`, with P1–P3 only on tray WS? If yes, CHANGELOG 0.6.5 “召唤器” is Mac-tray-centric and Win/Linux docs need that split.
2. Was `OVERLAY_WINDOW_SIZE` 1040×760 introduced in Unreleased #469/#477 without updating the named-constant docs on purpose (docs freeze until 0.7.0)? Still a front-door lie today.
3. Are GitHub #258/#259/#260 closed? Living remaining-work lists still treat them as open; code exists. Need issue state (not fetched this pass).
4. Who consumes `KNOWLEDGE_GRAPH_TOO_FEW_COPY` after MIN_DOCS=1? Tests still pin the 20-篇 string — either dead copy or a second gate.
5. chrome-extension `package-lock.json` `0.6.3`: lockfile drift or a real unpackaged 0.6.3 extension artifact?

---

## Lane D marker

`/blocked: 3×BLOCK + 7×MAJOR/` — not push-ready as living documentation.

**Do not** tell a new user to “just follow README.” Until B1–B3 are fixed, README/PRODUCT are a **stale product brochure**.
