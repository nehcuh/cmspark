# ADR-012: NotebookLM 在线批量导入（v1.1）

**日期**: 2026-07-15 | **状态**: 已确认（worktree `notebooklm-import` v1.1 commit，待 PR）

## 背景

[ADR-011](011-notebooklm-import.md) 的 v1 仅做了离线 Markdown 下载（用户手动拖入 NotebookLM）。市场对比发现这远落后于 jetpack 和 Web Importer，二者已实现真 1-click 在线批量导入。

研究两个开源项目源码后的关键发现（详见 `docs/decisions/v1.1/research-phase0.txt`）：

1. **Web Importer 的 fetch interception 是死代码**：`replayRequest` 零调用点，产线全部走 DOM automation
2. **list notebooks via `batchexecute` RPC `wXbhsf` 工作**：CSRF `SNlM0e` 从首页 HTML 提取
3. **两个扩展都不创建 notebook**：`boVbkv` create RPC 仅在 `notebooklm-py` 提到，未经验证
4. **认证简化**：仅需 `host_permissions: notebooklm.google.com/*` + 用户已登录，`credentials: 'include'` 自动带 cookie

## 三方决策过程（Round 1）

| 问题 | Claude | Kimi | Pi-sub | 决议 |
|---|---|---|---|---|
| 导入机制 | DOM primary, CDP v1.2 | DOM only | DOM only | **纯 DOM automation** |
| Notebook 管理 | list only | list only | list only | **list via wXbhsf，跳过 create** |
| Selector drift | MutationObserver self-heal | 同 | 同 | **运行时自愈，CI canary v1.2** |
| AI 对话抽取 | generic 复用 v1 | generic | generic | **复用 v1 extractor，per-site v1.2** |
| MD 离线按钮 | 独立按钮 | 同 | 同 | **📓 在线 + 💾 离线** |
| 范围切分 | P0 ship / P1+P2 defer | P0 ship / P1=notebook picker only | P0 ship / P1 time-permitting | **P0 ship + P1 = picker only（Kimi 保守版胜）** |

详见 `docs/decisions/v1.1/round1-synthesis.md`。

## 决策

### 1. 纯 DOM automation 路径（不抄 Web Importer 的 fetch interception）

```
[Side panel 📓 → Importer overlay]
    │ 用户粘 URL 列表 / +当前 tab / +所有 tab
    │ chrome.runtime.sendMessage({type:"notebooklm.start_batch", items, notebook_id})
    ▼
[Background orchestrator]
    │ ensureNotebookLmTab(notebook_id) → 打开/复用 NotebookLM tab
    │ 循环 items：
    │   chrome.scripting.executeScript({func: importUrlRunner, args:[url, selectors]})
    │   runner 在页面里：开 Add Source dialog → 切到 Website → 填 URL → 等 Angular → click Insert
    │   每 item 后 chrome.storage.local.set（MV3 SW 可能被 kill）
    │   random delay 500-1500ms + retries 2 次
    ▼
[chrome.runtime.sendMessage → side panel]
    │ 更新进度条 + per-item 状态
```

### 2. Angular-aware waiter（Pi-sub Round 1 强约束）

NotebookLM 用 Angular Material + zone.js。固定 setTimeout 会 ~30% flake on batches >10：

- **MutationObserver quiescence**：80ms 无 mutation 视为稳定
- **requestAnimationFrame × 2**：等两次渲染机会（Chrome 一次完整 commit）
- **Angular 状态断言**：点 submit 前断言 `!hasAttribute("disabled")` && `aria-disabled != "true"` && `!classList.contains("mat-mdc-button-disabled")` && `pointerEvents != "none"`
- **Native value setter**：填 textarea 时绕过 Angular 受控组件——`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, value)` + dispatch input/change events

### 3. CSRF (SNlM0e) 缓存与失效

- 首次调用从 `https://notebooklm.google.com/` HTML 正则提取 `"SNlM0e":"<token>"`
- 缓存 30 分钟 + 内存（重启 SW 时重提取）
- 检测失效：HTTP 401/403 或 0-notebook response → 清缓存重试

### 4. Selector 注册表（多策略）

