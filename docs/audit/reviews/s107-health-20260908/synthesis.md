# S107 六路独立对抗合成 — 2026-09-08

**HEAD**: `4a63de56` (`main`)  
**Lockstep**: companion / extension / NSIS / CLI **0.6.6**  
**本机**: `CMspark-Setup-v0.6.6.exe` `/S` → `%LOCALAPPDATA%\CMspark`；daemon `ws://127.0.0.1:23401` LISTENING  
**范围**: `7ab36063` (0.5.8) → `4a63de56`（~270 commits，含 Unreleased 已进 main）  
**路**: PRODUCT · CORRECTNESS · SECURITY · SKEPTIC · ARCHITECTURE · UX（互相不知情）

证据等级：lane 报告为 `[inspected]`；合成对跨路命中做了抽查（README/PRODUCT/OVERLAY_WINDOW_SIZE/KNOWLEDGE_DOC_TOPK/MeetingPanel unmount）。

---

## 总评

| 路 | 裁决 |
|---|---|
| A PRODUCT | **REJECT** |
| B CORRECTNESS | **APPROVE_WITH_NITS**（0 BLOCK） |
| C SECURITY | **APPROVE_WITH_NITS**（0 BLOCK） |
| D SKEPTIC | **REJECT** |
| E ARCHITECTURE | **APPROVE_WITH_MAJORS**（6.6 / C+） |
| F UX | **REJECT** |

**狗食不阻塞**（Windows 0.6.6 已换装、daemon/tray 活）。  
**诚实发版阻塞**：前门文档仍卖 0.6.0 + 360×420 Capture + 「全选灌库」。A 与 D **独立命中同一组谎言**（S106 知识注入命中仍活）。运行时安全闸与默认 outbound L1（#228）未扩。架构闸还在，god-file 回胀。

---

## 跨路独立命中（最高置信）

| ID | 主题 | 命中路 | 抽查 |
|---|---|---|---|
| X1 | 前门文档锁 **0.6.0**，package/NSIS/CLI **0.6.6**，Unreleased 已在 HEAD | A P-01 · D B1 · E 文档头 | `[inspected]` README:980 · PRODUCT:4 · CLAUDE:37 · GOAL:3 · companion/package.json:3 |
| X2 | README「全选：所有知识文档全部注入」vs TF-IDF top-k（auto=5 / all=8）+ 8000 字预算 | A P-02 · D B3 | `[inspected]` README:364–367 · `skill-engine.ts:80–82,1472`。**S106 同洞，未修** |
| X3 | Capture 仍写 **360×420 (`OVERLAY_WINDOW_SIZE`)**，代码默认 **1040×760**，360×420 是紧凑档 | A P-03 · D B2 · F M2 | `[inspected]` `shell-open.ts:29` `{ w: 1040, h: 760 }` |
| X4 | PRODUCT/GOAL 仍把 #258–#260 当余项；Hex PTT / SAPI / embedding 已在树 | A P-06 · D M3 | 实现在，embedding 仍 experimental |
| X5 | GOAL G19「非目标：交互式 PTY」vs 0.6.4 已交付 #432（Darwin-only） | A P-07 · D M2 · E M4 | CHANGELOG 0.6.4 诚实写 Darwin/裸 login shell |
| X6 | NSIS `File /r` overlay 不 wipe → INSTDIR 残留 `gif.jpg` / `gifcode_test`；**无** leftover SEA | B 包装注 · C M-SEA | `[executed]` 换装后 ARP 0.6.6、无 `cmspark-agent.exe` |

---

## BLOCK（发版前门）

1. **版本分裂** — 用户按 README/PRODUCT 会以为产品是 0.6.0。SoT 是 0.6.6；HEAD 还含 #469–#485 / #451–#456，未 bump。无 `v0.6.x` git tag（`git describe` = `v0.4.0-785-g4a63de56`）。
2. **知识三种注入** — README:364–367 仍教勾选 ∪ hostname / 全选灌库。代码默认 TF-IDF top-k。UI 文案已诚实（KnowledgeSubPanel）。**S106 A+D 同洞。**
3. **召唤器几何** — README/PRODUCT/召唤器指南写 360×420 且点名 `OVERLAY_WINDOW_SIZE`。常量已是 1040×760。
4. **会议 Host「收起」结束录音**（仅 UX 路，抽查成立）— Host 按钮只 `closePanel()`（`ContextPanelHost.tsx:285–293`），`MeetingPanel` unmount 在 `phase !== idle` 时发 `meeting.end`（`:600–609`）。面板按钮已改「结束并收起」。折叠 = 杀会。
5. **「设置 → 听写」死路径**（仅 UX）— 八类导航已是「输入与语音」；会议/召唤器恢复文案仍指「听写」。

