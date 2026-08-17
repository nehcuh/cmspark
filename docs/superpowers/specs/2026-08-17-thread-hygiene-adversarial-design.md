# 会话卫生（未命名 / 编程接力 husk / 整理空白）— 多路对抗产品设计

**日期**: 2026-08-17  
**状态**: **设计已拍板**（用户裁决 C′ + D · 待写实现计划）  
**坐标**（[ADR-020](../../adr/020-capability-model-three-axes.md)）：**产品特性 / 聊天面 UX（L0）** — 不引入 Skill / Knowledge / Pack / L2。ACP 仍是 Composition 门面（[ADR-025](../../adr/025-acp-coding-agent-client.md)），不是第二套聊天产品。  
**前序 SoT**:

- [2026-08-06-thread-history-ia-product-design.md](./2026-08-06-thread-history-ia-product-design.md)（下称 **IA-2026-08-06**）
- [2026-08-11-thread-history-ia-gap-optimization-adversarial.md](./2026-08-11-thread-history-ia-gap-optimization-adversarial.md)

**本轮方法**: 五路独立对抗（A 产品 JTBD / B 列表呈现 / C 起名生命周期 / D 清理规则 / E 安全成本），再交叉合成。用户在合成稿上拍板两处分歧。

**触发**: 用户点完「整理会话 + 清理空白」后，历史里仍有意义不明的对话（举例 `4j6l6f`、`rny77t`）。

---

## 0. 能力声明

```text
Surface:      L0 chat UX / thread list + index alias
L2-classes:   (none)
Compose:      none new — ACP title uses first-party session metadata only
              (agent_id / mode / outcome). Handback body is DATA, never a title source.
Autonomy:     no auto-delete; organize applies only after user confirm
Trust:        every gone path (cleanup_empty / trash) must releaseTrustBeforeThreadGone
Channel:      community | enterprise unchanged
```

**Blast tier**: T1（UI 呈现 + 规则引擎）+ T1（alias 写点收口）。无新 LLM 默认路径。

---

## 1. 问题重述（用户可观察）

| # | 用户陈述 | 现象层（2026-08-17 本机实测） |
|---|---------|------------------------------|
| U1 | 历史里还有很多未命名 / 意义不明的对话 | 列表标题位是「未命名」或暗号 `p1-wl`，人用 `#4j6l6f` / `#rny77t` 指认 |
| U2 | 点了整理会话、清理空白，它们还在 | 两套工具扫不到、也删不掉这类行 |

**实测锚点**（`~/.cmspark-agent/threads/`，[executed]）：

| id | alias | 消息 | 判定 |
|----|-------|------|------|
| `rny77t` | `""` | 2 条 assistant，皆「编程接力」handback；0 user | ACP husk |
| `4j6l6f` | `p1-wl` | 1 条 assistant，「编程接力 · pi」失败（No API key）；0 user | ACP husk + 暗号 alias |
| `2b8ckp` | `""` | 0 条 | Empty（当日新建） |
| `t4s8kw` | `p1-wl` | 1 条长 ACP handback（有实质 diff） | ACP 实质，**不是 husk** |
| `vpfb7g` | `p1-wl` | 215 条，有 user | 真聊，禁止动 |
| 另 5 条 | `p1-wl` | 真聊或薄会话混合 | 同名簇，不是垃圾类 |

**实现为什么空转**（[inspected]）：

1. `cleanupEmpty()` 只硬删 `message_count===0`。handback 一写入 assistant，就不是空白。  
2. `batch_auto_title` 要首条 **user**；`generateThreadTitle` 要 user+assistant。无用户回合永远不起名。  
3. 整理助手默认 `to = now-30d`（`ThreadList.runCleanupScan`），近 30 天更新的行根本不进扫描。  
4. 规则集无 `no_user` / `acp_husk`。即便窗=0，`rny77t` 也不匹配任何现规则。  
5. `4j6l6f` 已有 alias，batch 跳过；用户仍觉得无意义，因为 **没有自己的回合**。

一句话：不是按钮坏了，是 **合同瞄错了对象和时间**。

