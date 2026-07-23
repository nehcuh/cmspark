# Foreground-Raise Design Brief

**Date**: 2026-07-23
**Status**: Brainstorm — pending adversarial + review agent sign-off, then Kimi/Pi 复审
**Owner**: Claude (main)
**Reviewers**: adversarial agent / review agent / Kimi / Pi (claude CLI substitute)

---

## 1. Problem Statement (User Voice)

> "chrome 插件不断弹出提示，点击授权的时候，前台应用自动切换后台，此时，插件再去模拟鼠标点击，点击的位置都是现在的 chrome 插件了"

**Surface symptom**: user clicks "Allow" on Chrome side panel security confirm → Chrome steals frontmost → CGEvent.post(.cghidEventTap) routes events by coord+frontmost → events land on Chrome, not on the target app.

**Claude 已经声称修复两次但用户 distrust**。原因：之前修复没碰到根因。

## 2. Three-Way Review Synthesis

| Reviewer | Verdict | Key catch |
|---|---|---|
| **Kimi** | REQUEST_CHANGES | F1 因果链描述错; F2 floating window (layer=3) 死锁; F3 multi-window verify 假阴性; F4 fg===0 fail-closed 太激进; F5 诊断粗糙 |
| **Pi (claude CLI fresh)** | REQUEST_CHANGES | **致命**：foregroundHwnd 取 z-order 第一个 layer=0 = off-screen Chrome 辅助窗 (windowId=51, y=-73, h=41) 而不是主窗 (windowId=47, h=1084)；foregroundHwnd 不调 checkOk mask binary 故障；pid 字段早就有不需改 Swift；CGEvent 按 coord+frontmost 路由 verify-by-pid 不够必须 AXRaise |
| **Claude (me)** | insufficient | 之前提的 Fix A/B/C/D **没碰到 z-order 启发式根因** |

### 2.1 Root Cause (Pi-identified, the real one)

`foregroundHwnd()` (darwin-adapters.ts:543) implementation:

```ts
for (const w of windows) {
  if ((w as { layer?: number }).layer === 0) {
    const wid = (w as { windowId?: number }).windowId
    if (typeof wid === "number" && wid > 0) return wid
  }
}
```

实测 binary 输出（用户机器 2026-07-23 21:50）：

```
[
  { windowId: 1239, layer: 26, owner: "Google Chrome", ... menu bar item },
  { windowId: 1252, layer: 24, owner: "Window Server", name: "Menubar" },
  { windowId: 51,   layer: 0,  owner: "Google Chrome", bounds:{y:-73,h:41}  },  ← first layer=0, OFF-SCREEN
  { windowId: 50,   layer: 0,  owner: "Google Chrome", bounds:{y:-79,h:47}  },  ← also off-screen
  { windowId: 1235, layer: 0,  owner: "Google Chrome", bounds:{y:33,h:115}  },
  { windowId: 47,   layer: 0,  owner: "Google Chrome", name:"(1) 主页 / X", bounds:{y:33,h:1084} },  ← REAL main window
  ...
]
```

**当前 foregroundHwnd() 返回 windowId=51**——一个 41px 高的离屏 Chrome 辅助窗。这导致：
- target=主窗(47): fg=51≠47 → forceForeground activate Chrome（pid 不变）→ z-order 顶可能还是 51 → verify false → **误抛 "TCC denial"**
- target=别的 app: fg=51 ≠ target → activate target 成功 → 但 fg 比对永远跟 51 比 → **verify 完全不可信**

即便用户没遇到 Chrome 抢前台场景，foregroundHwnd 也持续返回错值。这是用户 distrust 的真实根因。

### 2.2 Other findings

- `foregroundHwnd` (line 551) **不调 checkOk**——binary 返 `{ok:false}` 时 `windows` 缺失 → 静默 return 0，**把 binary 故障 mask 成"无窗口"**
- `--foreground` execFile (line 547) 缺 `encoding: "utf-8"`，stdout 是 Buffer，JSON.parse(Buffer) 功能正确但不一致
- 多 Space: CGWindowListCopyWindowInfo(.optionOnScreenOnly) 会把 inactive Space 的 layer=0 窗口列入 z-order 靠前
- Fix C (verify by pid) 不需要改 host.swift——binary 已返 `"pid": pid` (host.swift:588)
- CGEvent.post(.cghidEventTap) 按 coord+frontmost 路由，verify-by-pid 通过不够，**必须 AXRaise target hwnd**，否则 event 可能落到同 pid 非 target 窗口（Chrome 多窗口）

