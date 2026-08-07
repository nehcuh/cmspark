# 对话压缩 · 思考折叠 · 历史思考作压缩源 · 场景知识库 — 多路对抗调研与落地分析

> **日期**: 2026-08-07  
> **状态**: RESEARCH / LANDING ANALYSIS · **dual-review both APPROVE_WITH_NITS**（`context-memory-thinking-knowledge-verdict-20260807-100209`）  
> **触发**: 真实使用反馈 4 点优化  
> **方法**: 代码现状审计 + 外部文献/产品对照 + 四路对抗（Product · Impl · Security · External）  
> **轴 (ADR-020)**: Surface L0（chat UX + request budget）· Compose（Pack/场景 + Knowledge）· Autonomy n/a · Trust 不抬升  
> **Dual artifacts**:  
> - Claude: `docs/audit/reviews/context-memory-thinking-knowledge-claude-20260807-100209.md`  
> - Pi: `docs/audit/reviews/context-memory-thinking-knowledge-pi-20260807-100209.md`  
> - Prompt: `docs/audit/reviews/context-memory-thinking-knowledge-dual-review-prompt-20260807.md`  
> **相关 SoT**:  
> - `docs/superpowers/specs/2026-08-06-settings-thread-compact-ux.md`（Runtime M1/M2；**其「M3」= UI 消息中间折叠，与本 doc 无关**）  
> - `docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md`（Digest / @ref）  
> - `docs/superpowers/specs/2026-08-06-user-scene-tools-and-ai-create.md`（用户场景；**未含知识**）  
> - `docs/archive/2026-07/proposals/knowledge-mgmt-proposal/final-design.md`（保守方案已实现模式+站点分组；**知识预设**在折中方案才有、未做）  
> - VibeSOP `builtin/session-end` 三层记忆

---

## 0. 执行摘要（先读这 1 页）

| # | 用户直觉 | 现状 [inspected] | 对抗结论 | 推荐落地 |
|---|----------|------------------|----------|----------|
| **1** | 压缩像 session-end：热加载核心 + 冷存可搜 | M1 head-drop + M2 rolling bullets；磁盘全文保留；Digest 独立不进压缩热路径 | **方向正确**；不要合并三系统；做 **H1 ThreadHandoff**（勿称 M3，避免与 compact-ux SoT 的「M3=消息中间折叠」撞名） | P0: 锚定结构化 handoff（session-end 风格 schema）替换/增强 M2 散文；P1: 冷存索引 + `thread_recall` 工具 |
| **2** | 思考过程保留 + 默认折叠 | **已基本落地**：`reasoning_content` 持久化 + `ReasoningBlock` 直播开/落盘后默认折叠（现状 = `auto_live`） | **产品层完成度高**；缺口在历史回灌与跨 provider | P0: 确认历史线程 reload 一致；P1: 导出开关；**不要**默认把 thinking 回灌 LLM |
| **3** | 外部用「历史思考」当压缩内容 | Anthropic 明确：thinking block **不可改**（签名 mismatch → 400）且常 **不进后续 wire**；业界主流是 **结构化摘要 / 锚定 handoff**，不是原样塞 thinking | **可吸收「思考里的决策与约束」**，**禁止**把 raw thinking 当 compact 主体 | P0: H1 handoff 抽取时 **可选** 读 redacted reasoning 作 **输入**，输出仍是结构化 handoff；永不原样注入 |
| **4** | 场景应可预配知识库 | Pack YAML 已有 `knowledge:`；内置包会装入 global；**用户场景 UI 完全无知识配置**（仅 prompt/技能/MCP/tools） | **高 ROI 缺口**；与产品特色（global + site knowledge）对齐 | **P0 优先做**：用户场景勾选 knowledge ids + mode；apply 时写入 thread |

**总优先级（对抗后 · dual 确认）**：

```text
P0-A  场景可配知识库（Compose 闭环，差异化高；effort 修订 4–6 人天更现实）
P0-B  H1 锚定 ThreadHandoff（session-end 风格核心抽取；增强而非替换 M1）
P1    冷存可检索（digest/fingerprint；thread_recall 强制复用 redactMessagesForCompaction）
P1    思考：历史一致性 / 导出 / 压缩输入侧「可选消费」
P2    向量检索 / 跨 session 外部记忆（勿与 runtime budget 混为一谈）
```

