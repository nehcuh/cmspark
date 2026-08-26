# 召唤器与编程面策略重审 — 多路对抗合成

> **日期**: 2026-08-26  
> **状态**: **DRAFT · 待 Claude+Pi dual-review**  
> **方法**: Product · Impl · Security · External 独立对抗 → 吸收 BLOCK  
> **触发**: 用户 9 点产品评论  
> **前序锁（不得削弱）**: ADR-020 / 022 / 025 / 016 · Honesty F-UX-OVERLAY-1 · Knowledge CRUD 2026-08-26 · C-thin 召唤壳  
> **对抗原文**: [synthesis](../../audit/reviews/summoner-strategy-rethink-adversary-synthesis-20260826.md)

```text
Surface:      L0 summoner = capture bar ; Side Panel = operate home ; L1 stays CDP in Chrome
L2-classes:   (none new)
Compose:      outbound MCP (export L1) + ACP (handoff to coding agents) + Pack
Autonomy:     Mission Board stays multi-agent ; L0 RunProgress is display not a new Autonomy object
Trust:        overlay ACL does not grow ; F-S-10 must not worsen ; grants ≠ ws_secret
Channel:      community ; summoner optional / fadeable
```

**Blast**: 本文件 = **T0 策略**。落地切片另开，按 ADR-020 分轴。

---

## 0. 一句话

| 问题 | 裁决 |
|------|------|
| 召唤器做太重会变成 Codex/WorkBuddy | **KEEP** — 已经有 HUD Expand「对标 WorkBuddy」的债，停止加轨 |
| 脱离扩展的能力都应在召唤器里操作 | **REJECT as rule** — 混淆了 WS ACL 与 tool-loop。L1 执行仍在 Chrome；确认/Trust/知识配置/MCP 添加仍在侧栏/托盘 |
| 召唤器淡化、当别人的浏览器插件 | **淡化 KEEP**；插件 = **Outbound MCP adoption**，不是再做一个给他们装的 Chrome 扩展 |
| 侧栏太丑，对标 Gemini | **学启动/空态/作曲区语法 KEEP**；当消费级 Gemini **REJECT** |
| 编程 Agent 更好配、更深嵌 | **KEEP 未做完的 ADR-022/025**（一键 mcp add、grant、T1）；不是第三扇门 |
| Jira/GitHub 双向打通 | **KEEP 已登录页 + inbound MCP + ACP 任务包**；自建 Jira **REJECT** |
| Kimi 解读 | **大体正确**；T1 未跑、0.5.2=安装器、UX 护城河最薄 |
| vibesop-py 做匹配 | **REJECT 把 Python 塞进 Companion**；**KEEP 把 IDF/显式/场景层 port 进现有 TS** |
| 复杂任务可见清单 | **KEEP 用户 JTBD**；**REJECT 用 Mission Board / 模型自勾当完成** |

**产品句：**

> 召唤器是可关掉的热键捕获条：提问、附图、打断。干活、批准、装配在侧栏。编程 Agent 租这台已登录的 Chrome（MCP），侧栏把网页活派给本机编程助手（ACP）。两扇门，一个浏览器——不是第二套 Codex，也不是 Chrome 里的 Gemini。

---

## 1. 九点吸收

### 1 轻重 — KEEP

HUD Expand 规格已写「对标 Codex / 千问办公 / WorkBuddy」。这正是用户怕的重。**召唤器折叠条 = 产品；展开工作台 = 冻结，不再加轨。**

### 2 快窗口 vs「都能操作」— MAJOR_REVISE

Impl 关键澄清：`chat.create` 已经在召唤器里跑 **完整 tool-loop**（含 CDP）。扩 ACL 加的不是「脱离扩展的能力」，而是 **HTML 管理台**。

| 召唤器可以 | 召唤器不可以 |
|------------|--------------|
| 热键开关、提问、📎、steer、线程切选、overlay-eligible pack.apply | Allow/Deny、`config.*`、`mcp.add`、知识 get/import/update、L2、cookies、evaluate |
| 诚实文案「批准 / 知识配置去侧栏」 | 假装打开侧栏 |

**Pin F-UX-OVERLAY-1** 不改。现有 `mcp.toggle_server` / `skill.activate` 算 **冻结或另票回滚**（Security：已经是 Trust 抬升），本重审不扩。

### 3 淡化 + 给 Codex/WorkBuddy 当插件 — MAJOR_REVISE

竞品对照（研究编译，非全量实测）：

| 产品 | 他们要的浏览器 | 和我们的关系 |
|------|----------------|--------------|
| Chrome Gemini | 原生侧栏 + Connected Apps | **消费助手**；我们不在这条 JTBD 上赢 |
| Claude for Chrome | 真实 Chrome + 接到 Claude Code/Cowork | 最近邻；我们用 **MCP 导出 + ACP 接力** 而不是再做一套品牌扩展 |
| Tencent BrowserSkill `bsk` | 任意能跑 shell 的 Agent → 已登录浏览器 | ADR-022 已点名的红海；我们差异化是 **HITL + Pack + 审计 + 已登录会话** |
| Chromeflow / Browser MCP | 编码 Agent 驱真实 Chrome | 同红海 |
| WorkBuddy | 办公 Agent；浏览器是 **Skill** | 我们不应变成他们的 Agent Browser Skill |

**无缝对接 = 假话**，直到：Companion 在跑、扩展已配对、`cmg_` grant、披露、托盘确认（ADR-022 L8，Win/Linux 仍偏侧栏）。诚实路径：

```text
claude mcp add cmspark -- cmspark-agent mcp-outbound
# Codex / Grok config.toml 同形
```

