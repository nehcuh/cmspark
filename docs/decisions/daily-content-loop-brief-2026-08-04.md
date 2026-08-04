# Brief: Daily Content Loop（每日内容情报环）

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Status | **DIRECTION LOCKED**（用户 2026-08-04 拍板 §11；D1–D12）— 可选 dual-review；实现仍依赖 Outbound P0c |
| Authors | Grok（对话场景收敛：用户日报环 + Loop Engineering + ADR-022） |
| Related | [ADR-020](../adr/020-capability-model-three-axes.md) · [ADR-022](../adr/022-outbound-mcp-server.md) · [Eval Engineering skill](../skills/eval-engineering-gate/SKILL.md) · [P0c eval gates](../superpowers/plans/2026-08-04-outbound-mcp-p0c-eval-gates.md) · Pack [ADR-014](../adr/014-mission-pack-enterprise-modules.md) |
| Depends on | Outbound MCP **P0c 真桥**（采集/网页再探）· 编程 Agent **本地模型** · **P1 grant**（定时低确认）· Agent 协助配置 schedule/邮件 |
| Non-goals (v0) | CMspark 内置「情报 SaaS」runtime；默认导出 L2/CU/cookie API；值守 grant 自动绑 MCP；无源列表的全网爬虫；把公开站强绑「仅 SSO 才有价值」 |

---

## 0. Why this document

用户场景（收敛表述）：

> 每天定时刷新关心的网站最新内容 → AI 判定好坏与可行性 → 编程 Agent 尝试验证并打分 → 自动生成每日报告 → 用户只在需要时打开报告，确认有没有值得关注的内容。

这与「通用 Browser MCP」或「编程 Agent 值守操控整机」不同：它是一条 **异步业务闭环（Loop Engineering）**，CMspark 只提供其中 **已登录浏览器采集/再探** 节点。

本 brief 锁定：

1. 环的阶段、artifact、验收信号  
2. 谁当 Loop owner、CMspark 边界  
3. Trust / 确认 / 外泄策略  
4. 交付形态（Pack + 外部 schedule 优先）  
5. 与 ADR-022 / Eval gate 的门控  

**用户拍板已完成**（§11 → §12）。**不是**实现 PR；真跑依赖 Outbound P0c + Agent 侧配置。

### 0.1 用户锁定的产品选择（2026-08-04）

| # | 问题 | 锁定选择 |
|---|------|----------|
| 1 | 首发源 | **公开站为主**（可选少量需登录源作增强，非 v0 必选） |
| 2 | 报告落点 | **本机目录 + 邮件**（双通道；本机为权威归档，邮件为投递） |
| 3 | 判定/环内 LLM | **编程 Agent 使用本地模型**（页文优先不进云） |
| 4 | 验证深度 | **默认跑代码验证 + 网页再探**（Stage C 必选双轨） |
| 5 | 定时/配置 | **由编程 Agent 协助用户配置**（cron/launchd、MCP、邮件、sources） |

---

## 1. One-sentence positioning

> **Daily Content Loop** = 本机定时的「采集 → 本地判定 → 代码+网页验证 → 本机报告+邮件」环；  
> **CMspark** = 环上可拒绝、可审计的 **L1 浏览器传感器**（公开站为主，登录态可选）；  
> **编程 Agent（本地模型）** = 环的主编排、配置助手与报告员；  
> **用户** = 异步决策者（读本机/邮件报告，不盯每一页刷新）。

禁止叙事：

- 「CMspark 变成每日情报中台 / 第二 Agent runtime」  
- 「开了无人值守，IDE Agent 就能静默全自动」  
- 「cookie 导出给云模型做采集」  
- 「公开站必须走云端大模型才算完成」  

---

## 2. Capability declaration (ADR-020)