## 3. Design Goals + Acceptance Criteria

### Must fix
- **G1**: foregroundHwnd 必须返回**用户可见的 frontmost app 的 main window windowId**，不是 z-order 第一个 layer=0 辅助窗
- **G2**: 当 binary 故障时 foregroundHwnd **不能静默 return 0**（要么真 0 + clear error，要么 throw）
- **G3**: forceForeground verify 必须容忍同 pid 多窗口场景
- **G4**: forceForeground 必须保证 target hwnd 在 event 投递前 RAISED 到 frontmost（CGEvent 不能仅依赖 pid 路由）
- **G5**: floating window (layer=3) 作为 target 时不能死锁

### Must NOT regress
- **R1**: 不能因为加严过滤导致全 minimize / 桌面态直接 throw
- **R2**: 不能弱化 fail-closed 设计（旧 bug mask 月余才浮现，新的修复不能再 mask）
- **R3**: 不能让 binary 故障 fall-open

### Acceptance tests (pass/fail)
1. **A1 - foreground correctness**: 当前 Chrome 主窗 frontmost 时，foregroundHwnd() 返回的 windowId 应当 = 主窗（用户可见 1084px height），不是 51
2. **A2 - off-screen filter**: windowId=51/50 (off-screen, h<50) 被过滤排除
3. **A3 - checkOk mask**: binary stdout `{ok:false,...}` 时 foregroundHwnd 应当 throw 或返明确错误，不是 silent 0
4. **A4 - pid verify**: target=Chrome 窗口 A 时，activate 抬起 Chrome 窗口 B（同 pid），verify 应通过
5. **A5 - AXRaise**: CGEvent.post 之前 target hwnd 被 AX-raised，event 不落到同 pid 其他窗口
6. **A6 - floating target**: 网易云 mini-player (layer=3) 作为 target 时，foregroundHwnd 能返回它，ensureForeground 不死锁
7. **A7 - desktop fallback**: 全 minimize 时 ensureForeground 仍尝试 forceForeground 而非直接 throw
8. **A8 - 167 tests**: existing tests pass

## 4. Candidate Designs

### Design A — 最小补丁（不动 Swift）

**Changes (companion/src/computer/darwin-adapters.ts only)**:

1. `foregroundHwnd()`:
   - 加 `encoding: "utf-8"` 到 execFile
   - 加 `checkOk(parsed)` gate
   - 过滤 windows：`layer >= -1000 && layer < 20`（覆盖 normal/floating/modal，排除 menu bar 24+/dock desktop -1000+）
   - 排除 off-screen：`bounds.y >= 0 && bounds.height >= 50`（Pi 建议）
   - 取第一个符合的 window
2. `forceForeground(hwnd)`:
   - verify 改 by pid：用现有 `pid` 字段（host.swift:588 已返）
   - activate 后补 **AXRaise target hwnd**（osascript `tell app "System Events" to tell (first window whose id = X) to perform action "AXRaise"`）
3. `ensureForeground(hwnd)`:
   - `fg === 0` 时**仍 try forceForeground**，verify 后判定（不直接 throw）
   - 错误信息细化（区分 probe-broken / minimized / floating-target）

**Pros**:
- 纯 TS 改动，~30 行 diff
- 不动 Swift binary，不需重编 + SHA 更新 + 重签 + DMG 重打
- 立即可测

**Cons**:
- z-order 启发式仍在，只是过滤更严
- 多 Space 场景仍可能错（z-order 把 inactive Space 的窗口列前）
- AXRaise via osascript 需要 Automation TCC 给 System Events（额外权限）

### Design B — 架构重做（动 Swift）

**Changes (host.swift + darwin-adapters.ts)**:

