I'll read only that packet and follow its review instructions independently.The packet continues past the first thousand lines; I’ll keep reading so the review covers the full instructions and remaining files.I’ll continue through the rest of the packet so the verdict is based on the complete design, deltas, and evidence.# Independent closure review · #471

**Scope:** [inspected] packet design + exact r1→current deltas + provided full files/hooks/tests. [actual] log tails only. No repo walk, no unseen files, no edits. Native platform UX not certified. Unchanged ~3k relocation and AST-preserved handlers not re-reviewed. r1 Companion-green is **not** gate evidence.

**Capability [inspected]:** T3 IA/presentation. No new L2 class, protocol, default, or Agent execution. `handleSave` / `handleTest` / license accept-reject / arm phrases unchanged. Voice cancel bumps generation and cannot `run()`; hotkey listeners detach when hidden.

---

## Prior findings — close / reject

| Item | Verdict | Evidence |
|---|---|---|
| Split live region vs buttons | **CLOSE** | Status buttons are siblings; only sr-only span has `role="status"` `aria-live="polite"`. [inspected] |
| License named + inert + Tab/Esc/focus | **CLOSE** | Nested modal `ariaLabel="实验层许可证与免责声明"`; content `inert`; Esc/`onClose` clears door only (no `accepted:true`); deep-link effect queues while door open; rAF restore. [inspected] + [actual] settings-final2 |
| Save scope + close | **CLOSE** | Label「保存并关闭」; scope hint present; `handleSave` still `config.set` then `TOGGLE_SETTINGS`. [inspected] |
| Unused nav/select hidden from AT | **CLOSE** | Default `mobile-category{display:none}`; `max-width:759` `nav{display:none}`. [inspected] |
| Hover + focus-visible recipe | **CLOSE** | `bgHover`; h3/select/summary (+ existing dialog button) 2px accent. [inspected] |
| Desktop **selected** `navSelected` + weight 600 | **DO NOT CLOSE** | See NIT-1. [inspected] |
| Autonomy stays on security | **CLOSE** | Spec only; no delta moves the control; integrations copy points at 安全与信任. [inspected] |
| Pointer path | **CLOSE** | `本机与工具`. [inspected] |
| Session-index grouping + 笔记导出 | **CLOSE** | Comment + `sectionTitle` + reasoning checkbox relocated with heading. [inspected] |
| DeepSeek autonomy condition | **CLOSE** | Design 收口. |
| Composer duplicate 新对话 (r1 P1) | **CLOSE** | False-visible in r1; now `#newThreadBar`/`#chev`/`#settings` in ancestor `hidden` **outside** `.composer`. [inspected] + [actual] summoner-final: visible composer ids `attachFile,mic,sendGo`; `新对话` count === 1 |
| M1 36px summary / M3 button min | **CLOSE** | `summary` and panel buttons `min-height:36px`. [inspected] |
| Accepted NITs (status on its own page; redundant select name; dual h3) | **CLOSE as accepted** | Intentional. |

---

## New findings

### NIT-1 — Desktop nav selected recipe not evidenced
**[inspected]** Nav JSX is `aria-current="page"` only (no selected class/inline style). Provided CSS: all nav buttons `background:transparent; color:textSecondary`, then `:hover` only — no `[aria-current]` / `navSelected` / `font-weight:600` between those rules in r1 or current.

Sighted wide-nav current page is not marked in the 172px rail; orientation still comes from content `h3` + AT `aria-current` + mobile `<select>`. One-line CSS if you want the spec literal. Do not claim r2 “active recipe” fully implemented. Not a trust/function block; native UX not certified.

### NIT-2 — Blunt ` .cm-settings-panel button{min-height:36px} `
**[inspected]** Also inflates hotkey preset chips (`padding:3px 6px; font-size:10px`). Meets 36px target; visually crude.

### NIT-3 — Export page copy vs immediate checkbox
**[inspected]** 「文件与知识」description says 配置更改后点击保存. Relocated「导出 Markdown 时包含思考过程」still `dispatch(SET_EXPORT_INCLUDE_REASONING)` immediately, not via public save. Pre-existing mixed semantics; heading move is correct.

No P0 / P1 / MAJOR.

---

## Implementation checks (delta-only)

**Voice cancel [inspected + actual].** `active={assistantOpen && settingsOpen && !licenseDoor}`. Effect always `generation++` + `abort()` on inactive/unmount. `onresult`/`onerror`/`onend` no-op on stale generation → cannot execute settings commands. Explicit **停止** still `stop()` without bump, so `onend` → `run(phrase)` (spec). Fake SR: collapse aborts, late `onend` does not change `voiceDictationMode`; explicit stop does.

**Hotkey [inspected].** `active={page==="voice" && settingsOpen && !license}`. `!active` sets `capturing=false` and previous effect cleanup removes capture-phase `keydown`. Test only asserts capture UI resets after round-trip, not that model-page keys are ignored — that part is code-level.

**License [inspected + actual].** Footer/nav/save live under inert; license sibling outside. Inner overlay Tab/Esc `stopPropagation` so outer settings modal does not close. Queued `settingsFocusSection` skipped while door open, consumed after. Restore skipped if a deep-link is queued (`!settingsFocusSection`). Playwright: 5× Tab + Shift+Tab stay in license; Esc hides license, settings remains, focus returns to model placeholder, no `license_response`.

**Summoner [inspected + actual].** Three visible actions; legacy ids kept for handlers; no `.mark` / 「山」on empty reset.

**settings-web [inspected].** Comments + 中文 subtitle/section title in this delta. Color tokens not in this hunk (likely r1). Surface reflow [actual] surfaces-final; scripts not executed.

---

## Machine gate (this packet only — do not inherit r1)

| Run | Result |
|---|---|
| ext-finalbuild2 | [actual] `tsc --noEmit && plasmo build` DONE |
| ext-finaltest2 | [actual] 1281 pass, 0 fail |
| comp-lastbuild | [actual] `tsc` + copy worker |
| Companion primary | [actual] 5019 tests, **4996 pass, 0 fail, 23 skipped** |
| settings-cli | [actual] 20 pass, 0 fail |
| settings-final2 | [actual] PASS (responsive, drafts, deep-link focus, status, no implicit writes, voice cancel, hotkey hide, license kbd/focus) |
| workspace-last / summoner-final / surfaces-final | [actual] PASS |

Synthetic transport only; no live user config / installed app.

---

## Design

Category IA, keep-mounted pages, public save vs independent/immediate, license outside hidden tree, voice/hotkey cancellation, summoner three-action row, light settings-web as model-only fallback — consistent and implementable. Trust boundary held.

---

**VERDICT: APPROVE_WITH_NITS**

Design and implementation are merge-ready on this evidence. Only open item is NIT-1 (nav selected chrome not evidenced). Optional one-line CSS; not blocking.
