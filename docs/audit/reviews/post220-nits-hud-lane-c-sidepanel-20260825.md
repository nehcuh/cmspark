# Lane C — Side Panel nits (independent adversary)

| Field | Value |
| --- | --- |
| Lane | C (independent adversary — Side Panel / chrome-extension). Did **not** implement the nits fold or the HUD restyle. |
| Date | 2026-08-25 |
| Range | `d4cbbfae..8f5c94c6` |
| HEAD | `8f5c94c6325a9bd1081a6cc400062532e81d71ff` **[executed]** `git rev-parse HEAD` |
| Base | `d4cbbfaefe38ce32dd6e0bc771bcab2c32f07c13` **[executed]** |
| Frozen patch | `docs/audit/reviews/post220-nits-hud-diff-20260825.patch` |
| Frozen SHA256 | `AB1D1A1285F558BE52A86D5A1F5A6B8EDB5BC671F565348337B7240F6EFE6825` |
| Exclusive files | `chrome-extension/src/sidepanel/components/ChatView.tsx` · `ContextPanelHost.tsx` · `KnowledgeSubPanel.tsx` · `hooks/useWebSocket.ts` · `utils/markdown-gfm.ts` · `tests/markdown-breaks.test.ts` |
| Prior (context only, not proof) | `head-6ce291db-post220-p1-r2-lane-c-sidepanel-20260825.md` APPROVE_WITH_NITS (N1 dead `open-knowledge` · N2 folder silent · N3 confirm enabled on placeholder/fail · N4 markdown-breaks not mutation-killed) |
| Default | REFUTED until `file:line` + `[executed]` / `[inspected]` |
| Production edits this lane | **none**. Private `chrome-extension/.tmp-adv-nits-hud-c/` only; deleted after. |

Capability (implementer claim — challenged below; **this lane is not the HUD restyle**):

```text
Surface:      L0 Side Panel (chip → knowledge panel, confirm-import disable, folder confirm, GFM breaks)
L2-classes:   none in exclusive files
Compose:      knowledge (open-knowledge / confirm-import / folder native picker)
Autonomy:     n/a
Trust:        confirm-import blocked on 正在解析/正在抓取/预览失败; error no longer replaces payload with {};
              folder path is HITL confirm + native picker, not extracted preview (Wave 0b item 5 carve-out)
Channel:      community
```

Blast: **T2**. Escalate to T3 only if exclusive files grew overlay Allow/Deny, skipped confirm, or opened `knowledge.import` without a gesture. **No T3 trigger found.**

---

## Frozen patch vs live HEAD **[executed]**

`Get-FileHash -Algorithm SHA256` of `docs/audit/reviews/post220-nits-hud-diff-20260825.patch` =
`AB1D1A1285F558BE52A86D5A1F5A6B8EDB5BC671F565348337B7240F6EFE6825` — **match**.

`git diff d4cbbfae..HEAD --stat -- ':!docs/audit' ':!memory'` = **21 files, +381/−139** (matches shared prompt).

Exclusive 6-file `--stat`: **+63/−12**.

Commits in range: `7ec76d78` (nits fold) then `8f5c94c6` (Windows C-thin HUD). HUD / companion history / summoner-web are **other lanes**. This report scores only the six exclusive paths.

---

## MACHINE **[executed]**

Cwd: `chrome-extension/`. TypeScript **5.9.3** via `node .\node_modules\typescript\bin\tsc`.

**Mandatory command:**

```text
node .\node_modules\typescript\bin\tsc -p tsconfig.test.json
→ TSC_EXIT=0

node --test .test-dist/tests/markdown-breaks.test.js
→ tests 2 / pass 2 / fail 0 / duration_ms 63.4568
   ✔ ChatView marked uses GFM breaks (single newline → hard break)
   ✔ PacksPanel meeting card accent only when meeting-minutes is active
```

`tsc` followed the new test import and emitted `.test-dist/src/sidepanel/utils/markdown-gfm.js` (`CHAT_MARKED_OPTIONS = { gfm: true, breaks: true }`). Full `npm test` **not** run.

### Mutation-kill (private `.tmp-adv-nits-hud-c/`, production untouched, then deleted)

**MUT1 — claimed pin: drop `markdown-gfm` import from ChatView → official source asserts red.**

Copied `ChatView.tsx`; deleted only `import { CHAT_MARKED_OPTIONS } from "../utils/markdown-gfm"`. Left `marked.use(CHAT_MARKED_OPTIONS)` and the parse spread. Replayed the official pins against that copy (live ChatView as CONTROL):

```text
✔ CONTROL live ChatView still matches official pins
✖ MUT drop import from ChatView copy → official source pins red
  AssertionError: The input did not match /from ["']\.\.\/utils\/markdown-gfm["']/
MUT_EXIT=1  (1 pass / 1 fail)
```

Claimed mutation is load-bearing. **[executed]**

Temp dir `Test-Path .tmp-adv-nits-hud-c` after `Remove-Item` = **False**. Exclusive `git status --porcelain` = **empty**.

