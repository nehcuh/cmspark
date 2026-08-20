# Lane B (UI copy / 导出文案 Markdown 化) — independent adversary

**Date**: 2026-08-20
**Reviewer**: Lane B (uicopy)（未参与实现会话；不信任 PR 描述，全部结论来自活码 + 亲自执行）
**Repo**: `C:/Users/HuChen/Projects/cmspark`
**Range**: `2b97cfa..2576b53`（PR #206，HEAD = 2576b53，工作区干净）
**Frozen patch**: `docs/audit/reviews/head-2576b53-acp-discover-diff-20260820-211701.patch`
**Scope**: `chrome-extension/src/sidepanel/` 本 range 全部变更（coding-handoff/copy.ts、task-package.ts、components/ChatView.tsx、CodingHandoffSettingsSection.tsx、SettingsSlideout.tsx、StatusRail.tsx、ThreadList.tsx、hooks/useWebSocket.ts、store/agentStore.tsx）+ `docs/coding-handoff-user-guide.md` + `memory/session.md`（仅确认无代码语义）。ACP/discover 侧归 lane-a，本报告不评分；folder-picker.ts 仅做命名/行为自洽评估。

## Patch freshness

[executed] `git diff 2b97cfa..2576b53 | diff - docs/audit/reviews/head-2576b53-acp-discover-diff-20260820-211701.patch` → **无输出，字节一致**（退出码 0）。补丁不陈旧。

Range 统计 [executed] `git diff --stat`：21 文件 +273/−55。其中本 lane 范围 11 文件（chrome-extension 9 + docs 1 + memory 1），全部为小行数 hunk。

## Capability declaration (verified, not trusted)

| Axis | Claimed | Lane B |
|------|---------|--------|
| Surface | 无新 Surface | **Hold**。本 lane 范围 diff 全为字符串字面量/注释/对话框标题；无新 LLM fetch、无新工具、无新 WS 消息类型。 |
| L2-classes | 无新增 | **Hold**。无工具/L2 相关改动。 |
| Compose | 无 | **Hold**。 |
| Autonomy | single | **Hold**。 |
| Trust | monotonic（纯文案，不动门控） | **Hold**。逐 hunk 核对 [inspected]：无任何确认门、白名单、auto-approve、导出管线逻辑被触碰。folder-picker.ts（lane-a 范围，顺带评估）新增 `$d.Description` 用的是编译期常量且 `'`→`''` 转义，无注入面。 |
| Channel | community | Assumed（沿用声明，未重新推导）。 |

## Method

1. [executed] 补丁一致性校验（见上）。
2. [inspected] 逐 hunk 读 `git diff 2b97cfa..2576b53 -- chrome-extension/ docs/coding-handoff-user-guide.md memory/session.md` 全部内容。
3. [inspected] 全仓库 Grep `Obsidian`（chrome-extension/src + companion/src）与 `导出.*Obsidian|Obsidian.*export`（i，排除 node_modules），逐条分类用户可见性。
4. [inspected] 读活码：`companion/src/threads/markdown-export.ts` 全文、`message-router.ts:2020-2129`（export handler）与 `:3300-3325`（refresh_profile）、`config.ts` deepMerge 默认值、`useWebSocket.ts` error 分支（:1778-1854）、`folder-picker.ts` 全文、`task-package.ts` 全文、三个导出入口的 `include_reasoning` 接线。
5. [executed] chrome-extension 全量 `npm test`（wipe + tsc + node --test）与 copy/coding-handoff 定向子集。

---

## Claims

### C1. 「会话导出」用户可见文案已从 Obsidian 改为 Markdown，且无残留

**核心声称**（PR 标题 + memory/session.md）：导出对话的用户文案去掉 Obsidian 品牌，实际就是 Markdown 下载。

**diff 内改动** [inspected]，全部为字符串/注释，逐 hunk 核对无行为变更：