---

## 2. 相对旧 SoT 的显式修正

| 旧锁 | 本轮 | 理由 |
|------|------|------|
| IA-2026-08-06 §B.6：整理默认「30 天前～更早」 | **改默认**为「全部（含近期）」 | 用户要清的是眼前工作集，不是档案 |
| IA-2026-08-06 §B.1：空别名展示 `未命名 · {id前6}` | **否决字面**。标题禁止再塞 id；`#id` 只当徽章 | 实现已拆开；再拼回去会让人把徽章当名字 |
| 「无意义 = 标题不好听」 | **否决**。无意义 = **没有用户回合** | `4j6l6f` 已有 `p1-wl` 仍被点名 |
| （本轮新增）预勾策略 | 用户选 **D**：薄空壳默认勾 | 见 §4 分歧 2 |

**不推翻的旧锁**：时间是默认组织轴；AI 永不自动删；AI 元数据是索引不是真相；窄栏 ~320px；Graph 永不取代时间轴；worker 默认不进整理。

---

## 3. 多路对立对抗（摘要）

每条车道独立产出「主张 → 反方 → 锁」。此处只保留交叉后仍成立的裁决。完整车道稿在会话内，不另存五份。

### Lane A — JTBD

| | |
|--|--|
| **主张** | 本题是近端工作集卫生：今天/昨天不应把 husk 当对等真聊。 |
| **反方** | 用户要的是全库语义标题；清 husk 会毁掉失败回执；`p1-wl` 是工作区码。 |
| **合成** | **A1** 只做工作集卫生，不做知识化。**A2** 无意义=无 user 消息。**A5** 同名不是垃圾类。**A6** `#id` 留下。**A8** 当前空草稿不是问题。 |

### Lane B — 列表呈现

| | |
|--|--|
| **主张** | 先修呈现：空 alias 用闭环来源名词，不要让 6 位 id 当唯一可读词。 |
| **反方** | 列表展示 handback 摘录 = 不可信文本进特权 chrome；藏 `#id` 毁复制搜索。 |
| **合成** | **B1** 显示阶梯（不写库也可工作）。**B4** handback 正文零进入列表。**B5** 重复 alias 不重题，用时钟消歧。 |

### Lane C — 起名生命周期

| | |
|--|--|
| **主张** | 第一次有意义事件就要有标题；ACP 终态写结构化临时名。 |
| **反方** | 用 handback 起名是索引投毒；静默改 `p1-wl` 是破坏用户短码。 |
| **合成** | **C′（用户拍板）**：新 ACP 终态且 alias 为空 → 写闭枚举；旧行只走 B 显示；非空 alias 绝不静默改。 |

### Lane D — 清理规则

| | |
|--|--|
| **主张** | 默认窗含近期；新规则抓住无 user；`cleanup_empty` 语义冻结；安全从时间窗转移到预勾策略。 |
| **反方** | 窗一开 + 全选预勾 = 昨天真短聊进回收站；扩 `cleanup_empty` 毁文案契约。 |
| **合成** | **D1** 默认全部。**D2** 空白语义冻结。**D5** 禁止扫描全选。**预勾采用 D 进攻面**（用户拍板，见 §4）。 |

### Lane E — 安全 / 成本

| | |
|--|--|
| **主张** | 宁漏删勿误删；新规则不勾；ACP 标题闭枚举；0 LLM；无额外 list I/O。 |
| **反方** | 再「安全」= 按钮继续假死。 |
| **合成** | 召回必须修（E 同意）。预勾被用户改成 D（比 E 更进攻）。E 的禁止清单其余全部保留。 |

---

## 4. 用户拍板的两处分歧

### 4.1 起名写库 — **C′**

- **旧行 / 尚未终态**：只改呈现（B 阶梯），不回填 alias。  
- **今后 ACP 会话终态且 `alias` 为空**：写 `接力·{agent}·{审查|起草|失败|部分|取消}`。  
- **已有非空 alias**（含 `p1-wl`）：静默写点一律停。

### 4.2 预勾 — **D**（进攻面）

