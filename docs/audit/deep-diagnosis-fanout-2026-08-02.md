# CMspark Deep Diagnosis Fanout Report (2026-07-25)

**Project:** CMspark — 浏览器内 AI Agent（Chrome Extension + 本地 Companion）  
**Mode:** RE-AUDIT + NEW surface (computer-use v1.3)  
**Versions:** companion / chrome-extension **0.3.0**  
**Prior audits:** 2026-06-16 · 2026-06-23 diagnosis · **2026-07-09 full 25-dim (4.4 / C)**  
**Method:** Multi-agent subsystem fanout + cross-cut dimensions + adversarial confirmation of critical/high claims  
**Artifact:** `audit-report-cmspark-2026-07-25.md`  
**Commit context:** main around computer-use v1.3 + security P0 batches

---

## Executive Summary

本次是 **2026-07-09 全量审计后的复审**，并首次把 **computer-use / host-use（桌面坐标注入 + 宿主 COM/AX）** 与 **Mission Pack / MCP / multi-agent** 扩张后的控制面一并纳入评分。

### 最大好消息：四个 Critical 承重墙已关闭

| 2026-07-09 Critical | 2026-07-25 状态 | 证据 |
|---------------------|-----------------|------|
| **C1** WS 控制面零鉴权 | **FIXED_VERIFY** | `ws-auth.ts` HMAC-SHA256(ws_secret, nonce) + `verifyClient` Origin + pre-auth terminate；extension/tray 握手一致 |
| **C2** history.db 永不落盘 | **FIXED_VERIFY** | debounced `save()` + SIGTERM/SIGINT/`close()` flush；`server.ts` shutdown 调 `historyStore.close()` |
| **C3** CI `npm test \|\| true` | **FIXED_VERIFY** | `ci.yml` companion/extension tests 硬门；security-gates 有 `CMSPARK_DATA_DIR` 预导入隔离 |
| **C4** Critical npm 漏洞 | **FIXED_VERIFY** | supply-chain 文档 + CI prod audit gates |

相对 07-09 的 **4.4 / C**，整体 **上调至 5.8 / C+（+1.4）**。对抗验证后 **0 Critical**——不编造 Critical。

### 仍不能宣称「可安心公开发布」

**10 个对抗确认 High**（去重后）仍集中在：

1. **DATA_DIR 路径逃逸**（`threadFilePath` 未 sanitize → 可删/覆写 `config.json`）  
2. **`mcp.add` stdio 任意本地 spawn**（绕过 shell 企业模块 + L2）  
3. **线程 JSON 持久化未脱敏 tool 结果**（cookies/shell/MCP/evaluate 绕过 history.db 红线）  
4. **`chat.create` supersede 竞态**（前任 finally 拆掉后任 AbortController / 多 agent gate / 可抹新消息）  
5. **任意 peer 断线全局杀死所有 pending tools**（tray 重连误杀 extension 长任务）  
6. **macOS `cuPidForWindow` 忽略 windowId**（HID/SkyLight 可能钉到错误进程）  
7. **HUD spike 用特权 `respond()`**（`CMSPARK_HUD_SPIKE=1` 时跨 peer 批 L2）  
8. **取消协议不完整**（无 `tool.cancel`；`analyze_image` 未 stamp `thread_id`）  
9. **Tray 开机自启 launchd 参数错误**（与 `install-daemon.sh` 分叉，自启可能永不起来）  
10. **MCP 密钥与 host env 扇出**（list 未 redact；stdio 子进程继承完整 `process.env` + user-env）

**一句话**：控制面终于上了锁；但「已配对 peer」的信任面过大（stdio MCP、thread 路径、持久化 tape），生命周期/多 peer 竞态会破坏 Stop 语义，computer-use 在 macOS 注入路径上仍有信任根级缺口。

---

## Score Dashboard

```
Security        ██████░░░░  5.5  C+
Stability       █████░░░░░  4.5  C-
Performance     ███████░░░  7.0  B
Testing         ██████░░░░  5.5  C+
Maintainability █████░░░░░  5.0  C
Design          █████░░░░░  5.0  C
Release         ██████░░░░  5.5  C+
Computer-Use    █████░░░░░  5.0  C
─────────────────────────────────────
Overall         ██████░░░░  5.8  C+
```

| Dimension | 2026-07-09 | 2026-07-25 | Δ |
|-----------|------------|------------|---|
| Security | 3.5 | **5.5** | +2.0 |
| Stability | 3.5 | **4.5** | +1.0 |
| Performance | 6.0 | **7.0** | +1.0 |
| Testing | 3.5 | **5.5** | +2.0 |
| Maintainability | 6.0 | **5.0** | −1.0 |
| Design | 5.5 | **5.0** | −0.5 |
| Release | 3.0 | **5.5** | +2.5 |
| **Computer-Use** | n/a | **5.0** | NEW |
| **Overall** | **4.4 / C** | **5.8 / C+** | **+1.4** |

