# Knowledge CRUD Honesty — 四路对抗合成

> **日期**: 2026-08-26  
> **输入 strawman**: Honesty 锁保持；P0 查看/编辑/导出；P1 列表默认展示 related≤3  
> **触发**: 用户「知识库感觉怪；看不到关联；没有导出和编辑入口」+ 前序对话确认图谱本季不做  
> **车道**: Product · Impl · Security · External（独立 subagent，互不可见）  
> **产出 SoT**: [design spec](../../superpowers/specs/2026-08-26-knowledge-crud-honesty-design.md)

## Lane verdicts

| 路 | VERDICT | 一句话 |
|----|---------|--------|
| Product / JTBD | **MAJOR_REVISE** | 图谱锁对。P0 必须是阅读器 + 卡片字段 + 下载 + 可点相关；默认 related 不能当「关联」的替代品；320px 全身编辑器是 wiki IDE。 |
| Impl / Architecture | **MAJOR_REVISE** | 新动词要独立于 `exportSkill`/`importKnowledge`；原地 update 保 id；list 不准带正文；overlay 不准涨 get。先修 delete `id` vs `name`、directory 校验、`set_active` 键。 |
| Security / Trust | **MAJOR_REVISE** | Side Panel 查看/改/Blob 下载与 F-S-1 兼容。不得把 F-S-5 缩成「只禁写」——`get` 全文对 overlay 也要拒。update 走 import 写盘管线；export 要手势 + 密钥扫描 + 上限。 |
| External / Anti-bloat | **KEEP WITH CUTS** | 不是 2026-06 激进换皮。CRUD-only 或 related-only 都会让用户仍说怪。禁图谱/wiki IDE/vault 写；允许一篇 textarea + Blob + 默认可点「相关」。 |

## BLOCK 并集 → 已折入 SoT

| ID | 来源 | 折入 |
|----|------|------|
| 默认 related 不能当关联产品 | Product BLOCK 1 | P0 阅读器 + 相关标题可点进正文；空则隐藏或「暂无相关」 |
| P0 全身编辑器 = wiki IDE | Product BLOCK 2 | 同一张 sheet：阅读 + 卡片字段 + **一块** textarea；无分栏预览 / mermaid / 双链输入 |
| 知识下载当 Obsidian | Product BLOCK 3 | 文案「下载 .md」；Blob；不跑 vault-profiler / wikilinks |
| 无 `knowledge.get` 的查看是空壳 | Product BLOCK 4 · Impl | P0 必带 get；list 仍只 meta |
| 重开 F-E-3 | Product / External | NEVER；相关天花板仍 ≤3 query-time |
| 事后批量抽 tags 喂 related | Product BLOCK 6 | 禁；标签只在导入确认 / 本 sheet 用户改 |
| overlay 涨 `knowledge.get` | Security B1 · Impl 3 · External E-OVERLAY-1 | get/update/export **均不在** summoner ACL / HTML |
| update 绕开 allowlist | Security B2 | 与 `importKnowledge` 同写盘：allowlist + wildcard site + `writeRestrictedFile` |
| 无 `user_gesture` | Security B3 | update / export / delete validate 强制 `user_gesture: true` |
| export 当 exfil | Security B4 | 单篇、Blob、密钥扫描或 HITL、非 MCP、非 overlay |
| HTML 渲染知识正文 | Security B5 · External E-WIKI-2 | UI = `<pre>` / `<textarea>`；可选预览必须走 ChatView DOMPurify，本 bet 不做预览 |
| 无界批量导出 | Security B6 · Impl | v1 **一篇**；不 `id[]` |
| `exportSkill` 复用 | Impl 1 / 8 | 独立 `exportKnowledge`；双向拒绝对方类型 |
| delete+import 换 id | Impl 4 | 原地写同一 `filenameStem`；不走 `allocateDocIdentity` |
| list 带 `source_file`/`entries`/body | Impl 5 | 瘦 list；related 最多 `{id,title}[]` |
| `set_active` / 勾选用 `name` | Impl 6 | 解析 `id` **或** legacy `name`；UI 钉 `id` |
| v1 改 `site`/`type` 搬家 | Impl 7 | v1 **不可**改 site/type |
| delete 校验 `id`、UI 发 `name` | Impl BLOCK 1 | 本 bet 必修 |
| `import_directory` 校验要 `path`、UI 不发 | Impl BLOCK 2 | 本 bet 必修（F-I-7 忽略客户端 path） |
| 文案 图谱/双链/会话关系图 | External E-COPY-1 | F-UX-NOUN-1 本面板零出现 |
| 复用 `thread-graph.html` | External E-GRAPH-1 | 禁 |
| N+1 `knowledge.related` | Impl 5 · External E-PREFETCH-1 | list 一次算 related，或只在 get 里带；禁止每行请求 |
| 相关仍藏在按钮后 | External E-UNDER-1 | P0 默认展示（有则显示） |
| 相关不可点进正文 | External E-UNDER-2 | 芯片打开 reader |
| 只能看 description | External E-UNDER-3 | get 正文 |
| 正文永不可改 | External E-UNDER-4 | 同 sheet textarea + 确认保存（不是第二应用） |
| 无 Blob 导出 | External E-UNDER-5 | 阅读器「下载 .md」 |

## 未折入本 bet（预存在 / 另票）

- Overlay `knowledge.list` 仍可能带路径类字段：本 bet **瘦 list** 顺手收；不单独开 overlay 重构票。
- Overlay MCP-without-confirm（Honesty F-S-10）：不恶化、本切片不修完。
- `all` 模式 compact index（2026-06 D3）：仍未做；本 bet 不加 `query_knowledge`。
- 会话「关系图」（thread-graph）：别的对象；本 bet **不提**、不复用页面。
- 批量多篇 zip / 写 vault：另 ADR。

## 合成后的脊柱

```text
KEEP Honesty NEVER: Project、图谱、远程库、overlay 知识管理、模型脚注、自动入库
Wave 3   同一家族：get + 阅读器 + 默认可点相关≤3 + 卡片/正文确认保存 + 单篇下载.md
         + 修 delete id / import_directory 校验 / set_active 键
NEVER    知识图谱 UI、持久边、embedding、wiki 分栏、Obsidian 品牌下载、overlay get
```

## 冲突仲裁（四路不一致）

| 冲突 | Product | Impl | Security | External | **锁** |
|------|---------|------|----------|----------|--------|
| 正文编辑 P0 vs P1 | P0 砍全身编辑器 | update 含 body | textarea 可 | 正文不可改 = FAIL | **同一张 sheet 一块 textarea**；无 live preview。禁的是 IDE 铬，不是改正文 |
| related 挂 list 还是 get | 列表默认可见 | 不要 N+1；倾向挂 get | list 可 meta | list 一次算或 batch | **`knowledge.list` 一次算 `related?: {id,title}[]`**（无 score）；overlay 已有 list，只多标题，不涨 verb |
| overlay 只禁写？ | 不涨 overlay knowledge.* | get 也不给 overlay | **get 也拒** | 同 | **三新动词全拒 overlay** |
| 批量导出 | 停放 | v1 一篇 | 上限 | 要 Blob 不要批量 | **v1 一篇** |
| 导出密钥 | — | — | redact 或 HITL | — | 导出跑 `redactSecrets`；UI 报 hit count；update **不**静默剥正文（确认留下） |
| 瘦 list | — | 必做 | overlay `source_file` 是 nit | — | list 去掉 `source_file`/`entries`/`dir`/`resources`/`body` |
