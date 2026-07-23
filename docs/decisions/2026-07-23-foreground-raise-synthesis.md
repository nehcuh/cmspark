# Foreground-Raise Synthesis (Round 2)

**Date**: 2026-07-23
**Status**: 综合 Kimi + Pi + Adversarial + Architecture 四方意见，等用户授权实施
**Prior brief**: `2026-07-23-foreground-raise-brief.md`

---

## 1. 四方 verdict 对比

| Reviewer | Verdict | 一句话 |
|---|---|---|
| Kimi | REQUEST_CHANGES | floating/multi-window/fg===0 太激进/诊断 |
| Pi (claude CLI) | REQUEST_CHANGES | z-order 第一个 layer=0 是 off-screen 辅助窗（root cause）；checkOk mask |
| Adversary (general-purpose) | REJECT C → A only | `bounds.size` 启发式排除 NetEase 实际窗口；用 `name + y>=0` 过滤；drop osascript AXRaise；用 host.swift 已有 AX 设施 |
| Architect (Plan) | REJECT C → cut-down B | Contract 缺失；AXRaise + setTimeout 不是同步原语；truth must live in Swift；collapse activate+raise+inject 到单 Swift call |

## 2. 四方共识（strong consensus）

1. **Design C 整体否决**——Phase 1 完整方案（osascript AXRaise + verify-by-pid + size 过滤）双方都认为 flawed
2. **立即 ship ~15 行纯 TS 改动**——foregroundHwnd 加 checkOk + encoding + 过滤
3. **drop osascript AXRaise**——Adversary：用 host.swift 已有 AXUIElement 设施；Architect：移到 Swift 同进程
4. **drop verify-by-pid 作为主路径**——A4 "target=A, raise B, verify pass" 实际是 misroute（Pi 自己指出的失败模式被 A4 rubber-stamp）
5. **drop `bounds.size >= 100` 启发式**——排除 NetEase Music mini-player/lyric/tray-icon 等真实场景
6. **fail-closed on probe-zero**——必须 distinct error class，不能 fall-open（Architect 更明确：`ForegroundProbeBrokenError` + executor 层分支）
7. **加 fixture regression test**——用 2026-07-23 21:50 用户实测 binary 输出作为 golden fixture（ locks historical bug as permanent canary）

## 3. 四方分歧

| 主题 | Adversary | Architect | 我的裁决 |
|---|---|---|---|
| Phase 2 何时做 | 等 measured multi-Space failure 再做 | this week 直接做 | **采纳 Architect**：multi-Space 是已知 broken，不必等 |
| 过滤条件 | `layer === 0 && bounds.y >= 0 && name !== ""` | 没具体说 | **采纳 Adversary**：name + y>=0 比 size 启发式好 |
| Contract 显式化 | 未提 | 必须先写 postcondition | **采纳 Architect**：先把 contract 写下来 |
| Test strategy | fixture test | fixture + property + 真实 binary CI | **采纳 Architect**：加 property test + macOS CI matrix |

## 4. 最终推荐方案

### Round-2 Review blockers (Kimi + Pi 一致)

- **B1 (CRITICAL)**: `executor.ts:1147` 的 `foregroundHwnd()` 是**诊断用途**（计算 `dialogSuspected`），不是 precondition。如果加 `checkOk` throw，binary hiccup 会直接冒泡到 line 1367 catch → wrap `INJECT_FAILED` → task fail。**这是 regression**——之前 fg===0 只是 `dialogSuspected` 不计算 foreground channel，task 继续运行。**必须在同 PR 包 try/catch**，catch `ForegroundProbeBrokenError` 后 fg=0（保持旧行为）。
- **B2 (minor)**: A9 property test 需给 generator spec 草稿（Pi 提出），但非阻塞
- **B3 (none)**: `forceForeground` line 596-597 bundleId-unresolvable 分支保持 silent `fg===hwnd`——罕见路径，可接受

### Field-name audit (Kimi 提的 pre-merge check)

实测 binary stdout (`cmspark-host window-list --foreground`) 字段：
- `windowId: number` ✓（fixture 草稿写对了）
- `name: string` ✓
- `layer: number` ✓
- `bounds: { x, y, width, height }` ✓
- `pid: number` ✓
- `bundleId: string` ✓
- `ownerName: string` ✓

fixture 用 raw captured stdout，不手编。

### Phase 1 (PR 1, 今天, ~40 行 TS)

**Changes (companion/src/computer/darwin-adapters.ts)**:

