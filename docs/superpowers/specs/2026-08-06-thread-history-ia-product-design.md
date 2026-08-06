# 会话历史信息架构（Thread History IA）— 产品设计

**日期**: 2026-08-06  
**状态**: 草案（多路验证后）  
**坐标**（[ADR-020](../../adr/020-capability-model-three-axes.md)）：**产品特性 / 聊天面 UX** — 非 Composition 原语，不进入 L2；可选 AI 抽取属于 L0 本地元数据增强。  
**现状锚点**（[inspected]）：

| 能力 | 现状 | 代码 |
|------|------|------|
| 线程列表 | 扁平 `threads.map`，汉堡弹出，宽 300 / 高 max 320 | `ThreadList.tsx` |
| 元数据 | `id / alias / created_at / updated_at` + 能力字段；**无 tags/summary/keywords** | `thread-manager.ts` |
| 单删 / 清空白 | `thread.delete`、`thread.cleanup_empty` | message-router |
| AI 标题 | `thread.generate_title`（当前线程） | message-router |
| AI 摘要 | `thread.export_obsidian` scope=`summary` → 下载，**不落库为可检索索引** | ADR-008, `summary-export.ts` |
| 语义相关 | Obsidian wikilinks：纯 TF 余弦 + CJK 2-gram | `semantic-match.ts` |
| 输入增强 | `/` skill 弹出；**无 `@` 会话引用** | `SlashCommandPopover.tsx` |
| 侧栏约束 | Side Panel ~320px 宽 | Claude.md / tokens |

---

## 0. 问题陈述

当线程数从十余个涨到上百时，**找、连、清** 三类痛点同时放大：

1. **找** — 扁平列表 + 未命名线程 → 扫描成本 O(n)，时间感丢失  
2. **连** — 会话彼此孤立；相关决策散落多 thread；无法在当前对话里「挂上」另一会话的上下文  
3. **清** — 只能逐条删或清空白；无冗余识别；删除不可恢复（confirm 后立即 unlink）

用户提案覆盖上述三类，方向正确；但若一次做满（时间树 + Tag 视图 + 跨会话 `@` + 脑图 + 批量删 + AI 冗余），会在 **窄侧栏、LLM 成本、误删、上下文污染** 上同时爆雷。本设计用多路验证收敛为可分期交付的规格。

---

## 1. 多路验证（五车道）

### Lane A — 产品价值 / Jobs-to-be-Done

| 提案 | 核心 JTBD | 价值 | 频次 | 结论 |
|------|-----------|------|------|------|
| 今日平铺 + 历史月/日 | 按时间找回最近会话 | ★★★★★ | 每次打开列表 | **P0 必做** |
| 要点抽取 + Tag 视图 | 按主题找回历史会话 | ★★★★ | 周级 / 检索时 | **P1**；默认手动，定期 opt-in |
| `@` 引用其他会话 | 在当前任务复用历史结论 | ★★★★ | 中频 | **P1.5**；先注入「摘要卡」非全文 |
| 跨会话脑图 | 发现主题簇 / 知识脉络 | ★★☆ | 低频探索 | **P2**；非默认主视图 |
| 层级多选批量删除 | 快速卫生清理 | ★★★★★ | 清理时 | **P0**（与时间树同交付） |
| AI 冗余识别 + 日期筛选 | 「会话太多了」时的辅助 | ★★★ | 偶发 | **P1.5**；先规则后 LLM |

**产品原则（验收级）**

1. **时间是默认组织轴**；标签是增强检索轴；图谱是探索轴 — 三者不可抢默认位。  
2. **AI 元数据是索引，不是第二套真相** — 原文仍在 thread JSON；删 tag 不删会话。  
3. **删除永远是用户确认的** — AI 只提议，不自动删。  
4. **跨会话注入默认最小化** — 防 token 膨胀与 prompt 污染。  
5. **窄栏优先** — 任何新视图必须在 300×400 可用区内完成主路径。

### Lane B — UX / 信息架构

#### B.1 默认视图：`Timeline`（时间树）

```
线程
├── 今天（默认展开，平铺，按 updated_at desc）
│   ├── 调研竞品定价 · #a3k2…
│   └── 未命名 · #x9…
├── 2026-07（默认折叠）
│   ├── 07-28（默认折叠；若该月仅 1 天可跳过日层）
│   │   └── …
│   └── 07-15
└── 2026-06
```

规则：

