# ADR-011: NotebookLM 网页导入（v1, Markdown 下载）

**日期**: 2026-07-14 | **状态**: 已确认（worktree `notebooklm-import`，待 PR）

## 背景

用户希望把当前浏览的网页内容导入 Google NotebookLM 作为来源。NotebookLM 没有公开 API，只能通过：(a) 粘 URL（很多站点失败），(b) 上传文件（PDF/txt/md，每 notebook 50 个上限），(c) 粘文本，(d) 链 YouTube/Google Docs。

参考开源项目 [notebooklm-jetpack](https://github.com/crazynomad/notebooklm-jetpack)（MIT, WXT+React）走的是「清洗内容→生成 PDF→用户手动拖入」路径，**不实际驱动 NotebookLM UI**。

CMspark 现有能力给到独特杠杆：
- CDP 控制 Chrome（`chrome.debugger`，`browser-bridge.ts`）
- `DOM.setFileInputFiles` 已用于 `uploadFile` 工具（`browser-bridge.ts:907`）— 理论上可程序化上传到 NotebookLM
- 已有侧栏按钮 → BG → WS → Companion → Blob 下载模式（[ADR-008](008-obsidian-export.md)）
- `page-sanitizer` 反注入净化、`page-sanitizer.ts` / `dangerous-apis.ts` 安全护栏

## 三方决策过程

每个关键决策都经 **Claude（主）+ Kimi（`kimi` CLI）+ Pi-sub（`claude` CLI 顶替，系统无 `pi`）** 三方共识。

### Round 1 — 设计（范围 / 架构 / 抽取层 / PDF 策略）

| 问题 | Claude | Kimi | Pi-sub | 决议 |
|---|---|---|---|---|
| v1 范围 | A | A | A | **A**（仅下载，B 自动上传延后 v1.1 opt-in） |
| 抽取层 | 扩展+CDP hybrid | 同 | 同 | **Hybrid**（扩展 CDP/Runtime 抽取，companion 格式化） |
| PDF vs MD | CDP printToPDF | CDP printToPDF | **MD only** | **MD only**（Pi-sub 反对 PDF：cookie/auth bleed + 站点打印 CSS 烂；Kimi 默认 MD 兜底，事实上让步） |
| LLM tool | 不暴露 | 不暴露 | 不暴露 | v1 不做 tool |
| 入口面 | 侧栏+右键 | — | 仅侧栏 | **仅侧栏按钮** |
| 自动上传安全确认 | 是 | 是 | 是 | 必须（v1 moot） |

详见 `docs/decisions/notebooklm-import-round1-synthesis.md`。

### Round 2 — 实施计划（架构 / DOM 安全 / Readability / 测试）

两位 reviewer 都给 `approve-with-changes`。关键变更：

| # | 原计划 | 终版 |
|---|---|---|
| 架构 | X（扩展抽取 → companion 格式化） | **Z（扩展自包含）** — A1 不约束纯字符串格式化，省一个 WS 往返，减 MV3 SW 生命周期面 |
| 抽取 API | CDP `Runtime.evaluate` | **`chrome.scripting.executeScript`** — 无 debugger 横幅、无 attach/detach 复杂度 |
| DOM 安全 | IIFE `remove()` 净化 | **必须 `cloneNode(true)` 再净化**（Pi-sub 抓到：原写法破坏 live DOM） |
| Readability | 不用 | **延后 v1.1** — 需 content-script bundling；v1 选择器列表 + body 兜底 |
| 截断可见性 | 静默 200k | **UI banner** |
| 文件名注入 | 标题派生 | **slugify**：剥离 `/`/`:`/控制字符，CJK 保留 |
| YAML 注入 | 无保护 | **escapeYaml**：双引号 + 反斜杠/双引号转义 + 换行折叠 |
| 测试 | 手动 e2e | 手动 e2e + markdown-builder 单测 + extractor 结构性单测 |

详见 `docs/decisions/notebooklm-import-round2-synthesis.md`。

## 决策

### 1. v1 = 侧栏按钮 → 提取 → Markdown 下载，全在扩展侧

数据流（**不经 companion**，零 WS 往返）：

```
[侧栏 📓 按钮]
   │ chrome.runtime.sendMessage({type:"page.import_notebooklm"})
   ▼
[Background onMessage case "page.import_notebooklm"]
   │ handleNotebooklmExport()
   │   ├─ chrome.tabs.query({active:true, currentWindow:true})
   │   ├─ chrome.scripting.executeScript({func: extractPageContentRunner, args:[...]}])
   │   ├─ buildMarkdown({title, url, text, extractedAt})
   │   └─ sendResponse({ok, content, filename, truncated})
   ▼
[侧栏 Blob 下载 .md]
   ▼
[用户拖入 NotebookLM]
```

理由：Round 2 共识——纯字符串格式化不归属 CLAUDE.md A1「LLM/状态在 companion」的范畴；v1 不涉及 LLM，无需 companion；省 WS 往返 + MV3 SW 生命周期面。v1.1 引入 LLM 摘要时再拆 X。

### 2. 抽取：选择器兜底链 + `cloneNode` 安全净化

`extractPageContentRunner(maxLen, selectorsJSON)`（注入到页面，自包含）：
1. `<title>` + `<link rel=canonical>` + `location.href`
2. 选择器优先级：`article` > `main` > `[role="main"]` > 站点类（`.post`/`.entry-content`/…）> `document.body`
3. **必须 `root.cloneNode(true)` 再净化**（绝不改 live DOM）
4. 净化选择器：`script,style,noscript,nav,aside,footer,header,form,iframe,svg,canvas,[role='navigation'],[aria-hidden='true']`（移除登录态 chips / 导航 / 广告）
5. `innerText` 优先（layout-aware），textContent 兜底（Shadow DOM）
6. 折叠多余空白；截断到 200k chars + tail marker；返回 `{title, url, text, truncated}`

理由：
- **安全**：在 clone 上净化 → 不会破坏用户当前 tab；剥离 nav/header/footer → 不带登录态 chips（cookie/auth bleed，Round 1 风险）
- **健壮**：多档选择器兜底；innerText→textContent 兜底
- **已知弱点**：SPA / Shadow DOM 闭根 / 跨域 iframe / Substack paywall——v1.1 引入 `@mozilla/readability`（Pi-sub 推荐）

### 3. Markdown 模板：frontmatter + H1 + 正文 + NotebookLM 提示

```markdown
---
title: "<escaped>"
source_url: "<escaped>"
extracted_at: <ISO>
extracted_via: CMspark Browser Agent
---

# <flattened title>

> Source: <url>
> Extracted: <ISO>

---

<text>

---

*Exported by CMspark Browser Agent → drag this file into [NotebookLM](https://notebooklm.google.com) as a source.*
```

文件名：`notebooklm-{YYYYMMDD-HHMMSS UTC}-{slug(title)}.md`，slug 限 40 字符，CJK 保留，`/`/`:`/控制字符 → `-`。

### 4. UI 集成：📓 按钮 + 截断 banner

侧栏 header 在 🧠 与 📋 之间新增 📓：
- 点击 → `chrome.runtime.sendMessage({type:"page.import_notebooklm"})` → Promise 响应
- 响应 `{ok, content, filename, truncated}` → Blob 下载 `.md`
- 处理中：⏳；截断：⚠️ + tooltip「已导出（超过 200k 字符，已截断）」6s 后回 📓；失败：⚠️ + error tooltip

### 5. 安全考量（继承 + 新增）

| 风险 | 缓解 |
|---|---|
| Cookie/auth bleed 到导出 | 净化剥离 nav/header/footer/iframe；innerText 不带属性；无 cookie 序列化 |
| 文件名路径注入（标题含 `/`） | `slugify` 剥离 path separators |
| YAML 注入（标题含 `\nmalicious: true`） | `escapeYaml` 双引号 + 转义 + 换行折叠 |
| MV3 service worker 中途被 kill | 单次 `executeScript` round-trip，无长 attach span |
| 抽取到 chrome:// / file:// 页面 | handler 显式校验 URL scheme（仅允许 http(s)） |
| 用户拖入 NotebookLM 的 Google ToS | **v1 不自动上传**，用户手动拖入属正常使用 |

### 6. 测试

- `tests/notebooklm-markdown-builder.test.ts` — 16 个用例：slugify / escapeYaml / flattenTitle / timestampSlug / buildMarkdown 全覆盖（含路径注入、YAML 注入、CJK、空标题）
- `tests/notebooklm-extractor.test.ts` — 7 个结构性用例：选择器顺序、`cloneNode(true)` 安全、`maxLen` 截断、`canonical` 优先、不引用模块作用域
- 端到端 sanity（无法跑浏览器自动化）：用 Node 拉真实文章 HTML → 跑 markdown-builder → 11 项结构断言全过

### 7. 延后到 v1.1+

- 右键菜单（页/链接/选区）
- PDF 生成（需先解决 cookie bleed 到 print pipeline）
- CDP 自动上传 NotebookLM（gated by `SecurityConfirmationManager` + 用户 opt-in + Google ToS 复核）
- LLM tool 暴露（"把这个页面发到 NotebookLM"）
- `@mozilla/readability` 集成（提升抽取质量）
- 「多 tab → 合并 PDF/MD」突破 50 source 上限
- 文档站点批量（sitemap-aware）
- AI 对话页提取（Claude/ChatGPT/Gemini）

## 后果

✅ **正面**：
- 用户能在一秒内把任意 http(s) 页面变成 NotebookLM 来源
- 零新依赖（无 puppeteer/PDFKit/Readability）
- 与现有 Obsidian 导出模式平行，复用 Blob 下载 + frontmatter 风格
- 全扩展侧，不增加 companion 复杂度

⚠️ **权衡**：
- 抽取质量靠选择器列表，前 5 个真实站点可能翻车 → v1.1 接 Readability
- 用户仍需手动拖入 NotebookLM（不做自动上传）→ v1.1 opt-in
- 长页面被截断 → 用户从 banner 知晓；maxLen 可在 v1.2 配置

🔗 **关联**：
- [ADR-008](008-obsidian-export.md) — Obsidian 对话导出（同一 Blob 下载家族）
- [ADR-006](006-layered-defense.md) — 默认拒止安全姿态
- `docs/decisions/notebooklm-import-round1-synthesis.md` / `round2-synthesis.md` — 三方决策留痕