1. **明确 contract** (在文件顶部 JSDoc 或 types.ts):
   ```ts
   /**
    * Returns the window CGEvent will route the next event to (event-tap target),
    * NOT "what the user perceives as frontmost." These converge only when the
    * frontmost app has exactly one visible window.
    *
    * Postcondition: returned windowId is layer ∈ [-1000, 20) AND has non-empty
    * name AND on-screen (bounds.y >= 0). Returns 0 only if no window matches
    * (binary broken, or no app window onscreen).
    */
   ```

2. **foregroundHwnd 改写** (line 543-572):
   ```ts
   async foregroundHwnd(): Promise<number> {
     const bin = resolveHostBinary()
     let result: { stdout: string }
     try {
       result = await execFileAsync(bin, ["window-list", "--foreground"],
         { timeout: 5000, encoding: "utf-8" })   // ← add encoding
     } catch (err) {
       return 0   // binary spawn failed — distinct from "no windows"
     }
     const parsed = parseComputerJson(result.stdout, "window-list")
     checkOk(parsed, "window-list")              // ← add (throws on {ok:false})
     const windows = Array.isArray(parsed.windows) ? parsed.windows : []
     for (const w of windows) {
       const layer = (w as { layer?: number }).layer
       const name = (w as { name?: string }).name ?? ""
       const bounds = (w as { bounds?: { y?: number; height?: number } }).bounds ?? {}
       // Adversary 建议: name + y >= 0 比 size 启发式更精确（避免排除 NetEase
       // mini-player 等合法小窗口）。layer 范围排 menu bar (24+) 和 dock (-1000+)。
       if (typeof layer === "number" && layer >= -1000 && layer < 20 &&
           name !== "" &&
           typeof bounds.y === "number" && bounds.y >= 0) {
         const wid = (w as { windowId?: number }).windowId
         if (typeof wid === "number" && wid > 0) return wid
       }
     }
     return 0
   }
   ```

3. **ensureForeground 显式 error class** (line 446-457):
   ```ts
   // 新增 error class（同文件或 types.ts）
   export class ForegroundProbeBrokenError extends Error {
     constructor(message: string) { super(message); this.name = "ForegroundProbeBrokenError" }
   }

   private async ensureForeground(hwnd: number): Promise<void> {
     const fg = await this.foregroundHwnd()
     if (fg === 0) {
       // distinct error class → executor.ts:1147/1346 可以分支处理
       // (Architect Q4: fail-closed 必须 observable，不能 fall-open)
       throw new ForegroundProbeBrokenError(
         `ensureForeground: foregroundHwnd=0 after checkOk passed ` +
         `(binary ok but no app window onscreen? probe filter too strict?)`)
     }
     if (fg !== hwnd) {
       const raised = await this.forceForeground(hwnd)
       if (!raised) {
         throw new Error(
           `ensureForeground: failed to raise hwnd=${hwnd} (current fg=${fg}; ` +
           `likely osascript Automation TCC denial, dead window, or bundleId unresolvable)`)
       }
     }
   }
   ```

4. **forceForeground 不变** (line 575-617)——osascript activate 已有，verify by hwnd（foregroundHwnd 修了就 work）

5. **executor.ts:1147 必须 try/catch ForegroundProbeBrokenError** (B1 blocker):
   ```ts
   // Before:
   const fg = await deps.injector.foregroundHwnd()

   // After:
   let fg = 0
   try {
     fg = await deps.injector.foregroundHwnd()
   } catch (err) {
     // ForegroundProbeBrokenError: binary checkOk failed — 诊断信号退化为
     // "fg 未知"，dialogSuspected 跳过 foreground channel（旧行为）。
     // 不冒泡到 catch err → fail(INJECT_FAILED)，避免一次 hiccup 直接 fail task。
     if (!(err instanceof ForegroundProbeBrokenError)) throw err
     log("computer.task.foreground_probe_failed", { taskId, seq, error: (err as Error).message })
   }
   ```
   注意：`ensureForeground` 内部的 throw 仍要传到 click() → executor.ts:1367 catch → fail(INJECT_FAILED)——这是**期望的 fail-closed**（precondition 不满足不能注入）。只有诊断用途的 foregroundHwnd 才 catch。