加一篇 **adoption skill**（何时用我们 vs Playwright vs DevTools MCP）。**不要** CWS「CMspark for Codex」。Raycast/uTools/WorkBuddy 热键只当分发（已有 `docs/summoner-launcher-plugins.md`）。

### 4 审美 / 对标 Gemini — MAJOR_REVISE

PRODUCT.md 已锁看山 canon。Gemini 赢的是 **Chrome 原生铬**（工具栏图标、每 tab 会话、Gmail）。我们赢的是 **已登录页上真干活 + 确认台**。

本季允许：L0 空态、作曲区作主、图标/启动可靠性（配对、角标）。本季禁止：Connected Apps 叙事、把确认台藏掉、召唤器视觉竞赛。

### 5 编程 Agent 更深 — KEEP 未完成的门，不加第三扇

已有两扇门：

- **他们 → 我们**：Outbound MCP（ADR-022），策展 L1，`require_grant` 默认开  
- **我们 → 他们**：ACP（ADR-025），`acp.enabled` 默认关，apply 走 L2  

更深 = 安装 5 分钟内完成 + 任务包（当前 GitHub/Jira **页** → 本地审查）+ 观察芯片，不是 Side Panel IDE。先跑 **T1 bake-off**（已登录 SSO vs Playwright）。失败则 pivot 只读，禁止用「更深集成」硬上。

### 6 Jira/GitHub 双向 — MAJOR_REVISE

硬伤真实：编码 Agent 不持有你的 Jira 登录态。我们的解法是 **打开那一页（L1）+ 用户自备 inbound MCP + ACP 任务包**，状态仍以 Jira/GitHub 为真相源。禁止 CMspark 对象同步冲刺/工单。Issue 正文 = 不可信检索数据（F-S-1）。

### 7 Kimi 报告 — KEEP 诊断，校正三处

| 主张 | 仓库 |
|------|------|
| 赌注 = 真实已登录 Chrome | 对（PRODUCT.md、ADR-022 L7） |
| ADR-020 三轴 | 对 |
| 五道门 | 对，是合成不是产品对象名 |
| Outbound + ACP | 对，是门面不是新 runtime |
| 会话搬不走 = 护城河 | 对，**尚未 T1 证伪** |
| 0.5.2 | 对，但是 **Windows 安装器**，不是召唤器里程碑 |
| UX 最好抄 | 对 → 所以不要把季度押在抄 Gemini 上 |
| 单人 / 未签名 / Chrome-only | 大体对 |

不要把这份报告当成「召唤器做大」的许可证。报告自己说 UX 护城河最薄。

### 8 匹配不准 / vibesop-py — MAJOR_REVISE

体感对，机制描述不全：

- `matchSkills`：name+description+tags 的 **TF 余弦（注释写 TF-IDF，实现无 IDF）**；≥70 跳过 LLM，否则 `llmRerank`
- tokenizer **已经从 VibeSOP port**
- 技能勾选在 auto 下仍 **并上** matchSkills（`skill.activate` 不切 manual）→ 感觉「关键词乱入」
- 知识 auto = 勾选 ∪ **站点**，不是 query 语义
- related 不算正文

**REJECT** Companion 内嵌 Python + sentence-transformers（SEA/NSIS、与 Qwen3-VL allowlist 冲突、Honesty F-E-10）。  
**KEEP** TS：显式 `/技能`、Pack 当场景、补 IDF、技能 activate→manual 或 UI 诚实、related 可加正文 token。Embedding 永远 opt-in 另 ADR。

### 9 复杂任务清单 — MAJOR_REVISE

用户要的是 **跑着的任务可见、子步骤完成能勾、任务变了能加行、方便回看不跑偏**。

| 不要 | 要 |
|------|-----|
| 把 ADR-016 Mission Board 当个人 todo（L2 complete、信任徽章、默认关） | L0 **RunProgress**：聊天列可见 |
| 模型自己打勾当完成（ThreadDigest 空壳） | 完成绑定 tool_result / 用户确认 |
| 新 `thread.todo` SoT | 可从 H1 `open_todos` 做种子；模型新增行 = **草稿**，执行需手势 |

召唤器最多 **展示** 当前条数，不拥有清单编辑。

---

## 2. NEVER（本重审）

- Overlay 确认方言、`knowledge.get/import`、`mcp.add`、`config.set`、HTML getUserMedia  
- CWS「给 Codex 装的 CMspark 扩展」；Skill-only 浏览器服务（BrowserSkill 克隆）  
- 默认 embedding / vibesop-py in-process / 图数据库  
- Jira/GitHub 作为 CMspark 对象的双向同步  
- Side Panel IDE、ACP `allow_exec`、静默 apply  
- 用清单/召唤器当新一级底栏 Tab  

---

## 3. 本季顺序（单人项目）

1. **P0** 真人 T1 bake-off（ADR-022）。失败 → 只读/垂直，不发插件故事。  
2. **P1** Outbound adoption：一键 mcp add + grant 5 分钟路径 + 一篇 skill。  
3. **P1** 匹配诚实：技能 auto vs 勾选；TS IDF。  
4. **P2** Side Panel L0 空态/作曲区/图标启动（看山，不 Gemini 化）。  
5. **P2** RunProgress 切片（证据完成，默认草稿）。  
6. **召唤器** 只修快与淡；不完成 WorkBuddy 展开。

---

## 4. 开放（外审可降 nit）

- Overlay 已允许的 `mcp.toggle_server` / `skill.activate` 是回滚还是冻结。  
- RunProgress 是否复用 H1 `open_todos` 字段。  
- T1 仍未跑时，adoption 文档能否先发「实验」。  
