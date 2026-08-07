# Wave D: Reasoning UI polish + export policy — Implementation Plan

> **Gates:** plan dual → implement → impl dual  
> **Parent SoT:** analysis §4.2 T1–T4  
> **Depends:** A/B/C on main

**Goal:** Polish thinking display (user-controlled fold default) and **lock** Obsidian export to exclude reasoning by default (already structural); optional advanced include; document rebuild policy.

**Architecture:** UI-only preference in `chrome.storage.local` (`cmspark.ui.show_reasoning`). `ReasoningBlock` reads mode from agentStore/context. Export stays pure: `ExportMessage` has no reasoning field; add explicit strip + optional `include_reasoning` flag on export RPC for advanced users.

---

## Capability

```text
Surface:      L0 UI + export policy
L2-classes:   (none)
Compose:      none
Trust:        no elevation; default export omits thinking (privacy)
```

## Locked decisions

| ID | Decision |
|----|----------|
| D-D1 | Modes: `always_collapsed` \| `auto_live` (default) \| `always_open` |
| D-D2 | Storage: **client** `chrome.storage.local` key `cmspark.ui.show_reasoning` — not companion config (no cross-device need) |
| D-D3 | `auto_live`: open while streaming reasoning & no answer yet; collapse when done (current behavior) |
| D-D4 | `always_collapsed`: never auto-open (user may still expand) |
| D-D5 | `always_open`: open by default for historical + live |
| D-D6 | Per-block: **Copy** button copies reasoning text only |
| D-D7 | Export default: **never** include `reasoning_content` in markdown body |
| D-D8 | Export advanced: optional `include_reasoning: true` on `thread.export_obsidian` → fold under `> 思考过程` details |
| D-D9 | Rebuild: document only — `rebuildMessagesFromHistory` does not re-inject reasoning (existing); short note in plan + comment already on anthropic-convert |
| D-D10 | No collapse-all global toolbar this wave (YAGNI; per-block copy is enough) |

---

## File map

| File | Change |
|------|--------|
| `chrome-extension/.../agentStore.tsx` | `showReasoningMode` state + load/save LS |
| `chrome-extension/.../SettingsSlideout.tsx` | select under 模型与推理 |
| `chrome-extension/.../ChatView.tsx` | ReasoningBlock props: mode, onCopy |
| `companion/src/threads/markdown-export.ts` | ExportMessage optional reasoning; render if include_reasoning |
| `companion/src/message-router.ts` | pass include_reasoning |
| `companion/tests/markdown-export*.ts` or new | strip vs include |
| Optional: extension unit if any |

---

### Task 1: UI mode

- Load on sidepanel mount from chrome.storage.local  
- Settings: 思考过程展示 — 默认折叠 / 仅推理时展开 / 始终展开  
- ReasoningBlock: initial open from mode; live still forces open in auto_live  

### Task 2: Copy

- Button on toggle row: 复制 → clipboard.writeText(content)

### Task 3: Export

- When mapping messages for export, omit reasoning unless `include_reasoning`  
- If include: render collapsed markdown block after assistant text  

### Task 4: Tests + dual

- Export without reasoning even if source has reasoning_content  
- Export with flag includes 思考过程  

---

## Non-goals

- Companion config schema for UI  
- Collapse-all chrome  
- Changing rebuildMessagesFromHistory behavior  

## Workflow

| Gate | Status |
|------|--------|
| G7 plan dual | pending |
| G8 impl dual | blocked |