| 规则 | 说明 |
|------|------|
| 「今天」 | 本地时区日历日；用 `updated_at`（最近活跃）归桶，不用 `created_at` |
| 「昨天」 | 可选二级：昨日单独组；再早进「本周」或直接月 |
| 历史 | **月 → 日 → 会话**；单日会话 ≤3 时可扁平展示日标题+列表 |
| 空别名 | 展示 `未命名 · {id前6}` + 可选首条 user 消息预览一行（P0.5） |
| 折叠记忆 | `localStorage`：`threadList.expand.{yyyy-mm}` / `threadList.view` |
| 搜索条 | 列表顶：本地 filter（alias / id / tags）；**不依赖 LLM** |

**不做**：年层（用户量级年层几乎无用）；按 `created_at` 默认排序（会把「今天打开的旧会话」埋掉）。

#### B.2 辅视图：`Tags`（类 Obsidian tag）

- 顶栏切换：`时间 | 标签`（P2 再加 `图谱`）  
- 左/上：tag 云或字母序列表（频次徽章）  
- 点 tag → 右侧/下方筛选会话列表  
- 多 tag 默认 **OR**（检索意图）；高级 `AND` 可后置  
- 无 tag 的会话归入 `#未标注`  
- 单会话可挂多个 tag（建议上限 8）

#### B.3 辅视图：`Graph`（脑图 / 关系图）— P2

- 节点 = 会话（或 tag 聚合节点）  
- 边 = 共 tag / 语义相似度超阈值 / 用户显式 `@` 引用  
- 布局：力导向或径向；点击节点 → 打开会话  
- **侧栏内用简化列表+相关簇**；全图可「在新标签打开」或弹出层（避免 300px 画布不可用）

#### B.4 多选模式

入口：列表头「选择」或长按 / 勾选图标。

| 层级 | 勾选行为 |
|------|----------|
| 会话行 | 切换该会话 |
| 「今天」组头 | 全选/取消今日全部 |
| 日组头 | 全选/取消该日 |
| 月组头 | 全选/取消该月（二次确认文案提示数量） |
| Tag 视图 | 勾选 tag = 选中该 tag 下全部会话（可再剔除） |

底部操作条：`已选 N` · `删除` · `提取要点` · `取消`。  
删除：确认文案含 N + 可展开 id 列表；**P0 仍硬删**；**P1 引入回收站**（见数据模型）。

#### B.5 输入 `@` 引用（跨会话）

与现有 `/` skill popover **对称**：

```
用户输入 @  →  AtThreadPopover
  搜索：alias / tag / 近期
  选中 → 插入 chip：@「调研竞品定价」
  发送时：chip 解析为 structured attachment
```

注入策略（强约束）：

| 策略 | 内容 | 默认 |
|------|------|------|
| `summary_card` | 标题 + TL;DR + tags + 关键结论 3 条（来自已存 digest） | **默认** |
| `excerpt` | 用户勾选的消息片段 | 手动 |
| `full` | 全 thread 消息 | **禁止默认**；仅显式 + token 预算门 |

未抽取 digest 的会话：先同步跑轻量 digest（或 fallback：title + 首末 user 消息）。

#### B.6 冗余清理助手

入口：列表头「整理…」→ 抽屉。

1. 日期范围（默认：30 天前～更早）  
2. 规则建议（零 LLM，即时）：  
   - 空消息（复用 `cleanup_empty`）  
   - 仅 1 条极短 user、无 assistant  
   - 别名重复 / 高度相似（编辑距离或 token 重叠）  
   - 长期未打开（`updated_at` > N 天）且消息数 < M  
3. AI 建议（opt-in，需点「深度扫描」）：  
   - 输入：各 thread 的 digest（非全文）+ 日期范围  
   - 输出：`{ thread_id, reason, confidence, cluster_id? }[]`  
   - UI：分组展示「可能重复簇」「可能无效」；用户勾选后批量删  

**禁止**：静默删除、默认打开深度扫描、把 worker/orchestrator 子线程标为冗余（除非用户勾选含 multi-agent）。

### Lane C — 架构 / 技术可行性

#### C.1 数据模型扩展（index 级，避免每次打开读全量 messages）

在 `Thread`（`index.json` 条目）增加**可选**元数据字段：

