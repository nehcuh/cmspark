# CMspark Project Health Fanout Report (2026-08-09)

**Project / 项目:** CMspark — 浏览器内 AI Agent（Chrome Extension Side Panel + 本地 Companion）  
**Mode / 模式:** 8-dimension parallel fanout + synthesis（Map×8 → Synthesize×1）  
**Versions / 版本:** companion / chrome-extension **0.5.0**  
**Date / 日期:** 2026-08-09  
**Method / 方法:** Workflow project-health-fanout；合成层校准 Critical/High；维度证据为代码路径级 [inspected]  
**Artifacts / 产物:**
- `docs/audit/health-fanout-2026-08-09.md`（本报告）
- `docs/audit/health-fanout-2026-08-09-summary.json`
- `docs/audit/health-fanout-2026-08-09-dimensions.json`

**Prior audits / 前次审计:** 2026-07-09 (4.4/C) · 07-25 security (5.8/C+) · 07-28 docs (~6.9/B-) · 08-02 deep diagnosis fanout  

**Recalibrated severity / 校准规则:**
- **Critical** = unauthenticated RCE / 大规模破坏  
- **High** = post-auth local RCE-equivalent / 完整性破坏 / durable secret tape  

---

## Executive Summary

CMspark **0.5.0** 产品主面（Side Panel ↔ Companion 闭环、Pack / 入站 MCP / Confirm Center、Multi-agent Board、听写+ / 本机 STT / 会议工作台、Obsidian / Mermaid）与代码大体对齐；**产品维约 7.6 / B**，文档 hub 与用户指南可用，可作为**内测 / 自用稳定切点**。

**安全仍是主拖累 (Security remains the primary drag):** 鉴权后 `mcp.add` stdio 无 L2、线程路径未净化、thread JSON 全量 tool 磁带、`tool.result` 未绑 origin、`chat.create` supersede 无 generation CAS、macOS CU 错绑 PID，以及 Whisper 静默 PATH 回退 / 缺 pin、Outbound `require_grant=false`——合计 **0 Critical / 9 High**。

架构与可维护性被 `companion/src/server.ts`（~7160 LOC）与 `companion/src/message-router.ts`（~3528 LOC）双神文件 + 无共享协议类型包拖累；测试体量大（companion ~186 + extension ~66 `*.test.ts`）但 `startServer()` 仅副本测、release 打包不重跑测试。

| 对比轴 | 结论 |
|--------|------|
| vs 2026-07-28 docs fanout ~6.9/B- | 整体 **6.6 / B-** 略降：产品/文档仍 B 档，安全 High 残留 + 0.5.0 新表面（Whisper / Outbound）重权拉低 |
| vs 2026-07-25 security fanout 5.8/C+ | 整体抬升；安全维 **6.0 / C+**，有可测 hardening，但多数 prior High 仍 open/partial |
| 8 维 agent | **全部成功**（无失败维度） |

**Bottom line:** 在 P0 安全八件套与 Whisper / Outbound 门禁落地前，**不宜宣称分发级安全闭环 GA**。适合：自用 / 内测 / 受控环境。不适合：对不可信配对 peer 或公网分发的信任假设。

---

## Score Dashboard

### ASCII

```
CMspark 0.5.0 Health  |  overall 6.6 / B-  |  2026-08-09
========================================================
Architecture                 6.7  B-
Documentation                7.2  B
Design and UX                6.5  B-
Product features             7.6  B
Security residual            6.0  C+
Testing / CI / Release       6.7  B-
Maintainability              6.1  C+
0.5.0 product surfaces       6.7  B-
--------------------------------------------------------
Critical (recalibrated)      0
High (auth RCE/integrity/
  durable secret tape)       9
Prior: 6.9/B- (07-28 docs) | 5.8/C+ (07-25 sec)
```

### Table

| Dimension | Score | Grade | Notes / 备注 |
|-----------|------:|-------|--------------|
| Architecture | 6.7 | B- | Dual-layer 稳；god-file 债务持续 |
| Documentation | 7.2 | B | 07-28 的 underclaim 已大幅修复 |
| Design and UX product surface | 6.5 | B- | chrome 模式对；DESIGN↔tokens 漂移 |
| Product features — claimed vs delivered | 7.6 | B | 0.5.0 主面已交付 |
| Security residual recheck | 6.0 | C+ | 0 Critical / 9 High；有 hardening 但 High 未关 |
| Testing, CI, and Release | 6.7 | B- | 体量大；release 门松 |
| Maintainability and code health | 6.1 | C+ | 双神文件 + spike 噪音 |
| 0.5.0 product surfaces | 6.7 | B- | 新 High：VOICE-01/02、MCPO-01 |
| **Overall** | **6.6** | **B-** | vs 07-28 −0.3；vs 07-25 +0.8 |

### Finding statistics（合成去重后）

| Severity | Count | Meaning |
|----------|------:|---------|
| **Critical** | **0** | 未鉴权 RCE 类未再确认 |
| **High** | **9** | 见 Security Residual 表 + VOICE/MCPO |
| Medium | ~35+ | 文档/设计/测试/维护债 |
| Low / Info | ~20+ | 标签滞后、正例、非目标 |

---

## Prior Audit Delta

### vs 2026-07-28（文档向 ~6.9/B-）

