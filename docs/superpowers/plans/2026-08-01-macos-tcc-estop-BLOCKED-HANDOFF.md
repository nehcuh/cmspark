# HANDOFF — host_computer estop code 4 / Screen Recording -3801（阻塞）

> **日期**: 2026-08-01 傍晚  
> **状态**: **BLOCKED 真机** — 用户先退出，晚点再处理  
> **用户可见错误**（反复）:
> ```
> host_computer refused: emergency-stop unavailable
> (estop helper exited at startup (code 4) — check Accessibility permission for CMspark)
> ```
> 日志中亦出现：
> ```
> screenshot: Screen Recording permission denied (ScreenCaptureKit code=-3801)
> ```

---

## 已交付（代码 / PR）

| 项 | 状态 |
|----|------|
| TCC 产品身份方案 D（MacOS/CMspark = host Mach-O，`com.cmspark.agent`） | 已合 **main** via PR **#103** `9a911bd` |
| Dual review r2 Claude+Pi **APPROVE_WITH_NITS** | 设计/实现审通过 |
| B1 integrity：包内 deep-sign 后用 codesign 身份 | `d15a788` 等 |
| 后续 fix：`.app Contents` 解析 host + estop stderr/重试 | 分支 `fix/macos-tcc-product-identity` tip **`2c1437f`**（**尚未**再合 main） |
| 本机重装 | `/Applications/CMspark.app` 已 ditto 最新 staging（含 `2c1437f` 逻辑） |

---

## 现象时间线（用户机）

1. 系统弹窗：「**CMspark.app** 想录制屏幕」— 产品身份已正确（不再弹 node）。
2. 用户在 **录屏** 打开 CMspark；**辅助功能** 也有 CMspark=开；清理了多条幽灵 **node** 开关。
3. Side Panel `host_computer` 仍失败：
   - 较早：`estop code 4`（CGEventTap 创建失败）
   - 较晚日志：estop 偶发过后仍 **SCK -3801**（截图权限）
4. 对话 `#7n9nvl` 曾用 `shell_exec screencapture`（经 **node**），与 host SCK 路径不同，易混淆。

---

## 已验证（[executed]）

| 探测 | 结果 |
|------|------|
| `MacOS/CMspark security-check` | `axTrusted: true` |
| 手动 `MacOS/CMspark estop --socket-path …` | **常驻成功**，socket 可连 |
| 手动 `screenshot` Ghostty 大窗 | **ok:true**，~173KB PNG |
| 手动 `inject click` | **ok:true**，skylight+hid |
| 扩展 WS | 重启后 `connected` |
| Companion 内 `host_computer` | **仍 fail**（用户侧确认台批准后 estop/截图报错） |

**矛盾点**：CLI 对同一二进制 estop/截图成功，**daemon 路径 `host_computer` 仍失败**。  
嫌疑：host 解析/spawn 上下文、ad-hoc 重装后 TCC CDHash、或 daemon 子进程 TCC 归因。

---

## 代码锚点

| 模块 | 路径 |
|------|------|
| estop code 4 | `host.swift` `runEstop` → `CGEvent.tapCreate` fail → `HostError(code: 4)` |
| companion preflight | `computer/darwin-estop.ts` `ensureEstopHelper` |
| host 解析 | `host-use/darwin/host-bin.ts`（`resolvePackagedContentsDir` 新增） |
| 截图 | `darwin-adapters.ts` `MacScreenCapturer.captureWindow` → `screenshot` 子命令 |
| 日志 | `~/.cmspark-agent/logs/companion-YYYY-MM-DD.log` 搜 `computer.estop` / `3801` |

---

## 用户环境注意

- **ad-hoc 签名**：每次重装/重打 DMG 可能 **清掉或错位 TCC**；需对 **CMspark.app** 再开：
  - 录屏与系统录音  
  - 辅助功能  
  - 输入监控（若存在）  
- 改权限后必须 **菜单栏完全退出 CMspark** 再开（tray + daemon 都死干净）。
- 辅助功能列表里的 **node 幽灵** 可关；**不应**再依赖勾 node。
- **不要删** `CMspark.app/Contents/Resources/node`（Agent 运行时）。

---

## 下次开工清单（建议顺序）

1. **读最新日志**（重装 `2c1437f` 后）：应有 `computer.estop.spawn` / `computer.estop.early_exit` 含 **bin 路径 + stderr**。  
2. 若 bin ≠ `/Applications/CMspark.app/Contents/MacOS/CMspark` → 继续修 resolve。  
3. 若 bin 正确仍 code 4 → 查 **Input Monitoring** + CGEventTap 在 daemon 子进程下的 TCC；考虑从 **tray 进程** 拉起 estop 而非 daemon。  
4. 若 estop OK 仅 -3801 → 对 **当前 CDHash** 重开录屏 + 验证 companion 实际 spawn 的 codesign Identifier。  
5. 稳定后：把 `2c1437f` 再开 PR 合 main；长期 **Developer ID** 减 ad-hoc 漂移。  
6. Task 7 真机 DoD（外 App 截图）仍开放。

---

## 勿宣称

- 勿宣称「用户侧 Computer Use 已完全修好」— **真机 host_computer 仍失败**。  
- CLI 成功 ≠ Side Panel 成功。

---

## Update 2026-08-01 night — tray-owned estop landed (still device-blocked)

### Code (branch `fix/macos-tcc-product-identity`)
- `host.swift`: Aqua `launchAgentTrayAndExit` starts `estop` child **before** Node tray; unlinks stale socket; logs stderr → `~/.cmspark-agent/logs/estop-tray.log`
- `darwin-estop.ts`: connect grace 3s → daemon fallback only; `startTrayOwnedEstopBestEffort` for dev tray
- Workflow: `.grok/workflows/tray-estop-cu-fix.rhai`
- Pi+Kimi impl review: **both APPROVE_WITH_NITS** (`tray-estop-impl-*-20260801-215220.md`)

### New executed evidence
After reinstall latest DMG:
```
estop-tray.log:
estop: CGEventTap creation failed — grant Accessibility permission to CMspark
```
- Process tree: CMspark → tray only; **no living estop child**
- Socket file may exist **dead** (bind then exit 4) → Connection refused
- CLI `MacOS/CMspark estop` can still succeed while **app-launched** child fails → TCC grant may not cover current CDHash / LaunchServices launch path

### User action still required
1. Re-toggle **辅助功能** for CMspark (off→on) after every ad-hoc reinstall  
2. Re-toggle **录屏** similarly  
3. Fully quit + relaunch  
4. Confirm `estop-tray.log` empty of CGEventTap errors and `ps` shows `CMspark estop`

### Next engineering if still fail after re-toggle
- Compare `codesign` CDHash of running binary vs TCC entry  
- Consider Input Monitoring grant  
- Consider Developer ID (stop ad-hoc CDHash churn)