1. host.swift 新增 `cuFrontmostApp()` 用 `NSWorkspace.shared.frontmostApplication`：
   ```swift
   func cuFrontmostApp() -> String {
       guard let app = NSWorkspace.shared.frontmostApplication else {
           return cuError("no frontmost app")
       }
       let pid = app.processIdentifier
       let bundleId = app.bundleIdentifier ?? ""
       // AX main window → windowId via AXUIElementCopyAttributeValue + pid→windows scan
       ...
       return cuJson(["ok": true, "pid": pid, "bundleId": bundleId, "windowId": mainWnd, ...])
   }
   ```
2. 新 CLI flag `cmspark-host frontmost-app`
3. darwin-adapters.ts `foregroundHwnd()` 直接调 `frontmost-app`，废弃 z-order 扫描

**Pros**:
- 用 macOS 官方 API，ground-truth
- 解决多 Space / off-screen / floating 全部 case
- 不依赖启发式

**Cons**:
- 动 Swift，需要 `bash companion/src/tray/build-tray.sh` 重编（注意：host 二进制不是 tray binary，但有类似 build script）
- SHA 更新 `SWIFT_TRAY_SHA256`（如果用 launcher 校验）—— **需要 verify host binary 是否也有 SHA 校验**
- 重签 + 重打 DMG + 用户 tccutil reset
- AX main window 在某些 app（无窗口 / 全屏）可能为 nil
- 至少多 1-2 小时 build/test cycle

### Design C — 杂交（推荐）

**Phase 1（立即）**: Design A 全部，止血用户 distrust
**Phase 2（下一轮）**: Design B，长期根治

**Pros**: 平衡速度和正确性
**Cons**: 两轮工作，Phase 1 改动 Phase 2 可能废弃部分

## 5. Open Questions

- **Q1**: AXRaise via osascript 是否需要额外 TCC 权限（System Events Automation）？用户当前已授予 osascript Automation 给 cmspark-host，**是否传递到 System Events**？
- **Q2**: host binary 是否有 launcher SHA 校验？如果有，Phase 2 必须更新 SHA。如果没有，Phase 2 重编只需替换文件。
- **Q3**: 全 minimize 桌面态 `foregroundHwnd()` 应当返 Finder (layer=0 frontmost) 还是 throw？Finder 永远存在，所以 fg===0 真实场景罕见——但 binary 故障 / TCC 拒绝时确会发生。
- **Q4**: Design A 的 `bounds.height >= 50` 阈值是否合理？实测 Chrome 辅助窗 h=41/47，主窗 h=1084，但 32" 显示器 + 缩放可能让某些合法窗口 h<50。更稳的可能是 `bounds.height >= 100 && bounds.width >= 100`。
- **Q5**: floating window target (网易云 mini-player) 的 ensureForeground 流程：target hwnd 是 mini-player (layer=3)，foregroundHwnd 能返回它（layer 范围放宽），但 forceForeground activate 整个 app 抬起的是 main window，verify-by-pid 通过但 hwnd 不 frontmost，CGEvent 仍可能落到主窗——AXRaise 必须强制 RAISE target hwnd。

## 6. Recommendation

**Design C (Hybrid)**:
- **Phase 1 立即**：Design A，纯 TS 改动，止血用户 distrust
- **Phase 2 下一轮**：Design B，长期根治（独立 PR）

**Phase 1 具体改动顺序**:
1. foregroundHwnd 加 `encoding: "utf-8"` + `checkOk`
2. foregroundHwnd 过滤 layer ∈ [-1000, 20) + bounds.y≥0 + bounds.height≥100
3. forceForeground verify by pid（用现有 pid 字段）
4. forceForeground activate 后 AXRaise target hwnd
5. ensureForeground fg===0 时 try forceForeground，细化诊断
6. 跑 167 测试，手动 DMG 测试 Chrome foreground 场景

## 7. Risks

- **R1**: AXRaise 需要 System Events Automation TCC——可能触发额外权限弹窗
- **R2**: `bounds.height >= 100` 可能误过滤合法小窗口（palette / floating tool）
- **R3**: Phase 1 改完后 Phase 2 设计可能改变 forceForeground 契约，Phase 1 测试投入部分浪费
- **R4**: 测试覆盖——foregroundHwnd 改后，之前 mock 测试需要更新 mock 数据