### Finding Statistics（去重后开放项）

| Severity | Count |
|----------|------:|
| **Critical** | **0** |
| **High** | **10** |
| Medium | ~42 |
| Low | ~22 |
| Info / fixed_verify | ~24 |
| **Open total (H+M+L)** | **~74** |

---

## Prior Audit Delta（相对 2026-07-09）

### 已关闭 / 验证通过

| ID | 主题 | 状态 |
|----|------|------|
| C1 | WS 无鉴权 | FIXED_VERIFY — Origin + HMAC challenge/response |
| C2 | history 永不 flush | FIXED_VERIFY — debounce + shutdown `close()` |
| C3 | CI `\|\| true` | FIXED_VERIFY — companion/extension tests 硬门 |
| C4 | Critical npm | FIXED_VERIFY — prod audit gates |
| H8 Node | 无 SHA256 | FIXED_VERIFY — `verify-node.sh` + package pin |
| evaluate token | 未绑定 | FIXED companion-side（strip LLM token + issue/validate） |
| config 0o600 / atomic | 世界可读 / 非原子 | FIXED |
| PrivilegeMode 假 UI | 安慰剂 | FIXED_VERIFY — CapabilityLevel 实模型 |
| settings-web 四门 | Host/Origin/token/SSRF | INTACT |

### 仍开放 / 部分关闭

- **originWs 绑定**：navigate/MCP/host_computer 已绑；evaluate/osascript 仍常省略（SEC-1 / XC-Security-8）  
- **代码签名/公证**：仍 ad-hoc only（OPS-1 → 对抗下调 medium）  
- **Abort 完整排水**：`chat.abort` 较全；supersede / shell / extension CDP / analyze_image 仍缺口  
- **SBOM / release 再测**：仍开放  

### 本轮全新表面（相对 07-09）

- `companion/src/computer/*` + `host-use/*`（坐标注入、estop、session-trust）  
- Mission Pack / enterprise modules（shell、workspace、netsec）  
- multi-agent / board / MCP 深度集成  
- Apps P1 launch-only（相对健康，argv-only）  

---

## Top Risks

