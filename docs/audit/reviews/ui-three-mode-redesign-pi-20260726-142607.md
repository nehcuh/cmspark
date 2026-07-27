# Review: UI Three-Mode Redesign

## Verdict

**APPROVE_WITH_CHANGES**

## Summary

The L0/L1/L2 model correctly maps to the product's actual capability layers — a distinction already latent in the codebase (`isComputerTask` guards, different risk profiles for `host_computer` vs browser CDP tools). The progressive escalation on one thread preserves user context continuity, and the dual-surface split (Panel + Cockpit) solves the real, observable problem of 320px being simultaneously a chat surface, a security confirmation modal, a step rail, a context bar, and a screenshot viewer. The brief's self-awareness is its strongest quality: it admits what's open, defers token work, and asks hard questions about its own weak points. However, three decisions — auto-promotion thresholds, optional abort, and undefined dual-input semantics — are shipping hazards that must be resolved before implementation. The model is a genuine IA upgrade over today's feature landfill, but it needs sharper guardrails on surface transitions and fail-safe behavior.

## Answers to §5

### Q1 — Is the L0/L1/L2 ontology correct?

**Correct.** The code already thinks this way: `ComputerTaskBar.tsx` is a distinct rendering path for `host_computer` tasks with step rails, screenshots, locate-attempts, budget tracking, and an abort button — it is structurally a different product surface crammed into the same React tree. `SecurityConfirmationDialog` already branches on `isComputerTask` / `isAppLaunch` vs generic tool confirms, with entirely different copy, preview rendering (annotated screenshots + full_preview), and trust models (session-trust defaults ON for host_computer). Collapsing browser+computer would lose the differentiated safety UX. No fourth mode is justified yet: MCP is a capability transport, not a user mental model; multi-agent is a backend concern the user shouldn't need to mode-switch for.

### Q2 — Is progressive escalation on one thread sound?

**Sound, with one visibility requirement.** The alternative (separate session types) would fracture the core workflow: chat → browse → operate on page → automate desktop is one continuous intent. The de-escalation path (L2 end → L1 → L0) is correctly specified. However, escalation must be *announced*, not just inferred from tool calls. A user who says "fill out this form" and triggers L1 should see a mode transition indicator — not silently start executing browser tools. The dual-skin (D6) provides this signal, but only if the mode label is always visible, not just a color change. **Recommendation**: hard-require a persistent mode badge in the header (e.g., `💬 聊` / `🌐 网页 Agent` / `🖥 计算机 Agent`) that changes on escalation, with a brief toast on transition.

### Q3 — L1 promote-to-cockpit: right default?

**Wrong default. Auto-promotion is dangerous.** Creating a new Chrome window without explicit user action feels like malware behavior. Users on restricted corporate machines may have `chrome.windows.create` blocked or trigger IT alerts. The brief admits the threshold is undefined ("N steps, screenshot density") — this is precisely the kind of heuristic that creates heisenbugs: "sometimes my panel pops out, sometimes it doesn't, I don't know why." 

**Recommendation**: L1 stays panel-only by default. Promotion to Cockpit is user-initiated only via an explicit "展开工作区 ↗" button. Remove the auto-promotion trigger entirely from v1. This simplifies the state machine, removes the threshold-tuning problem, and matches user expectation: windows only open when the user asks for them.

### Q4 — Strict split (D10): TaskChip-only panel during L2

**The blind-spot risk is real and under-mitigated.** The brief says "optional secondary abort" on the TaskChip. This is backwards: when the Cockpit is closed (D11), the chip is the *only* surface with abort capability — it must be mandatory, not optional. The scenario: user closes Cockpit, L2 task continues running desktop automation, user opens Panel to check something else, sees a tiny chip with no abort button because "optional" wasn't configured. That's a safety failure.

**Recommendations**:
1. TaskChip must ALWAYS include abort (remove "optional secondary abort" language).
2. TaskChip must show a live status indicator (running/paused/finished) and step count — not just a static label.
3. Dual-input (D12): when L2 Cockpit is active, Panel input should be restricted to L0-chat-only (non-task messages). The Cockpit owns L2 task input. Resolve this now, not later.

### Q5 — Dual skin (D6): helpful or jarring?

**Helpful as a mode signal, but accessibility is a real concern.** A sharp light→dark transition at L2 escalation could be jarring for users with visual sensitivities. The dark HUD makes psychological sense for L2 (focused, machine-operation, terminal-like), but both skins must pass WCAG AA contrast independently. The current design system (`docs/DESIGN.md`) has no dark variant at all — everything is light-theme-only. Building a dark skin from scratch on these thin tokens is a significant visual design effort, not a quick CSS swap.

**Recommendation**: In v1, use a *semi-chrome* approach: keep the same token palette but add a distinct mode indicator (badge + subtle header tint, e.g., amber accent for L2). Defer full dark-skin to v2 when tokens are refreshed. This is more shippable and avoids shipping an untested dark mode.

### Q6 — Confirm elevation: "full confirm only on cockpit"

**Acceptable with mandatory focus-stealing.** The security confirmation dialog today (`SecurityConfirmationDialog` in `App.tsx`) is already complex: risk badges, code previews, annotated screenshots, whitelist radios, thread/session trust checkboxes, nonce challenges with keyboard input. At 320px, this is barely usable — the nonce input alone is 28px font with 8px letter-spacing. Moving it to a wider Cockpit window is a genuine UX improvement.

**Risks**: Chrome's `windows.update({ focused: true })` is not guaranteed to steal focus — it may only flash the taskbar. A minimized Cockpit with a pending confirm is a dead agent. 

