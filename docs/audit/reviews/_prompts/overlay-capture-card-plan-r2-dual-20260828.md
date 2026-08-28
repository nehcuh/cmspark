# Plan dual r2 — Overlay Capture 卡片 #241

T3 implementation plan. You did not write it. Do not rubber-stamp. No code to ship.

r1 三路：Impl REJECT · Product REJECT · Trust AWN。blocker 已折进 plan **r2 pins 16–31** 与 SoT §6 origin 句。本轮只审 **折完的 plan+spec** 是否还能对着现树落地。

## Blast
```text
Surface:      L0 Capture 卡片（overlay HTML）；侧栏视觉不动
L2-classes:   none
Compose:      file.upload；/api/stt/* → voice.stt；meeting.create/start/end；ui.open_sidepanel tray→SW
Autonomy:     none
Trust:        overlay never Allow/Deny；F-I-4 Companion never chrome.*；④ 扩展 SW 开侧栏
Channel:      community
```

## Read (required)
1. `docs/superpowers/plans/2026-08-28-slice-241-overlay-capture-card.md`（含 r2 pins）
2. `docs/superpowers/specs/2026-08-28-overlay-capture-card-design.md`
3. `docs/audit/reviews/overlay-capture-card-plan-adversary-synthesis-20260828.md`
4. `companion/src/summoner-web.ts`（无 /api/dispatch；JSON_BODY_MAX；empty 听写在侧栏）
5. `companion/src/tray/companion-client.ts` sendAppRequest vs sendAppMessage
6. `companion/src/meeting/meeting-handlers.ts` origin；`message-router.ts` meeting vs stt ctx
7. `companion/src/message-router/handlers/overlay-shell.ts`（④ **不要**抄它的 origin）
8. `chrome-extension/src/background/index.ts` handleCompanionMessage vs bulk-forward vs thread_graph sidePanel.open
9. `companion/tests/summoner-web.test.ts` leftover 720 / 召唤器 / 听写在侧栏
10. `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## r2 pins that must not reopen
- 无通用 `/api/dispatch`
- ④ tray-request / extension-receive；`sendAppRequest`；SW 测切 handleCompanionMessage
- 会议 surface 进 router；audio_retained=false；无 append_transcript
- Task 1 不放撒谎 CTA；不单独 Closes #241
- HTML 无「听写在侧栏」空态；无「允许」；summoner-web.ts 无字面量 ui.open_sidepanel

## Job
If r2 still has a blocker that would make Tasks 1–4 silent-green or dead at runtime, REJECT with file:line.
Final line exactly:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