---

## 1. 现状地图（代码事实）

### 1.1 三套「摘要」系统（已锁定 glossary，禁止合并）

| 系统 | 位置 | 用途 | 进 LLM？ |
|------|------|------|----------|
| **Runtime context budget** | `context-budget.ts` / `context-budget-m2.ts` / `adapter.ts` | 请求路径 turn-safe head-drop + omit/summary notice | **每轮 request 组装**；omit **不写磁盘** |
| **ThreadDigest** | `threads/digest.ts` | 搜索 / `@` 引用卡（tldr/tags/bullets） | 仅 `@` 显式 |
| **Export summary** | Obsidian / NotebookLM | 出站笔记 | 导出管道 |

SoT 明文禁止：共享 prompt、把 M2 写进 digest、export 默认夹 omit。

### 1.2 Runtime 压缩算法（M1 / M2）

- **M1**: `compactMessagesTurnSafe` — 保 system；assistant+tool 成对 drop；不 drop 最后 user；插入 `[context_omitted]` / `[context_summary]` user 边界消息。  
- **M2**: 对 dropped 消息 `redactMessagesForCompaction` → LLM 5–12 条 bullets；默认策略 pre_loop + ≥3 msgs 或 ≥500 tok。  
- **安全**: cookie/host/shell 等敏感工具体 redact；audit 只 hash+length。  
- **诚实性**: 磁盘与 UI 仍可显示全文；chip 声明「模型上下文已压缩」。

### 1.3 session-end 模式（用户对标）

VibeSOP session-end 不是「丢消息」，而是：

| 层 | 写什么 | 热/冷 |
|----|--------|------|
| Hot | `memory/session.md` 当前进展 / next | 下一会话首读 |
| Warm | `project-knowledge.md` 坑/模式/ADR | 按需 |
| Cold | `overview.md` + handoff 块（只留最近 2） | 状态扫一眼 |
| Optional | instinct / skill-craft | 进化层 |

**与 M2 的本质差**：session-end 产出 **可复用、分层、可 trim 的外部记忆**；M2 产出 **单次 request 内的散文 rolling summary**。

### 1.4 思考过程

| 环节 | 状态 |
|------|------|
| 流式 | `chat.reasoning` → UI live `ReasoningBlock`（`open=true` while live） |
| 落盘 | `thread-manager` / types：`reasoning_content?: string` |
| 历史 UI | 非 live → **默认折叠**（`useEffect`: `!live && !userToggled → setOpen(false)`） |
| 本轮 request | 当前 turn 的 assistant 消息会带 `reasoning_content` 进 `messages` 数组 |
| **历史 rebuild** | `rebuildMessagesFromHistory` **不回灌** `reasoning_content` |
| Anthropic wire | `anthropic-convert` **故意 drop** reasoning（M7） |
| DeepSeek | 依赖 provider；历史重建后同样丢失 |

→ 用户诉求「保留 + 默认折叠」在 **UI 层已基本满足**；缺口主要是 **导出/一致性/是否用于压缩**，不是「从零做折叠」。

### 1.5 知识与场景

| 能力 | 状态 |
|------|------|
| global / sites 目录 | `~/.cmspark-agent/knowledge/{global,sites}` |
| 线程模式 | `knowledge_selection_mode`: auto \| all \| manual |
| auto | active ∪ site-match(hostname) |
| Pack YAML `knowledge:` | validator + install 到 global；内置 AppSec/NetSec 有 baseline |
| apply | 可设 `thread_defaults.knowledge_selection_mode` |
| **用户场景 UI** | PacksPanel 文案：**system prompt / 技能 / MCP / tools** — **零 knowledge 控件** [inspected] |
| 知识管理提案 | 2026-06 保守方案已实现模式+站点分组；**「知识预设」在折中方案才有**，未做 |

---

## 2. 外部证据（要点 + 对 CMspark 的含义）

### 2.1 Anthropic：Context engineering

- Compaction = 把长对话蒸馏为高保真摘要后继续。  
- 更安全的轻触：tool result clearing；memory tool 把知识放到窗口外再按需加载。  
- Claude Code：把 history 交给模型 summarize/compress 关键细节。  
→ **对齐我们的 M2 方向**；并强调 **just-in-time 加载**（类似 session-end 热核心 + 冷检索）。

### 2.2 Anthropic / Claude：thinking 与 compaction 的冲突

