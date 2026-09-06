# 低语料知识图谱：AI 自动整理分组与关联洞察 — 设计

> GitHub: #427
> 日期：2026-09-06（round-2 复审闭环修订版）
> 状态：设计定案。三路独立对抗提案（grok / claude / pi，存 `.tmp/lane-status/kg-427-*.md`）
> + round-2 复审（3×MAJOR 已全部闭环，逐条见 §11）。
> 被修订的既有决策：`2026-09-04-knowledge-graph-view-design.md` §6「n<20 → too_few 不假装
> 结构」——该决策对纯 TF 聚类仍然成立（#273 检索路由闸不动），图谱视图由本 spec 的
> LLM 分支接管。#356 的 error 帧渲染合同**不修订**（见 §4 裁决）。

## 1. 问题

`KNOWLEDGE_CLUSTER_MIN_DOCS = 20` 是分布 chips + 簇路由（#273）的闸；图谱视图目前复用它
（`KNOWLEDGE_GRAPH_MIN_DOCS = KNOWLEDGE_CLUSTER_MIN_DOCS`），n<20 直接 too_few 空面板。
TF average-link 在小语料出不了可信簇——这个理由对 LLM 分组不成立。
**本票只动图谱视图；`KNOWLEDGE_CLUSTER_MIN_DOCS` 与 `scoreRelatedKnowledge` 一字不改。**

## 2. 总览：双 lane 图谱构建与状态映射

**图谱画布闸与聚类闸解绑**：`KNOWLEDGE_GRAPH_MIN_DOCS` 不再复用聚类常数，改为 1
（n≥1 即可画布；散点是诚实结构，不是假装）。

| n | status | 画布 | 分组来源 | 备注 |
|---|---|---|---|---|
| 0 | `too_few` | 不渲染 | — | 既有空库文案 |
| 1 | `ok` | 单节点 | 不分组 | 不调 LLM（一篇没有结构可言） |
| 2–19，无缓存 | `ok` | 节点 + TF 边（可能全孤立散点） | 全部未分组 | CTA banner「让 AI 整理现有 N 篇」 |
| 2–19，缓存命中 | `ok` | 节点 + TF 边 + AI 关联虚线 | `graph_llm` + 锁 overlay | 0 次 LLM 调用 |
| 2–19，缓存 stale | `ok` | 同上（按现存节点剪枝后） | 同上 | 加「语料已变化 · 可重新整理」badge |
| ≥20，无锁 | `ok`/`over_cap` | 既有行为 | TF 聚类 `c:` | **零改动**；无 `relations` 帧字段 |
| ≥20，有锁 | 同上 | 同上 | TF 着色 + 锁 overlay（§6） | 仅 wire 着色叠加，TF 聚类输入不变 |

`group_key` 命名空间：TF 侧 `c:<key>`，LLM 侧 `l:<hash>`，未分组 `u:ungrouped`（既有）。
`l:<hash>` = `l:` + `sha256(排序后成员 id 列表).slice(0,12)`，**服务端派生**——LLM 输出
只给成员 id 数组，键永不来自模型（同成员集合同键，锁与缓存才能稳定对上）。

## 3. LLM 整理 lane（2 ≤ n ≤ 19）

### 3.1 触发（手动唯一，无自动；panel-only）

- 2–19 无缓存帧带 CTA banner「让 AI 整理现有 N 篇」；工具栏加「重新整理」（仅 LLM lane）。
- 防抖索引重建、首次打开图谱 tab 均**不自动**调 LLM（未经同意的花费 + 编辑高频期
  成本/抖动双输——claude/pi 多数否决 grok 的「首开自动一次」）。
- wire：`knowledge.graph` 请求加 `organize:true` + `user_gesture:true`（与 distill-all
  同纪律；服务端校验，缺一拒绝）。surface 闸与 knowledge preview 同款：**panel-only**，
  summoner/overlay 请求拒绝。
- 响应帧与推帧带 `llm_ready:boolean`（无 LLM 配置 → CTA 禁用 + 既有
  llm-not-configured 文案）。
- 执行复用 label 驱动的 single-flight + AbortController 模式，但**不得静默 catch**
  （label 通道可静默，organize 不行——见 §4 错误合同）。超时 30s（失败走 §4 错误条，
  用户可重试；不为 n=19 抬到 60s，#418 的 60s 教训反向适用：慢就诚实失败）。
- organize 在飞期间索引重建：settle 时按**当前**索引重校 ids；指纹已漂 → 写入缓存
  并直接标 `stale:true`（不渲染过期结构假装新鲜）。