| Theme | Then | Now 2026-08-09 |
|-------|------|----------------|
| 文档 underclaim / 事实错误 | 主拖累，文档维曾极低 | **大幅改善** → Documentation **7.2/B** |
| 产品叙事 vs 代码 | 部分过时 | 主面大体对齐 **7.6/B** |
| Overall blend | ~6.9/B- | **6.6/B-**（安全 + 0.5.0 表面 High 重权） |

### vs 2026-07-25（安全向 5.8/C+）

| Prior High / theme | Status | Evidence |
|--------------------|--------|----------|
| C1–C4 未鉴权 / history flush / CI / npm | 仍 **FIXED**（未回 Critical） | WS handshake gate `server.ts` ~6751–6758 |
| **threadFilePath** 路径逃逸 | **OPEN High (SEC-A)** partial | `sanitizeId` 仅 `create()`；readers/writers 仍裸 join |
| **mcp.add stdio 无 L2** | **OPEN High (SEC-B)** | `message-router.ts` ~1791–1810 无 `requestConfirmation` |
| **thread JSON 未脱敏 tool** | **OPEN High (SEC-C)** | `adapter.ts` 全量 persist；仅 history.db redact |
| **chat.create supersede** | **OPEN High (SEC-D)** | finally 无 generation CAS |
| **pendingToolCalls 全局 close** | **OPEN High (SEC-E)** partial | 无 `originWs`；close 扫全表 |
| **cuPidForWindow** | **OPEN High (SEC-F)** | `windows.first` 仍忽略 windowId 匹配 |
| MCP list 密钥广播 | **partial Medium (SEC-G)** | `config.updated` 已 redact；list 路径仍 raw |
| Voice/meeting 路径 | **largely FIXED** | session/meeting id containment + origin fence |
| **NEW:** Whisper PATH + pins | **NEW High VOICE-01/02** | ADR-023 L5 违反 |
| **NEW:** Outbound `require_grant` | **NEW High MCPO-01** | default `false` + `ws_secret` deputy |

**Hardening since 07-25（可确认改善）:**
- L2 `SecurityConfirmationManager.rejectAll` 按 originWs 作用域
- `redactConfigForBroadcast` 遮罩 `config.updated` 中 llm/vision key 与 MCP env/headers
- `HistoryStore.redactForStorage` 覆盖 cookies / evaluate / host_computer / MCP 形密钥
- voice STT：`sanitizeSessionId` + `assertWithin`、https-only Whisper pin 下载、chrome-extension origin
- meeting：`isSafeMeetingId` + `resolveContained`；默认 `audio_retained=false`

---

## Architecture Map notes

### Topology（ADR-001 仍成立）

```
Chrome Extension (Plasmo + React Side Panel + SW/CDP)
        ↕ WebSocket  ws://127.0.0.1:23401  (+ HMAC pairing / ws-auth)
Companion (Node.js + TypeScript)
  LLM · threads · skills · MCP · Pack · CU · Host
  · voice · meeting · outbound-mcp · board · orchestrator
```

**Positive / 正例 (ARCH-BOUND-1):** `browser-bridge.ts` 只做 CDP/tabs；`createToolExecutor` / `executeCompanionTool` 在 companion；CU host adapters **未**迁入 extension。

### Companion domain map（与 `docs/architecture.md` §4.1 对照）

| Area | Path | Role |
|------|------|------|
| Control plane | `companion/src/server.ts` (~7160), `message-router.ts` (~3528), `ws-auth.ts` | WS、工具、L2、广播 |
| Security | `security*.ts`, `capability/` | 确认队列、模块门 |
| Browser bridge | `bridge/` | tool catalog / tab |
| LLM | `llm/` | streaming + tool loop |
| Desktop L2 | `computer/`, `host-use/` | 坐标注入、宿主 |
| Pack / enterprise | `packs/`, `capability/`, `netsec/` | 任务包、shell、workspace |
| Multi-agent | `orchestrator/`, `board/` | tab lease、Board |
| MCP | `mcp/`, `outbound-mcp/` | 入站 client + 出站 server |
| **0.5.0** | `voice/` (~17 ts), `meeting/` (~6 ts) | STT / 听写 / 会议 |
| Other | `obsidian/`, `threads/`, `history/`, `tray/` | 导出、持久化、托盘 |

### Extension map

| Area | Path |
|------|------|
| CDP / SW | `chrome-extension/src/background/*` |
| Side Panel | `sidepanel/*`（Chat、Packs、Board、MCP、Voice…） |
| Mode / Surface | `sidepanel/mode/mode-controller.ts` |
| Cockpit | `cockpit/` |
| NotebookLM | `notebooklm/*` |

### Architecture health (6.7 / B-)

**Strengths**
- ADR-001 dual-layer held；领域目录对齐 ADR-020 三轴（Surface / Composition / Autonomy）
- **Pack Trust 纪律好 (ARCH-PACK-TRUST):** `FORBIDDEN_PACK_KEYS`（`packs/types.ts`）、`scanForbidden`、`pack.apply` 需 `user_gesture`+`allowTrust`、`spawn_worker` 强制 `allowTrust:false`
- Capability modules：shell/netsec 需 `capability_profile=enterprise`
- WS auth challenge-response 存在（`ws-auth.ts`）