- Extended thinking 的 `thinking` / `redacted_thinking` **必须保持原始形态**，compaction 改写会触发 400（社区大量报告）。  
- Cookbook 在 session memory 路径上 **主动 strip `<think>`**，摘要里不需要 thinking 原文。  
→ **禁止**「直接拿历史思考原文当压缩后的 context 主体」；若用，只能作 **抽取输入**，输出结构化、可编辑、无 signature 约束的 handoff。

### 2.3 OpenAI Agents SDK：trim vs summarize

- Trimming：零额外延迟，长程遗忘硬切。  
- Summarization：长程记忆强，有 **summary drift / context poisoning**。  
→ 我们已有 M1≈trim + M2≈summarize；下一步应是 **structured handoff** 降低 drift。

### 2.4 Mem0 / Factory：压缩 ≠ 记忆

生产共识三层：

1. In-context working memory（当前 lossless 尾部）  
2. Compressed session memory（**锚定增量摘要**优于每次全量重生）  
3. External persistent store（跨会话事实；**write-before-compaction**）

压缩常丢失：精确数字、硬约束、决策理由、跨 turn 依赖、隐式偏好。  
→ session-end 风格的 **Facts / Decisions / Constraints / Open todos** schema 正是补这五类损失。

### 2.5 OpenDev ACC 等 agent scaffold

- 分级压缩；observation 归档后提示「需要时再 read_file」。  
→ 与「核心热加载 + 压缩体可搜索」同构；我们已有 **磁盘全文**，缺的是 **agent 可调用的检索面** 与 **更好的热核心**。

### 2.6 用户所说「拿模型历史思考当压缩内容」的合理还原

业界常见三种误传/变体：

| 变体 | 评价 | 我们是否采用 |
|------|------|--------------|
| A. 把 raw thinking 原样塞进 summary 位置 | 高 token、高噪声、Anthropic 不可改签名、易泄露中间错误假设 | **拒绝** |
| B. 用 thinking 作为 **summarizer 的额外输入**，输出仍是结构化状态 | 决策理由更完整（Mem0 指出「why 易丢」） | **有条件采用** |
| C. 单独存 thinking 供人调试，压缩路径完全不用 | 产品调试价值高 | **已接近现状** |

---

## 3. 四路对抗

### 3.1 Product / UX

**立场**：用户痛点是「长聊后模型变傻 + 场景冷启动缺知识」，不是「再多一个摘要系统」。

| 点 | 主张 |
|----|------|
| 1 | 热层要像 handoff：**目标 / 决策 / 约束 / 待办 / 关键路径**；冷层「可搜」要有 UI 入口（至少「查看已压缩摘要」已有，可扩展「从历史定位」） |
| 2 | 思考折叠 **已交付**；可加：设置「默认展开思考」、导出是否含思考 |
| 3 | 不要对用户说「我们用思考当记忆」——话术改为「从完整对话（含思考）提炼工作记忆」 |
| 4 | 场景编辑器与技能对称：知识多选 + mode；应用时 toast 说明注入了哪些 |

**Blocking floors**

- F-UX-A：不静默丢用户可见消息（保持 dual-truth）。  
- F-UX-B：场景知识配置与线程 Knowledge 面板语义一致，避免双源困惑。  
- F-UX-C：压缩 chip 可点开看 handoff（结构化优于长散文）。

### 3.2 Impl / Architecture

**立场**：在现有 M1/M2/Digest 边界上 **加层**，不重写。

| 点 | 主张 |
|----|------|
| 1 | **H1 ThreadHandoff**（命名：勿用 M3）字段进 `runtime_context_budget` 或 thread meta；**实现前必须锁死** schema 名/类型/长度 cap：候选 `goals[]` `decisions[]` `constraints[]` `open_todos[]` `artifacts[]` `last_compact_at`；M2 bullets 可迁移为 fallback |
| 1b | 锚定增量：新 drop 区间只 merge 进 handoff，不全量重生（对齐 Factory anchored） |
| 1c | 冷检索：P1 用现有消息磁盘 + digest/fingerprint；工具 `thread_recall`（限本 thread、**强制复用** `redactMessagesForCompaction` + `buildRedactedTranscript` cap、token budget） |
| 2 | ReasoningBlock 无需大改；现状默认 = **auto_live**（`useState(live)`）；可选 Settings 与 LS |
| 3 | 压缩抽取 prompt **可选**附加 `reasoning_content` 的 redacted 切片（长度 cap）；输出 schema 与 reasoning 解耦 |
| 4 | Pack：`knowledge_ids: string[]` 用户场景；apply 写入线程激活集。**实现前决议**：新建 `active_knowledge_ids` vs 复用/扩展 `active_skill_ids`（知识 mgmt 提案 D1 倾向独立字段；当前 engine 部分路径经 skill ids） |