```ts
/** 会话索引元数据 — 可重建，非真相源 */
interface ThreadDigest {
  /** ISO；与 content_fingerprint 一起判脏 */
  extracted_at: string
  /** 消息数 + 末条 id/hash 的廉价指纹 */
  content_fingerprint: string
  /** 一句话摘要 ≤120 字 */
  tldr: string
  /** 规范化 tag，小写、无 # 前缀、≤24 字；最多 8 个 */
  tags: string[]
  /** 可选：关键要点 1–5 条，每条 ≤80 字 */
  bullets?: string[]
  /** 生成方式 */
  source: "manual" | "scheduled" | "on_export" | "on_at_ref"
  /** 模型名快照（可审计） */
  model?: string
}

// Thread 上新增：
digest?: ThreadDigest | null
/** 软删：null/undefined = 存活；ISO = 进入回收站时间 */
trashed_at?: string | null
```

- **真相源**仍是 `{threadId}.json` 的 messages。  
- digest 丢了可重抽；`content_fingerprint` 变化 → 标记 stale（UI 灰标「要点可能过期」）。  
- Tag 索引：启动时从 list 扫一遍建 `Map<tag, threadIds[]>`；变更 digest 时增量更新。量级 <5k 线程内存可接受。

#### C.2 协议（WS，与现有 thread.* 对齐）

| type | 方向 | 作用 |
|------|------|------|
| `thread.list` | ↔ | 响应可带 `digest`；可选 `include_trashed` |
| `thread.extract_digest` | → | `{ thread_id \| thread_ids[], force? }` |
| `thread.digest_updated` | ← | 推送单条 digest |
| `thread.batch_delete` | → | `{ thread_ids: string[], mode: "hard"\|"trash" }` |
| `thread.batch_deleted` | ← | `{ thread_ids, failed?: … }` |
| `thread.restore` | → | 回收站恢复 |
| `thread.suggest_cleanup` | → | `{ from?, to?, mode: "rules"\|"ai", include_workers? }` |
| `thread.cleanup_suggestions` | ← | 建议列表 |
| `thread.related` | → | `{ thread_id, limit }` 相关会话（共 tag + TF） |
| 消息附件 | chat | `context_refs: { type:"thread", id, mode:"summary_card" }[]` |

`thread.batch_delete` 必须走 **indexLock**（与 create/delete 同级）；单次上限建议 **50**，超出分页确认。

#### C.3 抽取管线（复用优先）

```
buildDigestTranscript(messages)  // 复用 summary-export 的 head+tail 预算
  → llmExtract(DIGEST_SYSTEM_PROMPT)  // 输出固定 JSON: tldr/tags/bullets
  → validate & normalize tags
  → write Thread.digest + saveIndex
```

- **禁止** 为每个 thread 跑完整 NotebookLM 长摘要（成本过高）；digest 目标 **≤800 tokens out**。  
- 与 `export_obsidian summary` 关系：  
  - digest = **库内索引**（短、可检索）  
  - export summary = **出站笔记**（长、带附录）  
  - 可选：export 成功后回写 digest（`source: on_export`）避免双算。  
- `generate_title`：若 alias 空，digest 可同时建议 title；用户确认后写 alias。

#### C.4 定时抽取

- 配置：`config.thread_digest: { enabled: false, on_idle_hours: 24, max_per_day: 20 }`  
- 实现：companion 空闲调度（daemon 已有），**默认关**。  
- 仅处理 `digest` 缺失或 fingerprint 过期、且 `updated_at` 距今 > on_idle_hours 的线程。  
- 尊重用户 API 配额；失败退避。

#### C.5 `@` 注入进 LLM

在 `message-router` / adapter 组 messages 时：

```
[system 片段]
## 引用会话
### 调研竞品定价 (#a3k2)
TL;DR: …
Tags: 竞品, 定价
- 要点1
- 要点2
（完整对话未注入；用户可打开该线程查看）
```

预算：所有 context_refs 合计 **≤ 1500 tokens**；超则截断 + 提示。

#### C.6 图谱

- **不新增图数据库**。  
- 边：共 tag（硬）+ 可选 cosine(tags+tldr tokens)（软）。  
- API `thread.related` 纯本地计算；全图前端一次拉 list+digest 构建。

### Lane D — 安全 / 隐私 / 成本 / 合规