**Primary debt**
| ID | Issue | Path |
|----|-------|------|
| ARCH-GOD-1 | `server.ts` multi-concern god-file | ~7160 LOC；tool exec + WS + MCP + CU abort |
| ARCH-GOD-2 | `message-router.ts` mega-switch | ~3528 LOC；100+ cases |
| ARCH-PROTO-1 | 无 `protocol_version` 协商 | 仅 HMAC auth |
| ARCH-TYPES-1 | 无共享 protocol/types 包；双 Thread 模型 | extension `sidepanel/types.ts` vs companion `thread-manager.ts` |
| ARCH-SURFACE-1 | Surface L0/L1/L2 为 UX 推导，非 companion 硬门 | `mode-controller.ts` vs `isToolAllowed` |
| ARCH-PROTO-2 | `validateWsMessage` allow-unknown | `server.ts` ~6245–6251 returns valid for unknown types |
| ARCH-DOC-1/2 | `architecture.md` §1.3 消息族、§4.1 树滞后 | 缺 voice/meeting 树；§1.3 仅 baseline families |

**Open decision:** L0 是否在 `createToolExecutor` 硬拒 `BROWSER_TOOL_NAMES`，或诚实文档化为 UX-only。

---

## Product Coverage Matrix narrative

**Score: 7.6 / B** — At 0.5.0, delivered surface largely matches README/GOAL claims.

| Capability | Status | Code anchors | User docs |
|------------|--------|--------------|-----------|
| Chat + multi-thread | **shipped** | `threads/`, `llm/adapter.ts` | README |
| L1 browser CDP tool loop | **shipped** | extension `background/` + `bridge/` | README |
| Skills / Knowledge | **shipped** | `skills/` | README |
| Inbound MCP | **shipped** | `mcp/` | `docs/mcp.md` |
| Mission Pack / enterprise modules | **shipped** | `packs/`, `capability/` | `mission-pack-usage.md` |
| Confirm Center / Cockpit | **shipped** | `security-confirmation` + cockpit UI | `confirm-center-user-guide.md` |
| Multi-agent P0 + Board/Fleet | **shipped** | `orchestrator/`, `board/` | `multi-agent-user-guide.md` |
| Obsidian export | **shipped** | `obsidian/` | ADR-008 |
| CSP-safe Mermaid | **shipped** | sidepanel renderer | ADR-009 |
| Computer Use | **partial** | `computer/`, `host-use/`；enable 仅 config | `computer-use-user-guide.md` |
| Host / Apps | **partial** | Linux `host_read` stub | `host-and-apps.md` |
| Dictation+ / local STT | **shipped**（packaging residual） | `voice/*` | ADR-023/024 + meeting guide |
| Meeting workbench | **shipped** | `meeting/*` | `meeting-and-dictation-user-guide.md` |
| Outbound MCP | **opt-in shipped**（叙事分裂） | `outbound-mcp/` | ADR-022 / mcp.md |
| Tray / pairing / daemon | **shipped** | `tray/`, `daemon.ts` | README |
| NotebookLM import | **shipped (fragile)** | `notebooklm/` | notebooklm guide |

### Gaps / 缺口（非 overclaim 若营销守界）

1. **FEAT-001** Outbound 双叙事：GOAL G21 仍写 Phase-0 skeleton；`mcp.md` + `index.ts mcp-outbound` 已是真实 bridge。  
2. **FEAT-002** CU `coordinateEnabled` 无 Side Panel 开关，仅 `config.json`。  
3. **FEAT-003** Linux Host Use stub（`host-use/linux/index.ts`）。  
4. **FEAT-004** Outbound L8 confirm：Win/Linux 无原生 tray 确认 → 无面板时 `OUTBOUND_CONFIRM_REQUIRED`。  
5. **FEAT-005** Path B STT：协议/UI 已交付；self-contained binary / pin / e2e residual。  
6. **FEAT-007** NotebookLM 依赖登录 + live DOM。  
7. **Non-goals correctly excluded (FEAT-010):** 系统混音、身份级 diarize — 若营销不过界则无 overclaim。

---

## Documentation Health

**Score: 7.2 / B**

### Strengths（相对 07-28 大修）

- `docs/README.md` 分层导航 + ADR-020 坐标  
- 根 README 0.5.0 能力矩阵含 L0–L2、Composition、Autonomy、听写/会议  
- 用户指南齐：confirm / MCP / packs / CU / host / multi-agent / NotebookLM / meeting-dictation  
- TROUBLESHOOTING 覆盖模型迁移、入站/出站 MCP、确认台  
- ADR-016 Implemented；risk-engine 不再伪造成 runtime  
- CHANGELOG 0.5.0 与 package.json 锁步；TinyClick 删除已记  

### Remaining debt

| ID | Title | Evidence | Sev |
|----|-------|----------|-----|
| DOC-01 | TESTING.md frozen at 0.3.0 + TinyClick | `docs/TESTING.md` L3/L72/L163；实际 ~186/~66 tests | medium |
| DOC-02 | User-guide version badges lag | multi-agent/NotebookLM 0.3.0；CU/host 0.4.0 | medium |
| DOC-03 | README default `model_name` wrong | README `deepseek-chat` vs `config.ts` `deepseek-v4-flash` | medium |
| DOC-04 | Process noise volume | `docs/decisions` ~193；`docs/audit/reviews` ~781 | medium |
| DOC-05 | Broken nav link | `docs/README.md` → missing `optimization-plan-document-parse-vision.md` | medium |
| DOC-06 | ADR-023 / GOAL G21 status lag | ADR still M0+M1；G21 skeleton vs shipped outbound | medium |
| DOC-07 | GOAL G1 fixed 26 tools | catalog ~54 tools | low |
| DOC-08 | CONTRIBUTING tree behind 0.5.0 | omits voice/meeting/outbound-mcp | low |
| DOC-09 | README related-docs omits meeting + user-env | vs docs hub | low |
| DOC-10 | architecture §11 still labeled 0.3.0 | tool chapter | low |