---

## Must-falsify scorecard

Default **REFUTED** until `file:line` + evidence tag. **HOLD** = implementer claim survives. **PARTIAL** = claim true on the main path, hole remains.

| ID | Claim | Score | Evidence |
|----|--------|-------|----------|
| 1. open-knowledge listener | `cmspark:open-knowledge` has a listener that opens the knowledge panel (`ContextPanelHost`) | **HOLD** (focus **PARTIAL**) | Dispatch `ChatView.tsx:798-800`. Listener always-on in `ContextPanelHostProvider` (`ContextPanelHost.tsx:204-216`): `setActivePanel("knowledge")` + `loadPanelData("knowledge", …)` + optional `cmspark:focus-knowledge`. Provider wraps App (`App.tsx:218`, out-of-exclusive inspect). Repo grep: **1 dispatch + 1 listener**. Panel body mounts `KnowledgeSubPanel` only when `activePanel === "knowledge"` (`:274`). |
| 2. Folder import HITL | `window.confirm` before `knowledge.import_directory` + `user_gesture: true`. Not full extracted preview (Wave 0b carve-out). Score HITL vs silent. | **HOLD vs silent** (preview still carved out) | `KnowledgeSubPanel.tsx:301-305`: confirm copy names the native picker and 「每篇不单独预览，最多 200 个文件」; cancel `return`s; then `sendMessage({ type: "knowledge.import_directory", user_gesture: true })`. No `SET_KNOWLEDGE_PREVIEW` on this path. Result hydrates list (`useWebSocket.ts:1654-1673`). Spec Wave 0b item 5: native picker, ignore WS `path`. vs F-S-3 extracted-preview: still not that path — **not scored silent**. |
| 3. Confirm disabled + no payload wipe | Confirm import disabled on 正在解析/正在抓取/预览失败; error handler does not wipe payload to `{}` | **HOLD** | Disable: `ChatView.tsx:624-628` exact `正在解析…` / `正在抓取…` (optimistic `KnowledgeSubPanel.tsx:238,279`) + `startsWith("预览失败")` + missing `file\|url\|content`. Error: `useWebSocket.ts:1851-1855` now `{ preview: \`预览失败：${msg.error}\` }` — **no** `payload` key. Reducer (out-of-exclusive inspect, load-bearing) `agentStore.tsx:934-936`: omit `payload` → keep `prev.payload`; explicit `payload: {}` was the wipe. Exclusive grep `payload: {}` = **0**. Confirm stays disabled via `startsWith("预览失败")` even with payload preserved. |
| 4. CHAT_MARKED_OPTIONS | ChatView uses `CHAT_MARKED_OPTIONS` from `markdown-gfm`; test imports that module; drop import from ChatView → test red | **HOLD** (renderer still unimported) | Module `markdown-gfm.ts:3`. ChatView import `:43`, `marked.use(CHAT_MARKED_OPTIONS)` `:57`, parse spread `:1542`. Test import `markdown-breaks.test.ts:6` + pins `:18-23`. MUT1 **[executed]** red. Residual: test still `fs.readFileSync` + a **separate** `marked.parse`; does not import `MarkdownRenderer`. Unused import (identifier present, parse reverted to literals) would still green — see NIT N4. |
| 5. F-UX-NOUN-1 | Exclusive files still have no 图谱 / Raycast | **HOLD** | **[executed]** grep of all 6 exclusive files for `图谱` · `Raycast` · `uTools` · `启动器` · `第二大脑` · `第二块` · `双链` · `类 Obsidian` · `Project` = **0 hits**. Leftover tooltip `KnowledgeSubPanel.tsx:445` 「支持 Obsidian / iCloud vault」 is import-source, not 「类 Obsidian」 product metaphor (same call as r2). `ChatView.tsx:1046` 「真实项目」 is workspace/repo copy, not Project-as-container. Chips are `本轮附带 · {title}` (`:792-811`), not `[n]` footnotes. `CONTEXT_PANEL_TABS` knowledge label is 「知识」 (`ContextPanelHost.tsx:62`). |

---

## New / residual defects (exclusive files)

### NIT N1 — chip opens the knowledge **panel**; 「该条」 focus is racy if the panel was closed

Wave 1 acceptance is 「点击打开知识面板该条」. Opening HOLDS. Highlight/scroll does not, on the common path:

1. `onKnowledge` (`ContextPanelHost.tsx:204-210`) calls `setActivePanel("knowledge")` then **synchronously** `dispatchEvent("cmspark:focus-knowledge")`.
2. `KnowledgeSubPanel` (the only `cmspark:focus-knowledge` listener, `:52-65`) mounts **only** when `activePanel === "knowledge"` (`:274`).
3. No `flushSync`. The focus event fires before the listener exists. `focusId` stays `null`. `requestAnimationFrame` inside `onFocus` never runs.

If the knowledge panel is **already** open, the listener is mounted and `data-knowledge-id` + outline (`:511-517`) work. Cursor is still `pointer`. **Not REJECT**: must-falsify (1) is the listener that **opens** the panel, and that listener exists. Residual of r2 N1, not a dead control.

