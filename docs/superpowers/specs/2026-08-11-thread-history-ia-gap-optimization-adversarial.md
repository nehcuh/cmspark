# Thread History IA — Gap 复盘与优化设计（多路对立对抗合成）

**日期**: 2026-08-11  
**状态**: **双路外审通过**（Claude+Pi `APPROVE_WITH_NITS` · both_ok · 2026-08-11）  
**外审合成**: [thread-history-ia-gap-opt-dual-synthesis-20260811.md](../../audit/reviews/thread-history-ia-gap-opt-dual-synthesis-20260811.md)  
**前序 SoT**: [2026-08-06-thread-history-ia-product-design.md](./2026-08-06-thread-history-ia-product-design.md)（下称 **IA-2026-08-06**）  
**前序外审**: [thread-history-ia-dual-synthesis-20260806.md](../../audit/reviews/thread-history-ia-dual-synthesis-20260806.md)（both `APPROVE_WITH_NITS`）  
**外部参照（非 SoT）**: [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki) · Karpathy LLM Wiki 模式  
**坐标**（[ADR-020](../../adr/020-capability-model-three-axes.md)）：**产品特性 / 聊天面 UX（L0）** — digest/tags/related 为 Thread index 元数据，**不是** Skill/Knowledge/Pack；**不**引入 L2。

---

## 0. 能力声明（本轮优化若落地）

```text
Surface:      L0 chat UX / thread navigation metadata only
L2-classes:   (none)
Compose:      none new — digest/tags/related edges are Thread index metadata,
              NOT Skill/Knowledge/Pack dual-write
Autonomy:     n/a for graph; worker display stays flat+badge (IA-2026-08-06 pin)
Trust:        batch_delete / extract 不改 trust 语义；删仍 per-id releaseTrust
Channel:      community | enterprise unchanged
```

**Blast tier**: Wave A = T1（UI/入口）；Wave B = T2（LLM 成本护栏）；Wave C = T2（本地图算法，无新运行时）。

---

## 1. 问题重述（用户可观察）

| # | 用户陈述 | 现象层 |
|---|----------|--------|
| U1 | AI 自动整理会话标签的**入口看不到** | 有 `🏷` / 多选「提取要点」，无 `⋯` 批量入口；历史几乎无 digest → Tags 空壳 |
| U2 | 「时间 → 更多」正常；「标签 → 更多」**选项显示不全** | 嫌疑：`panel.overflow:hidden` + Tags 更高面板 / tag 云无折叠 |
| U3 | 希望抽取关键点、发现**跨对话关联**、自动**关联图谱** | 设计在 P2；实现未做；与「感觉没达成设计目标」一致 |
| U4 | 是否参考 llm_wiki **重新优化** | 方法可借；产品勿整体移植（见 Lane E） |

**本合成回答三个决策题**：

1. IA-2026-08-06 方向是否仍成立，还是要推翻重做？  
2. 当前实现差在哪一层（管线 / 入口 / 覆盖率 / 关联层）？  
3. 优化分期与 **pre-dev pins** 是否可进双路外审 → workflow 实现？

---

## 2. 现状锚点（[inspected] 2026-08-11）

对照 IA-2026-08-06 分期与代码：

| 能力 | 分期 | 状态 | 证据 |
|------|------|------|------|
| Timeline 时间树 | P0 | ✅ | `ThreadList.tsx` + `thread-timeline.ts` |
| 多选 / batch trash | P0 | ✅ | 底栏 + `thread.batch_delete` |
| 本地搜索 | P0 | ✅ | `filterThreadsByQuery` |
| `ThreadDigest` 管线 | P1 | ✅ 后端 | `companion/src/threads/digest.ts`；`thread.extract_digest` max 20 |
| Tags 视图 | P1 | ⚠️ 壳 | 有 UI；依赖 digest 覆盖率 |
| 手动提取入口 | P1 | ⚠️ 弱 | 行 `🏷`（仅 title）；多选底栏「提取要点」；**`⋯` 无项** |
| tldr/bullets 展示 | P1 | ❌ | UI 仅 `tags` pills；不显示 tldr |
| `thread_digest` 设置 / 定时 | P1/P3 | ❌ | 规格有，代码未见 |
| `@` + summary_card | P1.5 | ✅ | `AtThreadPopover` + `context-refs.ts` |
| 规则整理助手 | P1.5 | ✅ | `⋯ → 整理助手` + `suggest_cleanup` |
| AI 深度清理 | P2 | ❌ | — |
| `thread.related` / Graph | P2 | ❌ | — |
| 跨会话自动边维护 | P2 | ❌ | — |