---

## Design/UX Health

**Score: 6.5 / B-**

### Strengths

- **ModeBadge** 聊 / 网页 / 计算机·LIVE 实现 ADR-020 Surface（`mode-controller.ts`）  
- **FocusBand** 优先级：Confirm > L2 Safety+急停 > Fleet > L1 Context  
- **L2 SafetyStrip** 深色条 + 急停 + 确认台；Cockpit StatusRail  
- `tokens.ts` helpers（`connectionColor*` / `statusColor` / `riskColor*`）  
- ComposeDrawer / StatusRail 用 SVG（`icons.tsx`）；VoiceMicButton 可访问  
- BottomBar permanent strip 正确关闭（`ui.bottomBarStrip=false`）  

### Debt

| ID | Title | Evidence | Sev |
|----|-------|----------|-----|
| DES-01 | DESIGN.md tokens ≠ tokens.ts | Gemini-breath indigo、更大 radius、220ms | medium |
| DES-02 | Composer chip / slash matrix drift | DESIGN 无 `/meeting`；code 有 | medium |
| DES-03 | Panel vs Cockpit mode dialect | 计算机·LIVE vs L2 · LIVE | low |
| DES-04 | Emoji chrome vs quiet-professional | ThreadList / Slash / McpPanel | medium |
| DES-05 | SettingsSlideout sprawl ~3.4k LOC | residual raw hex | medium |
| DES-06 | 0.5.0 voice/meeting under-signposted | L0 EmptyState 无听写/会议入口 | medium |
| DES-07 | Hardcoded hex / ad-hoc radii | ModeBadge、FleetStrip | low |
| DES-08 | Type scale 14px outside DESIGN rule | composer / markdown h2 | low |
| DES-09 | L2 SafetyStrip dark island | intentional K6 | info |

**Design debt class:** consistency / discoverability — not missing core chrome patterns.

---

## Security Residual

**Score: 6.0 / C+** · **Confirmed Critical: 0** · **Confirmed High: 9**

> High = post-auth RCE-equivalent / integrity / durable secret tape under trusted peer threat model (extension + tray + settings multi-peer in scope).

### Table of rechecked Highs

| ID | Title | Prior | Status | Evidence (paths) | Impact |
|----|-------|-------|--------|------------------|--------|
| **SEC-A** | `threadFilePath` joins unsanitized `threadId` | partial | **OPEN** | `companion/src/threads/thread-manager.ts` ~334–336, 408+, 808+；`sanitizeId` only in `create()`；`file.upload` error path passes client id (`message-router.ts` ~723–730) | Path traversal under `~/.cmspark-agent` — read/write/delete outside `threads/` |
| **SEC-B** | `mcp.add` stdio no L2 / forceConfirm | open | **OPEN** | `message-router.ts` ~1791–1810：validate → `replaceMcpServers`；shape-only `validateMcpServerConfig` ~3415–3433 | Authenticated peer spawns arbitrary local processes — post-auth RCE-equivalent |
| **SEC-C** | Thread JSON full unredacted tool tape | open | **OPEN** | `llm/adapter.ts` ~137–148 `JSON.stringify(result)`；`chatCreate` addMessage ~1131/1268；history.db only redacted | Secrets in `threads/*.json` (exports, backups, shared machines) |
| **SEC-D** | `chat.create` supersede no generation CAS | open | **OPEN** | `message-router.ts` ~574–596 abort/replace；finally ~707–710 always `abortControllers.delete` + `releaseMultiAgentLlmLoop` | Interleaved messages；successor abort dropped；multi-agent gate under-count |
| **SEC-E** | `pendingToolCalls` global on peer close；`tool.result` unbound | partial | **OPEN** | `server.ts` ~283–291 no `originWs`；close ~7042–7057 → grace all；`handleToolResult` by id only ~2857–2868 | Cross-session tool spoof；any disconnect kills other peers' in-flight tools |
| **SEC-F** | macOS `cuPidForWindow` first window PID | open | **OPEN** | `host-use/darwin/host.swift` ~797–801；`host-skylight.swift` ~646–650；`cuWindowInfoDict` matches id but PID helper does not | Wrong-app CU inject/activate — safety binding bypass |
| **VOICE-01** | Silent PATH `whisper-cli` fallback | new | **OPEN** | `voice/stt-session-service.ts` ~520–529；`whisper-state.ts` ~106–110；`binary-resolve.ts` ~203–222 | PATH-planted binary processes mic audio；violates ADR-023 L5 |
| **VOICE-02** | Tier-1 Whisper SHA256 pins incomplete | new | **OPEN** | `voice/whisper-binary-pins.ts` ~11–45：only darwin-arm64；others `allowUnpinned:true` | Windows/Linux accept unpinned `cmspark-whisper` |
| **MCPO-01** | Outbound `require_grant` default false；`ws_secret` deputy | partial | **OPEN** | `config.ts` ~330–332；`outbound-mcp/stdio-server.ts` ~73–90；`companion-http.ts` ~129–202 | Any process with `ws_secret` invokes loopback L1 tools without dedicated grant |