---

## MAJOR（不挡狗食）

- **CLI**: `--version` 打完 banner 后 `Unknown command` exit 1；文档里的 `status`/`stop` 是 stub；`tray` 启动不写 `daemon.pid`（CORR C-01–C-04）。
- **持久化**: assistant `tool_calls[].function.arguments` 仍未脱敏进 `threads/*.json`（SEC C residual）。
- **Overlay MCP**: overlay WS 仍允许 `mcp.toggle_server`；stdio enable 会卡 L2（overlay 无法确认）；disable/HTTP enable 绕 spawn 闸。非配对绕过。#230 不扩。
- **L0 是徽章不是闸**（ARCH M1）：`filterToolsForSurface` 主要剥召唤器。
- **God-files 回胀**: `message-router.ts` ~5644 · `SettingsSlideout.tsx` ~4381 · `useWebSocket.ts` ~2460。
- **README 已交付表**欠 0.6.2–0.6.5（图谱、#432 终端、#439 检索、interact profile）。
- **`chrome-extension/package-lock.json` 仍 0.6.3**。
- **CU**: CHANGELOG 对 #423 6/10 vs ≥0.85 诚实；前门「已交付」易被读成 locate 过评测门。
- **0.7.0 enterprise**: 代码在 main；pilot 页诚实说未发布；导航+Unreleased 易被当成 GA。

---

## 安全 / 正确性保住的

- 默认 outbound L1 仍 8 工具（#228 未扩）。interact / `outbound_context_v1` 是**具名**档。
- Pack 不能写 god-mode；overlay `pack.apply` 剥 `allowTrust`。
- PTY：默认关、user_gesture + L2、plan_readonly 拒、cwd jail、剥 `CMSPARK_*`；Windows 诚实 `unsupported`。
- thread id 路径 sanitize fail-closed；mcp stdio spawn L2；tool-role 行脱敏（assistant args 除外）。
- 官方 `npm test` preload 钉 `CMSPARK_DATA_DIR`（#404 主路径）。standalone Windows test 仍有残余。
- #423 双端 `v/1000`；#483/#485 归属闸。

---

## 行动计划（建议顺序）

**P0 文档诚实（不改产品行为即可关门 REJECT）**

1. README / PRODUCT / CLAUDE / GOAL / docs/README / architecture / summoner 指南锁 **0.6.6**，并声明 HEAD Unreleased ≠ 已打 NSIS。
2. 删 README「三种注入」勾选∪hostname / 全选灌库；改 TF-IDF top-k + 预算（对齐 ADR-026 + UI）。
3. Capture：默认 1040×760，360×420 = 紧凑档；改 `OVERLAY_WINDOW_SIZE` 引用。
4. #258–#260 从「余项」拿掉；embedding 保留 experimental。GOAL G19 删「非目标 PTY」或改 Darwin-only。

**P0 UX 诚实**

5. 会议 Host 收起：进行中改为「结束并收起」或 unmount 不 `meeting.end`。
6. 全部「设置 → 听写」改为「设置 → 输入与语音」。

**P1 工程**

7. CLI `--version` / 真 `status`·`stop`；tray 写 pid 或 status 认 tray。
8. assistant tool args 落盘脱敏。
9. lockfile 0.6.3→0.6.6。NSIS 是否 wipe INSTDIR 另议（残留 jpg 不挡用）。

**冻 / 不在本轮**

- #230 overlay-acl。#228 禁扩默认 outbound。#363 评测门 6/10。0.7.0 企业双场景验收。

---

## 本机换装（对照）

| 项 | 结果 |
|---|---|
| 产物 | `dist-package/CMspark-Setup-v0.6.6.exe` 52M · zip 81M |
| ARP | DisplayVersion **0.6.6** |
| 进程 | node tray + `daemon start`；`127.0.0.1:23401` ~3s listen-first |
| 扩展 | INSTDIR `chrome-extension` manifest **0.6.6** |
| SEA | staging / INSTDIR 均无 `cmspark-agent.exe` |
| 残留 | `gif.jpg` / `gifcode_test`（overlay 不 wipe） |

下次：`chrome://extensions` 重载 `%LOCALAPPDATA%\CMspark\chrome-extension`。

Lane 原文：`product.md` `correctness.md` `security.md` `skeptic.md` `architecture.md` `ux.md`。