Lane D 原文有一处内部不一致：规则表把 `acp_husk` 写成默认不勾，fixture 表却把 `rny77t` / `4j6l6f` 标成「非 ACP 的 `no_user`」并预勾。现场两条 **就是** ACP 形。

用户选 D 的意图是：**薄且无用户回合的眼前脏行，扫描后应已勾上**，不必再点「勾选空壳」。

**本规格锁死的预勾表**（以用户意图为准，修正 D 的分类错误）：

| reason | 默认勾 |
|--------|--------|
| `empty`（0 消息） | **勾** |
| `no_user` 薄（assistant 去空白 &lt;400 字） | **勾** |
| `acp_husk` 薄/失败 | **勾** |
| `no_user` 厚 / `acp_husk` 实质 | 不进建议，或进了也不勾（见 §6：实质 **omit**） |
| `short_orphan` 且 `updated_at` 在 14 天内 | **不勾** |
| `short_orphan` 更早 | 勾 |
| `stale_thin` / `duplicate_alias` / `worker_orphan` | **不勾** |

仍禁止「全选」作主按钮。确认框若包含 `acp_husk`，必须加警告：「含编程接力记录，请再核对。」

---

## 5. Pre-dev pins（可测试）

### 5.1 定义

| 术语 | 操作定义 |
|------|----------|
| **Empty** | `message_count===0`，且不是当前 active 草稿 |
| **Untitled** | `alias.trim()===""` |
| **Cryptic / 已提交短码** | 非空 alias，且不是系统临时形态（`接力·…` / `worker:…` / 等于当前首条 user 截断） |
| **ACP 形** | 存在第一方 ACP 会话记录；**或**（仅 companion 侧规则扫描）任一条 assistant 以产品模板头 `【编程接力` 开头。客户端列表 **禁止** 用该正则嗅探正文来决定呈现 |
| **ACP husk** | 0 条 user **且** ACP 形 **且**（去空白 &lt;200 字 **或** 失败模板：`No API key` / `denied` / `cancelled` / `timeout` / `spawn failed` / `user_denied`） |
| **ACP 实质** | ACP 形 + 0 user + 去空白 ≥200 字 + 非失败模板 |
| **no_user** | ≥1 条消息、0 条 user、**非** ACP 形 |
| **薄 no_user** | 上条 + assistant 去空白合计 &lt;400 字 |

系统临时形态（可被后续 LLM 升级，不算用户提交）：

- 空  
- `接力·{agent}·{token}`（token 闭集）  
- 与 `provisionalTitleFromUserText(首条 user)` 相等  

`p1-wl` **不是** 系统临时形态。

### 5.2 呈现（B）

**P-B1 Primary 阶梯**（显示-only；有真 alias 则原样）：

1. `alias.trim()` 非空且 ≠ 本线程 id → 原样（含 `p1-wl`、含已写下的 `接力·pi·失败`）  
2. 否则 `message_count===0` → `空会话`  
3. 否则有第一方 `acp_list` → `编程接力`  
4. 否则 `user_message_count===0` → `无用户消息`  
5. 否则有 `first_user_preview` → `aliasFromFirstUserText(preview, 24)` **仅显示**  
6. 否则 → `未命名`

**P-B2** 禁止标题内联 id。匹配 `/未命名\s*·/` 为失败。

**P-B3** `#id` 徽章每行常驻；点击复制 bare id；搜索 `#id` / `id` 仍命中。

**P-B4** 列表 chrome 不得出现 handback 体、`### 摘要`、assistant 正文、`UNTRUSTED_ACP_HANDBACK`。证据行只许：digest tldr **或** `first_user_preview` **或** 用户 goal 截断 **或** 第一方模板句 `编程接力 · {agent} · 完成|部分|失败`。最多一行。

**P-B5** 同 alias 在已加载列表出现 ≥2 次时，相对时间改为 `今天 HH:mm` / `MM-DD HH:mm`。禁止 `p1-wl (2)` / `同名 7`。

**P-B6** `workspace_root` / basename 永不升格为标题或证据。