**Blocking floors**

- F-I-A：三系统 glossary 不破。  
- F-I-B：handoff / omit 仍 request-path 优先；磁盘可选 meta 存 handoff 供 UI/chip。  
- F-I-C：`rebuildMessagesFromHistory` 默认 **不** 回灌 reasoning（防 token 爆炸 + Anthropic 兼容）；若 DeepSeek 未来要求，做 provider flag。  
- F-I-D：场景 knowledge 只引用用户已有 knowledge 或 pack 资产，sanitize 同 skill import。

### 3.3 Security / Trust / Privacy

**立场**：思考与压缩是 **高敏旁路**。

| 点 | 主张 |
|----|------|
| 1 | handoff 抽取 **强制** 走与 M2 同级或更严的 redact；constraints 可含「勿提交密钥」类元约束，不得含密钥值 |
| 2 | thinking 常含失败猜测、内部策略试探；**默认不对用户外泄到 export**；UI 保留即可 |
| 3 | 禁止把 thinking 当「可信记忆」；handoff 条目应可被用户编辑/删除（防 context poisoning） |
| 4 | 场景预配知识：content 已经 sanitizer；site_knowledge 不因场景绕过 hostname auto 的安全语义；**manual 固定集合**可接受 |

**Blocking floors**

- F-S-A：handoff audit：schema + sha + bytes，无全文。  
- F-S-B：thinking 不进 Obsidian 默认导出。  
- F-S-C：`thread_recall` 不做跨 thread 隐式注入（`@` 仍是显式）。  
- F-S-D：场景 trust 与 knowledge 正交；知识不能抬升 auto_approve。

### 3.4 External / Research adversary

**立场**：对标 2025–2026 主流，避免重复踩坑。

| 陷阱 | 我们的规避 |
|------|------------|
| 把 compaction 当 memory | 分层：runtime handoff ≠ project knowledge ≠ digest |
| 每次全量重生 summary | 锚定增量 |
| thinking 参与 compact 导致 400 | 抽取用副本；wire 仍 drop |
| 只 trim 不 summarize | 已有 M2；增强结构 |
| 向量库过早 | 场景知识 + handoff 先于 embedding |
| 场景只配 prompt 不配知识 | P0 补 Compose |

---

## 4. 分点深度结论

### 4.1 优化点 1：session-end 式分层压缩

**结论：应该做，但是「增强 M2 → H1 ThreadHandoff」，不是另起第四套互相打架的摘要。**

推荐架构：

```text
┌─────────────────────────────────────────────────────────────┐
│  Working tail（最近 N turn，无损）                           │
├─────────────────────────────────────────────────────────────┤
│  Hot handoff（session-end schema，每轮 compact 锚定 merge） │
│    goals / decisions / constraints / open_todos / artifacts │
├─────────────────────────────────────────────────────────────┤
│  Cold archive（磁盘全文 + digest 索引；可选 BM25）           │
│    agent: thread_recall(query) 或用户 @ 本 thread 段落      │
└─────────────────────────────────────────────────────────────┘
```

与 session-end 映射：

| session-end | CMspark 对应 |
|-------------|--------------|
| session.md 热条目 | Hot handoff in request |
| project-knowledge | **不要**自动写（污染全局）；可选「提炼为 knowledge 文档」显式动作 |
| overview/handoff trim | handoff 字段 cap + 合并 |
| 全文 git 历史 | 线程消息磁盘 |

**不推荐**：自动把每轮 handoff 写入 `knowledge/global`（噪声 + 权限 + 用户不可控）。

### 4.2 优化点 2：思考保留 + 默认折叠

**结论：UI 目标已基本达成；做 polish，不做重做。**

已有：

- 持久化 `reasoning_content`  
- 默认折叠（完成后）  
- 流式自动展开  

建议 polish（小）：