### Non-High residual (rechecked)

| ID | Title | Sev | Notes |
|----|-------|-----|-------|
| SEC-G | `mcp.list` / `mcp.servers.updated` raw env/headers | medium | `mcp/client.ts` getMeta；`manager.ts` listServers；only `config.updated` redacts |
| SEC-H | Voice/meeting STT trust surface | info | Hardened：path + origin + https pin download — no High residual on recheck *except* VOICE-01/02 product path |

### Security strengths (keep)

- Unauthenticated WS terminated after handshake  
- `redactConfigForBroadcast` on `config.updated`  
- Many L2 sites pass `{ originWs: ws }`（仍不一致，见 MAINT-3）  
- History redaction exists（thread disk 未对齐）  
- Voice/meeting id containment + extension origin on STT/meeting handlers  

---

## Testing/CI/Release

**Score: 6.7 / B-**

### Strengths

- Companion ~**186** + extension ~**66** `*.test.ts` covering security, WS, MCP, packs, board, CU units, voice, Obsidian  
- `ci.yml` hard-gates companion/extension `npm test` + prod `npm audit`  
- `package.sh` verifies Node archives vs nodejs.org SHASUMS256；package-gates self-tests in CI  
- Fail-closed packaging asserts for host/tray/scpt、qwen-vl-worker 等  
- companion + extension versions **0.5.0** lock-step at HEAD  
- Multi-platform release matrix（macos-arm64 / linux-x64 / windows-x64）  

### Gaps

| ID | Title | Evidence | Sev |
|----|-------|----------|-----|
| TEST-1 | `startServer()` never called；auth gate replica-only | `ws-auth-handshake.test.ts`；`server.ts` ~6709 comment | medium |
| TEST-2 | `evaluate-token` weak mock + 45s confirm risk | `evaluate-token.test.ts` | medium |
| TEST-3 | host_computer task-mutex win32-only；Linux CI skip | `computer-task-mutex.test.ts`；`ci.yml` ubuntu-only | medium |
| REL-3 | `release.yml` packages without re-test/audit | no `needs:` test job | medium |
| REL-1 | No Developer ID / notarize / Authenticode | `create-dmg.sh` ad-hoc；Win signtool remove only | medium |
| REL-2 | No SBOM / SHA256SUMS on Releases | release upload zips only | medium |
| REL-5 | CI Node 20 vs release/package Node 22 | `ci.yml` vs `package.sh` NODE_VERSION | low |
| REL-4 | `package.sh` does not enforce ext/companion version lock | only Windows EXE + test-package-gates | low |
| TEST-4 | TESTING.md scale/version lag | claims 0.3.0 / 120+ / ~25 | low |

---

## Maintainability

**Score: 6.1 / C+**

### Strengths

- Domain folders beyond pure monolith：`computer/`, `mcp/`, `packs/`, `voice/`, `host-use/`, `meeting/`, `outbound-mcp/`  
- Large regression suite + intentional isolation setup modules for high-risk paths  
- Extension pure-function extraction + co-located unit tests  
- TinyClick product path largely removed from `companion/src/computer`  
- Package versions aligned 0.5.0；supply-chain notes in `docs/supply-chain.md`  

### Debt

| ID | Title | Path | Sev |
|----|-------|------|-----|
| MAINT-1 / ARCH-GOD-1 | `server.ts` ~7k god module | `companion/src/server.ts` | high |
| MAINT-2 / ARCH-GOD-2 | message-router mega-switch + circular import server | `message-router.ts` dynamic `import('./server')` | high |
| MAINT-3 | `originWs` binding inconsistent across L2 sites | evaluate default unbound；MCP/sendConfirmation bind | medium |
| MAINT-4 | Experimental spikes in product tree | `hud/spike.ts`、voice spike tabs、`scripts/spike/` ~2k files | medium |
| MAINT-5 | TinyClick remnants in dist + docs | `companion/dist/tinyclick-worker.js`；TESTING.md | medium |
| MAINT-6 | `CMSPARK_DATA_DIR` fixture isolation tribal | multi setup patterns；risk of real home dir | medium |
| MAINT-7 | Test script uses Unix `find` | `companion/package.json` scripts.test | medium |
| MAINT-8 | No `engines`；TS major drift | root TS ^6 vs packages ^5.4 | low |
| MAINT-9 | Extension App + useWebSocket concentration | ~1894 / ~1707 LOC | low |
| MAINT-10 | Process-doc / spike volume | `docs/audit/reviews` ~781 | info |

---

## New 0.5.0 Surfaces

**Score: 6.7 / B-** — Voice / meeting / dictation / outbound-MCP / Windows-Python

### What is solid

| Area | Strengths |
|------|-----------|
| Voice STT | chrome-extension origin fence；max-1 session；byte/time caps；tmp containment + boot GC |
| Pack isolation | strips voice/hotkey/refiner/ack keys from packs |
| Outbound profile | curated `cmspark__*` allowlist；PROFILE_FORBIDDEN；L9 dual-entry tab lease；server disclosure |
| ASR Refiner | fixed system prompt + length/URL/toolish/secretish guards |
| Meeting guide | M2 documented as progressive re-decode not token stream |
| Windows Python | well-known candidates；rejects Windows Store stub；absolute uv pins（`python-runtime.ts`） |