**关键文件**:

- UI: `chrome-extension/src/sidepanel/components/ThreadList.tsx`（`panelMaxHeight`、`overflow:"hidden"`、`handleExtractDigest`、tagCloud）
- Digest: `companion/src/threads/digest.ts`、`message-router.ts` `thread.extract_digest`
- 规格: IA-2026-08-06 §B.2–B.3、§C.6、§E 反目标与分期

**一句话诊断**:  
> **管线半成品 + 入口不可发现 + 覆盖率≈0 + 关联层未开工** = 用户感知「设计目标未达成」。不是「方向错了」，是 **P1 可发现性与 P2 关联层交付缺口**。

---

## 3. 多路对立对抗

每条车道：**主张 → 反方攻击 → 合成裁决**。裁决为可执行的 lock（写入 §5 pins）。

### Lane A — 产品 JTBD（找 / 连 / 清）

| | |
|--|--|
| **主张** | 时间轴已解决「找最近」；标签解决「按主题找」；图谱解决「发现关联」。应优先补标签覆盖率与入口，再做图谱。 |
| **反方** | 用户要的是「关联图谱」叙事；只修入口是打补丁，应直接做 llm_wiki 式编译知识库，否则永远停留在 chat 索引玩具。 |
| **合成** | **保留三轴**（时间默认 / 标签检索 / 图谱探索）。用户 U3 映射到 **P2**，但 P2 无数据（无 digest）则图谱空洞。**锁 A1**: Wave A 必须先把 digest **可发现 + 可批量**，否则禁止开 Graph UI 主路径。**锁 A2**: Graph **永不**取代时间轴默认位（重申 IA-2026-08-06 原则 1）。 |

### Lane B — UX / 窄栏可操作性

| | |
|--|--|
| **主张** | U1/U2 是发现性与裁剪 bug；`⋯` 加「为未标注提取」、空态 CTA、tldr 一行、菜单 portal / overflow 修复、tag 云折叠即可。 |
| **反方** | Side Panel 300px 塞时间/标签/图谱/整理是反模式；应独立全屏「会话图书馆」或迁出到 Obsidian。 |
| **合成** | **锁 B1**: Wave A/B 仍在 ThreadList 弹层内完成主路径（与 IA 原则 5 一致）。**锁 B2**: Graph 全图 **仅弹出层 / 新标签页**；侧栏最多 **Related 3 条列表**。**锁 B3**: Tags 视图 tag 云 `max-height` +「更多」；`⋯` 菜单不得被 `overflow:hidden` 裁切（portal 到 `document.body` 或 panel `overflow:visible` + list-only scroll）。**锁 B4**: 空 Tags 主 CTA = 「为未标注提取要点（最多 20）」，文案与真实入口一致。 |

### Lane C — 架构 / 数据模型

| | |
|--|--|
| **主张** | 继续 index 级 `ThreadDigest`；related 纯本地：共 tag + tldr/bullets TF + `@` 显式边；不写图数据库。 |
| **反方** | 无持久边表则每次 list 全量算；无 entity 页则跨会话概念漂移（同义 tag 分裂）。应引入 embedding + 边表 + 规范化 tag 字典。 |
| **合成** | **锁 C1**: Wave C **不**新增图 DB / embedding 依赖（可选 embedding 永远 opt-in 另 ADR）。**锁 C2**: `thread.related` 输入 = list 已带的 digest + 内存 `@` 边（若未持久化边，至少从消息/元数据可重建或先只做共 tag+TF）。**锁 C3**: tag **不**做全局 ontology；仅 normalize（小写、长度、敏感正则）— 同义合并 **P3+**。**锁 C4**: digest 仍可重建、非真相源（重申 IA）。 |

### Lane D — 安全 / 隐私 / 成本

| | |
|--|--|
| **主张** | 批量提取 cap 20；定时默认 off；AI 永不自动删；`@` 仅 summary_card。 |
| **反方** | 「一键为未标注提取」会在 200 线程库上默默烧 token；空闲自动 digest 等同用户未同意的后台 LLM。 |
| **合成** | **锁 D1**: 任意批量 extract 必须 **可见进度 + 可取消语义（至少完成当前批）+ 单次 ≤20**（已有协议上限）。**锁 D2**: 默认 **不** 在会话结束静默 extract；Wave B 若做 soft 触发，必须 **设置项默认 false** + fingerprint 冷却。**锁 D3**: 敏感 tag 正则保持；tldr 展示在 UI 时注意不放大密钥（仍本地）。**锁 D4**: 禁止默认全库扫描；「全部未标注」= 分页批处理 UI，非单请求无限。 |

