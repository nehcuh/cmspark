# Companion-canon Side Panel UI S1+S2 — Safety / Trust adversary

**Batch**: `companion-canon-ui-s12`  
**Date**: 2026-08-18  
**Family**: SAFETY（急停/确认 never buried; settings discoverable when disconnected; `createBlankThread` no DeepSeek poison; cruise 解除 still one-click; no new L2 tools; ADR-020）  
**Independence**: Not the implementer. Working-tree inspection only. Did **not** run `npm --prefix chrome-extension test` (no shell in this reviewer). Machine **714 pass / tsc 0** is implementer-claimed `[assumed]`.  
**Blast**: T2

```text
Surface:      L0 Panel chrome（空态 / 顶栏 / 输入 / FocusBand）
L2-classes:   none new
Compose:      装配 entry chrome only
Autonomy:     Board stays /board only
Trust:        settings 可发现；急停不得埋
Channel:      unchanged
```

**Axes fit** `[inspected]`: chrome only. No new confirm dialect, no `securityConfirmations.request` / originWs change, no new host/shell/netsec tool, no Board Host entry. Pack-first not applicable (no new scenario). Trust monotonicity: disarm is one click; arm still lives behind Settings phrase gates.

---

## 1. User-locked cuts

### C″ — One rail empty **and** in work — **HOLDS** `[inspected]`

Same `StatusRail` for empty and work:

| Control | Empty | Work | Evidence |
|---------|-------|------|----------|
| 设置 gear | always | always | `StatusRail.tsx:200-213` |
| 新对话 | always | always | `:227-235` → `createBlankThread` |
| 历史 `ThreadList` | always | always | `:236` |
| Mode whisper | always | always | `:220-226` `whisper` |
| Connection | `role="status"` dot when connected; **button** when not | same | `:253-290` |
| ⋯ | always | always | `:291-309` |

`hasMessages` (`:60`) only greys 提取技能 / 导出 (`:318-365`). That is enablement, not a costume dump of the rail. Brand hides when cruise **or** disconnected (`:214-218`) to make room — settings gear stays first on the left.

### D″ — Agent-honest empty — **HOLDS** `[inspected]`

| Surface | Copy | Operate-the-tab? |
|---------|------|------------------|
| L0 `chat` | title「要我帮你做什么？」hint「问问题、写文案，或描述任务。」rows 起草 / 打开装配（技能、场景、知识） | **No** |
| L1 `browser` | title「要对这页做什么？」hint「…或让我操作当前标签。」 | Yes — **page task, allowed** |
| L2 `computer` | 确认台 / 装配 | N/A — points at 确认台 |

Source: `empty-state-copy.ts:12-40`. Consumer: `ChatView.tsx:1550-1566` `emptyStateCopy(level)` only. 「随便聊」absent from empty copy (`empty-state-copy.test.ts:14`). 装配 has human gloss in both empty rows and composer `title="装配 — 技能、场景、知识"` (`App.tsx:1678`).

---

## 2. Slice DoD (Safety-relevant)

| ID | Claim | Result |
|----|--------|--------|
| **S1.1** | Empty L1 does **not** hang FocusBand webpage strip; confirm / 急停 still win | **HOLD** — see §3 |
| S1.2 | Empty capsule = 装配 + field + send; attach/听写 after first char | HOLD `[inspected]` `App.tsx:1671-1738` (装配 unconditional; attach/mic gated on empty+no-text) |
| **S1.3** | ⋯「设置」and thread-drawer 设置 match gear (disconnected → connection) | **HOLD** — all three use `connectionState !== "connected" ? "connection" : "model"` (`StatusRail.tsx:207-208,429-430`; `ThreadList.tsx:1290-1291`) |
| S1.4 | ComposeDrawer has no ⋯「编排」; Board = `/board` | HOLD `ComposeDrawer.tsx:71-72,122-123`; `composeSectionsExcludeBoard()` (`meta-slash.ts:384-387`) |
| **S2.1** | `createBlankThread` `config_override: {}`; EmptyState consumes `emptyStateCopy` | **HOLD** — see §4 |
| S2.2 | DESIGN.md / App THESIS no 「畅所欲问」 | HOLD `[inspected]` (THESIS `App.tsx:1-6` 要我帮你做什么？; DESIGN composer placeholder is 描述任务 / 问这页) |
| S2.3 | Dead rail styles + `IconPlus` gone | HOLD `IconPlus` not exported (`icons.tsx`) |
| S2.4 | Legal `tokens.textMuted` ≥11px | HOLD `App.tsx:2180-2185` `fontSize: 11` — contrast nit in §6 |
| S2.5 | Connected conn is `role="status"`; disconnected is a button | HOLD `StatusRail.tsx:253-289` |
| S2.6–S2.8 | Invitation hover; send arrow; filled mark | HOLD (not Safety-blocking) |
| **Cruise** | Rail chip 值守/巡航; full label on title/aria; **click still 解除** | **HOLD** — see §5 |

