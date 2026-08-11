# CMspark Deep Diagnosis Fanout — 2026-08-11

> Generated post-merge main `a6eb5a3` (#168–#171 Precision Instrument + Graph). Combined with independent 4-agent fanout: `docs/audit/precision-merge-adversarial-fanout-2026-08-11.md`.

## Executive summary

本报告综合 **10 个子系统审计**（均评 B）与 **6 条横切审计**（正确性横切评 C，其余 B），对重复根因做了严格去重，并对关键高优先级声称做了源码 spot-check（`[inspected]`）。

**结论一句话**：CMspark 作为本地浏览器 Agent 的产品骨架与能力面已达 0.5.0「功能完整」切点；但在 **并发/断连正确性、安全防御纵深（token/env/prompt/隔离）、发版产物一致性** 三处尚未达到可宣称的企业多端发布质量。总体评级 **C**。

| 维度 | 判断 |
|------|------|
| 功能交付 | 强：Panel↔Companion 闭环、L2、Pack/MCP/Board、CU/Host、STT/会议均已接线 |
| 安全基线 | 中：配对 HMAC、多数危险工具有 L2，但 fail-open 与 env 泄漏削弱纵深 |
| 正确性 | 弱：chat 双跑、断连不 abort、线程历史盲写、确认双响应 |
| 运维/发版 | 弱：package gates 空转、Windows 双产物线 |
| 架构纪律 | 中：ADR-020 文档完整，Surface 轴仍偏 UI；C10 拆分未完成 |

去重后严重度计数：**Critical 7 · High 18 · Medium 38**（Low 约 30 条并入正文「健康项/债务」叙述，不全表展开）。

> 说明：本报告**不**把「多表面 fan-out 确认」「MCP 与 native whitelist 正交（D8 注释）」等**明确设计选择**标为已修复；若产品 intentional，应在 UI/ADR 写清契约并补回归测试。Fanout #159 已修项未复列为 open。

---

## Overall grade

### **C**

**理由（诚实）**：

1. **横切正确性 C 拖累全局**：并行 `ws.on('message')` 无 per-thread 串行 → 并发 `chat.create` 可双装 AbortController 双跑 LLM（`[inspected]` message-router + lifecycle 模式）；disconnect 不 abort；UI `thread.messages` 盲 `SET_MESSAGES`。这类问题会直接造成 **thread tape 损坏与幽灵 busy**。
2. **安全「主路径可用、旁路/纵深不足」**：`shell_exec` 强制 token，但 `host_read`/`host_write`/`osascript_eval`/`host_computer` 仅在 token **存在时**校验，缺失则继续执行（`[inspected]` companion-dispatch.ts:917–964）；stdio MCP `{...process.env, ...getUserEnvVars()}`（`[inspected]` transport.ts:147–150）；`system_prompt` 覆盖 `basePrompt` 丢掉 untrusted 契约（`[inspected]` adapter.ts:442–443）。
3. **多 agent 控制面无归属**：`worker_cancel` 仅查 worker 存在即 abandon/abort（`[inspected]` companion-dispatch.ts:480–509），无 parent/run 校验。
4. **发版信任链破口**：`assert_file_exists` 未定义导致 whisper SoT 门禁空转（`[inspected]` test-package-gates.sh:85–88）；Release 走 package.sh，本地 Windows SEA 另一路径且扩展可 soft-fail。
5. **抵消因素（为何不是 D/F）**：本地 loopback + HMAC 配对；evaluate 默认 forceConfirm；URL/cookie 门与多数危险路径有确认台；测试体量大；架构文档与 ADR 齐全。日常单用户单 Panel 场景多数路径可用。

**升级到 B 的最低条件**：清完 P0 七项并补关键负向回归。**升级到 A**：P0+P1 完成 + 工具/协议锁步 CI + 并发/确认跨表面 e2e。

---

## Architecture assessment

### 拓扑与边界

- **A1 双层拓扑总体成立**：浏览器操作在 Extension/CDP，推理与状态在 Companion。
- **已知违反**：
  - Extension NotebookLM 命名直连 OpenAI-compatible API（x-architecture-01）。
  - `chat.llm_override.api_key` + `chrome.storage.local` 明文密钥（x-architecture-02 / extension-ui-04）使凭证双驻留。
- **运行时图**：`server.ts` 多处 `bind*Runtime` 可变单例 + `companion-dispatch` 动态 import `message-router`，层级不清（x-architecture-07）。

### 能力三轴（ADR-020）

| 轴 | 运行时强制 | 评价 |
|----|------------|------|
| Surface (L0/L1/L2) | 基本仅 UI badge（useCapabilityMode） | 文档暗示 runtime L0 易误导 |
| Composition (Pack) | skills/knowledge/whitelist 部分生效 | **MCP 不进 whitelist**（D8） |
| Autonomy | L2 + auto_approve 代数复杂 | evaluate 常 forceConfirm 是加分；注释与 config JSDoc 滞后 |

### 神文件与漂移

| 文件 | 规模/问题 |
|------|-----------|
| `companion/src/message-router.ts` | ~3.5k，FREEZE 仅抽 config |
| `companion/src/tool/companion-dispatch.ts` | ~1.6k 多域 switch |
| `chrome-extension/.../useWebSocket.ts` | ~1.7k inbound switch |
| 工具目录 | catalog JSON + inject + COMPANION_TOOLS + extension switch 四源 |
| `set_tab_url` | schema/lease 有、catalog/bridge 无 → 幽灵工具 |

### 并发模型

WS 帧级全 async 无连接/线程队列（core-runtime-02 / x-correctness-08）是 **正确性高危簇的根使能条件**，与 chat single-flight、config RMW、MCP 状态交织。

---

## Findings by severity

### Critical（7）

| ID | Title | File | Evidence | Fix |
|----|-------|------|----------|-----|
| **SEC-01** | host_read/write/osascript/host_* 缺 token 仍执行 | `companion/src/tool/companion-dispatch.ts` | token 仅 truthy 时 validate；shell_exec 缺 token 硬失败（917–964 等）`[inspected]` | 镜像 shell_exec：强制 validateTokenFor |
| **SEC-02** | stdio MCP 继承全量 process.env + user_env | `companion/src/mcp/transport.ts` | `{...process.env, ...getUserEnvVars()}`（147–150）`[inspected]` | 最小 env 白名单 + 显式 config.env |
| **SEC-03** | system_prompt 覆盖 base 含 untrusted 规则 | `companion/src/llm/adapter.ts` | `overrideSystemPrompt \|\| basePrompt`（442–443）`[inspected]` | append-only + 强制 security footer |
| **ISO-01** | worker 控制/认领无 parent·run 归属 | `companion/src/tool/companion-dispatch.ts` | worker_cancel 仅存在性检查（480+）`[inspected]`；board_claim 同 | WORKER_NOT_OWNED 门 |
| **CORR-01** | 并发 chat 双跑 LLM（孤儿 AbortController） | `message-router.ts` + `ws/lifecycle.ts` | 双 handler 同时见 existing=null 各装 controller | 同步 CAS single-flight |
| **CORR-02** | WS 断连不中止 in-flight LLM/tool | `companion/src/ws/lifecycle.ts` | close 清确认/MCP session，无 abortThreadChat | peer close → abort 持有循环 |
| **OPS-01** | package gates `assert_file_exists` 未定义 + Windows 产物分叉/SEA 扩展 fail-open | `scripts/tests/test-package-gates.sh`；`release.yml`；`build-windows-exe.ps1` | 85–88 调用未定义函数且 set 无 -e（`[inspected]`）；Release 仅 package.sh | 实现 helper；统一 SoT；扩展 fail-closed |

### High（18）

| ID | Title | File | Evidence | Fix |
|----|-------|------|----------|-----|
| **SEC-04** | 默认 L2 未绑定 originWs（任意已鉴权 peer 可批） | `tool/l2-admission.ts` | confirmOriginOpts 仅 nonce/host_computer 绑 origin；默认 undefined（1138–1143）`[inspected]` | 非 outbound 默认 `{originWs:ws}` |
| **SEC-05** | 多租户平台 wildcard 仍可通过 | `security.ts` | PUBLIC_SUFFIXES 不全；*.azurewebsites.net 等 | publicsuffix + 拒 eTLD+1 共享后缀 |
| **SEC-06** | loadConfig 不重过滤危险 wildcard | `config.ts` | 仅 saveConfig filter | load/mtime 同过滤 |
| **SEC-07** | shell allowlist 仅前缀匹配 | `capability/shell.ts` | `startsWith(prefix+" ")` | argv 模板 / 禁 -c |-e |
| **SEC-08** | shell_exec cwd 任意绝对路径 | `capability/shell.ts` | normalize 无 workspace 包含 | cwd 绑 L2/workspace |
| **SEC-09** | cmspark-host 完整性仅 inject 路径 | `host-use/darwin/*` | capture/OCR/evidence 用 raw execFileAsync | 全路径 spawnHostBin |
| **CORR-03** | thread.messages 盲 SET 覆盖 live stream | `useWebSocket.ts` | 无 thread_id/generation 门 | select epoch 门控 |
| **CORR-04** | 双表面确认可双响应 / 死 WS 丢响应 | `CockpitApp.tsx`；`background/index.ts` | Panel 乐观清 + Cockpit 60s deny；send 不查返回值 | SW 首响 resolved；失败回滚 |
| **CORR-05** | regenerate 先 truncate 后 abort | `message-router.ts` | 旧循环可回写已删后缀 | 先 abort+drain 再截断 |
| **CORR-06** | fill_form clear 仅 Ctrl+A（macOS 失效） | `browser-bridge.ts` | 无 metaKey | Meta+A 或 evaluate select |
| **CORR-07** | download waiter 可 latch 外 tab 下载 | `download-waiter.ts` | onCreated 忽略 tabId | 绑 initiator/hint |
| **CORR-08** | Whisper resolve 忽略 CMSPARK_DATA_DIR | `stt-session-service.ts` | search roots 无 dataDir | 传入 DATA_DIR |
| **CORR-09** | recording 状态永生击穿会议 cap | `meeting-store.ts` | cap 跳过 recording | boot reconcile |
| **ARCH-01** | Extension 直连 LLM（NotebookLM） | `notebook-name-suggester.ts` | fetch chat/completions | companion one-shot |
| **ARCH-02** | 凭证双驻留 + llm_override.api_key | `message-router`；extension storage | 扩展存明文 key | Companion 唯一 SoT |
| **INT-01** | spawn_worker 部分成功仍 success | `companion-dispatch` / spawn | pack/intent 失败嵌套仍 true | 事务化 stamp |
| **OPS-02** | daemon start 释放 UDS lock 再由 startServer 重获 | `index.ts` | releaseLock 后 init+start（165–171）`[inspected]` | 单所有权锁模型 |
| **OPS-03** | 发布 tag 与 package.json 版本未对齐校验 | `release.yml` | preflight 无版本比较 | tag == version fail-closed |

### Medium（精选 38 条中的代表簇；完整簇见下表）

| ID | Title | File | Evidence | Fix |
|----|-------|------|----------|-----|
| **SEC-M01** | untrusted 后缀空 id 退化为 `x` | `text-sanitize.ts` | empty → x | 强制随机 id |
| **SEC-M02** | 文档 filename 未转义注入 markup | `adapter.ts` | raw filename | 消毒/围栏 |
| **SEC-M03** | PAGE_CONTENT_TOOLS 漏 host/shell/MCP | `text-sanitize.ts` | source 弱标签 | 扩 EXTERNAL_DATA |
| **SEC-M04** | 出站 fetch 无 DNS 解析（SSRF） | `security.ts` | 仅 hostname 字面 | lookup all A/AAAA |
| **SEC-M05** | DESTRUCTIVE_MCP_TOOL_PATTERN 对 snake_case 失效 | `mcp/dispatch.ts` | `\b` + `_` | token 边界正则 |
| **SEC-M06** | HTTP MCP 任意 scheme/host | `mcp/manager.ts` | url 仅 string | https + SSRF 门 |
| **SEC-M07** | 敏感 tool 结果 <200 字不折叠 | `tool-persistence-redact.ts` | 阈值 200 | 始终 collapse |
| **SEC-M08** | 扩展 evaluate 只信 token 非空 | `evaluate-code-policy.ts` | 无 HMAC 复验 | companion 信封/nonce |
| **SEC-M09** | 知识 RAG 跳过 sanitize | `skill-engine.ts` | RAG 直出 chunk | 构建/返回时消毒 |
| **SEC-M10** | use_skill 内容未消毒 | `skill-engine.ts` | loadContent raw | sanitize |
| **CORR-M01** | per-connection 无消息队列 | `lifecycle.ts` | async handler | 每连接 mutex |
| **CORR-M02** | jailbreak 中途 return 跳过 cleanup | `adapter.ts` | 无 chat.done | SecurityAbort |
| **CORR-M03** | 主路径无 stripLoneSurrogates | providers | 仅 llmExtract 有 | wire 前全量 strip |
| **CORR-M04** | OpenAI 无 max_tokens / Anthropic 有 | providers | 不对称 | 共享 computeMaxTokens |
| **CORR-M05** | tool.start 无 thread_id 仍改 active | `useWebSocket.ts` | legacy 路径 | fail-closed |
| **CORR-M06** | off-active chat.done 丢内存 commit | `useWebSocket.ts` | 仅清 busy | 侧缓存合并 |
| **CORR-M07** | SOFT lease 探针失败无限续期 | `tab-lease.ts` | catch 续 soft | 硬上限 |
| **CORR-M08** | STT maxMs 存了不执行 | `stt-session-service.ts` | timer 用 deps 默认 | min(req, cap) |
| **CORR-M09** | audio_retained 仅空目录 | `meeting-store.ts` | 无写入 | 实现或删 API |
| **CORR-M10** | Anthropic tool_call id 碰撞 `tool_call` | `anthropic-convert.ts` | 空 id 同名 | 唯一化 |
| **INT-M01** | protocol_version 协商后未消费 | `protocol.ts` / clients | 字面量 1 三处 | 持久化 + 特性门 |
| **INT-M02** | Extension Thread 缺 board 字段 | `types.ts` | 无 mission_board | 共享协议类型 |
| **INT-M03** | 编排晋升后 worker 丢 pack whitelist | `orchestrator/spawn.ts` | parentCapabilityWhitelist=null | 快照继承 |
| **INT-M04** | board_mode off 但 sticky mission_board 仍强制 handback | `board/service.ts` | OR mission_board!=null | 仅 board_mode |
| **INT-M05** | RPC 无 request-id 相关 | extension background | send 即 ok | 按 id 关联 |
| **OPS-M01** | crash.log 忽略 CMSPARK_DATA_DIR | `crash-handlers.ts` | 硬编码 ~/.cmspark-agent | 用 DATA_DIR |
| **OPS-M02** | engines ≥20 vs 打包 Node 22 | package.json / package.sh | 漂移 | engines 锁 22 |
| **OPS-M03** | PR CI 仅 ubuntu | `ci.yml` | 无 win/mac 冒烟 | 夜间矩阵 |
| **OPS-M04** | SEA postject 无锁文件 + PE 补丁 + useCodeCache | build-windows-exe / sea-config | 供应链+缓存风险 | pin + codeCache false |
| **OPS-M05** | install-daemon 硬编码数据目录 | install-daemon.sh | 与 CMSPARK_DATA_DIR 分叉 | 贯穿 env |
| **OPS-M06** | stdout/stderr/crash 日志无 prune | log-rotation.ts | 仅 companion-日日志 | 扩展 prune |
| **OPS-M07** | HTTP listen 无 EADDRINUSE 处理 | lifecycle.ts | 仅 listening | error 监听 |
| **OPS-M08** | macOS DMG 未进 GH Release | release.yml | 仅 zip | 上传 DMG |
| **ARCH-M01** | COMPANION_TOOLS 与 dispatch 双名册 | server.ts / dispatch | 锁步漂移 | 单 registry |
| **ARCH-M02** | SURFACE_BY_TOOL 漏 workspace/MCP | surface-by-tool.ts | 默认 L0 | 扩表/元数据 |
| **ARCH-M03** | ADR-020 Surface 无 runtime 门 | companion 无 CapabilityLevel | UI only | 文档或 pregate |
| **TEST-M01** | 无 executeCompanionTool 负向用例（归属/token） | tests/ | 覆盖缺口 | 补单测 |
| **TEST-M02** | RAG sanitize / system_prompt / MCP snake_case 无回归 | 多处 | 见 x-tests | 表驱动锁 |

### Low（摘要，不全表）

CLI start/stop/status 半实现；首写 config 非原子；approveServer 死 API；HUD spike 静态 import；protocol 魔数三处；TS 根 6 vs 子包 5.4；测试并发 DATA_DIR 共享风险；confirm_session 无操作别名文档漂移等。

---

## Subsystem health matrix

| Subsystem / Cross-cut | Grade | 一句话 |
|----------------------|-------|--------|
| core-runtime | B | 生命周期可用；god-router + 锁窗口 + 无消息队列 |
| llm-adapter | B | 流式/工具环成熟；prompt 覆盖与 untrusted 细节伤 |
| security | B | L2 主路径在；token fail-open 与 wildcard/SSRF 残 |
| bridge-tools | B | CDP 面全；macOS clear/下载/幽灵工具 |
| mcp | B | 信任/能力门有；stdio env 与 regex 弱 |
| computer-host | B | 企业能力齐；shell 前缀/cwd/host 完整性 |
| voice-meeting | B | 本地 STT 可用；DATA_DIR 与 recording 生命周期 |
| orchestrator-packs | B | spawn/lease/board 有；归属与 MCP 白名单洞 |
| extension-ui | B | 确认台/流式可用；双端竞态与明文密钥 |
| ops-ci-packaging | B | 有 gates；Windows 双线 + 门禁 bug |
| cross-architecture | B | 拓扑大体正确；凭证/直连 LLM/神文件 |
| **cross-correctness** | **C** | **并发与断连正确性最弱横切** |
| cross-security | B | 与子系统安全问题同根 |
| cross-tests | B | 体量大；关键负向缺口 + gates 空转 |
| cross-ops | B | 服务安装与多产物线 |
| cross-integration | B | pack/board/e2e 缝与协议类型未共享 |

---

## Prioritized action plan (P0/P1/P2)

### P0 — 发布阻断 / 数据与密钥完整性（建议同一里程碑清完）

1. **host_* / osascript 强制 security_token**（SEC-01）
2. **MCP stdio 最小 env**（SEC-02）
3. **system_prompt 不可替换安全基线**（SEC-03）
4. **worker 控制面归属**（ISO-01）+ 负向单测
5. **chat 线程 single-flight + regenerate 顺序**（CORR-01/05）
6. **disconnect abort LLM**（CORR-02）
7. **package gates 修复 + Windows 产物 SoT + SEA 扩展 fail-closed**（OPS-01）

### P1 — 下一迭代强安全与正确性

- L2 origin 绑定；确认 single-flight；thread.messages/tool.start 门控
- shell argv+cwd；wildcard load 过滤；MCP whitelist 产品决策落地
- daemon 锁模型；DATA_DIR 贯穿 crash/whisper；meeting recording reconcile
- fill_form macOS；download waiter 范围

### P2 — 架构债与可维护性

- 神文件按域拆分；工具/协议单 SoT CI
- 取消扩展直连 LLM 与明文 key 缓存
- spawn 事务化；host 完整性统一；coverage 观测；多 OS CI 冒烟

---

## What looks healthy

- **配对与 loopback WS 鉴权**：HMAC/nonce 是真实门（Origin 仅 scheme 级是已知残差）。
- **evaluate 默认 forceConfirm**（三旗 cruise 才放行）比早期 god-mode 注释更安全。
- **URL/cookie 信任域分离**、L2 token 绑定 payload + 短 TTL 单次使用。
- **pack 作为 composition 而非新 runtime**（apply 到 thread）方向正确。
- **多 agent tab lease + HARD_DENY** 对 native 危险工具有一定隔离（MCP 除外）。
- **测试与文档密度高**：ws-router-validator-lockstep、大量 security-gates、ADR-020/014/015 等。
- **package.sh 对 host/tray/scpt 已 fail-closed**（相对 SEA 扩展路径更严）。
- **语音/会议本地优先**设计清晰；隐私 ack 至少在 wire 层强制布尔。

---

## Method (fanout map)

```
Deep Diagnosis Fanout 2026-08-09
├── Subsystems (10) — each grade B
│   ├── core-runtime      daemon/lock/WS/router/crash
│   ├── llm-adapter       stream/tools/untrusted/vision
│   ├── security          L2/token/domain/SSRF/redact
│   ├── bridge-tools      CDP catalog/extension execute
│   ├── mcp               inbound/outbound transport/trust
│   ├── computer-host     CU/shell/workspace/netsec/estop
│   ├── voice-meeting     whisper STT + meeting store
│   ├── orchestrator-packs spawn/lease/board/skills/thread
│   ├── extension-ui      Panel/Cockpit/WS mirror
│   └── ops-ci-packaging  CI/package/SEA/release
├── Cross-cuts (6)
│   ├── architecture  god files / ADR-020 / dual-home
│   ├── correctness   abort/generation/stream/disconnect  ← grade C
│   ├── security      token/origin/env/wildcard 合并
│   ├── tests         gates bug + coverage gaps
│   ├── ops           daemon/install/release 合并
│   └── integration   pack/board/protocol/types
└── Synthesis (this report)
    ├── root-cause dedup（同因只列一次）
    ├── spot-check high claims [inspected]
    └── P0/P1/P2 action plan（≤20）
```

**证据标注约定**：`[inspected]` = 本合成阶段读了对应源码行；其余继承各 agent 报告，未逐条复验。若后续 PR 已合入修复，应以测试绿 + 负向用例为准关闭条目。

---

*Report synthesized for CMspark 0.5.0 deep diagnosis · READ-ONLY · 2026-08-09*