| 风险 | 缓解 |
|------|------|
| 批量误删 | 确认 + N 展示；P1 回收站 30 天；不可恢复前二次确认 |
| AI 误标「冗余」删掉重要会话 | 仅建议；默认不勾选高 confidence 以外的；worker 线程默认排除 |
| digest 含敏感内容进 index | index 已是本地 0o600 目录惯例；tags 禁止写入密钥形态（简单正则扫描）；不上传第三方「云索引」 |
| 定时抽取烧钱 | 默认 off；max_per_day；仅 stale |
| `@` 全文注入 prompt 注入/隐私串线 | 禁止默认 full；只 summary_card；引用内容作 **数据** 段非指令段（可加 fence + 「以下为引用资料」） |
| multi-agent 父子线程 | 列表默认折叠 worker 于 orchestrator 下（与 Fleet 一致）；批量删父时提示是否级联 |
| Pack trust holder | `batch_delete` 必须对每个 id 走现有 `releaseTrustBeforeThreadGone`（与单删一致） |

成本粗算（量级）：digest ~1–2k in + 0.3k out / 线程；100 线程全量手动 ~$ 取决于模型，故 **禁止默认全库扫描**。

### Lane E — 范围 / 分期 / 反目标

#### 反目标（明确不做）

- 不做云端同步会话库 / 多端协作 graph  
- 不做自动删除（含「低置信冗余」）  
- 不做把 thread 变成第二套 Knowledge vault（Knowledge 轴已有）  
- 不做侧栏默认打开脑图  
- 不在 P0 改 thread 文件分片存储格式  

#### 分期路线图

| 阶段 | 交付 | 依赖 | 预估量级 |
|------|------|------|----------|
| **P0 — 可找可清** | Timeline 视图（今日平铺 / 月日折叠）；本地搜索；多选 + 层级勾选 + `batch_delete`；列表显示 `updated` 相对时间 | 纯 UI + `batch_delete` API | 1 个小迭代 |
| **P0.5** | 首条 user 预览；空别名改善；折叠状态持久化；「昨天」分组 | P0 | 0.5 |
| **P1 — 可检索** | `ThreadDigest` 字段；手动「提取要点」；Tags 视图；设置项（定期抽取 off） | llmExtract 复用 | 1 迭代 |
| **P1.5 — 可连接 / 可整理** | `@` popover + summary_card 注入；规则型清理助手 + 日期筛选；回收站 | P1 digest | 1 迭代 |
| **P2 — 可探索** | AI 深度清理建议；Related 列表；Graph 弹出层；export 回写 digest | P1.5 | 1 迭代 |
| **P3 — 抛光** | 定时抽取；AND 标签；digest stale 提示；批量「提取要点」 | 稳定后 | 按需 |

---

## 2. 交互规格（主路径）

### 2.1 打开线程列表

1. 用户点 ☰  
2. 默认 **时间** 视图；「今天」展开，其余月折叠  
3. 顶栏：`搜索…` · 视图切换 · `选择` · `+ 新建` · `⋯`（清理空白 / 整理 / 生成标题…）

### 2.2 批量删除（时间视图）

1. 点「选择」→ 行首出现 checkbox；组头 checkbox 为 indeterminate/全选  
2. 勾选 2026-07 月头 → 提示「将选中该月 23 个会话」  
3. 底栏「删除」→ Modal：`确定删除 23 个会话？此操作…` + 可滚动 id 列表  
4. 确认 → `thread.batch_delete` → 乐观更新 UI → 失败项 toast  

### 2.3 手动要点抽取

1. 会话行 ⋯ 或 多选后「提取要点」  
2. 行内 spinner；完成 tag 小 pill 出现在 alias 下  
3. 点 tag → 切到标签视图并选中该 tag  

### 2.4 `@` 引用

1. 输入区键入 `@` → popover（近期 10 + 搜索）  
2. 选中 → chip；Backspace 删 chip  
3. 发送 → companion 附 `context_refs`；若无 digest 则先 extract 再注入  
4. UI 在用户消息下展示「引用了 N 个会话」可点击跳转  

### 2.5 整理助手

1. `⋯` → 整理  
2. 日期：快捷「7 天前以前 / 30 天 / 自定义」  
3. 立即展示规则建议列表（checkbox）  
4. 「深度扫描」二次按钮 → AI 簇  
5. 用户勾选 → 删除 / 或「仅提取要点后保留」  

---

## 3. 验收标准（可测）

### P0

- [ ] 50+ 线程时，「今天」的会话无需滚动月组即可见（今日组默认展开）  
- [ ] 历史会话按本地时区月/日分组；折叠/展开正确  
- [ ] 月组头勾选选中该月全部；删除确认显示正确数量  
- [ ] `batch_delete` 50 线程一次成功；含 Pack trust 的线程删除后 trust 释放（与单删一致）  
- [ ] 搜索 alias 子串即时过滤（客户端）  

### P1