```text
Surface:      L1（采集 + Stage C 网页再探）；代码验证 = Agent workspace（非 CMspark L2）
L2-classes:   (none via outbound default) — 桌面 CU/Host 不进 v0 环
Compose:      outbound-mcp + skill(adoption) + pack(sources+prompts+paths+mail) + optional knowledge
Autonomy:     编程 Agent 配置的 OS/Agent schedule 驱动「单次环 run」；非 multi-worker fan-out 默认
Trust:        源域 allowlist + 本地模型优先（降外泄）+ P1 caller grant（定时少确认）
Channel:      community
Privacy:      Judge/Validate LLM = local via coding agent；artifact 本机权威
```

| 轴 | 放置 |
|----|------|
| **Composition** | Pack 配方 + Outbound 工具 + Skill「怎么跑环/怎么配 schedule·邮件」 |
| **Surface** | 浏览器采集/再探 = L1；报告 = 本机文件 + 邮件投递 |
| **Autonomy** | Schedule **由编程 Agent 协助写入** OS/Agent 配置；CMspark v0 **不**做内置 cron 产品 |
| **Eval / Loop** | 每段可观察 artifact；C 段须 code+web 双证据（或显式 skip 原因） |

---

## 3. JTBD

| Actor | Job |
|-------|-----|
| 信息过载用户 | 少花时间刷多个**公开**（及可选登录）站，仍不错过「值得跟进」的条目 |
| 编程 Agent | 有稳定输入（抓取 JSON）和稳定输出（本机 MD + 邮件），可重复跑；**并协助首次配置** |
| 隐私敏感用户 | 判定/验证用 **本地模型**；页文默认不进云；失败可审计 |

**成功画面（人侧）：** 邮箱或本机打开今日报告 → 高分条目 + 代码/网页双证据 → 决定是否深挖；其余时间零打扰。

---

## 4. Loop topology（规范）

```text
[Trigger: cron | launchd | agent schedule | 手动]
        │
        ▼
  Loop Owner = 编程 Agent（或等价脚本 + LLM）
        │
        ├─ Stage A  Collect   ──MCP cmspark__*──► 用户 Chrome（源 allowlist）
        │                      artifact: collect.json
        ├─ Stage B  Judge     ──本地 LLM only───► artifact: judge.json
        ├─ Stage C  Validate  ──code + web 双轨─► artifact: validate.json
        │            code: Agent workspace
        │            web:  CMspark L1 re-fetch（必选，除非 item 标 skip_web）
        └─ Stage D  Report    ──本机 MD + 邮件──► daily-YYYY-MM-DD.md
                                                      + mail delivery receipt
                                                      │
                                                      ▼
                                              User async read (disk and/or inbox)
```

### 4.1 Stage contracts

| Stage | 输入 | 输出 | 成功判据（可机核） |
|-------|------|------|-------------------|
| **A Collect** | `sources.yaml` + run_id | `collect.json` | 每个 source 有 `status`；`ok` 者有 `items[]` 且每条有 `url` 或 `stable_id` |
| **B Judge** | collect.json | `judge.json` | 每条有 `score`∈[0,1]、`tags[]`、`rationale`、`grounded_snippet_ids[]`；**model_route=local**；无 grounded → 条目无效 |
| **C Validate** | judge 中 score≥阈值 的子集 | `validate.json` | 每条 **同时** 有 `code` 与 `web` 子结果（或显式 `skip_*` + reason）；汇总 `feasibility_score`；失败有 `error_class` |
| **D Report** | 上三者 | 本机 `daily-YYYY-MM-DD.md` + **邮件投递结果** | 本机文件存在；`mail.status` ∈ {sent, skipped_user, failed}；高分区非空或显式「今日无达标」 |

**Stage 失败隔离：** 单 source / 单 item 失败 → 记入 artifact，**不**中止整环（除非 Trigger 配置 `fail_fast: true`）。

### 4.2 归责（error_class）