**P-B7** 闭环名词本波不扩 i18n：`空会话` | `编程接力` | `无用户消息` | `未命名`。Chip：`完成` | `部分` | `失败`。

**P-B8** 旧 companion 若无 `message_count` / `acp_list`：降级为今天的「未命名」+ `#id`，客户端不猜。

Fixture 文案：

| 行 | 第 1 行 | 第 2 行 |
|----|---------|---------|
| `2b8ckp` | `空会话` `#2b8ckp` | （无） |
| `rny77t`（C3 尚未写库） | `编程接力` `失败` `#rny77t` | 模板句或 goal |
| `rny77t`（C3 已写） | `接力·pi·失败` `失败` `#rny77t` | goal，否则可省 |
| `4j6l6f` | `p1-wl` `失败` `#4j6l6f` | 模板句或 goal |
| 7×`p1-wl` | 七行 primary 都是 `p1-wl` | 各行自己的 preview/goal；时间用时钟 |

### 5.3 起名（C′）

**P-C1** 唯一写口 `commitThreadAlias({ threadId, next, class })`，CAS：读到的当前值须仍属于声称的 from-class。非法 no-op + 日志。

**P-C2** 首条真实 user → 仅 EMPTY → `provisional_user` ≤16。worker 跳过。

**P-C3** ACP **会话终态**（成功 / 失败 / 取消 / spawn 失败），不依赖是否 `addMessage`：

- 仅 EMPTY，或已是 `接力·`（允许刷新第三段，如 `失败`→`起草`）  
- 格式：`接力·{agent}·{token}`  
- `agent`：`[a-z0-9_-]{1,12}`，非法则 `agent`  
- `token` **只**来自会话元数据：`审查`（review_readonly）/ `起草`（propose_diff）/ `失败` / `部分` / `取消`  
- **禁止** goal / handback body / diff / error 字符串进 alias  
- 此路径 **禁止** 再调 `generateThreadTitle`

**P-C4** LLM 标题：自动仅 EMPTY ∪ 系统临时形态，且必须已有 user+assistant。prompt **剔除** `【编程接力` / `UNTRUSTED_ACP_HANDBACK` assistant。无 user 时禁止 LLM（✨ 亦然：无 user 最多补 C3）。

**P-C5** `batch_auto_title` 承诺冻结：无 LLM、默认 `only_empty`、**只吃首条 user**、上限与 C2 对齐为 16。不认 CRYPTIC，不认 assistant。

**P-C6** Fork：默认空 alias；按拷贝前缀走 C2/C3/C4。禁止回归 `分支-${id}`。

**P-C7** Worker：`worker:{role}` 白名单；之后静默全禁。

**P-C8** `p1-wl` 一类已提交短码：静默全跳。✨ 且存在 user+assistant 才可覆盖。

**P-C9** 同一终态事件只发一条 `thread.updated`（禁止 provisional+LLM 双写闪烁）。

非写者：`addMessage`、handback 正文、digest/tldr、Pack apply、cleanup、regenerate。

### 5.4 清理（D + 用户预勾）

**P-D1** 整理默认时间窗 = **全部（含近期）**。`from`/`to` 默认不传。UI：`全部（含近期）`（默认）· `30 天前以前` · `90 天前以前`。打开整理助手自动扫一次。

**P-D2** `cleanup_empty` 谓词冻结：`!trashed && messages.length===0 && id !== activeThreadId`。硬删。确认文案必须含：数量、`没有任何消息`、`永久删除`、`不可恢复`、`不经过回收站`。禁止出现「无用户对话 / 编程接力 / 将移入回收站」。

**P-D3** 整理执行只 `mode:"trash"`。禁止整理路径硬删。

**P-D4** 新 reason：