### Lane E — llm_wiki 移植 vs 方法借鉴

| | |
|--|--|
| **主张** | 抄 llm_wiki：两步 CoT ingest、entity 页、4-signal graph、Louvain、overview.md。 |
| **反方** | 与 IA 反目标冲突（不做第二 Knowledge vault）；Side Panel 不是 wiki IDE；成本与职责双写 Knowledge/Obsidian。 |
| **合成** | **锁 E1**: **禁止** 把 Thread 列表升级为 llm_wiki 产品面（独立 wiki 引擎 / entity 页库 / 默认全图）。**锁 E2**: **允许借鉴**：(1) 编译一次（digest）而非每次检索重推；(2) 写入时维护边；(3) 多信号 related（共 tag / 共 `@` / TF / 可选时间邻近）；(4) Lint 式健康项并入整理助手（未标注、stale、孤立）。**锁 E3**: 若未来要「对话知识化」→ **另开 ADR**，导出到 Knowledge/Obsidian，不塞 ThreadList。 |

### Lane F — 「自动」的语义（与 U1 对齐）

| | |
|--|--|
| **主张** | 用户说「AI 自动整理」= 应后台默默打标。 |
| **反方** | IA 明确默认手动、定时 opt-in；静默 LLM 违成本与可预期性。 |
| **合成** | **锁 F1**: 产品文案区分三档：**(1) 一键整理**（用户触发批量）；**(2) 空闲整理**（设置 opt-in）；**(3) 全自动**（不做）。Wave A 只交付 (1)。**锁 F2**: UI 不用「自动」作主按钮文案，用「提取要点 / 整理标签」。 |

### Lane G — 实现切片边界（防 scope 爆炸）

| | |
|--|--|
| **主张** | 一次 PR 做完 A+B+C。 |
| **反方** | 入口+裁剪与 related/graph 风险面不同；混 PR 无法 dual-review 机核。 |
| **合成** | **锁 G1**: **Wave A 单独可合**（无 related API 也可验收）。**锁 G2**: Wave B 依赖 A 的入口稳定。**锁 G3**: Wave C 依赖 digest 覆盖率指标可观察（有 tag 线程占比或未标注数下降路径）。 |

---

## 4. 对立主张裁决总表

| ID | 议题 | 胜出 | 落败（明确不做） |
|----|------|------|------------------|
| A1–A2 | 默认导航轴 | 时间默认；A 先于 Graph | Graph 作主列表 |
| B1–B4 | 窄栏 | 修 ThreadList；Related 列表；全图弹出 | 默认全屏图书馆 / 默认脑图 |
| C1–C4 | 数据 | index digest + 本地 related | 图 DB / 默认 embedding / tag ontology |
| D1–D4 | 成本安全 | 可见批量 ≤20；默认无静默 LLM | 静默全库 / 无限 batch |
| E1–E3 | llm_wiki | 方法借鉴 | 产品移植 |
| F1–F2 | 「自动」 | 一键整理 + opt-in 空闲 | 默认全自动 |
| G1–G3 | 切片 | A→B→C 可独立合 | 单 PR 吞下全愿景 |

---

## 5. 优化分期（修订后可执行）

### Wave A — 可发现 + 可显示（P0 体验债 / 原 P1 补完）

**目标**: 用户打开列表后 **30 秒内**能完成「给若干历史会话打上标签」；Tags 视图在有数据后可用；U2 裁剪修复。

| # | 交付 | 验收 |
|---|------|------|
| A-1 | `⋯` 菜单：**🏷 为未标注提取要点**（≤20；跳过 busy + worker；empty-tags 用 `force:true` — GAP-11/12/13） | 无需多选即可触发；0 目标 disabled |
| A-2 | Tags 空态 / 高未标注态：主按钮同 A-1；文案去掉「点提取要点」虚指 | 文案与入口一致 |
| A-3 | 会话行：有 digest 时展示 **tldr 一行**（ellipsis）；tags 保持 | 可见「关键点」 |
| A-4 | 菜单裁剪修复：`⋯` 下拉不被 panel `overflow:hidden` 切掉 | 时间/标签两视图 5 项均可点 |
| A-5 | tag 云：**count-fold** + 折叠「更多」在 pills 外侧（无 height-clip） | 多 tag 时 更多始终可点 |
| A-6 | 多选底栏「提取要点」保留；可选：Tags 视图顶栏快捷按钮 | 回归不退化 |
| A-7 | 提取中状态：行内「抽取中」已有；批量时 toast 或顶栏进度「N/M」 | 可感知 |

