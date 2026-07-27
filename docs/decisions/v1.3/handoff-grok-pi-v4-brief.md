# Brief for Grok + Pi — Approach C-minus v4 Re-plan

> **Role change (user directive 2026-07-24)**: Claude ceases planning role for computer-use. Grok owns the plan. Pi confirms. Claude only writes code.

## User's vision (Hermes / OpenClaw pattern)

Agent operates **in background**:
- 不抢前台 — 目标 app 不必 frontmost 也能被操作
- 不频繁打扰 — 不是每个 action 都弹 Chrome side panel 让用户点允许
- 像 OpenClaw 那种 Accessibility + ScreenCaptureKit 直跑路径，不绕 AppleScript / HID tap

## What Approach C-minus v3 actually shipped (2026-07-24)

| Layer | What I did | What I missed |
|---|---|---|
| Click inject | `CGEvent.post(tap:.cghidEventTap)` → `SLEventPostToPid` (SkyLight per-PID auth-signed). Inject 路径的 `ensureForeground` 已删。Chrome renderer 接受事件。 | — |
| **Screenshot path** | — | **`host.swift:797` cuScreenshot 仍无条件调 `cuActivatePid(pid)`**（b0faek legacy bug fix，没去掉）。结果：每个 computer.action 第一步截图就把目标 app 拉到前台。这就是用户看到「实际执行又不断将需要操作的程序切换到前台」的根因。 |
| **L2 confirmation cadence** | — | **完全没碰**。每个 click 仍走 reL2() → Chrome side panel 45s 确认。用户看到「需要不断去 chrome 插件点击允许」的根因。 |
| Coordinate space | — | **LLM 发 (722, 872) vs 窗口 880x640** → `OUT_OF_BOUNDS`（executor.ts:862）。872 离 880 太近，疑似 x/y 互换、retina 缩放、或截图与点击窗口不一致。 |

## Three concrete defects (verified in code)

### Defect 1: Screenshot activates target (root cause of "前台被切")
- **File**: `companion/src/host-use/darwin/host.swift:797`
- **Code**: `cuActivatePid(pid)` 在 cuScreenshot 入口无条件调用
- **Reason for activation**: b0faek bug 历史 — Chrome side panel confirm popup 遮挡时截图会 capture 到 stale frame，所以加 activate
- **Now**: click 不再 activate（SkyLight 已解决），但截图仍 activate。**截图→点击→截图→点击**循环里每一步截图都把目标拉前台。

### Defect 2: Per-action L2 confirmation (root cause of "不停点允许")
- **Surface**: `companion/src/computer/executor.ts` 多处 `reL2(...)` 调用
- **Cadence**: 每个 computer.action 至少一次 L2，叠加 danger scan / uncross-verified / foreground-yield 等独立 L2 触发条件
- **Vision mismatch**: Hermes/OpenClaw 模式下，agent 应能在 L0/L1（whitelist 静默 / 单确认）下连续操作；当前架构把每个 click 都当 potential destructive 处理

### Defect 3: Coordinate space mismatch (`OUT_OF_BOUNDS 880x640`)
- **File**: `companion/src/computer/executor.ts:862`
- **Symptom**: LLM 返回 `(722.79, 872.09)`，窗口 client rect 是 `880x640`
- **Suspects**:
  1. LLM 截图分辨率 ≠ client logical px（retina 2x: 1760x1280 vs 880x640）
  2. LLM x/y 互换（872 接近 880 width，疑似把 width 当 height）
  3. 截图所属 hwnd ≠ 点击所属 hwnd（window resized / 误选 tab）
- **`locate-chain.ts:258` 注释**: "SCREEN → image space (capture meta: rect is the window's screen rect)" — 坐标变换链路多步，任一步偏差都致 OUT_OF_BOUNDS

## What I need from Grok

**Produce a v4 plan** that delivers the actual Hermes/OpenClaw pattern. Must address all 3 defects coherently — not 3 independent patches. Save to `docs/decisions/v1.3/plan-approach-c-minus-v4-grok.md`.

Required plan sections:
1. **Vision alignment**: explicit checklist of Hermes/OpenClaw behavioral properties (frontmost invariant, prompt cadence, coord system)
2. **Defect 1 fix**: cuScreenshot activation strategy. Is `cuActivatePid` still needed at all? If SkyLight per-PID delivers to background windows, can ScreenCaptureKit also capture background windows without activation? (open question — verify in plan)
3. **Defect 2 fix**: L2 confirmation cadence redesign. Per-action → session/window-scoped? Whitelist semantics? Risk-tier model?
4. **Defect 3 fix**: coordinate space audit. Define the canonical coord system end-to-end (LLM output → click API input). Identify where mismatch can occur.
5. **Acceptance criteria**: manual lab sequence (G2) with concrete pass/fail signals per defect
6. **Implementation order**: which file changes first, which can parallelize, which need sequential verify
7. **Risk register**: what could the v4 plan itself get wrong (acknowledged tradeoffs, not blind optimism)

Constraints to honor:
- Tahoe 26.5+ ship target (don't regress plist floor — Grok's prior win stands)
- Phase 1 excludes 5 high-risk tools (vault blacklist, AST validation — don't weaken)
- S-P0-2 spawn guard stays (don't remove)
- 3 distinct inject error codes stay (don't collapse — Claude Code v3 review finding)
- `multi_agent_advisor_pattern.md`: your plan goes to Pi for confirmation before Claude codes

Out of scope for v4 plan (Claude won't touch these even when coding):
- Windows Phase 1.5 (deferred per Round 2)
- Linux AT-SPI (Phase 1 but separate worktree)
- Biometric confirmation (W7+, separate)

## What I need from Pi

After Grok's plan lands, Pi reviews for:
- Plan coherence (does it actually deliver Hermes/OpenClaw pattern?)
- Hidden regressions (does removing screenshot activation break occlusion detection?)
- Coord system correctness (does the proposed audit catch the (722, 872) bug class?)
- Approval / conditional approval / rejection

Save Pi review to `docs/decisions/v1.3/review-pi-plan-v4.txt`.

## Claude's commitment

Once Grok + Pi consensus lands, Claude:
- Implements the plan file-by-file
- Runs tests after each change
- Surfaces blockers via brief back to Grok (not unilateral design changes)
- Stops before manual lab; notifies user

Until then, no code changes from Claude.

---

**Files in current worktree state** (uncommitted, G1 lab incomplete):
- `companion/src/host-use/darwin/host.swift` — has Defect 1 (line 797)
- `companion/src/host-use/darwin/host-integrity.ts` — NEW, S-P0-2 spawn guard
- `companion/src/host-use/darwin/adapter.ts` — routes through spawnHostBin
- `companion/src/host-use/darwin/build-host.sh` — auto-SHA rewrite
- `companion/src/computer/darwin-adapters.ts` — 5 inject paths use spawnHostBin + parseJson
- `companion/src/computer/executor.ts` — has Defect 2 (multiple reL2 sites) + Defect 3 (line 862)
- 2 test files (16 tests passing)

Prior reviews (background reading):
- `docs/decisions/v1.3/review-grok-merged-diff-v3.txt`
- `docs/decisions/v1.3/review-claude-code-merged-diff-v3.txt`
- `docs/decisions/v1.3/plan-approach-c-minus.md` (v3, now obsolete)