### High residuals on 0.5.0 surfaces

| ID | Issue | Fix direction |
|----|-------|---------------|
| **VOICE-01** | Silent PATH whisper-cli when packaged binary fails | Dev-only flag or remove；fail closed in prod |
| **VOICE-02** | Incomplete Tier-1 SHA256 pins | `build-cmspark-whisper.sh --write-pins` all Tier-1；refuse unpinned prod |
| **MCPO-01** | `require_grant=false` + `ws_secret` fallback | Default true；dedicated outbound grant |

### Medium residuals

| ID | Issue |
|----|-------|
| VOICE-03 | `voice.stt.start` ignores `config.voice.sttEngine=browser` |
| VOICE-04 | Privacy acks not server-enforced for STT/refine（meeting has server ack） |
| VOICE-05 | `voice.model` mutators trust self-attested `source:settings` without origin fence |
| MEET-01 | `retain_until` written but **no GC sweeper**（ADR-024 §7） |
| MCPO-02 | Outbound L3+ disclosure is coding-agent self-service (`cmspark__accept_data_disclosure`) |
| MCPO-03 | Open `additionalProperties:true` args schema on outbound tools |
| MEET-02 | ADR-024 non-goal auto-diarize vs shipped experimental Mtg3 |

---

## Top Risks

1. **SEC-B** — `mcp.add` stdio without critical L2 → post-auth local RCE-equivalent  
2. **SEC-A** — Unsanitized `threadId` path traversal under `~/.cmspark-agent`  
3. **SEC-C** — Durable unredacted tool tape in `threads/*.json`  
4. **SEC-E** — Global pending-tool kill + unbound `tool.result` (cross-session integrity)  
5. **SEC-D** — Supersede finally clears successor AbortController / multi-agent gate  
6. **SEC-F** — macOS CU wrong PID → cross-app inject  
7. **VOICE-01/02** — Whisper PATH fallback + incomplete pins（ADR-023 L5）  
8. **MCPO-01** — Outbound default grant over-trust via `ws_secret`  
9. **ARCH/MAINT** — `server.ts` ~7k + `message-router` ~3.5k god modules — security review blast radius  
10. **REL** — Release packages without re-test/audit；ad-hoc codesign only；no SBOM/SHA256SUMS  

---

## Prioritized Action Plan

### P0（发布前 / 1–5 天 — 安全闭环门槛）

| # | Action | Primary paths | Closes |
|---|--------|---------------|--------|
| 1 | `assertSafeThreadId` + realpath containment under `threads/` on **all** FS ops；never pass raw client id to addMessage/getMessages | `thread-manager.ts`, call sites in `message-router.ts` | SEC-A |
| 2 | L2 / `originWs` **forceConfirm** before `mcp.add` / `mcp.update` that persists or spawns stdio | `message-router.ts`, security-confirmation | SEC-B |
| 3 | Redact tool params/results before thread disk write（align or stricter than history.db） | `adapter.ts`, `thread-manager` atomicWrite | SEC-C |
| 4 | Bind `originWs` on `pendingToolCalls`；accept `tool.result` only from that peer；grace-reject only matching socket | `server.ts` | SEC-E |
| 5 | Per-thread generation CAS for `chat.create` supersede；finally deletes controller only if map holds **this** controller | `message-router.ts`, `llm-loop-gate.ts` | SEC-D |
| 6 | Fix `cuPidForWindow` via `kCGWindowNumber` match；lockstep `host.swift` + `host-skylight.swift` | `host-use/darwin/*` | SEC-F |
| 7 | Remove production PATH whisper fallback；complete Tier-1 pins or **fail closed** | `binary-resolve.ts`, `whisper-binary-pins.ts`, `whisper-state.ts` | VOICE-01/02 |
| 8 | Default `outbound_mcp.require_grant=true` / dedicated grant；no silent `ws_secret` deputy | `config.ts`, `outbound-mcp/*` | MCPO-01 |

### P1（1–2 周）

| Area | Actions |
|------|---------|
| Security | Redact `mcp.list` / `servers.updated` env/headers；server-enforce `sttEngine` + privacy_ack；origin fence on `voice.model` |
| Meeting | Implement `retain_until` GC at boot + periodic |
| Product | CU enable UI toggle（wire `computer.set_enabled` + existing L2 gate） |
| Testing | Real `startServer` ephemeral-port integration；retire replica gradually |
| Release | `release.yml` needs test+audit；emit SHA256SUMS（+ SBOM） |
| Docs/Design | Sync DESIGN↔`tokens.ts`；TESTING.md → 0.5.0 map；README `deepseek-v4-flash`；guide badges；GOAL G21 / ADR-023 status；fix broken nav |

### P2（维护 / 架构）

- Extract `tool-runtime` + domain routers from `server.ts` / `message-router.ts`  
- Shared protocol package + mandatory `protocol_version` after auth  
- Fail-closed unknown WS types in production  
- Surface L0 hard-gate **decision**（enforce or re-document）  
- CI Node 22（or matrix 20+22）；`package.sh` version lock-step enforce  
- Developer ID / notarization / Authenticode  
- Spike / TinyClick dist cleanup；cross-platform test runner（no Unix `find`）  
- Archive `docs/audit/reviews` / decisions noise  

