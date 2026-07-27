# Implementation Review Brief — UI Mode P0 + P1 (L0/L1/L2 + Cockpit)

> Status: Dual external implementation review  
> Date: 2026-07-26  
> Branch: `feat/ui-mode-p0` (includes P0 mode awareness + P1 Cockpit MVP)  
> Base: `main`

---

## 1. What was shipped

### P0 — Mode awareness (no window)

| Piece | Location |
|-------|----------|
| Pure ModeController | `chrome-extension/src/sidepanel/mode/mode-controller.ts` |
| Unit tests | `chrome-extension/tests/mode-controller.test.ts` |
| `lastBrowserToolAt` / `modePin` store | `agentStore.tsx` + `useWebSocket.ts` stamps |
| Hook + escalate toast | `useCapabilityMode.ts` |
| Header badge | `App.tsx` Header |
| BottomBar mode-split | `BottomBar.tsx` via `contextBarTabsForLevel` |

### P1 — L2 Cockpit MVP

| Piece | Location |
|-------|----------|
| Window manager | `background/cockpit-window.ts` |
| BG handlers + open on confirm/task start | `background/index.ts` (`cockpit.*`, auto open) |
| Plasmo page | `tabs/cockpit.tsx` → `tabs/cockpit.html` |
| Cockpit UI | `cockpit/CockpitApp.tsx` (dual-track, ConfirmElevated, conductor input) |
| Panel SafetyStrip | `SafetyStrip.tsx` + `MinimalConfirm.tsx` |
| Panel wiring | `App.tsx` — hide ComputerTaskBar + full modal on L2; open cockpit on L2 |

### Spec / plans

- Spec: `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md` (§6 P0/P1 accept criteria)
- Plans: `docs/superpowers/plans/2026-07-26-ui-mode-p0.md`, `...-p1-cockpit.md`
- Prior design dual review (APPROVE_WITH_CHANGES):  
  `docs/decisions/v1.3/ui-three-mode-redesign-review-synthesis-2026-07-26.md`

### Commits on branch (newest first, relative to main)

```
30a107c fix(ui): open Cockpit on computer.task started and host confirms
01feef6 feat(ui): P1 L2 Cockpit window with dual-track and panel SafetyStrip
0056abd docs: note mode badge in DESIGN.md
977cfe2 fix(ui): mode badge LIVE, L2 finish hysteresis, browser confirm L1
9e7dded feat(ui): mode badge and BottomBar tabs by capability level
ad8f4eb feat(ui): add useCapabilityMode hook with escalate toast
2ee378e feat(ui): track lastBrowserToolAt for L1 quiescence window
11f81ca feat(ui): add pure ModeController for L0/L1/L2 derivation
```

---

## 2. Spec acceptance to verify

### P0

1. Pure chat → L0 badge `聊`
2. Browser tool → L1 `网页` + escalate toast; BottomBar Tabs/Skills
3. Active computer / host confirm → L2 `计算机` / `计算机 · LIVE`
4. L0 BottomBar not six-pack
5. Hysteresis: L1 30s; L2 finished within quiescence stays L2
6. No regression path for ComputerTaskBar when **not** L2

### P1

1. L2 opens Cockpit (`chrome.windows` popup ~720×560)
2. Panel: TaskChip + **mandatory abort** + minimal confirm; heavy preview in Cockpit
3. Close Cockpit ≠ stop task; Panel can reopen + abort
4. Panel input ownership (D12′) — at least non-conductor UX
5. Tray / no-panel path: task start or host confirm still opens Cockpit
6. Confirm timeout auto-deny in Cockpit (~60s)
7. Dual surfaces rehydrate via WS broadcast (not shared memory) — honest about limits
8. Build: `tabs/cockpit.html` present; `tsc` + plasmo green

---

## 3. Known limitations (author self-report — attack or accept)

1. Two React trees / two stores — sync only via `chrome.runtime.sendMessage` broadcast from background.
2. Panel follow-up still sends `chat.send` (visual “排队跟进” only; not a true queue).
3. Cockpit ConfirmElevated does not fully mirror Panel session-trust / thread-trust checkboxes.
4. Pre-existing unrelated test fail: `appsPlatformSupported` in `apps-panel-logic.test.ts`.
5. No E2E browser automation in CI for window open.

---

## 4. Review questions (answer all)

1. Does P0 ModeController correctly encode L0/L1/L2 + pin + hysteresis vs the approved design (including dual-review amendments D9′–D16)?
2. Is dual-surface state (separate stores) acceptable for P1, or is it a ship blocker?
3. Safety: can the user always abort and always see a confirm path if Cockpit is closed/unfocused?
4. Content-split confirm: does MinimalConfirm + ConfirmElevated satisfy security without regressing whitelist/nonce paths?
5. Input ownership D12′: is current Panel behavior honest enough, or must send be gated?
6. Window lifecycle: open/focus/close/onRemoved — races, multi-window, SW death?
7. What must be fixed before human product confirmation / merge?
8. What can wait for P2?

---

## 5. Required output format

```markdown
# Review: UI Mode P0+P1 Implementation

## Verdict
One of: APPROVE_IMPL | APPROVE_WITH_FIXES | REJECT_REWORK

## Summary
(5–10 sentences)

## Spec compliance matrix
| Criterion | Met / Partial / Miss | Notes |

## Answers to §4
### Q1 …
…

## Must-fix before human confirmation
(numbered, severity ordered)

## Nice-to-have / P2
(bullets)

## Risks & failure modes

## Suggested next steps

VERDICT: <same as above>
```

Be adversarial. Prefer shippable honesty. Read the listed source files; do not implement code unless asked.
