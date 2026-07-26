# UI Mode P1 — L2 Cockpit MVP Implementation Plan

> **For agentic workers:** Execute task-by-task. Checkbox steps for tracking.

**Goal:** When capability is L2 (Computer Use), open an Extension Cockpit window with dual-track task UI + elevated confirms; Side Panel keeps SafetyStrip (mandatory abort + minimal confirm) and non-conductor input.

**Architecture:** Background owns `chrome.windows` lifecycle (`cockpit.open` / `focus` / track id). Cockpit is a Plasmo `tabs/cockpit` page mounting the same `AgentStoreProvider` + `useWebSocket` (messages already broadcast via `chrome.runtime.sendMessage`). Panel and Cockpit are separate JS contexts that rehydrate from companion traffic. Panel `ComputerTaskBar` is hidden while L2 (replaced by SafetyStrip); full timeline lives in Cockpit.

**Tech Stack:** TypeScript, React 18, Plasmo MV3, existing agentStore / ComputerTaskBar semantics.

**Spec:** `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md` §6 P1, §3 Cockpit IA  
**Branch:** continue `feat/ui-mode-p0` (or rename later)

---

## File map

| File | Role |
|------|------|
| `chrome-extension/src/background/cockpit-window.ts` | Create — open/focus/close/track cockpit window |
| `chrome-extension/src/background/index.ts` | Wire handlers + port name `cmspark-cockpit` |
| `chrome-extension/src/tabs/cockpit.tsx` | Create — Plasmo entry for cockpit page |
| `chrome-extension/src/cockpit/CockpitApp.tsx` | Create — dark shell: title, confirm, task dock, dual-track, composer |
| `chrome-extension/src/sidepanel/components/SafetyStrip.tsx` | Create — TaskChip + abort + minimal confirm + open cockpit |
| `chrome-extension/src/sidepanel/components/MinimalConfirm.tsx` | Create — content-split panel confirm |
| `chrome-extension/src/sidepanel/App.tsx` | Wire SafetyStrip; hide ComputerTaskBar on L2; open cockpit on escalate to L2; input ownership |
| `chrome-extension/src/sidepanel/mode/mode-controller.ts` | Optional helpers: shouldOpenCockpit |
| `chrome-extension/tests/cockpit-window-logic.test.ts` | Pure helpers if extracted |

---

### Task 1: Background cockpit window manager

**Files:** create `cockpit-window.ts`, modify `background/index.ts`

- [ ] Pure helpers: build cockpit URL via `chrome.runtime.getURL("tabs/cockpit.html")`
- [ ] Module state: `cockpitWindowId: number | null`
- [ ] `openOrFocusCockpit()`: if window exists, `windows.update({ focused: true, drawAttention: true })`; else `windows.create({ url, type: "popup", width: 720, height: 560, focused: true })`
- [ ] `windows.onRemoved` clears id
- [ ] Message types: `cockpit.open`, `cockpit.focus`, `cockpit.close`, `cockpit.status` → `{ open: boolean, windowId }`
- [ ] Accept long-lived port name `cmspark-cockpit` same as sidepanel keep-alive pattern

### Task 2: Cockpit page shell + dual-track

**Files:** `tabs/cockpit.tsx`, `cockpit/CockpitApp.tsx`

- [ ] Entry: ErrorBoundary + AgentStoreProvider + useWebSocket + CockpitApp
- [ ] Dark layout per spec §3
- [ ] TitleBar: L2 LIVE, 急停, 收起 (close window via `cockpit.close` or `window.close`)
- [ ] TaskDock + step rail (reuse ComputerTaskBar step rendering patterns / extract shared pieces if cheap)
- [ ] Compact dialogue: last few user/assistant messages without tool noise
- [ ] Composer: `chat.send` to active thread (conductor)
- [ ] Connect port `cmspark-cockpit`

### Task 3: Panel SafetyStrip + auto-open cockpit on L2

**Files:** `SafetyStrip.tsx`, `App.tsx`

- [ ] When `level === "computer"`: show SafetyStrip; **hide** full `ComputerTaskBar`
- [ ] SafetyStrip: status, task title, progress, **急停**, "打开操控台", minimal confirm slot
- [ ] `useEffect` when level becomes computer → `chrome.runtime.sendMessage({ type: "cockpit.open" })`
- [ ] When not computer, do not force-close cockpit (user may keep it); optional later

### Task 4: Confirm content-split

**Files:** `MinimalConfirm.tsx`, CockpitApp, App SecurityConfirmationDialog

- [ ] Panel: MinimalConfirm — tool, risk color, allow/deny/stop, "详情→cockpit" (no heavy preview/nonce)
- [ ] Cockpit: full confirm elevated (can reuse/extract from SecurityConfirmationDialog)
- [ ] Both call same `security.confirmation.response` path
- [ ] On new confirm in cockpit path: background focus + drawAttention
- [ ] Timeout: 60s auto-deny if still pending (timer in panel or cockpit; one source — prefer store/hook)

### Task 5: Panel input ownership (D12′)

**Files:** `App.tsx` InputArea

- [ ] When `level === "computer"`: placeholder "排队跟进…"; either queue locally and flush when level drops, or send as normal chat but label as follow-up (v1: **send allowed** but visual queue styling + still works — stricter: disable parallel by only allowing send that goes to same thread as normal chat — product said follow-up queue)
- [ ] Minimal: visual distinction + toast "指令已发送（Computer Use 进行中）"; do not block send hard if it breaks UX — prefer send to companion as normal user message (agent still receives)

### Task 6: Tests, build, acceptance

- [ ] Unit tests for cockpit URL / open-or-focus pure logic
- [ ] `npm --prefix chrome-extension test` + `build`
- [ ] Manual checklist from spec P1

---

## Out of scope (P2+)

- L1 expand workspace
- Full dual-skin token system
- Companion native window
- Multi-cockpit
