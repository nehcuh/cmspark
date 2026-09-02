# Knowledge AI Draft Extract — 导入元数据 AI 预填设计（草稿制，单篇路径）

> **日期**: 2026-09-02  
> **状态**: **PROPOSED · design dual-converged**（grok + claude 独立对抗设计已收敛，设计产物 [.omx/artifacts/design/](../../.omx/artifacts/design/)，待实现评审）  
> **方法**: 双路独立对抗设计（grok · claude）→ 收敛；冲突以 grok 的更严范围为准  
> **触发**: [#272](https://github.com/nehcuh/cmspark/issues/272) — 导入元数据纯启发式（description=正文前 150 字符、无自动 tags），撑不起 related 与后续检索；AI 产出须守 F-S-7 草稿制；目录导入与存量扫描零 LLM 抽取  
> **前序 SoT（不得削弱）**: [Knowledge Honesty](./2026-08-25-daily-assistant-knowledge-honesty-design.md)（F-S-3/4/7 出处）· [Knowledge CRUD Honesty](./2026-08-26-knowledge-crud-honesty-design.md)  
> **前置**: #270（错误可见性）、#271（跳过入口语义复用为「跳过解读」）  
> **设计原料**: [design-grok.md 提案 1](../../.omx/artifacts/design/design-grok.md)（主）· [design-claude.md 提案 1](../../.omx/artifacts/design/design-claude.md)（补）  
> **GitHub:** [#272](https://github.com/nehcuh/cmspark/issues/272)
> **修订**: 2026-09-02 实现评审（grok 4 MAJOR + claude/grok NIT）收敛 —— §3.1 单段响应改为两段式（`knowledge.preview_suggested` 推帧 + `knowledge.preview_cancel`）；abort Map identity 修复与 cancel tombstone；密钥形标签三侧过滤（LLM 出口 / 弹窗 sanitize / 入库 allowlist+overrides+update）；「AI 建议」徽标改为按实际填入点亮；Phase-1 description 无 frontmatter 时回落 150 字启发式（永不为空）；UI 侧 15s 看门狗。

```text
Surface:      L0 Side Panel 导入确认弹窗 + 阅读器按钮（既有）；
              companion knowledge.preview handler 扩展
L2-classes:   (none)
Compose:      复用 llmExtract（companion/src/llm/llm-extract.ts）+
              digest.ts normalizeTags；no new SoT
Autonomy:     低 — 草稿建议，用户确认才生效；无任何后台/批量任务
Trust:        与聊天路径同级；正文（≤8000 字符）发往用户自配 LLM，
              无新外发通道；overlay / summoner 无入口
Channel:      既有 WS（knowledge.* 家族内扩展）
```

**Blast tier**: **T1**（本地 loopback LLM 复用 `llmExtract`；草稿制；正文发往用户自配 LLM，与聊天同级；无新 L2、overlay ACL 不涨）。

---

## 0. 一句话裁决

| 问题 | 裁决 |
|------|------|
| 单篇导入时 LLM 预填说明 + 建议标签 | **GO** — 纯草稿，F-S-7；保存才生效 |
| 目录导入逐篇打 LLM | **NO-GO** — 0 次抽取调用，测试 spy 断言（claude 路的批量抽取方案被否决，见 §1.2） |
| 存量文档后台批量回填 | **NO-GO** — 永不出现「为旧文档补抽」按钮或任务 |
| 新增 frontmatter 字段（`key_points` / `summary` / `core_knowledge` 等） | **NO-GO** — 「核心知识」折叠进可编辑 description（≤500），tags ≤8 走 `normalizeTags` |
| 阅读器「建议说明/标签」单篇手点入口 | **GO** — 目录导入文档的逃生口；新 WS 消息，带 `user_gesture` |
| 改写正文 / 流式 LLM / 抽取成导入必经路径 / overlay 抽取 | **NO-GO** |
| LLM 失败时弹窗不可用 | **NO-GO** — 启发式兜底永不为空，弹窗照常可确认 |

**产品句：**

> 单篇文档导入时，AI 自动预填说明和建议标签，用户在确认弹窗里直接改，保存才生效；目录导入不逐篇打 LLM。

---

## 1. 现状证据与缺口

### 1.1 现状（已逐条核对，file:line 以本 spec 为准）

- `previewKnowledge` 只返回 `{ title, description, preview, char_count }`，**不抽 tags**（`companion/src/skills/skill-engine.ts:1548-1565`）。description 直接取 frontmatter，不重新生成。
- description 的兜底来自 `ensureKnowledgeFrontmatter` 的 **150 字启发式**：清洗正文（去代码块/标题/列表/粗体）后截 150 字符加 `...`（`companion/src/skills/skill-engine.ts:1644-1688`，截断在 1679-1687）。
- 导入确认弹窗打开时 **`setTags("")` 无条件清空**：即使源文件 frontmatter 自带 tags 也会被丢掉（`chrome-extension/src/sidepanel/components/ChatView.tsx:640-646`，清空在 644）。这是「源文件 tags 丢失」缺口，本切片顺手修：源文件已有 tags 应预填进弹窗（仍属用户可改草稿）。
- `knowledge.preview` handler 同步返回，无任何 LLM 调用（`companion/src/message-router.ts:2769-2774`）。
- `knowledge.import_directory` 走原生选目录、逐文件直接 `importKnowledge`，**无单篇确认弹窗**（`companion/src/message-router.ts:2798-2911`；`MAX_FILES=200` 在 2818）。
- 解析有 30s 上限：`KNOWLEDGE_PARSE_TIMEOUT_MS = 30000`（`companion/src/message-router.ts:378`），`parseFileBounded` 用 `Promise.race` 兜底（387-400）。
- `llmExtract` 已存在：一次性非流式抽取助手，自带 timeout 参数（默认 60s）与 parent abort 合并（`companion/src/llm/llm-extract.ts:50-90`）。
- `normalizeTags` 已存在，内含 `SENSITIVE_TAG_RE = /(sk-|api[_-]?key|password|bearer\s|secret|token)/i` 丢弃密钥形标签（`companion/src/threads/digest.ts:46, 66`）。
- related 匹配已经消费 `title + description + tags`（`companion/src/skills/knowledge-related.ts:32-34`）——本票零检索改动，收益由 existing related 与后续检索切片兑现。
- 入库 frontmatter 仍被 `allowlistKnowledgeFrontmatter` 收窄（F-S-4，`companion/src/skills/skill-engine.ts:1618-1632`）。

### 1.2 双路设计的分歧与收敛

| 分歧点 | claude 路 | grok 路 | 收敛（取更严） |
|--------|-----------|---------|----------------|
| 目录导入 | 批量抽取（并发 4-6、可取消） | **0 次 LLM** | **grok**：目录导入零抽取；200 篇 × 1 次调用的费用与失控风险不可接受 |
| 逃生口 | 未提 | 阅读器「建议说明/标签」单篇手点 | **grok**：补上，覆盖目录导入文档 |
| 「核心知识」 | 否决新字段（一致） | 否决新字段（一致） | 一致：折叠进 description |
| 输入 cap | ≈6000 字符 | **8000 字符** | **grok**：8000；与 6MiB 解析上限明确区分 |
| 草稿制 / 启发式兜底 / `normalizeTags` + `SENSITIVE_TAG_RE` / 禁存量回填 | 一致 | 一致 | 一致 |

---

## 2. 范围：做 / 不做

| 做 | 不做 |
|---|---|
| 单篇 `knowledge.preview` 成功后，异步一次 `llmExtract`（两段式，§3.1），预填说明 + 标签草稿 | 目录导入逐篇 LLM；后台批量回填存量 |
| 失败 / 超时 / 无 LLM 配置 → 启发式草稿，弹窗照常可用 | 流式 LLM；把抽取做成导入必经路径 |
| 阅读器「建议说明/标签」**单篇、手点**（目录导入后的逃生口） | 新 frontmatter 键（`key_points` / `summary` / `entities` / `core_knowledge`） |
| 标签走 `normalizeTags`（含 `SENSITIVE_TAG_RE`、max 8） | 改写 body；自动保存；overlay / summoner 抽取入口 |
| 弹窗预填源文件自带 tags（修 `setTags("")` 丢 tags 缺口） | 任何「为旧文档补抽」按钮或任务 |

数据模型零改动：仍是 `description ≤ 500`、`tags ≤ 8`。LLM 产出的 JSON 只活在预览/建议响应里。

---

## 3. 协议改动

### 3.1 `knowledge.preview` 两段式（实现收敛 2026-09-02）

LLM 抽取不能阻塞弹窗（§4 时序要求解析完成即出启发式草稿），故拆成两段：

**Phase 1 — `knowledge.preview` 响应**（保持即时返回，同步路径零 LLM）：

```text
knowledge.preview 响应:
  title / description / preview / char_count   // 不变；description 永不为空（frontmatter → 150 字启发式回落）
  tags: string[]                               // 新增：源文件 frontmatter 自带 tags（normalizeTags 后）
  extract_pending?: true                       // 新增：仅当 Phase-2 抽取真的启动时带上
```

- Phase 1 响应**不带** `suggested`；无 LLM 配置 / summoner·overlay surface / 空正文 / 该 id 已被 `preview_cancel` 命中时，`extract_pending` 缺省，UI 不进入「正在解读…」。
- 无 LLM 配置的旧客户端看到的响应逐字段向后兼容（新字段缺省或新增可忽略字段）。

**Phase 2 — 新推帧 `knowledge.preview_suggested`**（异步，与 preview 请求同 kp- id）：

```text
knowledge.preview_suggested   { id, suggested?: { description?, tags?, source: "llm" }, extract_error?: string }
```

- `suggested.source` 只会是 `"llm"`；失败/超时/非 JSON → `extract_error`，**禁止**把启发式包装成 AI 产出（Honesty 原则）。
- 未点「确认导入」前，`suggested` **不得**写入磁盘、不得进 `listKnowledge`、不得进 related 词袋（F-S-7）。
- 帧上 tags 在 companion 出口再过一次 `normalizeTags`（SENSITIVE_TAG_RE 丢密钥形），扩展侧 sanitize 再滤一层。

**取消 — 新消息 `knowledge.preview_cancel { id }`**：

- abort 在途抽取（`llmExtract` 的 signal）；无在途则把 id 记入 60s tombstone——解析窗口内（≤30s）取消的 id 之后不再启动抽取。重复/未知 id 为 no-op，应答 `{ type: "knowledge.preview_cancel", id, ok: true }`。

### 3.2 阅读器手点入口：新 WS 消息 `knowledge.suggest`

```text
knowledge.suggest   { id: string, user_gesture: true }
  → { type: "knowledge.suggest", id,
      suggested?: { description?: string, tags?: string[], source: "llm" | "heuristic" },
      extract_error?: string }
```

- 单篇、手点、`user_gesture: true` 必填（缺省 400，与 `knowledge.delete` 同型）；summoner surface 拒绝（SUMMONER_ACL）。
- 对已入库文档重新抽取，返回**草稿**：不落盘、不改 frontmatter。用户把建议抄进既有编辑 sheet，保存走现有 `knowledge.update` 路径（CRUD Honesty Wave 3），不新增写入动词。
- 抽取输入与超时与 §4 相同（8000 字符 / 15s）。

### 3.3 目录导入

`knowledge.import_directory` **零改动、零 LLM 调用**。完成后结果文案补一句：「未自动解读。打开文档可点『建议说明/标签』。」禁止在目录导入路径上偷偷排队任何抽取任务。

---

## 4. UX 时序（单篇导入）

```text
1. 选文件 / 拖入 → 现有解析（parseFileBounded，30s，message-router.ts:378, 387-400）
2. 解析成功 → Phase-1 响应即时到达：弹窗出启发式草稿（永不为空）+ 源文件已有 tags 预填；
   若 Phase-2 抽取已启动（extract_pending）→ 状态行「正在解读…」，可点「跳过解读」
   （复用 #271 跳过入口语义，发 knowledge.preview_cancel abort 在途请求）
3. LLM 返回（≤15s）→ knowledge.preview_suggested 推帧到达，只覆盖用户尚未改过的字段；
   用户已改过的 description / tags 保持原样；「AI 建议」徽标只亮在实际被建议填入的字段上
4. 用户改完点「确认导入」→ 现有 knowledge.import + overrides（标题/说明/标签），
   并 preview_cancel 终止仍在途的抽取
5. 跳过 / 超时 / 失败 → 启发式草稿留在弹窗，确认按钮始终可用；
   推帧丢失时 UI 侧 15s 看门狗兜底撤下「正在解读…」
```

- 抽取输入 cap：**8000 字符**（正文截断，非 6MiB 解析上限）。
- 抽取超时：**15s**，独立于解析 30s；总等待可到 ~45s，但解读失败时弹窗在解析完成后即可点确认，**不得**出现悬挂 loading。
- 「正在解读…」期间用户编辑任意字段即将该字段标记为 user-dirty；LLM 返回只填非 dirty 字段。

---

## 5. 失败 / 降级

| 情况 | 行为 |
|------|------|
| 无 API key / LLM 未配置 | 不打网，直接启发式；`suggested` 缺省或 `source: "heuristic"` |
| 超时（15s）/ 4xx / 非 JSON 返回 | 启发式兜底；`extract_error` 记录日志，UI 不阻断、可静默 |
| LLM 返回的标签含密钥形 | `normalizeTags` + `SENSITIVE_TAG_RE` 丢弃后再进弹窗；入库前再过 `allowlistKnowledgeFrontmatter` |
| 用户点「跳过解读」 | 取消在途请求（abort）；解析窗口内取消的 id 记 60s tombstone，之后不再启动抽取；保留启发式草稿；与 #271 跳过语义一致 |
| 用户在解读返回前改了字段 | LLM 结果不覆盖该字段（user-dirty 优先）；未被覆盖的字段不亮「AI 建议」徽标 |
| 推帧丢失 / companion 中途死亡 | UI 侧 15s 看门狗撤下「正在解读…」并记 extract_error；启发式草稿保留，确认可用 |
| 目录导入 | 全程 0 次抽取；结果文案提示手点入口 |

信任边界：正文（≤8000 字符）发往**用户自配 LLM**，与聊天路径同级；无新外发通道，overlay / summoner 无入口。

---

## 6. 锁对齐（实现前不可破）

- **F-S-7（草稿制）**：`suggested` 保存前不落盘、不进 `listKnowledge`、不进 related 词袋、不作自动激活 —— 不动。
- **F-S-3（gesture + 预览）**：入库仍走 `knowledge.preview` → 用户确认 → `knowledge.import`；`knowledge.suggest` 必须 `user_gesture: true`。
- **F-S-4（allowlist）**：入库 frontmatter 仍只过 `allowlistKnowledgeFrontmatter`；LLM 产出不是新的信任通道。
- **目录导入 0 抽取**：测试 spy 断言 `llmExtract` 在 `import_directory` 路径上 0 次调用；存量扫描同样 0 次。
- 不碰 F-E-3 / F-E-10 / F-I-2；overlay ACL 不涨（含 `knowledge.get` 仍 NO-GO）。

---

## 7. NEVER / 不在本票

- 目录导入 / 存量文档的任何批量或后台 LLM 抽取；永不出现「为旧文档补抽」按钮。
- 新 frontmatter 字段；改写正文；「知识蒸馏」；自动保存。
- 流式 LLM；把抽取做成导入必经路径。
- overlay Allow/Deny 改动；summoner 入口；第二只 Chrome 扩展；`ws_secret` 当 MCP grant。

---

## 8. 验收标准

1. 单篇导入（已配 LLM）：弹窗说明不再恒等于正文前 150 字；标签可预填且可改；源文件自带 tags 不再被 `setTags("")` 丢掉。
2. 关掉 LLM / 15s 超时：弹窗仍可用，说明回退启发式，无悬挂 loading。
3. 未点确认：磁盘文件数不变；`listKnowledge` 无该 id；related 不算它。
4. 目录导入 3 篇：0 次抽取调用（测试 spy 断言 `llmExtract`）。
5. 存量库 50 篇：无后台抽取任务（spy / 日志断言）。
6. LLM 返回 `tags: ["sk-abc", "竞品"]` → 弹窗与入库只有规范化后的非密钥标签。
7. 用户在解读返回前改了说明 → 不被 LLM 结果覆盖。
8. Blast 维持 T1；overlay / summoner 仍无 preview LLM 入口（`knowledge.suggest` 无 `user_gesture` 400，summoner SUMMONER_ACL）。