- [ ] 手动提取后 `index.json` 出现 `digest.tags`；重启后 Tags 视图仍可见  
- [ ] 修改会话新消息后 digest 标 stale（或自动不清，仅提示）  
- [ ] 定期抽取默认 **关闭**  
- [ ] tag 规范化：去重、长度限制、控制字符剥离  

### P1.5

- [ ] `@` 注入后 LLM 上下文含 summary_card，**不含** 全量 tool_result 噪音  
- [ ] 规则清理在无网络/不调 LLM 时仍可用  
- [ ] 回收站内会话不出现在默认列表；可恢复  

### P2

- [ ] AI 建议条目标注 confidence；默认不全选  
- [ ] Graph/Related 不阻塞主列表打开（list 仍 <100ms 本地）  

---

## 4. 指标（上线后观察）

| 指标 | 意图 |
|------|------|
| 列表打开后 10s 内选中目标线程比例 | 可找性 |
| 批量删除使用率 vs 单删 | 清理效率 |
| digest 覆盖率（有 tag 的线程占比） | 检索基建 |
| `@` 引用后下一轮用户满意度代理（是否继续对话 / 重开） | 连接价值 |
| digest 月 token 消耗 | 成本护栏 |

---

## 5. 对用户提案的逐条裁决

| # | 用户想法 | 裁决 | 说明 |
|---|----------|------|------|
| 1 | 当日平铺、历史月/日 | **采纳 · P0** | 默认主视图 |
| 2 | 定期/手动要点抽取 | **采纳 · P1** | 默认手动；定期 opt-in |
| 3 | Tag 视图快速定位 | **采纳 · P1** | 辅视图，非替换时间轴 |
| 4 | `@` 应用其他对话 | **采纳 · P1.5** | 仅 summary_card 默认 |
| 5 | 关键字脑图 | **有条件采纳 · P2** | 探索态；非默认；优先 Related 列表 |
| 6 | 层级多选批量删 | **采纳 · P0** | 与时间树同船 |
| 7 | AI 冗余 + 日期筛选 | **分阶采纳** | 规则 P1.5；AI P2；永不自动删 |

---

## 6. 实现切片（工程任务清单）

### Slice A — Timeline + multi-select（无 LLM）· P0

1. `groupThreadsByCalendar(threads, now)` 纯函数 + 时区午夜边界单测  
2. ThreadList：今日展开 / 月→日折叠；搜索（alias|id|首条 user 预览）；首条预览提入 P0  
3. 多选：列表头「选择」主路径；组头 checkbox；底栏；多选时 panel maxHeight ≥480  
4. Worker：P0 平铺 + 角色徽标（不折叠）；忙碌线程 checkbox 置灰  
5. companion：`thread.batch_delete` — `withIndexLock`；每 id `releaseTrust → delete`；上限 50；busy → `failed`；成功 id 广播 `thread.deleted`  
6. history.db：**不**按 thread 清 ops（审计 TTL 30 天保留）— 写进 API 注释与用户确认文案  
7. extension：`REMOVE_THREADS` 复刻 active 回落 + busy/pinned 清理  
8. 测试：`threads.batch-delete.test.ts`（trust per-id、continue-on-fail、busy reject、broadcast）  

### Slice B — Digest + Tags · P1

1. types：`ThreadDigest`；`content_fingerprint = ${len}:${lastId||"empty"}`  
2. `threads/digest.ts`：prompt + parse + normalize tags（密钥形正则拒写）  
3. WS：`extract_digest` / `digest_updated`；失败/重试/并发幂等 + 行内 spinner  
4. UI：手动按钮、tag pills、Tags 视图；stale 仅 Tags/选中时灰标  
5. 设置：`thread_digest.enabled` 默认 false  

### Slice C — @ ref + cleanup rules · P1.5

1. `AtThreadPopover`；无 digest 时 **fallback-first** 发送，异步补 digest  
2. 注入 fence 固定格式 + 合计 ≤1500 tok  
3. `suggest_cleanup` rules + 日期范围  
4. trash + restore；清理承载 = 打开列表惰性 purge（**不**依赖不存在的 daemon 调度）  

### Slice D — AI cleanup + graph · P2

1. AI suggest 基于 digests  
2. `thread.related`  
3. Graph 弹出层（可后置）  

---

## 7. 开放问题（已拍板 / 仍开放）