| error_class | 含义 | 下轮动作 |
|-------------|------|----------|
| `auth_expired` | 登录态失效 | 报告置顶；需用户重登 Chrome |
| `blocked_confirm` | 确认超时/拒绝 | 检查域白名单 / grant |
| `nav_timeout` | 页未就绪 | 调 wait / 选择器策略 |
| `empty_extract` | 正文空 | 选择器/SPA 策略；非 LLM 编造 |
| `llm_ungrounded` | 判定无 snippet 依据 | **丢弃该判定**（忠实度闸） |
| `validate_env` | 本机依赖/网络 | Agent 侧修环境 |
| `external_rate_limit` | 对方限流 | 退避；非 Agent 无能 |

---

## 5. Artifact schemas（v0 草案）

路径建议（Loop owner 工作区，**非**强制写 `~/.cmspark-agent`）：

```text
<loop_root>/
  sources.yaml
  runs/<run_id>/
    collect.json
    judge.json
    validate.json
  reports/daily-YYYY-MM-DD.md
```

### 5.1 `sources.yaml`（公开站为主）

```yaml
version: 1
# 本地模型判定：页文主要留在本机；disclosure 仍建议 per_run 记账
disclosure_mode: per_run
model:
  judge: local           # locked — 编程 Agent 本地模型
  validate_summary: local
defaults:
  max_items_per_source: 20
  timeout_s: 60
  validate:
    code: required       # locked
    web_reprobe: required  # locked — CMspark L1
sources:
  # 主路径：公开站
  - id: public-changelog
    name: "某开源项目 Changelog"
    url: "https://github.com/example/project/releases"
    domain: "github.com"
    auth: none
    prefer: cmspark_or_http  # 公开可用 HTTP；JS 重页优先 CMspark
    extract: list_then_detail
    judge_hint: "是否有我们依赖的 breaking change"
  - id: public-blog
    name: "公开技术博客"
    url: "https://blog.example.org/"
    domain: "blog.example.org"
    auth: none
    prefer: cmspark_or_http
  # 可选增强（非 v0 必选）：需登录源
  # - id: sso-docs
  #   auth: session_chrome
  #   ...
report:
  local_dir: "reports"           # 相对 loop_root；权威归档
  mail:
    enabled: true
    to: "${USER_EMAIL}"          # 由编程 Agent 协助写入用户配置
    on: always                   # always | high_score_only
    attach_md: true
```

### 5.2 `collect.json`（摘录）

```json
{
  "run_id": "2026-08-04T0800Z",
  "started_at": "...",
  "sources": [
    {
      "source_id": "example-sso-docs",
      "status": "ok",
      "fetched_at": "...",
      "items": [
        {
          "item_id": "…",
          "url": "https://…",
          "title": "…",
          "snippets": [
            { "snippet_id": "s1", "text": "…" }
          ],
          "raw_tool": "cmspark__get_page_text"
        }
      ]
    },
    {
      "source_id": "other",
      "status": "failed",
      "error_class": "auth_expired",
      "message": "…"
    }
  ]
}
```

### 5.3 `judge.json` / `validate.json`（字段底线）

- **Judge：** `item_id`, `score`, `tags`, `rationale`, `grounded_snippet_ids[]`（空 → 无效）, `model: "local"`  
- **Validate（双轨强制）：**
  - `code`: `{ status, commands[], log_paths[], score? }`
  - `web`: `{ status, url, tool: "cmspark__…", snapshot_ref?, score? }`
  - `feasibility_score`（汇总）, `error_class?`
  - 缺一轨且无 `skip_*_reason` → **Stage C 对该 item 失败**

### 5.4 日报 MD 结构（用户可见）

```markdown
# Daily Content — YYYY-MM-DD
- Run: <run_id> · Sources ok/fail · Judge model: local
- Artifacts: <loop_root>/runs/<run_id>/
- Mail: sent | failed | skipped — <detail>

## 值得关注（score ≥ threshold）
### [标题](url)
- 判定: … · 可行性: …
- 代码证据: path/to/log 或 test name
- 网页再探: url · cmspark tool · 时间
- 建议动作: watch | try | ignore

## 其余摘要
…

## 失败源 / 半失败验证
- source_id / item_id — error_class — 用户动作提示
```