| # | ID | Sev | 一句话 |
|---|-----|-----|--------|
| 1 | PERS-1 / XC-Security-2 | High | `thread_id` 路径逃逸 → 可删/覆写 `~/.cmspark-agent/config.json` |
| 2 | XC-Security-1 | High | `mcp.add` stdio 任意 `command` spawn，无 L2 / 无 shell 模块门 |
| 3 | LLM-2 / XC-Security-6 | High | threads/*.json 存全量 cookies/shell/MCP/evaluate（history 脱敏被绕过） |
| 4 | XC-Correctness-1 | High | supersede：前任 finally 拆后任 abort + 可 `deleteMessagesFrom` 抹新回合 |
| 5 | XC-Correctness-2 | High | 任意 peer close → 全局 5s 杀光 pending tools（含长下载） |
| 6 | COMP-2 | High | `cuPidForWindow` 取 CGWindowList 首项，忽略 windowId → 错进程注入 |
| 7 | XC-Security-3 | High | HUD spike 走特权 `respond()`，可跨 peer 批 L2（需 env） |
| 8 | XC-Integration-1/2 | High | 无 tool.cancel；analyze_image pending 无 thread_id → Stop 不干净 |
| 9 | XC-Ops-Release-2 | High | Tray 写的 launchd 参数错误，开机自启可能永不启动 companion |
| 10 | XC-Security-5 | High | MCP list 明文 env/headers + stdio 子进程继承 host secrets |
| 11 | SEC-1 / XC-Security-8 | Med | evaluate/osascript L2 省略 originWs |
| 12 | COMP-1/3 | Med | macOS occlusion 死标志 + preferForeground 失败仍 inject |
| 13 | MCP-1 | Med | manual MCP 仅过滤工具列表，不拦 execute |
| 14 | SRV-5 | Med | config.set 可扩 auto_approved_domains 无 arm |
| 15 | XC-Architecture-1 | Med | server.ts ~5.8k 控制面集中 → 回归与 origin/abort 漂移根因 |

---

## Findings by Severity

### Critical

**（无）** — 不编造。C1–C4 已关；本轮对抗未确认任何 unauthenticated / 无 pairing 即可 RCE 的新 Critical。所有 High 均要求 **已持有 ws_secret 的 authenticated peer**，或 **用户已启用 CU / MCP / spike** 的产品路径。

### High（10，去重 + 对抗确认）

#### H1 — PERS-1 / XC-Security-2 · thread 路径逃逸
- **File:** `companion/src/threads/thread-manager.ts:242-244,312-315`；`message-router.ts` thread.delete/select
- **Evidence:** `threadFilePath` = `path.join(DATA_DIR, "threads", \`${threadId}.json\`)`；仅 `create()` 调 `sanitizeId`。`../config` → 覆写/删除 `config.json`。
- **Impact:** 已配对 peer 可破坏 trust-root 配置（API keys、domains、MCP/apps）。
- **Fix:** 所有读写路径 sanitize 或 realpath 遏制于 `threads/`。

#### H2 — XC-Security-1 · mcp.add stdio 无 L2 任意 spawn
- **File:** `companion/src/message-router.ts:1083-1101`；`mcp/transport.ts:142-180`
- **Evidence:** `validateMcpServerConfig` 只检查 command 为 string；`StdioClientTransport({ command })` 无 L2。
- **Impact:** 绕过 enterprise shell 模块与 L2，本地用户身份 RCE。
- **Fix:** stdio add/update 强制 L2 或 arm phrase；可选 basename allowlist。

#### H3 — LLM-2 / XC-Security-6 · 线程 tape 未脱敏
- **File:** `companion/src/llm/adapter.ts:119-130,807`；对比 `history/store.ts` redactForStorage
- **Evidence:** `createToolResultMessage` 全量写入 `threads/*.json`；history.db 才脱敏。
- **Impact:** cookies/evaluate/shell/MCP 可从对话导出与磁盘读出。
- **Fix:** addMessage 前 redact tool 行。

#### H4 — XC-Correctness-1 · supersede 拆后任
- **File:** `message-router.ts:433-517`；adapter AbortError `deleteMessagesFrom`；extension chat.aborted 无 run_id
- **Evidence:** 前任 finally 无 generation 守卫即 delete abortControllers + releaseMultiAgentLlmLoop；deleteMessagesFrom 可抹后任消息。
- **Impact:** 新回合不可停、multi-agent 超额、磁盘丢消息、UI 假 Stop。
- **Fix:** per-run generation token；finally CAS；supersede 先 drain。

#### H5 — XC-Correctness-2 · 全局 disconnect 杀 tools
- **File:** `server.ts:193-200,2657-2668,5670-5680`
- **Evidence:** pendingToolCalls 无 originWs；任意 ws.close → 5s 全局 resolve 失败。
- **Impact:** tray 重连误杀 extension 长任务（download ≤125s）。
- **Fix:** pending 打 originWs；close 仅杀本 socket。

#### H6 — COMP-2 · cuPidForWindow 忽略 windowId
- **File:** `companion/src/host-use/darwin/host.swift:797-801`
- **Evidence:** CGWindowList optionAll 后 windows.first；对比 cuWindowInfoDict 正确过滤。
- **Impact:** 错进程 SkyLight pin / activate，与 HID 误投叠加。
- **Fix:** 经 cuWindowInfoDict 取 PID；缺失 fail-closed。

#### H7 — XC-Security-3 · HUD spike 特权 respond
- **File:** `server.ts:5587-5593`；`security-confirmation.ts:473-505`
- **Evidence:** hud.spike.confirm_response 调 respond()（绕过 origin）；门仅 CMSPARK_HUD_SPIKE=1。
- **Fix:** respondFrom(ws) 或隔离 spike id。

#### H8 — XC-Integration-1/2 · 取消协议缺口
- **File:** `server.ts:1987-2314`；extension tool.execute 无 cancel
- **Evidence:** extension Promise 不观察 AbortSignal；dispatchToExtension 不 stamp thread_id。
- **Fix:** tool.cancel + AbortSignal；统一 stamp。

#### H9 — XC-Ops-Release-2 · Tray autostart 损坏
- **File:** `menu-bar-agent.ts:267-291`；对比 `scripts/launchd/com.cmspark.companion.plist`
- **Evidence:** Tray 写 `daemon --daemonize`（CLI 不认）；正确为 `daemon start --daemonize`。
- **Fix:** 与 install-daemon.sh 同模板。

#### H10 — XC-Security-5 · MCP 密钥扇出 + env 继承
- **File:** mcp list/broadcast；`mcp/transport.ts:144-158`
- **Evidence:** list 含 env/headers；stdio env 继承 process.env + userEnv。
- **Fix:** list 脱敏；spawn scrubbed env allowlist。

### Medium（精选）

SEC-1 originWs 省略；SEC-2 多租户 eTLD；SEC-3 regex critical API；LLM-1† supersede 不 drain；LLM-3 shell 无 AbortSignal；LLM-4 无 cost budget；LLM-5 jailbreak 仅 content；MCP-1† manual 仅列表；MCP-2† list secrets；MCP-3/4/5/6 名/扫描/历史/生命周期；COMP-1†/3†/4/5/6 occlusion/FG/estop/trust/drag；SRV-1..5 shutdown/validate/race/maxPayload/domains；PERS-2/3/4 redaction+corrupt；EXT-1..4 thread 门/KeepAlive/streaming/mirror；SKILL-1/2/3；OBS-2；OPS-1†/2/3；TEST-1†/2†/3†；XC-Architecture-1†..6；XC-Correctness-3/4/5；XC-Integration-4/5；XC-Ops-Release-3/4/5；XC-Testing-4。

† 对抗从 High 下调。

### Low / Info
SEC-4/5/6/7/8；COMP-7/8/9/10；APP-1/2；OBS-1；SKILL-4；LLM-8；EXT-7/8；OPS-7/8；TEST-9/10；XC-Architecture-8；XC-Integration-8；XC-Correctness-8 等正向/fixed_verify。

---

## Subsystem Health Notes

| Subsystem | Score | 摘要 |
|-----------|------:|------|
| Security (auth/gates) | 7.5 | Trust root 真；残留 originWs / eTLD / regex critical API |
| Server + Router | 7.0 | Auth 好；shutdown/validate/race/maxPayload 债 |
| LLM + tool loop | 7.0 | wrapUntrusted 成熟；supersede/shell/thread 脱敏/预算弱 |
| MCP | 6.5 | capability 门强；manual execute / secrets / lifecycle 弱 |
| Computer + Host-use | 5.5 | 策略面强；macOS PID/occlusion/FG 弱 |
| Persistence | 7.0 | C2 已修；thread 路径与 corrupt 处理危险 |
| Chrome Extension | 7.0 | 握手/mermaid 好；thread 门/streaming 债 |
| Skills + Obsidian + Apps | 7.5 | skill 非 RCE；craft/import 注入；Apps 窄面健康 |
| Ops / package / tray | 7.5 | CI 诚实 + Node SHA256；签名/SBOM/tray plist 债 |
| Testing authenticity | 6.5 | security-gates 真；startServer/replica、CU skip |

---

## Cross-cut Dimension Scores

| Dimension | Score | 摘要 |
|-----------|------:|------|
| Architecture | 5.0 | 双层拓扑 OK；server 巨石 + 无 protocol SoT + lifecycle 碎片 |
| Correctness | 4.0 | supersede / multi-peer tools / abort 缺口最弱 |
| Security (XC) | 5.5 | 信任根修好；已认证 peer 面大 |
| Testing (XC) | 5.5 | C3 已死；High 缺真实 production 路径测 |
| Ops-Release (XC) | 6.0 | 打包卫生好；签名/自启/SBOM 未完成 |
| Integration | 5.5 | 握手一致；cancel/thread_id/set_enabled 半接线 |

---

## Prioritized Action Plan

### P0 — 1–5 天
1. threadFilePath 全路径 sanitize + `../config` 回归  
2. mcp.add/update stdio L2/arm + 禁静默 enable  
3. mcp.list 脱敏 + stdio scrubbed env  
4. supersede = abortThreadChatFull + generation CAS  
5. pendingToolCalls.originWs + per-socket grace  
6. tool.cancel + AbortSignal；dispatch stamp thread_id  
7. threads tool 行 redact  
8. 修 cuPidForWindow；occlusion/FG fail-closed（可同批）  
9. tray launchd 对齐 install-daemon.sh  
10. HUD spike → respondFrom(ws)  

### P1 — 1–2 周
全 L2 originWs；session-trust 收紧；history 补脱敏；corrupt fail-closed；MCP manual execute 门；shutdown 完整 drain；release needs CI；ADR-006 Superseded；skill craft 硬化。

### P2
拆 server.ts；共享 protocol；protocol_version；cost budget；startServer 真测 + CU Linux CI；Developer ID；streaming 切片。

---

## Method Appendix

**Agents:** Security · Server · LLM · MCP · Computer/Host · Persistence · Extension · Skills/Obsidian/Apps · Ops · Testing + cross-cuts Architecture/Correctness/Security/Testing/Ops-Release/Integration + adversarial severity adjustment.

**Policy:** confirmed = file:line evidence；severity_adjusted after threat-model review；fixed_verify for prior Criticals；**do not invent Criticals**.

**Rubric:** 9–10 A public-safe · 7–8 B core solid · 5–6 C trust root fixed but High open · 3–4 D Criticals · ≤2 F. This run **5.8 / C+**.

*Synthesized 2026-07-25 from multi-agent fanout + adversarial confirmations. Full artifact: audit-report-cmspark-2026-07-25.md.*