6. **加 fixture regression test** (新文件 `companion/src/computer/__fixtures__/foreground-2026-07-23.json`):
   ```json
   { "ok": true, "windows": [
     {"windowId":1239,"layer":26,"ownerName":"Google Chrome","name":"","bundleId":"com.google.Chrome","pid":731,"bounds":{"x":0,"y":0,"width":1728,"height":33}},
     {"windowId":1252,"layer":24,"ownerName":"Window Server","name":"Menubar","pid":407,"bounds":{"x":0,"y":0,"width":1728,"height":33}},
     {"windowId":51,  "layer":0, "ownerName":"Google Chrome","name":"","bundleId":"com.google.Chrome","pid":731,"bounds":{"x":0,"y":-73,"width":1728,"height":41}},
     {"windowId":50,  "layer":0, "ownerName":"Google Chrome","name":"","bundleId":"com.google.Chrome","pid":731,"bounds":{"x":0,"y":-79,"width":1728,"height":47}},
     {"windowId":1235,"layer":0, "ownerName":"Google Chrome","name":"","bundleId":"com.google.Chrome","pid":731,"bounds":{"x":0,"y":33,"width":1728,"height":115}},
     {"windowId":47,  "layer":0, "ownerName":"Google Chrome","name":"(1) 主页 / X","bundleId":"com.google.Chrome","pid":731,"bounds":{"x":0,"y":33,"width":1728,"height":1084}},
     {"windowId":1237,"layer":-2147483622,"ownerName":"程序坞","name":"Fullscreen Backdrop","bundleId":"com.apple.dock","pid":733,"bounds":{"x":0,"y":0,"width":1728,"height":1117}}
   ]}
   ```
   test: `foregroundHwnd(mockStdout=fixture) === 47`（locks historical bug as canary）

### Phase 2 (PR 2, this week, 动 Swift)

**Changes (companion/src/host-use/darwin/host.swift + darwin-adapters.ts)**:

1. host.swift 加 `cuFrontmostApp()` 用 `NSWorkspace.shared.frontmostApplication`
2. host.swift 加 `cuRaiseWindow(windowId)`（复用 cuScreenshot 已有的 AX frame-matching 模式，line 720-744）
3. **关键架构变化**（Architect Q3）：`cuInject` 加可选 `--ensure-frontmost` flag，**在同一进程内** activate + AXRaise + post CGEvent，消除 setTimeout race
4. darwin-adapters.ts inject 路径改用 `inject --ensure-frontmost`，drop osascript activate
5. foregroundHwnd 改用 `frontmost-app` subcommand，废弃 z-order 启发式（保留作为 fallback）

**SHA**: Adversary 已 verify `resolveHostBinary()` 只 fs.existsSync，**host binary 没有 SHA 校验**——Phase 2 不需 SHA 更新。但建议补一个 host binary SHA check 作为单独 issue（security hardening）。

## 5. 不做（明确否决）

- ❌ osascript AXRaise via System Events（需要额外 TCC，且 raise 错窗）
- ❌ verify by pid（A4 rubber-stamps Pi 自己指出的 misroute）
- ❌ `bounds.size >= 100` 启发式（排除 NetEase mini-player）
- ❌ setTimeout 作为同步原语（Architect Q3：是 prayer 不是 sync）
- ❌ Pi 的"fg===0 try forceForeground before throw"（Architect Q4：layer confusion）

## 6. Acceptance Criteria (rev)

| # | Test | Phase |
|---|------|-------|
| A1 | fixture replay: foregroundHwnd(fixture) === 47 | P1 |
| A2 | 空 name + off-screen 过滤：windowId 51/50/1235 排除 | P1 |
| A3 | checkOk: {ok:false} throws 不 silent 0 | P1 |
| A4 (rev) | multi-window app: target hwnd 是 z-order-top within pid 才 verify pass | P2 |
| A5 (rev) | CGEvent 不依赖 setTimeout；同进程 activate+raise+post | P2 |
| A6 | floating window (layer=3) target 不死锁 | P1 (name filter) + P2 (frontmost-app) |
| A7 | probe-broken distinct error class，executor 可分支 | P1 |
| A8 | 167 existing tests pass | P1+P2 |
| A9 | property test: random window arrays，filter 选对的 | P1 |

## 7. Phase 1 风险

- **R1 (low)**: name 字段在某些 app 可能空（如 menu bar items），但 layer 范围已过滤 menu bar
- **R2 (medium)**: bounds.y >= 0 排除顶部菜单下沿贴边的小窗（如 Spotlight），但 Spotlight 是 layer=25 已被 layer 范围过滤
- **R3 (medium)**: multi-Space 仍 broken（host.swift `.optionOnScreenOnly` 包含 inactive Space 窗口）——Phase 1 不解决，留给 Phase 2

## 8. 下一步

1. 等 kimi + pi 复审此 synthesis
2. 通过后 PR 1：~25 行 TS 改动 + fixture test，跑 167 测试
3. PR 1 测过后立即 PR 2：Swift 改动（独立 worktree）