### 5.5 邮件投递（D 段）

| 规则 | 说明 |
|------|------|
| **权威** | 本机 `reports/daily-*.md` 始终写入；邮件失败 **不** 回滚本机报告 |
| **内容** | 默认正文 = MD 全文或「高分区 + 本机路径链接」；体积过大则摘要 + 本机路径 |
| **密钥** | SMTP/API 走编程 Agent / OS 钥匙串或 user-env 类秘密；**不**写进 pack 明文 |
| **配置** | 首次由 **编程 Agent 协助** 探测/写入 `report.mail`（见 §8.3） |

---

## 6. CMspark / Outbound 绑定（ADR-022）

### 6.1 默认工具（环 Stage A / 可选 C）

| Tool | Loop 用途 |
|------|-----------|
| `cmspark__list_tabs` | 复用已开登录页，少 navigate |
| `cmspark__navigate` | 打开 source URL |
| `cmspark__wait_for` | SPA/慢页 |
| `cmspark__get_page_text` | 抽正文（**L3+ disclosure**） |
| `cmspark__screenshot` | 可选证据；外泄类 |
| `cmspark__click` / `type` | 展开列表、分页、轻交互 |
| `cmspark__downloads_find` | 若源提供附件下载后再读 |

**禁止进 v0 环 profile：** cookies\*、evaluate、host\_\*、shell、netsec、默认 L2。

### 6.2 公开站为主 + 登录态可选

- **v0 主路径：** `auth: none` 公开站；可用 CMspark（JS/反爬/要截图）或轻量 HTTP（实现可选优化，**不**替代 Outbound 产品叙事）。  
- **可选：** `auth: session_chrome` 需登录源 — 登录态 cookie **留在 Chrome**；**导出 cookie = 非目标**。  
- CMspark 价值在公开站场景：稳定导航、截图证据、与 Stage C 网页再探同一工具面、后续无缝加 SSO 源。

### 6.3 Trust 与「定时少打断」

| 模式 | 说明 | 依赖 |
|------|------|------|
| **M0 手动** | 编程 Agent 内触发一趟环 | P0c 真桥 + 本地模型 |
| **M1 半自动** | Agent 配好的 schedule 触发；新域仍确认 | P0c + L8 tray 确认 |
| **M2 低确认** | 源域预授信或 **loop grant**（只读 + 白名单 + TTL） | **P1 grant**（ADR-022 L4+） |
| **M3 禁** | 值守 CU + outbound 静默 | **明确不做** |

v0 产品承诺停在 **M0–M1**；M2 为 P1 目标。

### 6.4 外泄与本地模型（L3+ 对齐用户选择）

| 规则 | 锁定 |
|------|------|
| Judge / 验证摘要 LLM | **本地**（编程 Agent 配置的 local model） |
| 页文是否进云 | **默认否**；若用户改用云模型须重新 disclosure |
| `get_page_text` / screenshot | 仍记 audit；disclosure `per_run` 说明「进入本机 Agent 上下文」 |
| 本机报告 | 权威 |
| 邮件 | 投递通道；失败不删本机文件；收件人由用户确认后写入配置 |

---

## 7. Stage C「验证可行性」边界（双轨必选）

| 验证类型 | v0 | 执行者 |
|----------|----|--------|
| 对照本机 repo / 文档 | ✅ **code 轨** | 编程 Agent |
| 跑检查、单测、类型检查、最小 repro | ✅ **code 轨** | 编程 Agent workspace |
| 再打开链接核对仍在线/要点是否仍在 | ✅ **web 轨** | CMspark L1（`navigate`/`get_page_text`/…） |
| 仅一轨成功 | ⚠️ item `status=partial`；报告标黄；默认 **不进「强推荐」** |
| 部署、改生产、发帖、转账 | ❌ | 永不进自动环 |
| 桌面客户端 CU | ❌ v0 | Side Panel 人工或远期 profile |