---

## 3. 急停 / 确认 never buried on empty L1

Priority machine (`focus-band-priority.ts:76-137`):

```
Confirm → L2 Safety+急停 → coding → fleet → thread_tools → L1 context → empty
```

Empty-L1 gate is **only** `showL1Context = isBrowserContext && hasThreadMessages !== false` (`:78`). Confirm / `hasL2Task` / fleet / tools **ignore** it (`:79-123`).

Wired in `FocusBand.tsx:103-112`:

```ts
hasThreadMessages: state.messages.length > 0
```

Empty primary → `return null` (`:114`) — webpage `ContextStrip` is **not** mounted. `ContextStrip` has no other Panel caller `[inspected]`.

Confirm + live CU: `secondaryAbort` (`:85`) → `AbortSecondaryLine` **above** `MinimalConfirm` (`FocusBand.tsx:138-145`) with a real 急停 `onClick` (`:216-235`). Confirm does not replace abort.

L2 without confirm: `primary: "l2_safety"` → compact `SafetyStrip` 急停 (`SafetyStrip.tsx:145-151`). `ComputerTaskState.status` is only `running | paused | finished` (`types.ts:626`); `l2AbortRequired` covers the two live states (`FocusBand.tsx:47-51`).

Pinned above the scroll list: `App.tsx:221-236` column; `FocusBand` `flexShrink: 0`; `ChatView` list is `flex:1; overflowY:auto`. Greeting cannot scroll 急停/confirm off-screen.

Test: `focus-band-priority.test.ts:78-105` asserts empty L1 → `primary: "empty"`; confirm still wins; confirm+abort → `secondaryAbort: true`.

**S1.1 is in the code. 急停/confirm are not buried. Not a REJECT.**

---

## 4. `createBlankThread` — no DeepSeek / empty-trust stamp

```52:68:chrome-extension/src/sidepanel/components/ThreadList.tsx
export function createBlankThread(...) {
  // ...
  // Inherit live companion config — do not stamp DeepSeek / empty trust.
  config_override: {} as Thread["config_override"],
  tool_whitelist: null as string[] | null,
  // ...
  chrome.runtime.sendMessage({ type: "thread.create", alias: "", id })
}
```

WS payload has **no** override. Companion `thread-manager.create` defaults `config_override` to `{}` when omitted (`thread-manager.ts:504-518`). Merge is global then override keys only if present (`message-router.ts:294-306`). `{}` ⇒ live companion LLM `[inspected]`.

Same empty override on auto-create / quickAction (`useWebSocket.ts:1013,1052`). UI fallback: `App.tsx:888-895` `config_override.model_name` then `state.config.model_name`.

`agentStore` still boots `base_url: api.deepseek.com` / `model_name: deepseek-v4-flash` (`agentStore.tsx:413-416`). That is the **disconnected global placeholder**, not a per-thread stamp. A new thread does not pin DeepSeek over the user's live config.

`tool_whitelist: null` = no thread lock-down (inherit tools), not empty trust.

Source test: `create-blank-thread.test.ts:5-18` rejects `provider:"deepseek"` / `model:"deepseek` in the function body.

**Poison is gone. Not a REJECT.**

---

## 5. Cruise 解除 still one-click

`StatusRail.tsx:238-252`:

- Chip text: `trustStatusChipShort` → 「值守」/「巡航」 (`autopilot-tier.ts:89-96`)
- `title` / `aria-label`: full `trustStatusChip` + 「点击解除」/「左键解除」
- **`onClick={disarmCruise}`** — not title-only
- `disarmCruise` (`:177-181`): `security.unattended.disarm` `clear_cruise: true` + `config.set(disarmAllFlags())`