| reason | 谓词 | 建议？ | 默认勾 |
|--------|------|--------|--------|
| `empty` | 0 消息 | 是 | 勾 |
| `no_user` | ≥1 消息、0 user、非 ACP 形 | **仅薄**建议；厚 **omit** | 薄勾 |
| `acp_husk` | 见 §5.1 | 仅薄/失败 | **勾** |
| `short_orphan` | 现规则 | 是 | 14 天内不勾 |
| `stale_thin` | 现规则（与扫描窗独立：仍要 ≥30 天未更新） | 是 | 不勾 |
| `duplicate_alias` | 见 P-D7 | 仅暗号簇薄副本 | 不勾 |
| `worker_orphan` | 仅 `include_workers` | 是 | 不勾 |

**ACP 实质（`t4s8kw` 类）omit，不进建议。**

同一 `thread_id` 只留最高置信一条。不引入公开 reason `assistant_only`。

**P-D5** 禁止扫描结果全选。初始勾选 = §4.2 表。主按钮不提供「全选」（可藏二级且再确认）。提供「全不选」。

**P-D7** `duplicate_alias`：

- 暗号名：normalize 后长度 ≤16、无空白、且（`^[a-z0-9._-]+$` 或 CJK≤4）。`p1-wl` 是；「调研竞品定价」不是。  
- 簇主（`message_count` 最大，并列取最新）**永不**因 duplicate 进建议。  
- `message_count≥20` 即使不是最大也 omit。  
- 长真标题 v1 **不发** duplicate。  
- 已以更高 conf 标成 `empty`/`no_user`/`acp_husk` 的，不叠 duplicate 行。

**P-D8** 清理空白完成后 N=0 必须可见「没有空白线程」。可选教学：「另有 N 个无用户消息，请用整理助手」——不计入本次删除。

**P-D9** 规则函数继续无 I/O。输入补：`user_message_count`、`assistant_chars`、`looks_like_acp`（扫描端算好）。`has_user` 优先在既有 `getMessages` 单次扫描或 `addMessage` 时写入 index。**禁止**为新规则给 `thread.list` 再加一遍文件读。

**P-D10** 磁盘孤儿：不进 `suggestions[]`。页脚最多只读计数。本轮无删除。

### 5.5 安全（E，预勾被 D 覆盖后仍成立）

**P-E1** AI 永不自动删。无 cron/idle 调删除。

**P-E5** 整理确认文案含数量；每条至少 `id + message_count`（前 12 条）。含 `acp_husk` 时加警告。

**P-E6** ACP 衍生标题 = 闭枚举，永不切片 body。

**P-E7** 凡 gone 必 `releaseTrustBeforeThreadGone`；已 trash = clear-only。

**P-E8** 从回收站恢复不得重放 Trust / cruise。

**P-E9** 默认整理路径 0 新 LLM。

**P-E11** 禁止用 `p1-wl` / 测试名 / `worker:*` 当删除谓词。

**P-E12** 默认不含 worker；不覆盖 `thread_busy`；单次 `batch_delete` ≤50。

---

## 6. Fixture 决策表（验收金样）

前提：今天 = 实现日；默认窗 = 全部；worker 排除；`activeThreadId` 不是下表空壳（除非单独测 A8）。

| id | 清理空白 | 整理扫描 | 默认勾 | 执行 |
|----|----------|----------|--------|------|
| `2b8ckp` | 硬删（若仍 0 消息且非 active） | `empty` | 勾 | 空白先走则已不在；否则 trash |
| `rny77t` | 不碰 | `acp_husk` | **勾** | trash |
| `4j6l6f` | 不碰 | `acp_husk`（不叠 duplicate） | **勾** | trash |
| `t4s8kw` | 不碰 | **omit** | — | 留作审计 |
| `vpfb7g` | 不碰 | **omit** | — | 留着 |
| `cxzzjr`（1 user，`p1-wl`） | 不碰 | 若 short_orphan 且 14 天内 → 建议但不勾；否则不因同名入选 | **不勾** | 仅手勾才 trash |
| 刚点「+ 新建」的 active 空线程 | **不删** | 可不进 empty，或进了不勾 | 不勾 | 保留草稿槽 |

---

## 7. 30 秒成功标准