---

## Finding Catalog

> Deduped across 8 dimensions；severity-sorted（high → info）。IDs preserved from dimension agents where present。`prior_status`: open | partial | fixed | new.

### High

| ID | Title | Dim | Prior | Evidence (short) | Fix hint |
|----|-------|-----|-------|------------------|----------|
| SEC-B | mcp.add stdio no L2 forceConfirm | Sec | open | `message-router.ts` ~1791–1810 | critical-class L2 + originWs before spawn |
| SEC-A | threadFilePath unsanitized threadId | Sec | partial | `thread-manager.ts` join all readers/writers | assertSafeThreadId + resolveContained |
| SEC-C | Thread JSON unredacted tool tape | Sec | open | `adapter.ts` full result persist | redactForStorage before addMessage |
| SEC-E | pendingToolCalls global；tool.result unbound | Sec | partial | `server.ts` maps/close/handleToolResult | originWs bind + peer check |
| SEC-D | chat.create supersede no generation CAS | Sec | open | finally clears successor state | monotonic gen CAS |
| SEC-F | cuPidForWindow first-listed PID | Sec | open | `host.swift` / `host-skylight.swift` | match kCGWindowNumber |
| VOICE-01 | Silent PATH whisper-cli fallback | 0.5.0 | new | `binary-resolve` / `whisper-state` | remove prod fallback；dev flag only |
| VOICE-02 | Whisper Tier-1 SHA256 pins incomplete | 0.5.0 | new | `whisper-binary-pins.ts` | pin all Tier-1 or fail closed |
| MCPO-01 | require_grant=false；ws_secret deputy | 0.5.0 | partial | `config.ts`；outbound auth | default true；dedicated grant |
| ARCH-GOD-1 | server.ts multi-concern god-file ~7160 | Arch/Maint | open | `server.ts` ends ~7160 | extract tool-runtime / ws/ |
| ARCH-GOD-2 | message-router mega-switch ~3528 | Arch/Maint | open | 100+ cases ~202–3386 | domain routers by prefix |
| MAINT-1 | server.ts ~7k god module（same root） | Maint | open | merge with ARCH-GOD-1 | composition root only |
| MAINT-2 | message-router + circular server import | Maint | open | dynamic import server | inject deps；domain handlers |

### Medium

| ID | Title | Dim | Prior | Evidence (short) |
|----|-------|-----|-------|------------------|
| SEC-G | mcp.list exposes raw env/headers | Sec | partial | client getMeta；manager listServers |
| ARCH-PROTO-1 | No WS protocol_version negotiation | Arch | open | ws-auth secret only |
| ARCH-TYPES-1 | No shared protocol package；dual Thread | Arch | open | types.ts vs thread-manager |
| ARCH-SURFACE-1 | Surface L0 UX-only not hard-gated | Arch | partial | mode-controller vs createToolExecutor |
| ARCH-PROTO-2 | validateWsMessage allows unknown types | Arch | open | server.ts ~6245–6251 |
| ARCH-EXT-1 | Fat App + useWebSocket fan-in | Arch | partial | App ~1894；useWebSocket ~1707 |
| DOC-01 | TESTING.md 0.3.0 + TinyClick + missing domains | Docs | partial | TESTING.md |
| DOC-02 | User-guide badges lag 0.5.0 | Docs | open | multi-agent/CU/host headers |
| DOC-03 | README default model deepseek-chat wrong | Docs | new | vs config deepseek-v4-flash |
| DOC-04 | Process noise dominates docs volume | Docs | partial | decisions~193；reviews~781 |
| DOC-05 | Broken nav to missing optimization plan | Docs | new | docs/README.md |
| DOC-06 | ADR-023 / GOAL G21 lag shipped code | Docs | open | voice M2；outbound bridge |
| DES-01 | DESIGN.md ≠ tokens.ts | Design | new | color/radius/motion |
| DES-02 | Composer chip/slash matrix ≠ code | Design | partial | /meeting missing in DESIGN |
| DES-04 | Emoji chrome vs quiet-professional | Design | open | ThreadList/Slash/McpPanel |
| DES-05 | SettingsSlideout sprawl ~3.4k | Design | open | residual hex |
| DES-06 | Voice/meeting under-signposted L0 | Design | new | EmptyState chips |
| FEAT-001 | Outbound dual narrative skeleton vs bridge | Product | open | GOAL G21 vs mcp.md |
| FEAT-002 | CU enable not in Side Panel UI | Product | open | config-only |
| FEAT-003 | Linux Host Use not implemented | Product | open | host-use/linux stub |
| FEAT-004 | Outbound L8 confirm incomplete Win/Linux | Product | open | tray confirm gap |
| FEAT-005 | Local STT Path B packaging residual | Product | open | pin/e2e residual |
| TEST-1 | startServer never called（replica auth） | Test | partial | integration harness |
| TEST-2 | evaluate-token weak assertions | Test | open | mock WS；45s risk |
| TEST-3 | CU task-mutex skipped on Linux CI | Test | open | win32-only tests |
| REL-1 | No Developer ID / Authenticode | Rel | partial | ad-hoc codesign |
| REL-2 | No SBOM / SHA256SUMS | Rel | open | release.yml |
| REL-3 | release.yml no re-test/audit | Rel | open | package-only job |
| MAINT-3 | originWs binding inconsistent | Maint | partial | evaluate unbound paths |
| MAINT-4 | Spikes still in product/repo | Maint | open | hud/voice/scripts/spike |
| MAINT-5 | TinyClick dist + docs remnants | Maint | partial | dist + TESTING |
| MAINT-6 | DATA_DIR fixture isolation fragile | Maint | open | multi setup patterns |
| MAINT-7 | Test script depends on Unix find | Maint | new | package.json scripts.test |
| VOICE-03 | stt.start ignores sttEngine=browser | 0.5.0 | new | stt-handlers / session-service |
| VOICE-04 | Privacy acks not server-enforced STT/refine | 0.5.0 | new | vs meeting server ack |
| VOICE-05 | voice.model source:settings self-attest | 0.5.0 | new | whisper-handlers |
| MEET-01 | retain_until no GC | 0.5.0 | new | meeting-store only writes |
| MCPO-02 | Outbound disclosure agent self-service | 0.5.0 | open | accept_data_disclosure |