### NIT N2 — folder path is HITL, still not extracted preview (carve-out, honest copy)

`window.confirm` + native picker is two gestures. Confirm text tells the user notes are not previewed. `user_gesture: true` is sent; companion `knowledge.import_directory` does **not** read that flag (out of exclusive; router opens `pickFolderNative()` regardless). UI is no longer silent. Do not re-litigate Wave 0b item 5.

### NIT N3 — disable pins are exact-string, not a preview-state enum

`正在解析…` / `正在抓取…` use `===`. `预览失败` uses `startsWith`. A copy tweak (ellipsis, extra suffix) would re-enable 确认导入 while `payload` is still live. Current optimistic strings match. No product test for the disabled matrix.

### NIT N4 — markdown-breaks is a shared-constant + import-path pin, not a renderer test

MUT1 kills **drop import**. It does **not** kill:

- keep the import, revert `marked.parse` to `{ async: false, breaks: true, gfm: true }` (identifier still matches);
- `breaks: false` in ChatView-local options while `CHAT_MARKED_OPTIONS` stays true.

Second test is still PacksPanel meeting-card source lock, not markdown. **Zero** exclusive tests for chips ⊆ `retrieved_sources`, confirm-import disable, or `open-knowledge` listener. Stronger than r2 (one constant cannot go stale) — still not `MarkdownRenderer`.

---

## Confirmed-safe (exclusive files this increment)

- **open-knowledge is no longer a dead control** for *opening* the knowledge panel `[inspected]` + grep `[executed]`.
- **Folder import is HITL vs silent** (`window.confirm` gate) `[inspected]`.
- **确认导入 cannot fire on placeholder / failed preview** with current copy strings `[inspected]`.
- **Error path no longer replaces payload with `{}`** `[inspected]` (reducer keep-prev is out-of-exclusive but matches the omit-key shape).
- **GFM breaks** shared `CHAT_MARKED_OPTIONS`; ChatView uses it at `use` and `parse`; test imports the module; drop-import MUT red `[executed]`.
- **F-UX-NOUN-1** 图谱/Raycast absent from exclusive files `[executed]`. Related paint still `.slice(0, 3)` + row button 「相关」 (`KnowledgeSubPanel.tsx:578-595`) — no regression of folded related≤3.
- **Chips still ⊆ `msg.retrieved_sources`** (`ChatView.tsx:791-811`); no model-text filename parse `[inspected]`.
- **No T3**: exclusive diff adds no Allow/Deny, no confirm skip, no overlay `knowledge.import` `[inspected]`.

---

## Out of slice (do not score)

- Windows C-thin HTML restyle / Mac NSPanel (`8f5c94c6`) — HUD lanes.
- Companion `knowledge.import_directory` validate-requires-`path` vs F-I-7 ignore-client-path / native picker (pre-existing; not in exclusive delta).
- Companion `user_gesture` enforcement on `knowledge.import*` (Wave 0b: this Wave does not 400 missing gesture).
- D-N3 drain peek/take TOCTOU.
- `agentStore.tsx` reducer itself (inspected only as the merge contract for exclusive error payload).
- PacksPanel / ThreadList / ThreadGraphApp (not exclusive this round). Nouns replay limited to the six files.

---

## Scores

| Axis | Score | Note |
| --- | --- | --- |
| Outcome | HOLD | Five must-falsify claims observed at `file:line`; MUT1 kills drop-import; MACHINEs green |
| Trajectory | HOLD | Exclusive +63/−12 is the r2 N1–N4 fold. No drive-by HUD/L2/Trust dialect in these files |
| Component | HOLD | Hotspots `ContextPanelHost.tsx:204-216`, `KnowledgeSubPanel.tsx:301-305`, `ChatView.tsx:43,57,624-628,798-800,1542`, `useWebSocket.ts:1851-1855`, `markdown-gfm.ts:3` match the claims |

Eval gate card — `post220-nits-hud` Lane C Side Panel slice:

**Blast tier**: T2
**MACHINE**: PASS (`tsc` 5.9.3 exit 0; markdown-breaks 2/2; MUT1 red as claimed)
**ADVERSARY (this lane)**: APPROVE_WITH_NITS
**T3 escalate**: no

---

## Verdict rationale

Independent of the implementer session. r2 N1–N3 product holes in this exclusive set were folded: `open-knowledge` now has a Host listener that opens 「知识」; folder import is confirm-gated rather than silent; 确认导入 is disabled on the three preview placeholders/failures and the error handler no longer writes `payload: {}`. N4 is a shared `CHAT_MARKED_OPTIONS` module and the specified drop-import mutation fails. F-UX-NOUN-1 still has no 图谱/Raycast in exclusive files. Residuals are the closed-panel focus race (「该条」), exact-string disable pins, and a source-scan markdown test that still does not import `MarkdownRenderer` — not steal, not silent ingest, not banned nouns.

VERDICT: APPROVE_WITH_NITS
