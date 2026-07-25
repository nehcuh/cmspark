# CMspark Deep Diagnosis Fanout Report (2026-07-25)

**Project:** CMspark — 浏览器内 AI Agent（Chrome Extension + 本地 Companion）  
**Mode:** RE-AUDIT + NEW surface (computer-use v1.3)  
**Versions:** companion / chrome-extension **0.3.0**  
**Prior audits:** 2026-06-16 · 2026-06-23 diagnosis · **2026-07-09 full 25-dim (4.4 / C)**  
**Method:** Multi-agent subsystem fanout + cross-cut dimensions + adversarial confirmation of critical/high claims  
**Artifact:** `audit-report-cmspark-2026-07-25.md`

---

## Executive Summary

本次是 **2026-07-09 全量审计后的复审**，并首次把 **computer-use / host-use（桌面坐标注入 + 宿主 COM/AX）** 作为一等信任面纳入评分。

### 最大好消息：四个 Critical 承重墙已关闭

| 2026-07-09 Critical | 2026-07-25 状态 | 证据 |
|---------------------|-----------------|------|
| **C1** WS 控制面零鉴权 | **FIXED_VERIFY** | `ws-auth.ts` HMAC-SHA256(ws_secret, nonce) + `verifyClient` Origin + pre-auth terminate；extension/tray 握手一致 |
| **C2** history.db 永不落盘 | **FIXED_VERIFY** | debounced `save()` + SIGTERM/SIGINT/`close()` flush；`server.ts` shutdown 调 `historyStore.close()` |
| **C3** CI `npm test \|\| true` | **FIXED_VERIFY** | `ci.yml` companion/extension tests 硬门；security-gates 有 `CMSPARK_DATA_DIR` 预导入隔离 |
| **C4** Critical npm 漏洞 | **FIXED_VERIFY** | supply-chain 文档 + CI prod audit gates |

相对 07-09 的 **4.4 / C**，整体 **上调至 5.8 / C+（+1.4）**。对抗验证后 **0 Critical**。

### 仍不能宣称「可安心公开发布」

**~16 个确认 High** 仍集中在：

1. **绕过 evaluate L2 的 CDP 选择器注入**（`get_page_html` / `waitForSelector` / `getElementCenter`）  
2. **未鉴权 WS 可在握手窗口收到 `config.updated`（MCP env/headers 泄露）**  
3. **computer-use 安全模型自毁**：session-trust 把 danger-caution / TinyClick G4 一并免确认；macOS 坐标当屏幕坐标；Stop 不杀注入任务  
4. **聊天生命周期**：multi-tool early-stop 留 orphan `tool_calls` → 下一轮 OpenAI 400；`chat.error` 后仍 `chat.done` 提交半截流  
5. **集成断裂**：background 剥掉 `nonce_response` / `add_to_thread_whitelist`；发布包可能缺 `cmspark-host` / TinyClick / Windows host scripts  
6. **架构文档严重滞后**：`architecture.md` 仍写 phantom 模块并省略 desktop 面

**一句话**：控制面终于上了锁；但「安全工具」里仍有未上锁的侧门，桌面自动化的人类闸门在 mid-task 被 session-trust 拆掉，聊天状态机与发布包在 v0.3.0 computer-use 扩张后还没跟上。

---

## Score Dashboard

```
Security        ██████░░░░  6.0  C+
Stability       █████░░░░░  5.2  C
Performance     ███████░░░  7.2  B
Testing         █████░░░░░  5.2  C
Maintainability █████░░░░░  4.8  C-
Design          █████░░░░░  5.5  C+
Release         ████░░░░░░  4.5  C-
Computer-Use    █████░░░░░  5.0  C
─────────────────────────────────────
Overall         ██████░░░░  5.8  C+
```

| Dimension | 2026-07-09 | 2026-07-25 | Δ |
|-----------|------------|------------|---|
| Security | 3.5 | **6.0** | +2.5 |
| Stability | 3.5 | **5.2** | +1.7 |
| Performance | 6.0 | **7.2** | +1.2 |
| Testing | 3.5 | **5.2** | +1.7 |
| Maintainability | 6.0 | **4.8** | −1.2 |
| Design | 5.5 | **5.5** | 0 |
| Release | 3.0 | **4.5** | +1.5 |
| **Computer-Use** | n/a | **5.0** | NEW |
| **Overall** | **4.4 / C** | **5.8 / C+** | **+1.4** |

### Finding Statistics（去重后开放项）

| Severity | Count |
|----------|------:|
| **Critical** | **0** |
| **High** | **16** |
| Medium | ~38 |
| Low | ~18 |
| Info / fixed_verify | ~20 |
| **Open total (H+M+L)** | **~72** |

---

## Prior Audit Delta（相对 2026-07-09）