**不做（Wave A）**: 设置页定时、related API、Graph UI、改 digest prompt、embedding。

### Wave B — 覆盖率引擎（原 P1 设置 + 轻量触发）

| # | 交付 | 验收 |
|---|------|------|
| B-1 | `config.thread_digest?: { enabled: false, on_idle_hours?, max_per_day? }` 设置 UI | 默认 false |
| B-2 | 可选：thread idle / 打开列表惰性队列（有 cap） | 不静默超 max_per_day |
| B-3 | stale 灰标扩展到时间视图（轻量） | 与 IA pin 可微调：仅非今日组 |
| B-4 | 整理助手增加「对勾选项：仅提取要点」入口 | 与删除分轨 |

### Wave C — 关联与探索（原 P2，吸收 llm_wiki 信号思想）

| # | 交付 | 验收 |
|---|------|------|
| C-1 | `thread.related`：`{ thread_id, limit }` → 本地共 tag + tldr/bullets 词重叠 + 可选时间邻近 | 无网络；&lt;100ms 量级于 &lt;1k threads |
| C-2 | 会话行 hover/详情或 Tags 选中后：**相关 3 条** | 可点击切换 |
| C-3 | Graph **弹出层**：节点=会话，边=共 tag（硬）/ TF 超阈（软）；力导向可简 | 不阻塞 list 打开 |
| C-4 | 整理助手 Lint 项：未标注数、stale 数、孤立（related 空） | 只建议不自动删 |

**信号权重（初值，可配置常数，非 ML）**:

| 信号 | 权重 | 说明 |
|------|------|------|
| 共 tag | ×3 | 集合 Jaccard 或加权交集 |
| 显式 `@` 引用 | ×4 | 若可从消息/元数据恢复；否则 Wave C.1 可 defer 到 C.1b |
| tldr+bullets 词重叠 | ×1.5 | 复用 semantic-match 纯 TF / CJK 2-gram 思路 |
| 时间邻近（同日/7 日内） | ×0.5 | 弱加成，防「全是最近会话」霸榜可关 |

**不做（Wave C）**: Louvain 社区主 UI、Deep Research、entity wiki 页、把边写入 Knowledge。

---

## 6. 与 IA-2026-08-06 的关系

| 项 | 关系 |
|----|------|
| 三轴原则 / 反目标 | **保持** |
| Pre-dev pins P1–P14 | **保持**（不重新打开） |
| 分期表 | **修订交付顺序**：原 P1「可发现」欠债 → **Wave A 优先**；原 P2 Graph → **Wave C** 且依赖覆盖率 |
| 新 pins | 本文件 §3 锁 A–G + §7 |

**非 supersede 全文**：本文件是 **gap + 优化增量 SoT**；冲突时以本文件 Wave 锁为准，其余仍从 IA-2026-08-06。

---

## 7. Pre-dev pins（本轮新增，开工前钉死）

| ID | 决策 |
|----|------|
| **GAP-1** | Wave A 无 Graph；有 A-1 批量入口 |
| **GAP-2** | 批量 extract 单次 ≤20；多批需用户再次点击（或明确「继续下一批」） |
| **GAP-3** | `⋯` 菜单在 time/tags **均完整可见**（裁剪修为 A 阻塞项） |
| **GAP-4** | tldr 展示 ≤120 字已有字段；UI 单行 ellipsis；bullets 可不进列表（进 related/详情可后置） |
| **GAP-5** | 产品主文案不用「自动整理」作按钮；用「提取要点」 |
| **GAP-6** | 不引入 llm_wiki 运行时 / entity 页 / 默认 Louvain |
| **GAP-7** | related 纯本地；无默认 embedding |
| **GAP-8** | Wave A/B/C **分 PR 或分 workflow phase**；A 可独立合 |
| **GAP-9** | ADR-020：仍 L0 metadata；禁止借机把 digest 写入 Knowledge |
| **GAP-10** | 测试：A 至少覆盖 tagIndex 未标注选取、菜单/入口存在性（组件或纯函数）；C 覆盖 related 排序稳定性 |
| **GAP-11** | **S1** 未标注批：`!digest \|\| tags.length===0` 用 `force:true`；有非空 tags 且非 stale 不入批 |
| **GAP-12** | **S2** 默认排除 worker 线程；包含 orchestrator / 普通会话 |
| **GAP-13** | **S3** 跳过 busy；0 目标时 CTA/菜单项 disabled |
| **GAP-14** | **S4** A-4 优先 portal 到 `document.body`（z > panel/backdrop） |
| **GAP-15** | **S5** 进度跟 `digest_updated`；禁止固定 60s 清掉仍在批内的 spinner |
| **GAP-16** | **S6–S7** C-1 无 `@` 边（defer C.1b）；related on-demand |
| **GAP-17** | **S9** Wave C 权重代码常量，非设置 UI |