**原则：** 用户锁定 **代码 + 网页再探** 均要跑；缺轨必须 `skip_*_reason`（如「无对应仓库」），禁止静默只跑一轨还报「已验证」。

---

## 8. 交付形态（Pack-first + Agent 配置）

### 8.1 推荐默认

| 组件 | 内容 |
|------|------|
| **Mission Pack** `daily-content-loop` | sources 公开站模板、环协议 prompt、报告/邮件路径约定、skill 引用 |
| **Skill** | adoption：环阶段、`cmspark__*` 用法、双轨验证、忠实度、**如何请 Agent 配置 schedule/SMTP** |
| **Outbound MCP** | 浏览器能力本体（ADR-022） |
| **Schedule + Mail** | **由编程 Agent 协助配置** 写入用户机器（cron/launchd/Agent schedule + 邮件密钥）— **v0 不**在 Companion 内做 cron/SMTP 产品 UI |

### 8.2 明确不选（v0）

| 方案 | 原因 |
|------|------|
| CMspark 内嵌「每日情报 Agent」一级 UI | 违反 Pack-first / 一级入口纪律 |
| 仅 Skill、无 MCP | 外部 Agent 无法驱动浏览器（ADR-022 L5） |
| 强制云端 Judge | 与用户锁定「本地模型」冲突 |
| 把邮件当唯一归档 | 本机 MD 为权威 |

### 8.3 编程 Agent「帮我配置」清单（首次 onboarding）

Agent 应按序完成并留下可机核痕迹（写入 `loop_root/SETUP.md` 或 config）：

1. **创建** `loop_root/`、`sources.yaml`（公开站示例可改）、`reports/`  
2. **确认** 本地模型可用（编程 Agent 侧）；写 `model.judge=local`  
3. **配置** CMspark Outbound MCP 接入（stdio / 文档中的 client JSON 片段）  
4. **配置** 邮件：`to`、SMTP 或系统 `mail`；发一封测试信；记录 `mail.status=test_ok`  
5. **配置** 定时：launchd/cron 或 Agent schedule；dry-run 触发一次 M0  
6. **域列表** 导出给用户：建议加入确认白名单的公开域（为 M2 铺路，v0 可不自动写 `auto_approved_domains`）  

**禁止** Agent 在 onboarding 中：打开 god-mode、导出 cookie、安装不明 SMTP 后门、跳过测试邮件直接宣称完成。

---

## 9. Loop Engineering × Eval Engineering

| Loop 需求 | Eval 闸 |
|-----------|---------|
| Agent 自称「已采集」 | **MACHINE：** collect.json schema + 非空或显式 failed |
| 判定文采好但无依据 | **忠实度：** 无 `grounded_snippet_ids` → 条目作废 |
| 验证绕圈 40 步 | **路径：** 每 item 工具调用上限；超限 `error_class=thrash` |
| 合「自动群发无关收件人」 | **Blast T4：** 邮件仅用户确认的 `to`；禁止扩大通讯录 |
| 声称双轨验证但只有 code | **MACHINE：** validate.json 缺 web → FAIL |
| 日报写进 main 营销页 | 非本环；走开发 dual-review |

**环 run 的 merge 类比：**  
`reports/daily-*.md` 写入本机 = T0/T1（用户数据）；  
**改 CMspark 产品代码** 仍走 T3 dual，与日报环无关。

---

## 10. Phased roadmap

