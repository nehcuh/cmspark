# NotebookLM 导入使用说明

> **面向使用者**：如何从 Side Panel 把网页 / 链接 / 对话等导入 Google NotebookLM。  
> **产品版本**：0.5.0  
> **决策（工程向）**：[ADR-011](adr/011-notebooklm-import.md) · [ADR-012](adr/012-notebooklm-importer-online.md) · [ADR-013](adr/013-notebooklm-importer-v12.md)

### 能力坐标

| 轴 | 本指南位置 |
|----|------------|
| **Surface** | 用户操作多在浏览器上下文；**不**走 Companion LLM tool-loop，也**不是** L2 桌面能力 |
| **Composition** | **否** — 导出/导入类 **产品特性**，不是 Skill/MCP/Pack 装配原语（见 [ADR-020](adr/020-capability-model-three-axes.md) § Composition 边界） |
| **Autonomy** | 不参与 multi-worker / Board |
| **相近能力** | 对话笔记导出见 [ADR-008 Obsidian](adr/008-obsidian-export.md)；图表渲染见 [ADR-009 Mermaid](adr/009-mermaid-rendering.md) |

---

## 1. 一句话

CMspark 提供两条互补路径：

1. **在线批量导入（推荐）**：Side Panel 打开 **NotebookLM 导入器**，把 URL / 链接 / RSS / YouTube / 当前对话等送进你账号下的 NotebookLM notebook。  
2. **离线 Markdown**：把**当前页**抽成 `.md` 下载，你再手动拖入 NotebookLM。

导入主要在 **扩展侧**完成（DOM / 页面脚本 + Background 编排），**不**依赖 Companion 调 LLM，也**不是**「再开一层 Agent」。你需要 **已在 Chrome 登录 Google / NotebookLM**。

---

## 2. 入口在哪里

打开 CMspark Side Panel，点顶部菜单（`⋯` 或等价头部菜单）：

| 菜单项 | 作用 |
|--------|------|
| **NotebookLM 导入** | 打开导入器浮层（多 Tab：URLs / 页面链接 / RSS / YouTube / Thread） |
| **导出当前页 (NB)** | 离线：当前活动页 → Markdown Blob 下载 |

也可从其它 UI 文案中的 📓 入口进入导入器（以当前构建文案为准）。

---

## 3. 权限与前置条件

| 条件 | 说明 |
|------|------|
| 扩展权限 | 需能访问 `notebooklm.google.com`（host_permissions）；首次失败请检查扩展站点访问权限 |
| 登录状态 | 浏览器中 **已登录** Google 且能打开 NotebookLM；未登录时列表会报「未登录」类错误 |
| Companion | **不是**在线导入的硬依赖；Agent 聊天可同时进行，但导入器不走 LLM 工具链 |
| YouTube 播放列表 | 可选：自备 YouTube Data API key（导入器内可填写），用于展开 playlist |

**安全注意：** 导入器会在你已登录的会话里操作 NotebookLM 页面（DOM 自动化 ≈ 加速版手动操作）。不要在不信任的共享浏览器会话中批量导入敏感 URL。

---

## 4. 导入器各 Tab 做什么

| Tab | 输入 | 导入结果形态 |
|-----|------|----------------|
| **URLs** | 粘贴多行 URL | 逐条加入所选 notebook 的来源 |
| **Links** | 从**当前标签页**抽取链接（内链/外链/文档；媒体默认不勾） | 勾选后批量导入 |
| **RSS** | Feed URL 或 OPML | 条目列表勾选导入 |
| **YouTube** | 播放列表 / 视频 URL | 展开为视频项后导入（可配 API key） |
| **Thread** | 当前 CMspark **对话线程** | 导出为文本源再导入 NotebookLM（产品对齐：用本产品对话，而非仅外站 AI 聊天） |

公共步骤：

1. **刷新 / 选择 notebook**（或创建新 notebook — DOM 流程，需页面可操作）。  
2. 在对应 Tab 收集并勾选条目。  
3. **开始导入** → Background 编排 `notebooklm.start_batch`，进度在面板显示。  
4. 可 **取消** 进行中的 batch。

失败常见原因：未登录、NotebookLM UI 改版导致选择器漂移、条目超限、网络超时。重试前确认 NotebookLM 标签页可手动打开同一 notebook。

---

## 5. 离线导出（当前页 → Markdown）

1. 打开目标网页为活动标签。  
2. 菜单 → **导出当前页 (NB)**。  
3. 扩展抽取正文（`cloneNode` 净化，不破坏 live DOM）→ 下载 `.md`。  
4. 到 NotebookLM 手动 **上传文件** 作为来源。

适合：NotebookLM 在线自动化失败、或你只想留一份干净 Markdown。

---

## 6. 导入结果「去哪了」

| 路径 | 落点 |
|------|------|
| 在线 batch | **你的 Google NotebookLM notebook** 中的 sources（由 NotebookLM 产品侧存储；CMspark 不落一份完整副本到 `~/.cmspark-agent`） |
| 离线 MD | 浏览器 **下载目录** 中的 `.md` 文件 |
| Thread 路径 | 先从当前线程生成文本 → 再作为 NotebookLM 文本来源导入 |

CMspark **不会**把 NotebookLM 云端内容同步回 Knowledge 库；若要进 Agent 知识，请另行用知识面板导入文件 / vault。

---

## 7. 与 Obsidian「🧠 摘要」的区别

| | NotebookLM 导入 | Obsidian 🧠 导出 |
|--|-----------------|------------------|
| 目的 | 把材料送进 **Google NotebookLM** | 把对话导出为 **本机 Markdown 笔记** |
| 是否调 Companion LLM | 导入器主路径 **否** | 摘要路径 **是**（结构化 TL;DR 等） |
| 文档 | 本页 + ADR-011–013 | [ADR-008](adr/008-obsidian-export.md) |

---

## 8. 相关文档

| 文档 | 用途 |
|------|------|
| [ADR-011](adr/011-notebooklm-import.md) | v1 离线 MD |
| [ADR-012](adr/012-notebooklm-importer-online.md) | v1.1 在线 batch |
| [ADR-013](adr/013-notebooklm-importer-v12.md) | v1.2 多 pathway |
| [architecture.md](architecture.md) | 扩展 `notebooklm/` 模块位置 |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 其它故障 |

---

*文档版本：2026-07-28 · 与 `NotebooklmImporterPanel`、`chrome-extension/src/notebooklm/*`、`background/notebooklm-import-orchestrator.ts` 及 `background/index.ts` 中的 batch 入口对齐。*