### Low

| ID | Title | Dim | Prior |
|----|-------|-----|-------|
| ARCH-DOC-1 | architecture §1.3 under-documents live WS families | Arch | partial |
| ARCH-DOC-2 | §4.1 tree omits voice/ and meeting/ | Arch | new |
| ARCH-MINCAP-1 | Pack min_capability metadata only | Arch | new |
| DOC-07 | GOAL G1 fixed 26 tools | Docs | open |
| DOC-08 | CONTRIBUTING behind 0.5.0 | Docs | open |
| DOC-09 | README related-docs omits meeting/user-env | Docs | new |
| DOC-10 | architecture §11 labeled 0.3.0 | Docs | open |
| DES-03 | Panel vs Cockpit mode chip dialects | Design | open |
| DES-07 | Hardcoded hex / ad-hoc radii | Design | open |
| DES-08 | Type scale 14px drift | Design | new |
| FEAT-006 | Secondary guide version labels lag | Product | open |
| FEAT-007 | NotebookLM DOM/login fragility | Product | open |
| FEAT-008 | Dictation hold requires Side Panel focus | Product | open |
| FEAT-009 | GOAL G1 fixed tool count | Product | open |
| REL-4 | package.sh no version lock enforce | Rel | open |
| REL-5 | CI Node 20 vs ship Node 22 | Rel | open |
| TEST-4 | TESTING.md scale lag | Test | open |
| MAINT-8 | engines missing；TS major drift | Maint | open |
| MAINT-9 | Extension routing concentration | Maint | open |
| MCPO-03 | Outbound open additionalProperties schema | 0.5.0 | new |
| MEET-02 | ADR-024 auto-diarize SoT drift | 0.5.0 | new |

### Info / Positive / Non-goals

| ID | Title | Dim | Prior | Note |
|----|-------|-----|-------|------|
| ARCH-PACK-TRUST | Pack Trust discipline matches ADR-020 | Arch | fixed | FORBIDDEN keys；allowTrust gates |
| ARCH-BOUND-1 | Dual-layer browser vs companion correct | Arch | fixed | no LLM-in-SW regression |
| SEC-H | Voice/meeting path+origin largely hardened | Sec | fixed | residual is VOICE-01/02 product path |
| DES-09 | L2 SafetyStrip dark island (K6 by design) | Design | open | intentional risk signal |
| FEAT-010 | System-audio mix / identity diarize excluded | Product | open | correct non-goals |
| PY-01 | Windows Python discovery thorough | 0.5.0 | new | supports Qwen-VL path |
| MAINT-10 | Process-doc/spike volume | Maint | open | search/clone noise |

---

## Method & Evidence Levels

| Source | Level |
|--------|-------|
| 8 dimension fanout agents | [inspected] code path reads |
| Synthesizer score blend + High calibration | [inspected] cross-dedupe |
| Runtime e2e / live CU / live Whisper mic path | **not executed** this report |
| Network exploit against live peer | **not attempted**（out of scope） |

---

## Reproducibility

```text
docs/audit/health-fanout-2026-08-09.md            # this report
docs/audit/health-fanout-2026-08-09-summary.json  # structured scores
docs/audit/health-fanout-2026-08-09-dimensions.json
```

Prior anchors: `docs/audit/diagnosis-fanout-2026-07-25.md` · `docs/audit/diagnosis-fanout-2026-07-28.md` · `docs/audit/deep-diagnosis-fanout-2026-08-02.md`

---

## Bottom Line

| Question | Answer |
|----------|--------|
| 0.5.0 功能是否「像文档说的那样有」？ | **大体是**（产品 7.6/B） |
| 文档是否仍是主瓶颈？ | **否** — 已从 underclaim 重伤恢复到 B；维护债仍在 |
| 能否公开分发 / 声称安全闭环？ | **否** — **0 Critical / 9 High** 未关 |
| 自用 / 内测稳定切点？ | **可以**，在可信单用户 + 配对 peer 假设下 |
| 下一步最大杠杆？ | **P0 安全八件套**（路径 / MCP spawn / tape / peer / supersede / CU PID / Whisper / grant） |

*Report generated 2026-08-09 · CMspark Project Health Fanout · overall **6.6 / B-** · Critical **0** · High **9***
