# Outbound MCP P0d — 真人 Bake-off Checklist

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Status | **Ready to run**（P0c 已合 main · #115/#116 · S42 #118 · #117）· **自动 preflight 已跑** → [outbound-mcp-p0d-preflight-20260804.md](../../audit/reviews/outbound-mcp-p0d-preflight-20260804.md) · **T1–T3 仍待真人** |
| SoT | [ADR-022](../../adr/022-outbound-mcp-server.md) §6–7 · [P0c eval gates](2026-08-04-outbound-mcp-p0c-eval-gates.md) |
| User config | [mcp.md · Outbound / Grok](../../mcp.md#outbound-mcp) |
| Goal | **证伪 L7**：已登录/SSO 任务上 CMspark 是否不可替代；公网/localhost 可输给 Playwright |

> 本页是 **手测记分表**，不是实现 PR。  
> **T1 失败 → pivot** Option B（只读）或 C（垂直 API）；**禁止** T1 未过就扩通用自动化面 / P1 grant 当发货。

---

## 0. 前置（全部勾完再开测）

### 0.1 环境

| # | 检查 | 期望 | ☑ |
|---|------|------|---|
| E1 | Companion / CMspark.app 在跑 | `cmspark-agent daemon status` → running · `ws://127.0.0.1:23401` | ☐ |
| E2 | Chrome 扩展 Side Panel **已连接** | 顶栏绿 / 已配对 | ☐ |
| E3 | Outbound health | `GET /outbound-mcp/v1/health` + Bearer `ws_secret` → `"status":"ok","runner":"wired"` | ☐ |
| E4 | Grok（或其它编程 Agent）MCP 配置 | 见 [mcp.md](../../mcp.md#outbound-mcp)；DMG 路径 `…/cmspark-agent` + `mcp-outbound` | ☐ |
| E5 | `grok mcp doctor cmspark`（或等价） | handshake OK · **10 tools** · healthy | ☐ |
| E6 | **新开** Grok 会话（配置 ≠ 会话挂载） | 工具列表出现 `cmspark__list_tabs` 等 | ☐ |
| E7 | Playwright MCP（对照臂）已配置 | 干净 profile；同一台机器 | ☐ |
| E8 | 计时器 / 记分本 | 每任务记录开始/结束时间 | ☐ |

健康检查示例：

```bash
# Companion
/Applications/CMspark.app/Contents/Resources/cmspark-agent daemon status

# Outbound runner
SECRET=$(cat ~/.cmspark-agent/ws_secret | tr -d '\n')
curl -sS -H "Authorization: Bearer $SECRET" \
  http://127.0.0.1:23401/outbound-mcp/v1/health
# → {"status":"ok","runner":"wired",...}

# Grok
grok mcp doctor cmspark
```

### 0.2 工具纪律（全程）

| 规则 | 说明 |
|------|------|
| 外泄类先 disclosure | `cmspark__accept_data_disclosure` 且 **`acknowledge: true`** |
| 先 `list_tabs` | 使用真实 `tabId`，禁止硬编码 |
| 无 `cmspark__scroll` | L1 无 scroll；翻页用 `navigate` 到 URL / 或 Side Panel 全工具面 |
| 禁工具不得成功 | cookies / evaluate / shell / host / CU 等应 `PROFILE_FORBIDDEN` 或未暴露 |
| 确认 | L2 走确认台 / 托盘；**勿只盯 IDE**；超时应 `OUTBOUND_CONFIRM_REQUIRED` 等可操作错误，**不挂死** |

### 0.3 对照原则

- **同一任务陈述** 分别用 CMspark Outbound 与 Playwright MCP 各跑一遍。  
- Playwright：**干净 profile**（未登录目标 SSO）。  
- CMspark：**用户日常 Chrome**（T1 已登录）。  
- 敏感页须知情同意；默认用 **非敏感** 或用户明确授权的 SSO 页。

---

## 1. 任务定义（T1–T3）

每任务时限建议 **15 分钟**（可在表头改）；「完成」= Agent 给出任务要求的结构化答案且 **未** 人工改 DOM/手工点到结果。

### T1 — 已登录 / SSO（CMspark 应赢）

| 字段 | 填写 |
|------|------|
| 目标 URL / 系统 | ________________（例：公司 OA / 内网文档 / 已登录 SaaS） |
| 任务一句话 | ________________（例：「列出当前首页未读条目标题前 5 条」） |
| 成功标准 | ________________（可观察、可判定对错） |
| 时限 | 15 min |
| 是否敏感 | ☐ 否 · ☐ 是（已披露） |

**期望**：Playwright 干净 profile **失败或明显更难**；CMspark 在时限内完成。

### T2 — localhost 预览（Playwright 可赢）

| 字段 | 填写 |
|------|------|
| URL | `http://127.0.0.1:____/` 或 PR preview |
| 任务 | ________________（例：「读页面标题 + 主 CTA 文案」） |
| 时限 | 10 min |

**期望**：两边都能完成亦可；Playwright 更快/更稳 **可接受**。

### T3 — 公网页（Playwright 可赢）

| 字段 | 填写 |
|------|------|
| URL | ________________（例：公开博客 / 文档站，**非**强登录） |
| 任务 | ________________（例：「提取文章标题与前三段要点」） |
| 时限 | 10 min |

**期望**：Playwright 赢可接受；CMspark 应用 L1 完成即可，不要求碾压。

---

## 2. 每任务运行剧本（CMspark 臂）

复制给编程 Agent 或逐步执行：

```text
1. cmspark__accept_data_disclosure  { "acknowledge": true }
2. cmspark__list_tabs
3. 若目标页未打开：cmspark__navigate { tabId, url }
4. cmspark__wait_for { tabId, network_idle: true }  （或合理 selector）
5. cmspark__get_page_text { tabId }
6. 根据文本回答任务；不足则 navigate 到更具体 URL 再 get_page_text
7. 禁止：evaluate / scroll / cookies / shell（应失败或不可用）
```

**可选负面探针（每会话至少 1 次）**：

| 探针 | 期望 |
|------|------|
| 调用不在 L1 的工具名（若 Agent 可见） | `PROFILE_FORBIDDEN` 或工具不存在 |
| 不带 disclosure 直接 `get_page_text` | `DISCLOSURE_REQUIRED` / `ACK_REQUIRED` |
| Side Panel 与 MCP 同 tab 冲突（T1 可选） | MCP `TAB_LOCKED` 或排队披露；**Side Panel 赢** |

**无 Side Panel 聚焦时的确认（T1 若触发 L2）**：

| 路径 | 期望 |
|------|------|
| 托盘 / 确认台 / OS 通知 | 可在 &lt;45s 内完成确认 |
| 若无 tray 路径 | 仅验证 **fail-closed** 错误可操作；「确认负担 ≥90%」指标 **作废**（按 ADR） |

---

## 3. 记分表

### 3.1 汇总

| 任务 | CMspark 完成? | 用时 | Playwright 完成? | 用时 | 谁更合适 | 备注 |
|------|---------------|------|------------------|------|----------|------|
| T1 SSO | ☐ Y ☐ N | __ min | ☐ Y ☐ N | __ min | ☐ CM ☐ PW ☐ 平 | |
| T2 localhost | ☐ Y ☐ N | __ min | ☐ Y ☐ N | __ min | ☐ CM ☐ PW ☐ 平 | |
| T3 公网 | ☐ Y ☐ N | __ min | ☐ Y ☐ N | __ min | ☐ CM ☐ PW ☐ 平 | |

### 3.2 T1 门槛（ADR-022 · 必过）

| 指标 | 门槛 | 实测 | ☑ |
|------|------|------|---|
| 完成率 | 时限内完成（本 checklist 单次任务：完成=100%，失败=0%；多样本时 ≥80%） | | ☐ |
| 确认超时 | 不挂死；超时有可操作 MCP error | | ☐ |
| 无 Panel 确认（若适用） | tray 路径下 &lt;45s 解决 ≥90%；否则仅 fail-closed | | ☐ |
| 审计完整率 | 100%（见 §4） | | ☐ |
| Profile 违规 | **0** 次禁工具成功调用 | | ☐ |

### 3.3 L7 总判定

| 结果 | 条件 | 下一步 |
|------|------|--------|
| **PASS** | T1 CMspark 完成且 Playwright 失败或明显劣势；T1 门槛全绿；T2/T3 不阻塞 | 可进入 Daily Content Loop runbook/Pack；P1 grant 可开 dual-review 设计 |
| **FAIL** | T1 失败，或确认挂死，或禁工具漏出，或审计缺失 | **Pivot** Option B 或 C；**禁止**扩 L1 通用自动化 / 当产品 ship |
| **INCONCLUSIVE** | 环境问题（扩展未 wired、错误 URL、网络） | 修环境后重跑；不记入 L7 fail |

**本次判定**：☐ PASS · ☐ FAIL · ☐ INCONCLUSIVE  

**签字 / 日期**：________________  **环境备注**：________________

---

## 4. 审计抽查（每任务结束）

```bash
# 当日 companion 日志（outbound / confirm / tool）
rg -n "outbound|unattended|security.confirmation|tool\.(start|finish)" \
  ~/.cmspark-agent/logs/companion-$(date +%Y-%m-%d).log | tail -40

# 能力审计（若启用）
tail -20 ~/.cmspark-agent/logs/capability-audit.jsonl 2>/dev/null
```

| 检查 | 期望 | ☑ |
|------|------|---|
| 每次 outbound 调用有 caller / tool / outcome | 有 | ☐ |
| disclosure 接受有记录（或会话内 accept 成功） | 有 | ☐ |
| 失败路径有 error_code（非空 hang） | 有 | ☐ |

---

## 5. 常见失败速查

| 现象 | 处理 |
|------|------|
| doctor 绿但会话无 `cmspark__*` | **新开 Grok 会话** |
| `runner` 非 `wired` | 打开 Side Panel 配对 |
| `DISCLOSURE_REQUIRED` | `accept_data_disclosure` + `acknowledge: true` |
| `PROFILE_FORBIDDEN`（scroll） | 用 `navigate` + `get_page_text` |
| `EXTENSION_UNAVAILABLE` / list_tabs 超时 | Companion + 扩展；优先 chrome-extension WS |
| `OUTBOUND_CONFIRM_REQUIRED` | 看托盘/确认台，勿只盯 IDE |
| Playwright「也能登录」 | T1 必须用 **干净 profile** 对照，否则指标失真 |

完整排错：[TROUBLESHOOTING · Outbound MCP](../../TROUBLESHOOTING.md#outbound-mcp)

---

## 6. 跑完后产物（建议落盘）

在 `docs/audit/reviews/` 新增一份短记（可复制下表）：

```markdown
# Outbound MCP P0d bake-off — YYYY-MM-DD

- Operator:
- Builds: CMspark.app / commit:
- Agent: Grok / Claude Code / …

## Results
| Task | CM | PW | Winner |
| T1 | | | |
| T2 | | | |
| T3 | | | |

## T1 gates
- 完成 / 确认 / 审计 / profile: 

## L7 verdict: PASS | FAIL | INCONCLUSIVE
## Next: Loop runbook | Pivot B/C | re-run
```

并勾选更新：

- [ ] [P0c eval gates](2026-08-04-outbound-mcp-p0c-eval-gates.md) §「P0d 真人 bake-off」
- [ ] [spike plan](2026-08-03-outbound-mcp-phase0-spike.md) §6 P0d
- [ ] 若 PASS：启动 Daily Content Loop runbook（见 [brief](../../decisions/daily-content-loop-brief-2026-08-04.md)）

---

## 7. 与后续路线的关系

```text
P0d 本清单 ──PASS──► Daily Content Loop runbook / Pack / M0–M1
                 └──► P1 Grant 设计 + dual-review
         ──FAIL──► Pivot B/C；冻结通用 L1 扩面
```

**不在本 bake-off 范围**：CWS、default-on、导出 CU/shell/cookies、内置情报 SaaS cron。