每个 NotebookLM DOM 触点都有 ≥2 个 fallback：
- CSS 选择器优先（class → attribute）
- 兜底：textContent / ariaLabel / role（按文本/属性/AIRA 角色扫描所有元素）

关键 selector（从 jetpack/Web Importer 实证）：
- `.add-source-button`、`mat-dialog-container`、`.urls-input-container textarea`、`.copied-text-input-textarea`、`.drop-zone-icon-button`（按 icon 文本分流）、`.single-source-container`

### 5. MV3 SW 生命周期

orchestrator 不依赖闭包跨 await。每 item 后写 `chrome.storage.local`。SW 重启时 `resumeIfPending()` 从 storage 读 batch state，从 `nextIndex` 继续。

### 6. UI 分离

- **📓 按钮**：打开 NotebookLM Importer overlay（在线批量）
- **💾 按钮**：v1 离线 MD 下载（保留）
- **不自动 fallback**：用户意图明确（在线 vs 离线），不要静默切换

### 7. 批量限制与节流

- 单批最多 50 个源（用户确认后截断）
- 每 item 间随机延迟 500-1500ms（防账号风控）
- 失败重试 2 次，指数退避（2s → 4s → 8s 上限）

## 安全考量

| 风险 | 缓解 |
|---|---|
| Google 账号被风控（连续自动添加） | 50 上限 + 随机延迟 + 用户主动触发（非 LLM tool） |
| NotebookLM UI selector 漂移 | 多策略 fallback；运行时 MutationObserver 自愈；失败 item 错误透出 |
| CSRF token 失效 | 自动重提取；0-notebook response 触发重试 |
| 私有 RPC（batchexecute）ToS | 只用只读 list（`wXbhsf`），不做 create；与 jetpack 同等风险面 |
| Cookie/凭证泄漏 | runner 在 NotebookLM tab 内运行，从不读取/序列化 cookie |
| UI XSS（notebook title） | React 默认转义；dropdown option 文本不会执行 |

## 测试覆盖

- 104/104 chrome-extension 测试通过（v1 的 93 + v1.1 的 11）
- v1.1 测试包括：selector 注册表完整性、runner 源代码自包含性、Angular waiter 关键 API（MutationObserver / rAF / native setter）存在性、防御性 JSON.parse、空文本拒绝
- 没有 jsdom runtime 测试（v1.2 引入）；运行时 DOM 行为靠手工 + Phase 5 reviewer 验证

## 已知限制

- 不创建 notebook（v1.2 候选；需要 RE `boVbkv` 或 DOM automation 点击「New notebook」）
- 不做 AI 对话页抽取（v1.2 候选；Claude/ChatGPT/Gemini DOM 各异）
- 不做 page-link extractor / RSS / YouTube（v1.2）
- 没有 selector CI canary（v1.2 dev-infra）
- NotebookLM selector 改版会破坏导入；UI 失败 item 显示错误供用户上报

## 延后到 v1.2

- Notebook 创建（`batchexecute` write RPC `boVbkv`，需 RE + ToS 评估）
- CDP `Fetch` 拦截作为可选加速器（研究 PoC）
- AI 对话抽取（per-site scraper + Companion LLM 后处理）
- Page link extractor / RSS / OPML / YouTube playlist
- Selector CI canary（`scripts/check-selectors.mjs` 风格）

## 后果

✅ **正面**：
- 一键批量导入到 NotebookLM，超越 jetpack 和 Web Importer 的核心能力
- MV3 SW 持久化保证大批量不丢
- Angular-aware waiter 防止 >10 条批量时的 flake
- 保留 v1 离线 MD 路径（隐私 / 离线 / NotebookLM 不可达时的兜底）

⚠️ **权衡**：
- DOM automation 速度 ~1.5s/source（fetch interception 本可 ~500ms，但 Web Importer 自己都没用）
- 依赖 NotebookLM UI 不大改；改了需要更新 selector
- 用户必须先登录 NotebookLM（所有竞品都这样）

🔗 **关联**：
- [ADR-011](011-notebooklm-import.md) — v1 离线 MD 下载
- [ADR-008](008-obsidian-export.md) — Obsidian 对话导出（同一 Blob 下载家族）
- `docs/decisions/v1.1/` — Round 1 三方决策留痕 + Phase 0 reverse-engineering 研究