| ID | 项 |
|----|----|
| T1 | Settings：`ui.show_reasoning`: always_collapsed \| auto_live \| always_open |
| T2 | 消息菜单：复制思考 / 折叠全部思考 |
| T3 | Export：默认 **不含** reasoning；高级勾选 |
| T4 | 文档：说明历史 rebuild 不把思考回灌模型（省 token + provider 兼容） |

### 4.3 优化点 3：历史思考作为压缩内容

**结论：吸收「决策理由」信息增益；拒绝 raw thinking 当 compressed payload。**

推荐管道：

```text
dropped messages (redacted)
  + optional redacted reasoning slices (cap e.g. 1.5k tokens total)
       │
       ▼
  extract ThreadHandoff (structured JSON)
       │
       ▼
  inject as [context_handoff] user/system boundary  (NOT raw thinking)
  // Wave B: chip / contextCompacted UI 须识别 [context_handoff]
  // 与现有 [context_omitted] / [context_summary] 并列
```

Prompt 规则（摘要）：

- 优先：用户约束、已做决策及 **why 一句**、未完成 todo、关键 URL/文件名  
- 禁止：复述完整 CoT、密钥、tool 大段 dump  
- 若 thinking 与 final answer 冲突，以 **user 可见 final + tool 结果** 为准  

### 4.4 优化点 4：场景预配知识库

**结论：强烈建议 P0；这是当前 Compose 面最大的产品缺口之一。**

现状 asymmetry：

| 资源 | 用户场景可配 | 内置 pack |
|------|--------------|-----------|
| system prompt | ✅ | ✅ |
| skills | ✅ | ✅ |
| MCP | ✅ | ✅ |
| tools | ✅（近期） | ✅ |
| **knowledge** | ❌ UI | ✅ YAML |

落地最小集：

1. **用户场景编辑**：从 `knowledge.list` 多选；存 `knowledge: []` 相对或 **id 列表**（推荐 id，避免复制膨胀）。  
2. **apply**：`active_knowledge_ids = preset ∪ 用户线程已选`；`knowledge_selection_mode` 默认 `manual`（与内置 AppSec 一致）或 `auto`+preset 固定并入（产品二选一，推荐 **manual + preset 写入 active**）。  
3. **文案**：PacksPanel 补「知识库」与技能对称。  
4. **AI 生成场景**：`recommend` 可建议 knowledge ids（不自动写 secret 型文档）。  
5. **site_knowledge**：场景可 pin 站点知识；运行时仍可叠加 auto site-match（若 mode=auto）。

场景示例：

- AppSec：OWASP baseline（已有）  
- 内网运维：运维 runbook global knowledge  
- 竞品研究：固定竞品站点 site_knowledge  

---

## 5. 落地波次（可直接开 issue）

### Wave A — 场景知识（P0，预估 **4–6 人天** · dual 修订）

- [ ] 决议：`active_knowledge_ids` 独立字段 vs 扩展现有 skill 激活路径  
- [ ] pack schema / saveUserPack：`knowledge_ids: string[]`（+ snapshot/undo）  
- [ ] PacksPanel 多选知识  
- [ ] apply/unapply 与 thread 激活集 / mode；site_knowledge preset × auto hostname 语义写清  
- [ ] 单测 + 文案 + sanitize  
- [ ] 不碰 Trust

### Wave B — H1 ThreadHandoff（P0/P1，预估 4–7 人天）

- [ ] **冻结** schema 名/类型/长度 cap + 中文标签（产品确认）  
- [ ] extract prompt（锚定 merge）  
- [ ] 替换/增强 M2 rolling 散文为 handoff 注入（`[context_handoff]`）  
- [ ] chip UI 展示结构化 handoff（与 rolling_summary 并列）  
- [ ] audit + redact 单测  
- [ ] 可选：抽取输入含 reasoning redacted

### Wave C — 冷检索（P1，预估 3–5 人天）

- [ ] `thread_recall` 工具（本 thread、budget、**复用** `redactMessagesForCompaction`）  
- [ ] 或复用 `@` + digest 增强「已压缩区间」提示  
- [ ] **不做** 默认跨 thread 向量库

### Wave D — 思考 polish（P1，预估 1–2 人天）

- [ ] 设置项 `ui.show_reasoning`: always_collapsed \| **auto_live（默认）** \| always_open  
- [ ] 导出开关（默认不含 reasoning）  
- [ ] 文档说明 rebuild 策略