---

## 8. 验收标准（可测）

### Wave A

- [ ] 新用户路径：☰ → 标签 → 主 CTA → 最多 20 线程进入抽取中 → `digest_updated` 后 tag 云出现  
- [ ] ☰ → ⋯ → 「为未标注提取要点」在 **时间** 与 **标签** 视图均可点满全部菜单项（无裁切）  
- [ ] 有 digest 的行显示 tldr 一行  
- [ ] tag 云超过阈值折叠；展开后 list 仍可滚动  

### Wave B

- [ ] 设置默认 `thread_digest.enabled === false`  
- [ ] enabled 时不超过 `max_per_day`  

### Wave C

- [ ] `thread.related` 对无 digest 线程返回空或弱结果且不报错  
- [ ] Graph 弹出不阻塞 list 首屏  
- [ ] 无新 L2/Compose 原语  

---

## 9. 反目标（本轮重申 + 增补）

- 不做云端会话图谱同步  
- 不做自动删除  
- 不做 Thread → 隐式 Knowledge 双写  
- 不做侧栏默认脑图  
- **不做** llm_wiki 级 ingest 双步 CoT 默认跑全库  
- **不做** 把「提取要点」藏在仅 icon、无批量路径的状态（Wave A 必须消灭）

---

## 10. 给双路外审的明确问题

1. 三轴 + 反目标是否仍成立？有无 **blocking** 需推翻？  
2. Wave A 是否 right-sized？有无应升为 blocking 的遗漏（如 worker 线程是否参与「未标注」批量）？  
3. U2（菜单显示不全）根因假设是否够开工？是否要求先复现脚本？  
4. llm_wiki 锁 E1–E3 是否过严或过松？  
5. Wave C 信号表是否应 defer `@` 边（无持久化时）？  
6. 能力声明 L0 / Compose none 是否被任何 Wave 条目违反？  
7. 是否批准：**双路通过后**用 workflow 按 A→B→C 实现（A 优先）？

---

## 11. 内部对抗结论（提交外审前自评）

| 问题 | 自评 |
|------|------|
| 方向推翻？ | **否** — 补交付与可发现性 |
| 最大产品风险 | 用户仍把「一键提取」叫作自动，期望后台全库 → 用文案 F1–F2 管理 |
| 最大技术风险 | 批量 LLM 成本与失败态；严格 cap + 进度 |
| 最大范围风险 | Graph 提前 → 用 A1/G1 门禁 |
| 可进外审？ | **是** |

---

## 附录 A — 用户路径线框（Wave A）

```
☰ ThreadList
├── [时间|标签]  [选择] [+新建] [⋯]
│                    └── ✨ AI 生成标题
│                        📝 未命名→首条起名
│                        🧹 清理空白
│                        🗂 整理助手
│                        🏷 为未标注提取要点   ← NEW
│                        🗑 回收站
├── 标签视图空态
│   └── [为未标注提取要点（最多20）]     ← NEW primary CTA
└── 会话行
    ├── title + badges
    ├── tldr…                            ← NEW if digest
    ├── #tag #tag
    └── [🏷] [📥]
```

## 附录 B — 证据索引

| 声明 | 路径 |
|------|------|
| extract 入口弱 | `ThreadList.tsx` `handleExtractDigest`；菜单无 extract 项 |
| overflow hidden | `styles.panel.overflow: "hidden"` |
| digest 管线 | `companion/src/threads/digest.ts` |
| 无 related | repo `rg thread.related` 无实现 |
| 原设计 P2 Graph | IA-2026-08-06 §B.3 / §E |

---

*Internal multi-lane adversarial synthesis. Not approved until dual external review both_ok.*