**Mitigations required**:
1. Panel TaskChip must show a prominent "⚠️ 确认待处理 — 点击打开控制台" indicator when a confirmation is queued.
2. Cockpit must call `chrome.windows.update(windowId, { focused: true, drawAttention: true })` on confirm arrival.
3. 60-second confirm timeout → auto-deny with a toast explaining why. Never leave the agent hanging.

### Q7 — What would you reject or force-change?

1. **REJECT: Auto-promotion from L1 Panel → L1 Cockpit (D9 auto-trigger).** Window creation must be user-initiated. Replace with a manual "展开工作区" button. Keep the L1-Panel-default path; if the user needs more space, they click the button. This is the single most important change.

2. **FORCE-CHANGE: "Optional secondary abort" → mandatory primary abort on TaskChip.** The chip is the only abort surface when Cockpit is closed. Abort must always be reachable with one click.

3. **FORCE-CHANGE: Resolve dual-input semantics now.** When L2 Cockpit is open, Panel input sends to thread chat context only, not to the active task. Cockpit input owns task instructions. This prevents race conditions where the user inadvertently sends a conflicting instruction from the Panel.

4. **FORCE-CHANGE: D11 close warning.** Closing Cockpit must show a non-dismissible 3-second warning: "任务仍在运行 — 关闭窗口不会停止任务。可通过侧边栏任务卡片急停。" before the window actually closes. Chrome `windows.onRemoved` + `beforeunload` is unreliable; the simplest approach is a managed close via the Cockpit's own UI with a confirm step, not relying on native window close.

5. **FORCE-CHANGE: Mode transition announcement.** Every escalation must emit a visible toast (e.g., "已升级至 L1 网页 Agent — 可操作当前页面") and a store event so the mode indicator updates atomically. No silent escalation.

### Q8 — Phasing: smallest shippable slice

**P0 (2-3 weeks): Mode awareness, no surface split.** Ship `CapabilityLevel` enum + `ModeController` (derive level from tool activity) + persistent mode badge in header. No cockpit, no surface split, no skin changes. Users immediately benefit from knowing which capability layer they're in. This validates the ontology without any window-management risk. The `ComputerTaskBar` stays in-panel for now.

**P1 (3-4 weeks): L2 Cockpit + TaskChip, minimum viable split.** `chrome.windows.create` for Cockpit, `TaskChip` component in Panel (with mandatory abort), move `ComputerTaskBar` + `SecurityConfirmationDialog` to Cockpit renderer. One shared agent store, two renderers. This is the core architectural bet — validate it before building L1 promotion.

**P2 (later): L1 promotion, context bar split, visual polish.** Manual-expand button for L1, context tool reorganization (D5), token refresh, dark skin exploration. These are quality-of-life improvements that depend on P1 proving the dual-surface model works.

## Must-fix before implementation

1. **Remove auto-promotion trigger (D9/C).** L1→Cockpit must be user-initiated only. No heuristic window creation.
2. **TaskChip abort is mandatory, not optional (D10 correction).** When Cockpit is unavailable, the chip is the sole abort surface.
3. **Resolve dual-input ownership (D12).** When L2 Cockpit open, Panel input → chat only; Cockpit input → task instructions.
4. **Cockpit close requires managed confirm step (D11 hardening).** No silent close-while-running.
5. **Security confirm timeout with auto-deny.** 60s max in Cockpit before auto-deny + toast.
6. **Persistent mode badge in header.** Always visible capability level indicator, updated atomically on escalation/de-escalation.

## Nice-to-have / later

- Dark skin for L2 (build on refreshed tokens, not today's thin `docs/DESIGN.md`)
- Context bar mode-split (D5 reorganization of the six BottomBar panels)
- Icon migration from emoji to SVG
- Companion native Cockpit window (v2, post-Extension)
- Exact N-step threshold tuning (moot if auto-promotion is removed)

## Risks & failure modes

- **Multi-window focus races**: Chrome may not reliably focus the Cockpit on confirm arrival. If the user is in another app, confirm sits unseen. Mitigation: `drawAttention: true` + Panel chip indicator + timeout auto-deny.
- **Mode thrash**: Rapid L0↔L1↔L0 cycling (e.g., a loop of chat → tool → chat → tool) could cause visual jitter if the mode indicator or skin transitions are animated. Mitigation: debounce mode transitions (500ms hysteresis before down-leveling from L1 to L0).
- **Cockpit window lifecycle**: `chrome.windows` created by the extension can be closed by the user via OS window controls. On close, state must sync back — if the Cockpit had unsent input or a pending confirm, that state is lost. Mitigation: auto-save Cockpit draft state to store on window removal.
- **Panel + Cockpit store consistency**: Two React trees reading/writing the same agent store via WebSocket. If both issue `chat.send`, message ordering depends on WebSocket timing. Mitigation: serialized send queue with a single writer (extension background script as gate).
- **Confirm missed**: The worst-case scenario — a security confirmation with a 60s timeout fires while the user is in a different virtual desktop. The task fails, the user doesn't know why, and the agent appears broken. Mitigation: companion-side retry with backoff before auto-deny, plus OS-level notification if available.

## Suggested phasing

- **P0 (ship first)**: `CapabilityLevel` enum, `ModeController` derivation, persistent mode badge in header. No surface split, no skin change. Validate the ontology.
- **P1 (core bet)**: L2 Cockpit window + Panel TaskChip (mandatory abort). `ComputerTaskBar` + `SecurityConfirmationDialog` move to Cockpit renderer. One store, two surfaces.
- **P2 (polish)**: Manual L1 expand button, context bar mode-split, refined visual indicators, token system refresh.

VERDICT: APPROVE_WITH_CHANGES