### 3.2 LLM 调用（一次批式）

输入（隐私边界，**不进 .md 正文**，含首块）：每篇 `title + tags(≤3) + description`。
description 当前不在 `KnowledgeIndexDoc`（只被打进 vec）——本票把它（非正文、构建索引时
现成的字段）加进 `KnowledgeIndexDoc`，指纹与 prompt 同源取用。锁组名单作为禁区进 prompt
（§5）。

输出严格 JSON（零容忍解析纪律沿用 parseGraphLabels）：

```json
{
  "groups": [ { "name": "≤20字", "summary": "≤280字", "ids": ["..."] } ],
  "relations": [ { "a": "id", "b": "id", "reason": "≤80字", "confidence": 0.0 } ]
}
```

服务端校验与归一化：
- 组：`clampKnowledgeGraphLabelEntry` 同款钳制；ids 必须现存；每篇至多属一组（重复归属
  后出现的整条作废）；**单成员组进未分组——是预期归一化，不计入丢弃分子**。
- 关联：`a`/`b` 现存且不等；`reason` 必填（`sanitizeLabelLine` 净化后按**码点**切 ≤80
  字——新代码用 `Array.from` 切片，不复制既有 clamp 的代理对缺陷）；`confidence` 钳
  [0,1]；无序对去重。
- 截断两段式（顺序钉死）：先按每个端点 id 度数 confidence 降序 slice(0,3)，再全图
  confidence 降序 slice(0, min(12, 3×n))。
- **丢弃率分池判定**（组池 / 边池独立）：分母 = LLM 原始输出条目数；分子 = 结构性无效
  条目（不存在的 id、重复归属、缺 reason、confidence 非数值）。任一池丢弃率 >50% →
  **该池整体回退**（组池烂 → 全部未分组；边池烂 → relations=[]），不连坐另一池。

### 3.3 缓存（派生层，可丢可重建）

派生索引新增 `graph_llm` 区（与 `display` 同文件同语义，readKnowledgeIndexFile 同款
「形状不符整区丢弃、不连累 docs」校验）：
`{ fingerprint, groups, relations, stale }`。
- `fingerprint` = 全部参与文档 `(id, title, description, tags)` 的聚合散列——**tags 必须
  在内**（tags 是 LLM 输入，只改 tags 也得标 stale）。
- 指纹变 → 只标 `stale:true` + UI badge，**不自动重跑**、不擦旧缓存。
- 渲染前按当前 docs **剪枝亡 id**（缓存组/边引用已删文档时剔除；组缩到 <2 解散）。
- LLM 失败不擦有效缓存。
- **重建 carry-forward（硬要求）**：`rebuildKnowledgeIndexSafe` 必须与 `display` 同款
  携带 `graph_llm`/`graph_lock`（软界 + 形状不符整区丢弃）——否则 2s 防抖重建每次
  都会抹掉锁和 LLM 缓存。

## 4. 边：TF 骨架 + LLM 洞察覆盖层；错误合同

- `edges[]` **永远纯 TF**（`buildKnowledgeGraphEdges` 现算，n≥2 即算——它本无篇数门槛，
  只是被旧 too_few 闸挡住；权重/语料/top-5/0.08 门一字不改，wikilinks 同源评测不触发）。
- wire 加可选 `relations[]`：`{ a, b, reason, confidence, ai: true }`——纯覆盖层，不进
  `edges[].score`；只在 LLM lane（2–19）帧出现，≥20 帧永不携带（统计图上不残留 AI
  虚线）。旧客户端自然忽略新字段。
- UI：TF 边实线；relation 与 TF 边同对 → 理由进该边 tooltip；TF 没有的对 → 虚线 +
  「AI 关联」标。每条 relation 可点开看 reason。
- **错误合同（不修订 #356）**：`status:"error"` 仍只表示图谱加载失败（索引不可用等），
  死面板不变。organize 的 LLM 失败**不走 error status**——推 `status:"ok"` 帧（节点 +
  TF 边 + 有效旧缓存）外加帧级 `organize_error` 字段，UI 渲染顶部错误条 + 重试按钮。
  两通道分开写，防止实现者整段复制 label 驱动的静默 catch。
- LLM 显式返回空 relations → 合法 ok，诚实散点 + 文案「AI 未发现明确关联」。
- **绝不为凑连通编边。**

## 5. 分组锁定（graph_lock）