1. 打开 `☰`，「今天」：`2b8ckp` 显示「空会话」不是「未命名」；`rny77t` 显示「编程接力」（或已写的 `接力·pi·失败`）不是光秃「未命名」+ 只能靠读徽章认人。  
2. `⋯` → 整理助手（**不改日期**）→ `rny77t` / `4j6l6f` 在建议里 **且已勾**。  
3. 确认「移入回收站」→ 今天组不再把它们当对等真聊。  
4. `vpfb7g` 与其它有 user 的 `p1-wl` 仍在。`#id` 仍能搜。刚进回收站的 husk 在 TTL 内可恢复。  
5. 新开一次失败的编程接力（空线程）：终态后 alias 变为 `接力·{agent}·失败`，且列表 primary 不再是「未命名」。

---

## 8. 明确不做

- 独立会话图书馆 / llm_wiki 产品面  
- 静默删除、定时硬删、默认 LLM 深度扫描 / 顺手 extract  
- 改 `cleanup_empty` 去吞「无 user / 仅 handback」  
- 整理路径硬删  
- 磁盘孤儿 janitor（本轮）  
- 行内改名 UI  
- 追查生产 `p1-wl` 是否测试泄漏，或按该字面量清库  
- 用 workspace basename 当标题  
- 把 Graph 设为默认轴  
- 客户端用 handback 正文正则决定行呈现  

---

## 9. 分期（实现时再拆 PR，本文件不写代码）

| Wave | 交付 | 可单独验收 |
|------|------|------------|
| **H1 呈现 + 召回** | B 阶梯；整理默认窗=全部；新 reason；预勾表；禁全选；确认文案；`cleanup_empty` 跳过 active | 打开整理就能看见并勾上 `rny77t` / `4j6l6f` |
| **H2 起名写口** | `commitThreadAlias`；C3 终态钩；C4 剥 ACP；batch 16 字对齐 | 新失败接力不再叫「未命名」 |
| **H3 金样回归** | fixture 表单测 + ThreadList 呈现测 | §6 / §7 全绿 |

H1 不依赖 H2：旧 husk 靠呈现 + 整理清掉。H2 阻止新 husk 再叫「未命名」。

---

## 10. 关键文件（落地时）

- `chrome-extension/src/sidepanel/utils/thread-timeline.ts` — `displayThreadTitle` / 搜索 / 时间格式  
- `chrome-extension/src/sidepanel/components/ThreadList.tsx` — 行装配、整理窗、预勾、确认文案、清理空白  
- `companion/src/threads/cleanup-rules.ts` — 新 reason、簇主、预勾纯函数  
- `companion/src/threads/thread-manager.ts` — `cleanupEmpty` 跳过 active；index 计数；`listWithPreviews` 补字段  
- `companion/src/message-router.ts` — `suggest_cleanup` 输入；batch / generate_title  
- `companion/src/llm/adapter.ts` — provisional / generateThreadTitle 剥 ACP  
- `companion/src/ws/lifecycle.ts` + `companion/src/acp/manager.ts` — C3 挂终态，不挂 body  
- `companion/src/acp/handback-format.ts` — 对照不可信边界  
- `companion/src/packs/pack-engine.ts` — gone → releaseTrust  
- `chrome-extension/tests/thread-timeline.test.ts` + `companion/tests/thread-cleanup-context.test.ts` — 金样

---

## 11. 规格自检

| 检查 | 结果 |
|------|------|
| Placeholder / TBD | 无。token 闭集、预勾表、fixture 均已选边 |
| 内部一致 | D 原文「acp_husk 不勾」与 fixture「rny77t 预勾」的矛盾已在 §4.2 按用户选 D 修正为「薄/失败 acp_husk 勾」 |
| 与 C′ | 写库只打 EMPTY / 已有 `接力·`；`p1-wl` 不写。呈现阶梯在写库前后都成立 |
| 范围 | 单主题（会话卫生）。不含 Graph / digest 覆盖率 / 磁盘 GC |
| 歧义 | 「薄」给了字数阈值；「失败模板」给了字面集合；active 草稿给了跳过条件 |

---

*本文件是实现与双路外审的 SoT。未写入实现计划前不得开工改产品代码。*
