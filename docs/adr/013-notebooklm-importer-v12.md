# ADR-013: NotebookLM 导入器 v1.2（多 pathway + notebook 创建 + CDP PoC）

**日期**: 2026-07-15 | **状态**: 已确认（worktree `notebooklm-import` v1.2 commit，待 PR）

## 背景

v1.1（[ADR-012](012-notebooklm-importer-online.md)）交付了 P0：在线批量 URL 导入 + notebook 选择。用户在 review 后明确要求"全部实现"，因此 v1.2 完成所有 P1+P2 功能：AI 对话、notebook 创建、page links、RSS/OPML、YouTube playlist、selector CI、CDP Fetch 拦截 PoC。

## 决策

### 1. UI 走 tab 化（不是多按钮）

5 个 tab：URLs（v1.1）/ 页面链接 / RSS / YouTube / AI 对话。统一通过 `collectItems()` 把每个 tab 的选中项归一化为 `ImportItem[]` 喂给 v1.1 的 batch orchestrator。

理由：避免侧栏爆炸式增加按钮；批量底层已稳，新功能只是 input pathway。

### 2. Notebook 创建走 DOM automation（不走 batchexecute write RPC）

考虑：
- A. 反向工程 `boVbkv` 私有 RPC（jetpack/Web Importer 都没做，未验证）
- B. DOM automation：home 页点 "New notebook" → 填名字 → submit → 读 URL `/notebook/<id>`

选 B。理由：
- ToS 风险低（DOM 自动化 = 用户手动操作的快速版）
- 不引入私有 RPC 写入路径（list 用 `wXbhsf` 只读已经够边缘了）
- DOM 自动化的失败模式可控（用户看到对话框）；RPC 失败可能默默写入错乱数据

### 3. AI 对话抽取：三站点专用 + Markdown 输出

`extractAiChatRunner` 注入到当前 tab，自检 hostname 决定 platform：
- **Claude**: `[data-testid="user-message"]` + `[data-testid="ai-message"]`（新）→ `[class*='conversation-turn-']`（旧）
- **ChatGPT**: `[data-message-author-role="user"|"assistant"]`（新）→ `[data-testid^="conversation-turn-"]`（旧）
- **Gemini**: `<user-query>` + `<model-response>` 自定义元素

输出 Markdown：标题 + 元数据 + 每个 turn 标 `🧑 User` / `🤖 Assistant`。直接喂给 v1.1 的 text-import 管线。

### 4. Page link extractor：分类 + 默认勾选

抽取所有 `<a href>`，按 URL 后缀 + hostname 分类：
- `internal`（同域）/ `external`（跨域）/ `document`（pdf/docx/xlsx）/ `media`（mp3/mp4）
- 默认勾选 internal+external+document，**不勾 media**（NotebookLM 多数不支持音频/视频 URL）
- 去重 + 跳过 `javascript:` / `#fragment`

### 5. RSS/OPML：服务端 fetch + 客户端解析

支持 RSS 2.0 / RSS 1.0 / Atom；OPML 用于批量订阅合并。所有 fetch 走 `safeFetch`：timeout 15s，无 credentials，redirect 跟随，size cap。

feed 发现：自动尝试 `/feed` `/rss` `/atom.xml` 等常见路径 + `<link rel="alternate" type="application/rss+xml">`。

### 6. YouTube playlist：用户自带 API key

用 YouTube Data API v3。需要用户提供 API key（存储在 `chrome.storage.local`，明文）。

- 分页获取（50/页，循环到 `nextPageToken` 为空）
- 二次 enrichment：批量调 `videos?part=contentDetails` 拿 duration（ISO 8601 → 秒）
- 自动跳过 deleted/private videos
- 默认过滤 shorts（<90s）

**API key 存储安全**：chrome.storage.local 未加密，但对扩展内访问限制（其他扩展拿不到）。接受为 v1.2 风险；v1.3 可考虑 `chrome.storage.sync` 加密或 OAuth。

### 7. Selector CI canary：puppeteer-core + 登录态 profile

`scripts/check-selectors.mjs` 跑在 CI，验证所有 selector registry 至少有一个 CSS 在 `notebooklm.google.com` 命中。需要：
- `CHROME_PATH` 指向 Chrome 二进制
- `NOTEBOOKLM_PROFILE` 指向已登录 NotebookLM 的 Chrome user-data-dir

无 puppeteer-core 时 fallback 到「列出所有 selectors 供人工 review」并 exit 0。

### 8. CDP Fetch 拦截：PoC，默认关

`cdp-fetch-interceptor.ts` 用 `chrome.debugger.attach` + `Fetch.enable` 在 CDP 层拦截 NotebookLM 的 batchexecute AddSource 请求。market unique：jetpack/Web Importer 都是 content-script 注入 wrapper，能被 SPA re-unwrap；CDP 层拦截绕不过。

PoC 状态：未在 UI 暴露。需要：
1. 验证捕获到的 body shape 能正确 URL-substitute 重放
2. CSRF 旋转时的失效检测
3. 黄色 debugger banner UX 评估

v1.3 再决定是否接入。

## 安全考量

| 风险 | 缓解 |
|---|---|
| createNotebook 写错 notebook | 显式导航到 home → dialog → submit → 读 URL 验证 |
| AI 对话抽取泄漏用户私密对话 | 抽取结果只走 BG → batch orchestrator → DOM 注入 NotebookLM；不发给 Companion / LLM；不上报 |
| RSS/OPML SSRF | safeFetch: `credentials: "omit"`、timeout、redirect 跟随但有上限 |
| YouTube API key 泄漏 | `chrome.storage.local`，扩展内可见；不入日志；UI password-type 输入 |
| CDP Fetch PoC 调试器泄漏 | PoC 不接入 UI；attach 生命周期管理（detachIfAttached）；tab 关闭自动 detach |
| Selector CI 跑在 CI 需登录 profile | 文档化 `NOTEBOOKLM_PROFILE` env var；未配置时 fallback 到 list-only |

## 已知限制

- AI 抽取对 Shadow DOM / SPA lazy-load 不完美；用户可在 UI 里编辑后再导入
- createNotebook 在 NotebookLM 改 UI 后会断；selector CI canary 是早期信号
- CDP Fetch PoC 没真测；接入前要验
- YouTube quota 用完后 UI 报错即可（不自动降级）

## 测试

- 119/119 chrome-extension 单测通过（v1.0=93 + v1.1=11 + v1.2=15）
- Plasmo build 绿；TS strict 无错
- companion 未触动，912/912 零回归
- 没有 e2e（jsdom 缺失，所有 runner 是 toString 结构性测试）

## 后果

✅ **正面**：
- 5 个 pathway 覆盖市面所有现成方案
- Notebook 创建闭环（不依赖用户预先手动建）
- Selector CI 防漂移
- CDP PoC 留给未来加速

⚠️ **权衡**：
- UI 复杂度↑（5 tabs + create 按钮）
- YouTube 依赖用户 API key（虽然 Web Importer 也这样）
- CDP PoC 是死代码（v1.3 接入前）

🔗 **关联**：
- [ADR-011](011-notebooklm-import.md) — v1 离线 MD 下载
- [ADR-012](012-notebooklm-importer-online.md) — v1.1 在线批量导入