用户点「保留这版分组」写入派生索引 `graph_lock` 区：
`{ groups: [{ ids: string[], name: string, summary?: string }] }`（成员 id 集合快照 +
命名/摘要）。**不写 .md、不写 frontmatter**——锁与 AI 产物是视图派生物，写 .md 会污染
用户原文并随导出/同步外溢；缓存丢失 → 锁随之丢失，UI 诚实提示「派生缓存已重建，请重新
整理/锁定」。

- 锁是**图谱视图着色 overlay**：只把锁成员的 wire `group_key` 改写为 `l:<hash>`（§2 同
  公式派生）并注入 labels。锁成员同时属某 TF 簇时，图谱着色以锁为准。锁**不进入** TF
  聚类输入——该输入同时服务 #273 路由与 ≥20 图谱着色，两侧都感知不到锁。
- 锁组冻结：成员只减不增——.md 删除 → 缩容；<2 篇 → 解散并一次性提示。新文档一律进
  「未分组」，LLM/TF 不得把新篇并入锁组（prompt 里锁组是禁区，不是可吸收候选；吸收法
  留作后续票）。
- 手动「重新整理」只重排未锁定部分。
- 解锁 = 删除对应锁条目。
- 锁组标签带 `ai:true` 标识（来源为用户认可的 AI 分组）。

## 6. 跨 20 切换语义

n 涨过 20 的下一帧起：未锁定分组改按 TF 聚类着色；锁组继续吃锁（着色 overlay 与算法
来源无关）；`relations[]` 不再上帧（AI 虚线不残留）。顶部一次性 banner「知识已满 20 篇，
分组改按统计聚类（更稳定）」——「一次性」记录在派生索引 `graph_tf_switch_ack:true`
（缓存丢失后重现一次可接受）。反向（删回 <20）回到 LLM lane，缓存大概率 stale，用户
手点重整理。

## 7. 三路对抗分歧裁决记录（round 1）

| 分歧点 | grok | claude | pi | 定案 |
|---|---|---|---|---|
| 首开自动跑一次 LLM | 支持 | 反对 | 反对 | **手动唯一**（多数；Autonomy 不变） |
| LLM 边 wire 形状 | 独立 relations[] | 单列表可选字段 | 单列表 source 字段 | **relations[]**（edges[] 合同永纯 TF） |
| 锁跨 20 是否存活 | 存活（着色 overlay） | 整体退役 | 存活（剔除出聚类输入） | **存活但仅着色 overlay**（剔除入聚类动 TF 输入，否） |
| 锁组可否吸收新文档 | 否 | 可（prompt 约束） | 否 | **否**（v1 从简；吸收法另票） |
| 缓存位置 | 派生索引 graph_llm 区 | 派生索引 llm_graph 区 | 独立 cache 文件 | **派生索引**（display carry-forward 先例） |
| LLM 输入是否进正文 | 仅 title+tags+description | 手动可放宽首块 300 字 | 仅 title+tags+description | **不进正文**（保守；与现有隐私边界同级） |

三路一致（无分歧直接采纳）：不动 MIN_DOCS；n=1 单节点不调 LLM；无 5–19 分段混合；
不写 SoT/frontmatter；reason 必填否则服务端丢边；失败不擦有效缓存；指纹失效只标
stale 不自动重跑；relations 与分组一次批式调用。

## 8. 常数表（可测可调，不藏）

| 常数 | 值 | 说明 |
|---|---|---|
| `KNOWLEDGE_GRAPH_MIN_DOCS` | **1**（与聚类闸解绑，本票改） | 图谱画布下限；too_few 只剩 n=0 |
| `KNOWLEDGE_GRAPH_LLM_LANE_MAX` | 19（= MIN_DOCS−1，同源不另造数） | LLM lane 上界 |
| `KNOWLEDGE_GRAPH_RELATIONS_CAP` | 12 | 全图 LLM 关联上限（两段式第二刀） |
| `KNOWLEDGE_GRAPH_RELATIONS_PER_NODE` | 3 | 单端点度数上限（两段式第一刀） |
| `KNOWLEDGE_GRAPH_RELATION_REASON_MAX` | 80 字（码点切片） | reason 钳制 |
| `KNOWLEDGE_GRAPH_ORGANIZE_TIMEOUT_MS` | 30_000 | organize 单次超时 |
| 池丢弃率回退阈 | >50%（分池判定，§3.2） | 超阈该池整体回退 |

## 9. 验收（用户能看见的完成）