- `ChatView.tsx`：注释 + 按钮 `title`/`aria-label`「导出此条到 Obsidian」→「导出此条为 Markdown」。
- `StatusRail.tsx`：菜单文本「导出线程 (Obsidian)」→「导出为 Markdown」。
- `ThreadList.tsx`：🧠 按钮 `title`「导出此线程摘要到 Obsidian」→「导出此线程摘要为 Markdown」。
- `SettingsSlideout.tsx`（12 行）：复选框「导出到 Obsidian 时包含思考过程」→「导出 Markdown 时包含思考过程」；`{/* --- Obsidian Export --- */}` 注释 → Markdown export；「Vault 路径」→「笔记库路径（可选）」；placeholder `/path/to/your/vault`→`/path/to/your/notes`；helpText 重写（明确「对话导出为 Markdown 文件下载，不写进该文件夹」，并如实披露 frontmatter/[[wikilinks]]/模板套用）；「刷新 vault 档案」→「刷新笔记库档案」。
- `useWebSocket.ts`：profile_ready 成功/失败状态文案「Vault 档案」→「笔记库档案」（仅 2 条字符串，dispatch 形状不变）。
- `agentStore.tsx`：1 行注释（`exportIncludeReasoning` 的 docstring）。
- `copy.ts`：编程接力面板 4 条字符串（blurb/toast/发现列表/错误提示，补 grok/kimi/opencode 品牌）。
- `task-package.ts`：1 行注释。
- `docs/coding-handoff-user-guide.md`：1 行（助手名单）。`memory/session.md`：纯会话笔记，无代码语义 ✓。

**全仓残留核查** [inspected]（chrome-extension/src + companion/src，逐条判定用户可见性）：

| 位置 | 内容 | 用户可见？ | 判定 |
|------|------|-----------|------|
| `ThreadList.tsx:1398` | 关联图 tooltip「（类 Obsidian）」 | 是 | **有意保留**（session.md 明示），描述的是 thread-graph 而非导出，不算导出残留 |
| `KnowledgeSubPanel.tsx:393` | 导入提示「支持 Obsidian / iCloud vault」 | 是 | **有意保留**（session.md 明示），是知识库导入功能且描述属实 |
| `background/index.ts:1160-1162`、`ChatView.tsx:332`、`StatusRail.tsx:330/355`、`ThreadList.tsx:976`、`useWebSocket.ts:1626/1642` | WS 消息类型 `thread.export_obsidian` / `thread.exported_obsidian` / `obsidian.*` | 否（协议标识符） | 改名=协议变更，有意不改，合理 |
| `types.ts:253`、`normalize-config.ts:91-93`、`agentStore.tsx:162`、`SettingsSlideout.tsx:3009-3039` | state 字段 `obsidian_vault_path` / `vaultPicker` 等 | 否（内部命名） | 合理 |
| `companion/src/message-router.ts:2049` | 错误串 `"obsidian export not configured"` | **是**（经 useWebSocket error 通用分支 → 聊天 ❌ 消息） | **残留**，见 P2-B1 |
| `companion/src/message-router.ts:3324` | 错误串 `vault 分析失败: …` | **是**（同上路径） | **残留**，见 P2-B2 |
| `companion/src/message-router.ts:2024`、`markdown-export.ts:1/26/146/392`、`obsidian/*.ts` 头注释、`config.ts:13/299` | 注释与类型名 `ObsidianExportConfig` 等 | 否 | 内部命名，见 P2-B4 |
| `docs/`（ADR-008、architecture.md、README.md、CLAUDE.md、GOAL.md 等） | 特性名「Obsidian 导出」 | 仓库文档 | 不在本 PR 声称范围，见 P2-B5 |

**Verdict on claim: HOLD**（UI 导出文案无「导出到 Obsidian」残留；2 条 companion 错误串残留为 P2 nit，不阻断）。

### C2. diff 中每个文件均为纯文案，无夹带行为变更

[inspected] 逐 hunk 核对本 lane 范围全部 11 文件的 diff：所有 `+`/`-` 行均为字符串字面量、JSX 文本、`title`/`aria-label`/`placeholder` 属性值或注释。重点复核：

- `SettingsSlideout.tsx`（12 行，行数最多）：改动全部在 label 文本/helpText/placeholder/按钮文本/块注释；`config.obsidian_vault_path` 读写、`obsidian.refresh_profile` 发送逻辑、状态渲染条件均未动。
- `useWebSocket.ts`：仅 `SET_OBSIDIAN_PROFILE_STATUS` 两条 message 字符串；dispatch type、字段、条件分支未动。
- `agentStore.tsx`：单行 docstring。
- 无任何 if/条件/函数签名/消息类型变更。**Verdict: HOLD。**

### C3. 导出模板实际产出是否纯 Markdown

