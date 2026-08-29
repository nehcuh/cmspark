# Changelog

格式大致遵循 [Keep a Changelog](https://keepachangelog.com/)。版本号与 `companion/package.json` / `chrome-extension/package.json` 对齐。

## [Unreleased]

（无）

## [0.5.4] — 2026-08-29

四路独立对抗评审 + grok 多路验证驱动的修复批次（spec/plan：`docs/superpowers/specs|plans/2026-08-29-post-review-adversarial-fixes.md`）。全部为已有行为 bugfix，无新需求。

### Security

- **shell allowlist 回归闭环**：裸 shell 家族条目（`sh/bash/zsh/pwsh/powershell/deno/bun/cmd`）的执行旗标恢复拒绝——`-c`/`-Command`/`-EncodedCommand`/`eval`/`-p`/`--print`/`-r` 等，含 PowerShell 唯一前缀（`-com`/`-enc`）、斜杠形式（`/c`）、`=` 粘连、`.exe` 基名归一、大小写变体；tokenized 与 fallback 统一复用同一判定函数。`grep -c`、`bash -e/-eu`（errexit）、`ruby -r` 等合法形态不误伤。位置参数与 GTFOBins 类在代码注释声明为设计边界（旗标 deny 是纵深，L2 确认才是门）。
- **外泄授权 per-key**：HTTP 轨按认证 grant 自身 `allow_page_export` 判定，同 caller 的 sibling 带旗钥匙不再放行无旗 token（`grantAllowsPageExportById`）；stdio 轨保持 caller 级并注释文档化双轨。与 grant-cli「这把钥匙」承诺及 TROUBLESHOOTING 对齐。
- **打开侧栏结果帧**：仅 panel/extension 来源可裁决（origin 绑定），settle 单漏斗先到先赢。
- **外发 HITL 断连**：操作员批准时调用方已断连则不再执行工具，审计记 `CALLER_DISCONNECTED`（与已执行明确区分）。

### Fixed

- **「打开侧栏」假成功**：`sidePanel.open()` 在无手势上下文必失败却回报成功。改为真结果回传（关联 id broadcast + 结果帧 validator + 6s 超时），失败/超时 overlay 如实显示「请点工具栏」。
- overlay 附件发送成功后清空 file input，旧附件不再随后续消息重复发送。
- **SSE 瞬断不再即杀会议/听写**：最后 SSE 断开改 8s 重连宽限（重连取消）；热键关窗不再同步释放 composer 租约（关窗后 1s 短宽限 + 8s 硬兜底）；Windows 关窗保存 spawn PID 直接 `process.kill`（原 `ps` 路径 win32 恒 no-op，窗口假活撞 `OVERLAY_STANDBY`）。
- `run_progress` 显式清除（null）持久生效：仅 `undefined` 才从 handoff 初始播种，`get()` 读路径同修；无关 update 不再重播种。
- `thread.updated` 双发去除（broadcast 已覆盖扩展端）；`llmLoopOwnerPanel` 在 chat.create/file.upload/regenerate 三路所有出口对称清理。
- Swift overlay `confirmPending` 六处复位（hydrate-attach / token 恢复 / done / 新线程 / 换线程 / 终态错误），HUD CTA 不再永远粘在「需要确认」。

### Tests

- #252 握手 terminate、#250 WS fanout 改行为级集成测试（替代源码 grep 假防线）；`ui.open_sidepanel` 双端 lockstep 测试。

### Known residuals（下轮）

- `stopSummonerWebServer` 丢 PID 不杀进程；overlay SSE 收不到 slash-pin 的 `thread.updated`；hydrate-detached 换线程 CTA；win32 不扫进程树；`chat.aborted` 不在 summoner 映射；`thread.digest_updated` 同款双发（`message-router.ts:678`）。
- 协议版本未 bump（MIN=MAX=1 期间语义变更靠同步发版，#252 起）；`mcp.toggle_server` WS ACL 残留属 #230。

## [0.5.3] — 2026-08-27

0.5.2（Windows 官方 NSIS）之上的产品切点：**知识 CRUD 诚实** + **形态切片 1–3 / 5 / 6**。这不是召唤器或租手「做完」的里程碑——T1 真人 bake-off 仍待（[#228](https://github.com/nehcuh/cmspark/issues/228)）。

### Added

- **知识诚实（#222 / #223 / #226）**：Side Panel 可点开正文、确认后保存、下载 `.md`、related≤3 芯片。图谱 / 双链 / Project / 默认 embedding 本季不做。
- **租手钥匙 + L8（切片 1–2，#226）**：`cmspark-agent outbound-grant` 签发 `cmg_`（不打开侧栏设置）；空 grant 默认 `GRANT_REQUIRED`；首次外泄走确认台 / Mac 托盘。`require_grant` 仍默认 true。overlay **永不** Allow/Deny。
- **召唤器诚实文案（切片 3，#226）**：默认收起条；「展开对话 / 打开浏览器 / 打开确认台」；MCP 轨藏而不删。禁止「展开工作台」「去侧栏批准」。
- **侧栏空态看山（切片 5）**：CompanionMark + 22px 招呼 + 句子邀请 + 作曲区。
- **匹配诚实 + 本轮步骤（切片 6，#227）**：技能匹配补 IDF（仅 skills；knowledge related 与 Obsidian 仍 TF）；聊天列 L0「本轮步骤」种子来自 H1 handoff todos。**v1 勾选基本只能点**（seed 行常无 `tool`，见 [#230](https://github.com/nehcuh/cmspark/issues/230)）。

### Changed

- 产品句锁定：家 = **已登录 Chrome + 硬闸**（[PRODUCT.md](PRODUCT.md) / [GOAL.md](docs/GOAL.md)）。侧栏是 Operate 面之一，不是家。
- **需求设计 Issue-first**：新需求必须先建 GitHub Issue，再写 spec/plan。模板：[`.github/ISSUE_TEMPLATE/design.md`](.github/ISSUE_TEMPLATE/design.md)。本季余项：[#228](https://github.com/nehcuh/cmspark/issues/228) T1 · [#229](https://github.com/nehcuh/cmspark/issues/229) 召唤器 P2 · [#230](https://github.com/nehcuh/cmspark/issues/230) 残留。

### Fixed

- Windows：`launch-hidden.vbs` 设 `NODE_PATH`，打包后 systray2 能解析（#224）。
- Overlay：合并冲掉的 paper HUD / I1/I2 恢复（#225）。

### Honesty / not in this cut

- T1 真人 bake-off **未跑**；不得扩默认 outbound profile，不得对外声称护城河。
- F-S-10（trusted/cruise 下 `mcp__*` 可能不弹确认）本季不修完；禁止用 overlay 管 MCP 掩盖。
- `outbound-grant` 对未知 flag 仍静默忽略。

## [0.5.2] — 2026-08-20

### Packaging

- **Windows 官方安装器**：GitHub Release 在 `cmspark-v*-windows-x64.zip` 之外增加 `CMspark-Setup-v*.exe`（NSIS）。安装器包装与 zip **同一份** `package.sh` staging（`node.exe` + `cmspark-agent.js` + 扩展），每用户装到 `%LOCALAPPDATA%\CMspark`，HKCU 开机自启 + ARP 卸载。CI 钉 Chocolatey `nsis` **3.12.0**，`CMSPARK_REQUIRE_NSIS=1`：缺 makensis **失败**，不静默只发 zip。SEA（`build-windows-exe.ps1`）不再产出官方同名 Setup.exe。产物未 Authenticode 签名（REL-1），SmartScreen 会警告。见 [#204](https://github.com/nehcuh/cmspark/pull/204)。

## [0.5.1] — 2026-08-18

### Added

- **对话框用户附图**：Side Panel 可粘贴 / 点选 / 拖入 PNG·JPEG·GIF·WebP。线程生效主模型 `likelyMultimodal` 时原生看图，否则走视觉轨；工具截图 / PDF 内嵌图仍走视觉轨。
- 附件芯片、48px 对话缩略图、首次发送目的地主机提示；sidecar 落盘（0o600/0o700 + realpath）；WS 帧 10MiB−256KiB 拒发。

### Security / Trust (already on main since 0.5.0; recorded at 0.5.1 cut)

- **C1** 无人值守 dual-write：武装前快照三旗；解除/TTL 过期**始终**恢复快照（不再仅 `clear_cruise`）
- **C2/C3** 急停 ≠ 解除：值守仍开 banner；确认台空桌面常驻「值守中：桌面确认已静默」
- **C4** 后果矩阵拆分 evaluate vs 导航；默认值守不 waive evaluate forceConfirm
- **C5** Pack Trust `skip_l2`/三旗需 Settings 同款短语 step-up（服务端拒绝 + PacksPanel）
- **C6** Worker `WORKER_HARD_DENY` 运行时 `isToolAllowed` 再强制；`thread.update` 不可开全表面
- **C7/C8** shell cwd / netsec ports L2 bind 与 execute 预规范化一致
- **C12** security-gates 去掉 `force_confirm` 假绿断言
- **C9** CI lockstep：`ws-router-validator-lockstep` 测试
- **C11** UI `SURFACE_BY_TOOL` 表（含 shell_exec / netsec / scroll_to / upload_file）
- **C13–C16** SoT/文档诚实：SUPERSEDED Aug-02 设计；mcp.md `require_grant` 默认 true；CU Apps 坐标开关 0.5.0；ADR-021 residual windowLevel hard

### Also on tip since 0.5.0 (recorded at 0.5.1 cut)

- **#160** 无人值守 re-L2 静默（ADR-021 2026-08-09 修订）
- **#161** Windows voice/shell closeout（shell/netsec token binding 对齐）
- 会议用户指南：STT `resource_conflict` 恢复说明 + 纪要模板用法（§3.5–3.6）
- 会议 **P1 近实时**（默认渐进假设 + ~8s 定稿）与 **P2 长会**（直播/上传硬上限 3h、软提示 2h；纪要输入 20 万字）

### Fixed

- Windows：外部编程 Agent（ACP）启动不再命中 npm 的 Unix shebang 垫片（`spawn ENOENT`），也不再对 `.cmd` 直接 CreateProcess（`EINVAL`）。发现优先 `.exe`/`.cmd`，并把 Claude/Pi 等 shim 解包为 PE / `node script.js`。
- Windows Mode C / wrapViaCmd 共识 R1–R5：禁止 WindowsApps `wt.exe` 假 L1；`auto` 先 `start` 失败可 L0；`cmd /c` 剥离 `-p`/prompt；cmd-host 只走 L0；粘贴行带 `Get-Content` 任务文件。
- Windows ACP P2（R6–R14）：临时文件 `wx`+延迟删除；`start` 全 token 引号；`System32\taskkill.exe`；拒绝用 companion PE 当 node；unwrap `%~dp0`；`joinDp0` 反斜杠；spawn 接线锁；设置补 WT/cmd；空列表说明 shebang 垫片。
- Windows Mode C post-#191：`start` 走 `cmd /d /s /c` extra-quote + `windowsVerbatimArguments`（不再被 CRT 改写成 `\"`）；真 PE `wt.exe` 的 exit 0 视为 CLI 交班成功；`cmd`/`powershell` 钉 System32；成功时间线用实际打开的 app，不用 config pref。

### Packaging

- `run-esbuild-bundle.mjs` 直接 spawn esbuild 原生二进制（避免 node 解析 Mach-O）

## [0.5.0] — 2026-08-08

### 稳定切点

听写 / 会议 / 本机 STT 产品线合入并文档化；Computer Use 实验定位仅保留 **Qwen3-VL**；macOS DMG 可打包安装。

### Added

- **听写+ D2**：按住热键；设置中 **按键盘录制** 组合键；文字/语音改设置命令条  
- **实时出字**：浏览器 Web Speech interim；本机 Whisper **M2 渐进假设流**（PCM 流式 + `voice.stt.partial_request`，约 8s 窗定稿）  
- **会议**：装配 › 场景 › 会议 工作台入口；Mtg0–3（粘贴/本机录/上传/实验发言人N）  
- ADR-023 / ADR-024 与用户指南 [meeting-and-dictation-user-guide](docs/meeting-and-dictation-user-guide.md)

### Removed

- **TinyClick / Florence-2 ONNX** 全栈与 `onnxruntime-node`、CI vendor 校验（PR #151）  
- 实验桌面定位统一为 **Qwen3-VL**

### Changed

- 产品版本 **0.4.0 → 0.5.0**
- 文档导航、GOAL G22、architecture §9 与 README 能力表同步  

### Security / Trust

- 本机 STT 仍走 chrome-extension origin fence；partial 失败 soft-skip 不杀 live 会话  
- Pack 仍不得写 voice / hotkey / ack  

## [0.4.0] — 2026-08

### Added / shipped under 0.4.x

- Multi-agent · Mission Board · Pack / 企业模块  
- Computer Use / Host / Apps · Confirm Center · Outbound MCP 骨架  
- Qwen3-VL 实验定位层  
- 听写 M1 + Path B 本机 STT 初版 · Dictation+ D1 · 会议 Mtg 初版（后续并入 0.5.0 文档）  

## [0.3.0] — 2026-07

- MCP · Mission Pack · Computer Use / Host 主路径 · Multi-agent P0  

---

链接：

- [docs/README.md](docs/README.md)  
- [GOAL.md](docs/GOAL.md)  