| Phase | 交付 | Gate |
|-------|------|------|
| **L0 Brief** | 本文 | ✅ 用户拍板 §11 → DIRECTION LOCKED |
| **L1 Manual runbook** | 公开站 sources 例 + Agent onboarding prompt（§8.3）+ 一次 M0 手动跑通 | P0c M1–M7 绿；本地模型；双轨 C；本机 MD |
| **L2 Pack skeleton** | `daily-content-loop` pack + skill + 邮件/报告约定 | Pack 校验；无新一级 UI |
| **L3 Agent-configured M1** | Agent 写好 schedule + 测试邮件 + 一趟定时 | L8；mail 失败隔离；SETUP.md 完整 |
| **L4 Low-confirm M2** | loop grant / 公开域预授信 | ADR-022 P1 dual-review |
| **L5+** | 可选 SSO 源配方、Obsidian 链、多环 | 另 brief |

**依赖硬序：** Outbound P0c → L1 runbook（可先写文档）→ Pack → Agent 配置 schedule/邮件；**不可**先承诺 M2 静默。

---

## 11. Open questions — **已关闭**

| # | 决议（用户 2026-08-04） |
|---|------------------------|
| 1 | **公开站为主**（登录源可选增强） |
| 2 | **本机目录 + 邮件**（本机权威） |
| 3 | **编程 Agent 本地模型** 做判定/环内推理 |
| 4 | **Stage C = 代码 + 网页再探** 双轨必选 |
| 5 | **编程 Agent 协助配置** schedule / MCP / 邮件 / sources |

残留实现细节（不挡方向锁）：SMTP 供应商、具体本地模型名、公开站初始清单 — 在 L1 runbook / onboarding 时由 Agent 与用户填。

---

## 12. Decision freeze（**LOCKED**）

| ID | 锁 |
|----|-----|
| **D1** | Loop owner = 编程 Agent（本地模型），**不是**新 CMspark runtime |
| **D2** | CMspark 提供 **L1 采集 + Stage C 网页再探**；不导出 cookie；L2/CU 不进 v0 环 |
| **D3** | 交付 = Pack + Skill(adoption) + Outbound + **Agent 配置的** schedule/邮件 |
| **D4** | 四阶段 artifact 契约强制；无 grounded snippet 的判定无效 |
| **D5** | v0 自动化 **M0–M1**；M2 依赖 P1 grant；M3 永非目标 |
| **D6** | Stage C **代码 + 网页** 双轨；缺轨须 skip 原因；桌面 CU 不进 v0 |
| **D7** | 单源失败隔离；失败置顶提示用户 |
| **D8** | 源策略 **公开站为主** |
| **D9** | 报告 **本机权威 + 邮件投递**；邮件失败不删本机文件 |
| **D10** | Judge/环内 LLM **local**；默认页文不进云 |
| **D11** | 首次 setup 由 **编程 Agent 按 §8.3 清单** 协助完成并写 SETUP 痕迹 |
| **D12** | 邮件收件人/域白名单变更须用户确认；禁止 Agent 自扩通讯录 |

---

## 13. Next actions

1. ~~用户确认 §11~~ ✅  
2. 可选：dual-review 本 brief（产品策略级）  
3. **Outbound P0c** 按 [eval gates](../superpowers/plans/2026-08-04-outbound-mcp-p0c-eval-gates.md)（阻塞真采集/网页再探）  
4. **L1 runbook**：公开站示例 + §8.3 onboarding prompt（可与 P0c 并行写文档）  
5. **Pack skeleton** `daily-content-loop`（无 default-on）  
6. P0c 绿后：Agent 带用户跑通 **M0**（本机报告 + 测试邮件）→ 再配 **M1** schedule  

---

## 14. Change log

| Date | Change |
|------|--------|
| 2026-08-04 | 初版 DRAFT：场景收敛、四段环、artifact、ADR-022 绑定、M0–M3、Pack-first、D1–D7 |
| 2026-08-04 | **DIRECTION LOCKED**：公开站为主；本机+邮件；本地模型；C 双轨；Agent 配置；D8–D12 |

---

*Daily Content Loop = Loop Engineering: public-web collect → local judge → code+web validate → disk+mail report — CMspark is the L1 browser node, not the whole runtime.*