- **编程接力任务包**（`copy.ts`/`task-package.ts`，本 lane 直接范围）[inspected]：模板为 `#` 标题、`>` 引用、``` 围栏、列表、`*` 强调——**纯 Markdown**，无 wiki-link、无 callout 语法。✓
- **会话导出本体**（`companion/src/threads/markdown-export.ts`，供参照）：frontmatter 为标准 YAML；正文为加粗+分隔线；reasoning 用 `<details>` HTML——均为通用 Markdown。**但**：工具调用块无条件渲染为 Obsidian callout（`renderToolEntry` :366 `> [!info]- …`、`renderToolWarning` :389 `> [!warning] …`），摘要附录无条件 `> [!note]- 完整对话`（:179）；`[[wikilinks]]` footer 仅在配置了笔记库且有索引时出现（:521-528，且尊重「几乎不用 wikilink」的档案习惯）。callout 在非 Obsidian 渲染器退化为普通引用块（可见字面 `[!info]-`），文件仍是合法 .md。新 helpText 已如实披露 wikilinks/模板行为。结论：导出「是 Markdown 下载」属实，但**并非 100% 通用 Markdown**（含 Obsidian 风味 callout，无条件）。见 P2-B3。

### C4. 测试 [executed]

- chrome-extension 全量：`npm test`（wipe .test-dist → `tsc -p tsconfig.test.json` → `node --test .test-dist/tests/*.test.js`）→ **771 pass / 0 fail**（duration ~9.4s）。
- 定向子集：`node --test .test-dist/tests/coding-handoff-task-package.test.js coding-handoff-repo-context.test.js coding-handoff-progress-tail.test.js gate-error-copy.test.js empty-state-copy.test.js` → **18 pass / 0 fail**。
- 无任何测试断言旧 Obsidian 导出文案（全量绿即证）。

### C5. folder-picker 命名与行为自洽性（仅评估，未改码）

[inspected] `companion/src/obsidian/folder-picker.ts` 全文：功能是「用 OS 原生对话框选一个文件夹，路径写回 `config.obsidian.vault_path`，供导出时抽取 frontmatter/命名/tag 约定 + 建索引 + 检模板」。下游（vault-profiler 的 LLM prompt、wikilink 页脚、模板骨架、callout）**本质上就是 Obsidian 风味**的约定抽取——所以 `obsidian/` 目录名、`obsidian.vault_path` 配置键保持 Obsidian 命名与行为**自洽**（不是过时命名）。本 range 把三平台对话框标题改为「选择 Markdown 笔记文件夹」（编译期常量，Windows 侧 `'`→`''` 转义正确），属诚实文案：选的是「笔记文件夹」而非必须是 Obsidian vault。文件头注释仍写 "selecting the Obsidian vault path"——内部注释，轻微陈旧但与典型用途相符。session.md 明示 WS 协议名/目录名有意不改，与实际一致。**自洽，无需动作。**

---

## Hostile questions

### Q1. 还有没有用户可见文案声称「导出到 Obsidian」？

chrome-extension/src：**无**（`导出.*Obsidian|Obsidian.*导出` 在 src 下零命中；余下两处 Obsidian 字样的用户可见文案分别是关联图「类 Obsidian」与知识库导入「支持 Obsidian vault」，均非导出声称且为有意保留）。companion/src：2 条错误串残留（P2-B1/B2），其中 2049 实际不可达（`config.ts:495` 默认配置含 `obsidian` 块，`loadConfigFile` :603 用 `deepMerge(defaultConfig, parsed)` 兜底；只有用户手编 config.json 置 `"obsidian": null` 才会触发）。

### Q2. SettingsSlideout/useWebSocket/agentStore 的 12/4/2 行改动是否真纯文案？

是 [inspected]。逐 hunk 见 C2。无 dispatch 形状、无状态字段、无事件接线变化。

### Q3. 新错误文案「请在 设置 → 导出与集成 填写」与实际设置区名是否一致？

一致 [inspected]：`SettingsSlideout.tsx:3000` 设置区 `title="导出与集成"`，companion 新错误串指向正确。

### Q4. 「导出 Markdown 时包含思考过程」复选框是否在三个导出入口都生效（文案是否过度承诺）？

生效 [inspected]：`ChatView.tsx:338`（single）、`StatusRail.tsx:334`（thread）、`StatusRail.tsx:358`（summary）、`ThreadList.tsx:980`（summary）均传 `include_reasoning: state.exportIncludeReasoning === true`。（2026-08-07 wave-d 评审记录的「仅 1/3 入口接线」已被后续 Wave E 修复，非本 range 改动。）复选框文案无过度承诺。✓

### Q5. Trust 单调性：有无新 auto-approve / 白名单写 / 确认跳过？

本 lane 范围：无 [inspected]。diff 内不触碰任何安全门控、配置语义或协议。folder-picker 新 `$d.Description` 为常量字符串，转义正确，无注入面。

### Q6. memory/session.md 声明的「未改」清单是否属实？

属实 [inspected]：WS `thread.export_obsidian`、关联图「类 Obsidian」、知识库导入文案三处均确认未改且存在。其「落地：companion 错误提示」一句不完全——改了 2 条，漏了 2 条（P2-B1/B2）。

---

## Findings

| ID | Severity | 摘要 | 证据 |
|----|----------|------|------|
| P2-B1 | P2 | `message-router.ts:2049` 错误串 `"obsidian export not configured"` 残留英文+Obsidian 品牌；经 error 通用分支会以 ❌ 聊天消息触达用户；但默认配置 deepMerge 兜底使其几乎不可达（需手编 `"obsidian": null`） | [inspected] + [inspected] config.ts:495/603 |
| P2-B2 | P2 | `message-router.ts:3324` `vault 分析失败: …` 仍用「vault」旧术语，用户刷新笔记库档案失败时会在聊天里看到，与新「笔记库」文案不一致；session.md 声称 companion 错误提示已落地 | [inspected] useWebSocket.ts:1830-1853 error→聊天路径 |
| P2-B3 | P2 | 会话导出的 .md **无条件**内嵌 Obsidian callout 语法（工具块 `[!info]-`/`[!warning]`、摘要附录 `[!note]-`），配置笔记库时另有 `[[wikilinks]]` 页脚；按钮文案「导出为 Markdown」属实但不等于通用 Markdown（其他渲染器退化为引用块+字面 `[!info]-`）。helpText 已披露 wikilinks/模板，可接受 | [inspected] markdown-export.ts:179/366/389/521-528 |
| P2-B4 | P2(nit) | 内部命名整体保持 Obsidian 品牌（`companion/src/obsidian/`、`config.obsidian.vault_path`、WS `obsidian.*`、`ObsidianExportConfig`）；鉴于下游功能确为 Obsidian 风味约定抽取，命名与行为自洽，仅记录 | [inspected] |
| P2-B5 | P2(nit) | 仓库文档（README.md:42/417、CLAUDE.md:27/69/90、docs/GOAL.md、ADR-008 等）仍以「Obsidian 导出」为特性名；不在本 PR 声称范围（仅 UI 文案），若后续要彻底去品牌化需文档跟进 | [inspected] grep |

P0 = 0，P1 = 0，P2 = 5（均不阻断）。

---

## Targeted tests [executed]

```
# chrome-extension（本 lane 独占目录，允许全量）
npm test            # wipe + tsc + node --test .test-dist/tests/*.test.js
# → tests 771, pass 771, fail 0

node --test .test-dist/tests/coding-handoff-task-package.test.js \
  .test-dist/tests/coding-handoff-repo-context.test.js \
  .test-dist/tests/coding-handoff-progress-tail.test.js \
  .test-dist/tests/gate-error-copy.test.js \
  .test-dist/tests/empty-state-copy.test.js
# → tests 18, pass 18, fail 0
```

未运行 companion 测试（companion 侧归 lane-a；本 lane 对 companion 只做只读检查）。

## Claim scoreboard

| ID | Result | Evidence |
|----|--------|----------|
| C1 UI 导出文案 Markdown 化、无「导出到 Obsidian」残留 | HOLD（2 条 companion 错误串 P2 残留） | [inspected] 全仓 grep |
| C2 diff 逐 hunk 纯文案 | HOLD | [inspected] |
| C3 任务包纯 Markdown / 会话导出含 Obsidian callout | HOLD（callout 见 P2-B3） | [inspected] |
| C4 测试 | 771+18 pass / 0 fail | [executed] |
| C5 folder-picker 命名自洽 | HOLD | [inspected] |
| Q4 include_reasoning 三入口接线 | HOLD（文案不过度承诺） | [inspected] |
| Trust monotonic（本 lane） | HOLD | [inspected] |
| session.md 未改清单 | HOLD（「companion 错误提示已落地」不完全） | [inspected] |

无 P0/P1 阻断项。

VERDICT: APPROVE_WITH_NITS