SafetyStrip **full** path also has a 解除 button (`SafetyStrip.tsx:220-228`, abort-while-armed `:112-114,:215-217`). Compact FocusBand path does **not** paint the cruise row (except abort-while-armed). Rail chip remains the one-click control on empty L1. That matches the Cruise DoD.

Right-click opens security settings (`:244-247`) — does not steal left-click 解除.

**解除 is a click, not a tooltip. Not a REJECT.**

---

## 6. Findings

| ID | Sev | File:line | Note |
|----|-----|-----------|------|
| S-01 | P2 | `App.tsx:2180-2185` + `tokens.ts:20` | Legal trust line「确认后才会执行危险操作」is `tokens.textMuted` `#a3a3a3` on `#ffffff` ≈ 2.5:1. DESIGN contrast policy reserves `textMuted` for decorative meta and prefers `textSecondary` for guidance. Slice DoD **asked for** `textMuted` ≥11px — size holds; the whisper is hard to read. Not buried 急停/confirm. |
| S-02 | P2 | `SafetyStrip.tsx:121-169` `wrapCompact` `maxHeight:56; overflow:hidden` | Compact L2 row does not show cruise 解除 (rail does). Abort-while-armed 解除 + 确认台 can clip on 320px nowrap. Rail chip is the backup. Fail-open for 急停 (flexShrink:0 on abort). |
| S-03 | P2 | `focus-band-priority.ts:50,78` | `hasThreadMessages` defaults **on** (`!== false`). Second caller that omits the flag re-hangs the L1 strip. Current `FocusBand.tsx:111` passes it. Confirm/急停 still win either way. |
| S-04 | nit | `create-blank-thread.test.ts:5-18` | Regex on source, not a merge/runtime assertion. Product path is correct (`message-router.ts:302-305` + companion `{}`). `useWebSocket` auto-create is untested sibling, same `{}`. |

No P0. No P1. None of the REJECT predicates fire.

### Settings when disconnected — HOLD `[inspected]`

- Gear always visible (`StatusRail.tsx:200-213`), routes to `connection`.
- Disconnected conn is a **button** to the same section (`:269-289`).
- ⋯「设置」same ternary (`:429-430`).
- Thread-drawer「设置」same (`ThreadList.tsx:1283-1296`) — R2 P3 (always-`model`) is fixed.
- `SettingsSlideout` opens on `settingsOpen` with **no** connection gate (`:426`).
- Unpaired: `isSectionEffectivelyOpen` force-opens connection (`settings-sections.ts:84`).
- Pairing paste + 配对 live in that section (`SettingsSlideout.tsx:854-879`).

### No new L2 tools — HOLD `[inspected]`

- Capability declaration: `L2-classes: none new`.
- `ComposeDrawer` refuses `panelId === "board"` (`:71-72`).
- StatusRail ⋯ has no Board Host entry (`:449-450` comment + footnote `/board`).
- No new `getToolDefinitions` names, no new `securityConfirmations.request`, no new confirm family in this chrome slice.

ADR-020: Surface L0 chrome only; Composition = 装配 entry; Autonomy stays `/board`; Trust gate unchanged (phrase-arm / one-click-disarm).

---

## 7. Trajectory

Scope matches the cut: Side Panel chrome (`StatusRail`, `FocusBand` priority, `ThreadList.createBlankThread`, empty copy, composer capsule, icons, DESIGN) + tests. No drive-by Cockpit rewrite, no new L2 class, no confirm-dialect fork.

R2 Safety residuals this slice actually closed `[inspected]`:

- ThreadList 设置 is connection-aware (was always `model`).
- Empty L1 no longer hangs `ContextStrip`.
- `IconPlus` gone; THESIS/DESIGN no 「畅所欲问」.
- Brand is left of cluster, not absolute-centered (S0.2); hidden under cruise/disconnect so it does not sit on ModeBadge.

---

## 8. Verdict rationale

REJECT if: 急停/confirm buried on empty L1; `createBlankThread` still stamps DeepSeek/empty trust; 解除 only in title with no click; new L2 tools; C″/D″ false; a claimed S1/S2 item missing from the code.

All of those are **false**. C″ and D″ hold. S1.1 / S1.3 / S2.1 / Cruise click are in the tree. Remaining items are contrast / compact-clip / default-footgun / test-shape — non-blocking.

VERDICT: APPROVE_WITH_NITS
