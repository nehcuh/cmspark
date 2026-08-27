# Outbound MCP — T1 bake-off（2026-08-27）

| Field | Value |
|-------|--------|
| Issue | [#228](https://github.com/nehcuh/cmspark/issues/228) |
| Operator | 胡琛（任务卡）+ Grok Build（租手臂） |
| Target | 操作员指定 `home.cmschina.com.cn`；live Chrome 已登录 **OA门户** `oa.cmschina.com.cn`（标签已开、标题「OA门户」）。未另 `navigate` 到 home。 |
| Task | 查看当前邮件中前 5 封 |
| Companion | 仓库 **0.5.3** `companion/dist/index.js daemon`（停掉 `/Applications/CMspark.app` 0.5.2 PID 40169） |
| Grant | `grok-t1` + `--allow-page-export`；测完 **revoked** `gr_2293cfc071c10bd81d9d974e` |
| Config during T1 | `require_grant=true` · `auto_approve_dangerous=false`（操作员授权）；测完改回盘上原值 |
| Playwright 对照 | **已跑 2026-08-27**（干净 Chrome / bundled Chromium / CDP 空 profile）→ **未能打开门户** `ERR_EMPTY_RESPONSE` |
| 邮件主题 | **不写入本文件 / Issue**（公司邮件；只在操作员对话里核对） |

---

## 0. 前置

| # | 检查 | 结果 |
|---|------|------|
| E1 | Companion 23401 | **PASS** — 0.5.3 repo daemon |
| E2 | 扩展 wired | **PASS** — health `runner:"wired"` |
| E3 | health + grant | **PASS** — bake-off 时 `require_grant:true`；`auth_mode:grant` |
| E4–E6 | Grok MCP 配置挂载 | **N/A** — 本场用 HTTP invoke + `cmg_`，未改 Grok `config.toml` |
| E7 | Playwright | **FAIL 任务** — 见 §1b |
| E8 | 记分 | 本文件 |

BLOCK 已折：0.5.3 CLI 有 `outbound-grant`；本场 `require_grant=true` 且 `auto_approve_dangerous=false`；操作员给了 URL+任务并授权改配置。

---

## 1. CMspark 臂（执行）

1. `cmspark__list_tabs` → 200 / grant。OA门户 tab `1492095051` 已打开。确认台 `cockpit.html` 亦开。
2. `cmspark__get_page_text` 该 tab → **首次外泄 HITL 后 200 ok**（确认台已开；45s 内批过）。
3. 页面「我的邮件」区块可见邮件列表（未读 0 条；列表有多封）。前 5 封主题已在对话里交给操作员核对。
4. 负面探针：`cmspark__get_cookies` / `cmspark__evaluate` → **`PROFILE_FORBIDDEN`**（422）。

未调用 cookies / evaluate / shell。未扩 profile。未把邮件正文写入 GitHub。

---

## 1b. Playwright 臂（2026-08-27 对照）

同一任务陈述。干净 profile：**不**复用日常 Chrome 用户目录，**不**填账号。

| 尝试 | 结果 |
|------|------|
| Playwright bundled Chromium + 空 `user-data-dir` | `net::ERR_EMPTY_RESPONSE` @ `oa` / `home`，~150ms |
| Playwright `channel: chrome` + 空 profile | 同上 |
| 本机 Chrome GUI + `--user-data-dir=/tmp/cmspark-t1-chrome-clean` + CDP `:9333` | 同上 |
| curl 直连与 `--proxy http://127.0.0.1:1082` | `Empty reply from server`；解析到 **198.18.0.228/229**（fake-ip） |

系统 HTTPS 代理：`127.0.0.1:1082`（MacPacket）。日常 Chrome 里 **已经打开** 的 OA 标签可读；**新的**干净 Chrome 打不开同一主机。

**未出现登录墙**，因此不是「填了密码也能读」。失败形态 = 干净浏览器到不了门户。CMspark 臂用的是已打开标签，没有从空白 `navigate` 到 home。

对照 Chrome 已杀掉；空 profile 目录仅 `/tmp`。

---

## 2. 记分

| 任务 | CMspark 完成? | 用时 | Playwright 完成? | 用时 | 谁更合适 |
|------|---------------|------|------------------|------|----------|
| T1 SSO 邮件前 5 | **Y**（OA门户「我的邮件」widget） | <2 min + HITL | **N**（ERR_EMPTY_RESPONSE） | <1 min | **CMspark** |

### T1 门槛

| 指标 | 门槛 | 实测 |
|------|------|------|
| 完成率 | 时限内完成 | **Y** — get_page_text HITL 后拿到列表 |
| 确认超时 | 不挂死 | **Y** — 确认台批过；非 timeout |
| 无 Panel 确认 | tray &lt;45s 或 fail-closed | 确认台窗口已开，走 HITL |
| 审计 | outbound 调用有 caller/tool | grant_id + HTTP 200/422 |
| Profile 违规 | 0 次禁工具成功 | **0** — cookies/evaluate FORBIDDEN |

### L7 总判定

**PASS（带 nit）** — 本机这一次 T1：CMspark 完成，干净 Playwright/Chrome **无法打开门户**，CMspark 明显更优。

- CMspark：已登录、已打开的 OA门户读到「我的邮件」前 5 封；确认台 HITL；禁工具未漏出。
- Playwright：三种干净启动均 `ERR_EMPTY_RESPONSE`，未见登录表单。
- **Nit / 不得对外说成**：不是「Playwright 撞上 SSO 登录页」。而是干净 profile 在本机 TUN/fake-ip 下到不了主机。CMspark 也没有从空白再 navigate。
- **禁止**据此扩 outbound 默认 profile（cookies / evaluate / L2 / shell）。租手仍是实验、非 default-on。
- T2/T3 未跑（不阻塞 T1 收口）。
- URL 诚实：操作员写 `home.cmschina.com.cn`；CMspark 用已打开的 `oa.cmschina.com.cn`。

---

## 3. 测后恢复

- `require_grant` / `auto_approve_dangerous` 改回 bake-off 前盘上值（false / true）。
- 备份仍在 `~/.cmspark-agent/config.json.bak-bakeoff-20260827-100935`。
- 钥匙已 revoke。
- Companion **保持仓库 0.5.3 daemon**（不再回到无 `outbound-grant` 的 0.5.2 安装包）。若要再挂 CMspark.app，需另装 0.5.3 包。