- AC-1：4 篇知识打开图谱 → 画布画 4 节点 + TF 边（可能全孤立）+ CTA「让 AI 整理现有
  4 篇」；点击后出分组 + 命名/摘要 + AI 关联虚线；**分组名/摘要/AI 关联**带「AI 生成」
  标识（TF 实线边不是 AI 产物，不带标）。
- AC-2：再次打开命中缓存 0 次 LLM 调用；只改一篇的 tags 或 description → stale badge，
  不自动重跑。
- AC-3：「保留这版分组」后保存一篇无关文档（触发防抖重建）→ 锁组仍在（carry-forward
  回归）；手动重新整理 → 锁组不动，新篇进未分组；删到 <2 篇锁组解散并提示一次。
- AC-4：LLM 未配置 → 帧带 `llm_ready:false`，CTA 禁用；LLM 超时/解析失败 → 画布保留
  （节点 + TF 边 + 旧缓存）+ 顶部错误条（`organize_error`），旧缓存不丢。
- AC-5：LLM 返回空 relations → 散点 +「AI 未发现明确关联」；无虚构边。
- AC-6：第 20 篇入库 → 一次性 banner（关 tab 重开不再出现），未锁组改 TF 着色，锁组
  保持，relations 不再上帧。
- AC-7（红线回归）：`KNOWLEDGE_CLUSTER_MIN_DOCS`/`scoreRelatedKnowledge`/#273 评测
  输入面零改动；n≥20 且无锁时 wire 与行为与今天完全一致；`organize:true` 在 n≥20
  服务端 no-op（客户端漏藏按钮也偷渡不进 TF lane）；summoner 发 organize 被拒。

## 10. NEVER（沿用票面）

- 不改 #273 检索路由打分与 TF 聚类算法；不做 embedding；LLM 产物/锁不进 SoT；
  不进 .md 正文做 LLM 输入；无自动 LLM 触发；不编边凑连通；不修订 #356 error 帧合同。

## 11. Round-2 复审闭环记录（3 lane 全 MAJOR → 已修）

| 来源 | 问题 | 闭环 |
|---|---|---|
| grok M-1 / claude N1 | too_few 闸未与聚类解绑，LLM lane 上不了屏 | §2 状态映射表 + `KNOWLEDGE_GRAPH_MIN_DOCS=1` |
| grok M-2 | description 不在 KnowledgeIndexDoc | §3.2：本票把 description 加进索引 doc（派生） |
| grok M-3 | graph_llm/graph_lock 未要求重建 carry-forward | §3.3 硬句 + AC-3 回归 |
| grok M-4 / claude M1 | 套用 label F5 静默 catch 会吞 AC-4；error 帧与画布互斥 | §4 错误合同：organize_error 帧字段，不动 #356 |
| grok M-5 / claude N3 / pi N1 | 丢弃率分母未定义 | §3.2 分池判定，单成员组不计分子 |
| grok M-5 / claude N5 | 一次性 banner 无落点 | §6 `graph_tf_switch_ack` |
| grok M-5 | n≥20 organize 未关闸 | §3.1/AC-7 服务端 no-op |
| claude M2 | 「≥20 零改动」与锁跨 20 矛盾 | §2 表格分行 + §5 overlay 语义钉死 |
| claude M3 / grok N1 | 指纹漏 tags | §3.3 指纹含 tags + AC-2 断言 |
| claude M4 / grok N4/N7 | l:<hash> 不可让模型产出 | §2 服务端派生公式 |
| pi MAJOR-1 / grok N2 | per-node 上限是死常数 | §3.2 两段式截断顺序钉死 |
| pi N4 | stale 缓存渲染引用亡 id | §3.3 渲染前剪枝 |
| pi N5 | ≥20 时 relations 去留未写 | §4/§6：≥20 帧永不携带 |
| claude N6 | organize 在飞 vs 重建竞态 | §3.1 settle 重校 + 标 stale |
| claude N7 | organize surface 闸未写 | §3.1 panel-only |
| claude N8 | CTA 禁用缺 wire 位 | §3.1 `llm_ready` |
| claude N9 / grok N3 | reason 切片代理对缺陷；AC-1 AI 标措辞过宽 | §3.2 码点切片；AC-1 已改 |
| grok N5 | organize 缺 user_gesture | §3.1 与 distill-all 同纪律 |
| grok N6 | 30s 超时争议 | §3.1 维持 30s + 诚实失败 |
| pi N2/N3 | 反 SoT 理由与「TF 只服务 #273」措辞不精确 | §5/§6 已改写为事实陈述 |
| claude N4 | 锁条目丢 summary | §5 快照带 summary |