### 已关闭 / 验证通过
- **C1** WS 无鉴权 → FIXED_VERIFY（HMAC + Origin + unauth terminate）
- **C2** history 不 flush → FIXED_VERIFY（debounce + shutdown close）
- **C3** CI `|| true` → FIXED_VERIFY
- **C4** Critical npm → FIXED_VERIFY
- **H8** Node 无 SHA256 → FIXED_VERIFY
- evaluate 默认阻断 + critical force-confirm 仍 enforced
- settings-web Host/Origin/token/SSRF 无回归
- PrivilegeMode 死 UI 已移除
- MCP capability + meta-tool 门集成测试在
- S-P0-1 HOST_BIN 需显式 opt-in；Darwin estop held socket

### 仍开放 / 部分关闭
- Extension evaluate HMAC：PARTIAL（扩展 no-op）
- Confirmation originWs：PARTIAL（host_computer 绑；evaluate/navigate/MCP 常省略）
- 选择器注入：STILL_OPEN
- config.updated 鉴权扇出：STILL_OPEN
- 代码签名/公证：STILL_OPEN（ad-hoc only）
- Abort 正确性：STILL_OPEN

### 本轮全新表面
- `companion/src/computer/*` + `host-use/*`
- Apps P1 launch-only（相对健康）
- TinyClick/ORT（发布包常缺失）

---

## Top Risks

| # | ID | Sev | 一句话 |
|---|-----|-----|--------|
| 1 | SEC-1 | High | 选择器插进 Runtime.evaluate → 绕过 evaluate L2 的页面 RCE |
| 2 | SRV-1 | High | config.updated 发给未鉴权 socket → 无需 secret 吸 MCP 密钥 |
| 3 | COMP-2 | High | 一次 L2 后 session-trust 免掉 danger/TinyClick re-L2 |
| 4 | COMP-1 | High | macOS client 坐标当 screen 坐标 |
| 5 | XC-Int-1 | High | background 丢掉 nonce_response / thread-trust |
| 6 | XC-Cor-4 | High | Stop 不翻 computerTaskAbort |
| 7 | XC-Cor-1/2 | High | tool 孤儿 + 重建仍 400 |
| 8 | EXT-1 | High | 流式忽略 thread_id 跨线程污染 |
| 9 | XC-Sec-6 | High | god-mode 无 companion step-up |
| 10 | OPS-2 | High | 发布可缺 cmspark-host/TinyClick/win scripts |
| 11 | XC-Cor-3 | High | error 后 done 提交半截流 |
| 12 | SEC-2/MCP-1 | Med | L2/MCP 确认常不绑 originWs |
| 13 | SKILL-1 | Med | craft 可持久知识注入 system prompt |
| 14 | XC-Arch-1/2 | High* | 文档/ADR 与 desktop 面脱节 |
| 15 | XC-Test-1 | High* | harness 特权 respond 测不到 origin |

---

## Findings by Severity

### Critical
**（无）** — 不编造；C1–C4 已关且对抗未确认新 Critical。

### High（16，去重确认）

**H1 SEC-1** — `chrome-extension/src/background/browser-bridge.ts:603-606,964-967,981-987`  
选择器字符串注入；`L2_GATE_TOOLS` 不含 get_page_html/click。修复：JSON.stringify / CDP DOM API。

**H2 SRV-1** — `companion/src/server.ts:3214-3232`  
configEvents 仅 OPEN 扇出，未查 authenticated；MCP env/headers 未 redact。修复：broadcastToClients + redact。

**H3 COMP-1** — `host-use/darwin/host.swift:918-936`  
cuInject 无 ClientToScreen。修复：窗口 bounds + client offset。

**H4 COMP-2** — `computer/executor.ts:606-622,914-955`；`server.ts:927-939`  
reL2 对 trusted session 全放行含 danger/TinyClick。修复：危险/实验 API 强制交互；改假绿测。

**H5 EXT-1** — `useWebSocket.ts:148-174`  
token/done 不比 thread_id；streamingRef 切线程不清。

**H6 XC-Integration-1** — `background/index.ts:446-457`  
剥 nonce_response / add_to_thread_whitelist → 生物识别降级与线程信任失效。

**H7 XC-Correctness-4** — `App.tsx:813-819`；`message-router.ts:610-617`  
Stop 只 chat.abort，不 computer.task.abort。

**H8 XC-Correctness-1** — `llm/adapter.ts:287-325`  
strip incomplete tool_calls 后仍 push orphan tool 行。

**H9 XC-Correctness-2** — `adapter.ts:714-715,790-807,868-873`  
shouldStop 只 messages.pop()，磁盘留 orphan；无 deleteMessagesFrom。

**H10 XC-Correctness-3** — adapter + useWebSocket  
chat.error 后 chat.done 用 streamingRef 提交半截「完成」气泡。

**H11 XC-Security-6** — `message-router.ts:151-165`  
config.set 布尔即可武装 god-mode；UI phrase 仅客户端。