### 明确非目标（本阶段）

- 合并 Digest / Export / Runtime 为单一摘要引擎  
- 自动 session-end 写入 project-knowledge  
- 默认把 reasoning 回灌所有 provider  
- 上线 embedding 依赖的「全局记忆」作为压缩替代

---

## 6. 风险与成功标准

| 风险 | 缓解 | 成功标准 |
|------|------|----------|
| handoff poisoning | 用户可编辑；审计；以 tool 结果为准 | 长会话 50+ turn 约束保持率人工抽检 ≥ baseline M2 |
| 场景知识爆炸 | compact index + manual mode；cap 注入全文数 | 场景 apply 后首条延迟增幅 < 200ms 本地 |
| thinking 泄露 | 默认不导出；redact 进抽取 | 导出 diff 无 reasoning 除非勾选 |
| 系统过多用户懵 | chip 文案统一「工作记忆 / 完整记录」 | 用户能说清：列表仍完整、模型可能只看 handoff+尾部 |

---

## 7. 对抗决议记录

| 冲突 | 决议 |
|------|------|
| session-end 写全局 knowledge vs 仅 thread handoff | **默认仅 thread handoff**；全局写入必须用户显式「提炼为知识」 |
| raw thinking 作 summary vs 仅作输入 | **仅作输入** |
| 思考默认展开 vs 折叠 | **保持现状：live 开 / 完成后折** |
| 场景 knowledge mode auto vs manual | **preset 写入 active + mode=manual 默认**（可设置改 auto） |
| H1 替换 M1 | **否**；M1 保底，H1 增强热层 |

---

## 8. 引用（外部）

- Anthropic Engineering: [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)  
- Claude Platform: [Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) · [Session memory cookbook](https://platform.claude.com/cookbook/misc-session-memory-compaction)（strip thinking）  
- OpenAI Cookbook: [Session memory — trimming vs summarization](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory)  
- Mem0: [Context Compression vs Memory in AI Agents](https://mem0.ai/blog/context-compression-vs-memory-in-ai-agents)（三层 + write-before-compaction）  
- Factory: [Evaluating context compression](https://docs.factory.ai/guides/power-user/evaluating-context-compression) / anchored incremental summarization  
- 社区：Claude Code thinking / `redacted_thinking` 改写导致 compaction **400**（签名不可改；非泛泛「rewrite 失败」）— e.g. [claude-code#12973](https://github.com/anthropics/claude-code/issues/12973)

---

## 9. Dual-review nits 吸收记录（2026-08-07）

| 来源 | Nit | 处置 |
|------|-----|------|
| Pi N1 | 「M3」与 compact-ux SoT 的 M3（UI 消息中间折叠）撞名 | **重命名为 H1 ThreadHandoff**（全文） |
| Claude N1 / Pi N5 | schema 字段未锁死 | Wave B 首项：冻结 schema + 产品确认中文标签 |
| Claude N2 | Wave A 2–4 人天偏乐观 | **修订 4–6 人天** |
| Claude N3 / Pi | thread_recall 缺 redact 细节 | 强制复用 `redactMessagesForCompaction` |
| Claude N4 | show_reasoning 默认未写明 | 默认 **auto_live** |
| Claude N5 / Pi N2 | 外部引用无 URL | §8 补链接 |
| Pi N3 | active_knowledge_ids vs skill ids | Wave A 首项决议 |
| Pi N4 | `[context_handoff]` chip 识别 | Wave B chip 项 |
| Claude N6 | knowledge-mgmt 提案引用 | header 相关 SoT 已点名折中方案「知识预设」 |

**R1–R6 全过**；无 blocking。可开 Wave A issue / 正式 design 升格。

---

## 10. 建议下一步

1. **产品确认** Wave A（场景知识）是否立刻开工（dual 支持 P0）。  
2. **产品确认** H1 handoff schema 字段中文标签 + 字段冻结。  
3. 实现批次再跑 `scripts/dual-external-review.sh`（本 dual 仅覆盖 **分析 SoT**，不覆盖实现 diff）。

---

*多路对抗调研完成 · dual Claude+Pi APPROVE_WITH_NITS · 2026-08-07 · 证据级别：代码 [inspected+dual spot-check] · 外部 [web] · 未跑 e2e 新代码*