| # | 问题 | 状态 | 决策 |
|---|------|------|------|
| 1 | 回收站是否进 P0？ | **已拍板** | 否 → P1.5 |
| 2 | Worker 主时间线？ | **已拍板（双路）** | P0 平铺+徽标；折叠 P1+ |
| 3 | Tag 大小写 | **已拍板** | 存小写；展示保留首次写法 |
| 4 | digest ↔ Obsidian export | **已拍板** | 弱耦合；export 可选回写 |
| 5 | history.db 硬删 | **已拍板（双路）** | 不清 ops；审计保留 |
| 6 | 运行中线程删除 | **已拍板（双路）** | 拒绝 + failed reason |

---

## 7.1 Pre-dev pins（双路外审 2026-08-06 合成 · 开发契约）

> 来源：`docs/audit/reviews/thread-history-ia-dual-synthesis-20260806.md`  
> Claude + Pi 均为 **APPROVE_WITH_NITS**，Blocking 为空。以下为开工前必须遵守的实现契约。

1. **Worker**：P0 平铺 + `agent_role` 徽标；删父提示级联；拒绝级联后孤儿可单删。  
2. **Busy**：`batch_delete` 跳过/拒绝忙碌线程 → `failed: { id, reason: "thread_busy" }`。  
3. **失败语义**：best-effort 顺序；`releaseTrust → delete → next`；`ok[]` + `failed[]`；每成功 id **广播** `thread.deleted`。  
4. **锁**：为 `batch_delete` **引入** `withIndexLock`（不声称 create/delete 已加锁）。  
5. **history.db**：硬删不 purge ops（有意审计保留）。  
6. **Active 被删**：`REMOVE_THREADS` 与单删同逻辑（回落首项 / 清空 + busy/pinned）。  
7. **P0 搜索**：alias + id + 首条 user 预览（无 tags）；首条预览属 P0。  
8. **面板**：多选时 maxHeight ≥ 480 或 full-height 抽屉。  
9. **分桶**：P0 = 今天 + 月→日；昨天 = P0.5 必做；无「本周」层。  
10. **多选入口**：主路径 = 顶栏「选择」。  
11. **调度**：无现成 daemon idle-job；回收站/定时用惰性或新 interval，另定。  
12. **fingerprint**：`${messages.length}:${lastMessageId || "empty"}`。  
13. **@**：fence 固定；无 digest 时 fallback-first；异步补 digest。  
14. **敏感 tag**：拒 `/(sk-|api[_-]?key|password|bearer\s|secret|token)/i`。  

---

## 8. 总结（给决策者的一句话）

> **先把「时间树 + 层级多选删除」做实，再叠「可开关的要点索引与标签视图」，最后用「摘要级 `@` 引用」和「规则优先、AI 建议」解决连接与卫生问题；脑图是锦上添花，不能当导航主干。**

验证标记：

- 现状与代码路径：[inspected]  
- 交互与分期：[assumed] → 经双路外审修订为 [reviewed]  
- **双路外审**：[executed] Claude + Pi `APPROVE_WITH_NITS`，`both_ok=true`（2026-08-06）  
- Pre-dev pins 已并入 §7.1；用户确认后开工 Slice A  

---

## 附录 A — 视觉结构线框（ASCII）

```
┌──────── ThreadList ~300px · multi≥480 ──┐
│ 🔍 搜索…          [选择]  +  ⋯          │
│─────────────────────────────────────────│
│ ▼ 今天 · 3                           ☑  │
│   ○ 调研竞品定价 · 10分钟前             │
│     首条：帮我对比三家 SaaS 定价…       │
│   ○ 未命名 · x9f2  [worker]             │
│─────────────────────────────────────────│
│ ▶ 2026-07 · 23                          │
│ ▶ 2026-06 · 41                          │
│─────────────────────────────────────────│
│ 已选 12            [删除]        取消   │
└─────────────────────────────────────────┘
```

P0 顶栏：**搜索 · 选择 · 新建 · ⋯**（清理空白 / 生成标题 / 整理… 进 ⋯）。  
Tags 切换在 P1 再出现，避免 P0 挤占。

## 附录 B — 与能力三轴关系

- **Surface**：仅 L0 聊天面元数据与导航；不新增 CDP/Host 工具。  
- **Composition**：digest/tags **不是** 新 Skill/Knowledge 类型；若未来要「把要点写入 Knowledge」，另开 ADR，避免把 Thread IA 做成隐式 Knowledge 双写。  
- **Autonomy**：P0 worker 平铺+徽标；折叠与 Fleet 对齐留 P1+；不另起编排语义。  