**H12 OPS-2** — `scripts/package.sh:149-157`  
cmspark-host 缺失仅 WARNING。

**H13 XC-Ops-Release-1/2** — package.sh vs build-windows-exe.ps1  
release 缺 TinyClick/ORT/host-scripts-win；双管线。

**H14 XC-Architecture-1/2** — `docs/architecture.md`；adr 止于 013  
phantom modules；无 computer ADR。

**H15 XC-Architecture-5** — server.ts 分散 L2 绑定规则  
originWs 不一致的架构根因。

**H16 XC-Testing-1 / TEST-3** — security-gates harness + ubuntu skip WIN  
origin 与 desktop 回归不可见；COMP-2 假绿。

### Medium（精选）
SEC-2/3/4, SRV-2, LLM-1†/2†/3/4/5/6, MCP-2..7, COMP-3†/4/5/6/7, EXT-2†/3†/4, SKILL-1†/2/3, PERS thread corrupt / vault relPath / host_read 200c / Obsidian non-atomic, OPS-1†/3/4, XC-Int-3/4, CI Node20 vs pack Node22, release body stale auth text, TEST-1†, XC-Test-5 COMP-2 假绿。

† 对抗后从 High 下调。

### Low / Info
SEC-5 手改 `*`；SRV-3 allow-unknown；god-file；多项 fixed_verify 正向对照（settings-web、evaluate 默认阻断、MCP 能力门、skill 路径遏制、Obsidian realpath、healthz、WS 握手、Node SHA256）。

---

## Subsystem Health Notes

| Subsystem | Score | 摘要 |
|-----------|------:|------|
| Security | ~6.0 综合 | 信任根好；selector/config fanout/god-mode 拖后 |
| Server + Router | 7.0 | C1/C2 关；configEvents/pendingToolCalls 洞 |
| LLM + tool loop | 6.5 | 门控成熟；abort/预算/whitelist 弱 |
| MCP | 6.5 | 能力门真；origin/生命周期/扫描残 |
| Computer + host-use | **5.5** | 设计深；mid-task 与 mac 保真度差 |
| Persistence | 7.5 | history 好；线程损坏/Obsidian 弱 |
| Extension | 6.5 | auth 好；跨线程/字段剥/sanitize evaluate |
| Skills/Obsidian/Apps | 7.5 | 路径安全；craft/RAG；Apps P1 健康 |
| OPS packaging | 4.5 发布综合 | 校验进步；computer 面不完整 |
| Testing | 5.2 综合 | security-gates 真；harness/platform 假信心 |

---

## Cross-cut Dimension Scores

| Dimension | Score |
|-----------|------:|
| Architecture | 5.0 |
| Correctness | 4.0 |
| Security (XC) | 5.5 |
| Testing (XC) | 5.0 |
| Ops-Release | 4.0 |
| Integration | 4.0 |

---

## Prioritized Action Plan

### P0（1–3 天）
**P0-A 安全当日：** selector JSON.stringify；config fanout 鉴权+redact；confirmation 全字段转发。  
**P0-B Stop/流/线程：** chat.abort→computerTaskAbort；thread_id 门控流；shouldStop/orphan 清理；error 后不 done 半截流。  
**P0-C Computer：** reL2 排除 danger/TinyClick；Darwin client→screen。  
**P0-D 发布：** hard-gate host/tray；TinyClick/win scripts 或明确裁剪；修 release auth 文案。

### P1（1–2 周）
统一 requestL2 originWs + 双客户端测；god-mode companion step-up；evaluate 不 sanitize；skill craft allowlist；MCP roots/kill/redact；Self-UI bundleId + clearSession；Win estop 证明；ADR-014 + architecture 重写；release needs tests + 版本统一 + Node major 对齐。

### P2
拆 server.ts；共享协议 schema；pendingToolCalls 绑定；PSL 通配；token 预算；coverage+矩阵；Developer ID；线程损坏策略；原子写。

---

## Method Appendix

- **Agents:** Security, Server, LLM, MCP, Computer/host-use, Persistence, Extension, Skills/Obsidian/Apps, OPS, Testing + XC Architecture/Correctness/Security/Testing/Ops-Release/Integration  
- **Adversarial:** critical/high 二次证据；severity_adjusted 采纳（MCP-1→low, LLM-1/2→med, COMP-3→med, EXT-2/3→med, SKILL-1→med, OPS-1→med, TEST-1→med, TEST-2→low）  
- **Policy:** 不编造 Critical；fixed_verify 进 Delta 不重开；证据以 inspected 静态为主  
- **Calibration:** C+ = 5.5–6.4；Overall 5.8 = 信任根修复加分 − computer/正确性/发布新债

---

*Report generated 2026-07-25 · CMspark 0.3.0 · multi-agent deep diagnosis synthesis*
