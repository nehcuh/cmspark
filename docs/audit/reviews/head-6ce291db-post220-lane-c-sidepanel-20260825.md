# Lane C adversary — Side Panel / chrome-extension product+UX

**Role**: Lane C — independent adversary (did **not** implement Wave 2 Product AWN; do not rubber-stamp)
**HEAD**: `6ce291db1c14b72823e26905df32bfe7d498c7e7` (`6ce291db feat: knowledge honesty Wave 0–2 + overlay HUD workbench compose (#222)`)
**Base**: `1d16b0ed8b7a8eb0fc75c529cd88e24089f9c2bb` (#220)
**Range**: PR #221 + #222 (`1d16b0ed..HEAD`)
**Frozen patch**: `docs/audit/reviews/head-6ce291db-post220-diff-20260825.patch`
**SHA256**: `19B2A2F3DFDF41F4B5A5A22DD68763C19C861E5300FCCEF7876B791489246548` — **match** `[executed]`
**Exclusive files only.** Overlay HUD Swift/HTML = Lane A. Companion skill-engine = Lane B.

```text
Surface:      L0 Side Panel chat UX (disclosure chips + confirm-import modal + related/topic_folder)
L2-classes:   (none added in exclusive files)
Compose:      knowledge (title UI + confirm-import + related≤3) ; pack still owns knowledge_ids
Autonomy:     n/a
Trust:        knowledge remains untrusted retrieved data; import HITL on file/URL/distill/attachment;
              folder-import still persist-without-preview (spec Wave 0b item 5 carve-out)
Channel:      community
```

Axes fit: chips / confirm-import / 相关 / 话题夹 hang on **Surface L0 + Compose knowledge**, not a new runtime, not L2, not overlay-as-confirm. Pack-first: PacksPanel did not grow Project/图谱 primary chrome; scene list now shows `title` and meeting-card accent only when `meeting-minutes` is active.

---

## Capability / product-noun check

User-visible chrome in exclusive files was grepped `[executed]` for: `图谱` · `类 Obsidian` · `Raycast` · `uTools` · `启动器` · `第二大脑` · `第二块` · `双链` · `Project-as-container`.

**Result: zero hits.** Graph overflow chrome was renamed `关联图谱` → **会话关系图**. List 🔗 `title` is **列表内相关**. Empty chat is still 「要对这页做什么？ / 要我帮你做什么？」 via `emptyStateCopy`, not a repo path.

Comment-only leftovers (not painted): `ThreadList.tsx:441` `Obsidian-style`; `ThreadGraphApp.tsx:1,43` `Obsidian-like` / `Obsidian-adjacent`. User-visible tooltip leftover: Knowledge folder button `title="…支持 Obsidian / iCloud vault…"` (`KnowledgeSubPanel.tsx:427`) — import-source, not 「类 Obsidian」 product metaphor. `项目` in exclusive files is workspace/repo copy (`ChatView.tsx:1039`, `PacksPanel.tsx:155,953`), not Project-as-container.

---

## MACHINE

| Check | Result |
|-------|--------|
| `git rev-parse HEAD` | `6ce291db1c14b72823e26905df32bfe7d498c7e7` `[executed]` |
| Frozen patch SHA256 | `19B2A2F3DFDF41F4B5A5A22DD68763C19C861E5300FCCEF7876B791489246548` **match** `[executed]` |
| Exclusive-file banned-noun grep (listed above) | **0 user-visible hits** `[executed]` |
| `cmspark:open-knowledge` listeners in `chrome-extension/` | **1 dispatch (ChatView), 0 listeners** `[executed]` |
| Targeted tests (cwd `chrome-extension/`, local `tsc -p tsconfig.test.json` then `node --test .test-dist/tests/markdown-breaks.test.js .test-dist/tests/thread-timeline.test.js`) | **32 pass / 0 fail** (markdown-breaks 2 + thread-timeline 30). Full `npm test` **not** run. `[executed]` |
| markdown-breaks mutation (private copy, then deleted) | Official `/breaks:\s*true/` still **passes** if **either** `marked.use({breaks:true})` **or** `marked.parse(..., breaks:true)` is stripped; dies only if **both** gone. Test does **not** import `MarkdownRenderer`. `[executed]` |
| marked GFM (library, not renderer) | `"行1\n行2"` + `breaks:true` → `<br>`; `[1] invented.md` stays text; `[^1]: invented.md` becomes `<a href="invented.md">` (reference link, not a chip). `[executed]` |

---

## Must-falsify scorecard

Default **REFUTED** until `file:line` + evidence tag. **HOLD** = implementer claim survives. **PARTIAL** = claim true on main path, hole remains.

| ID | Claim | Score | Evidence |
|----|--------|-------|----------|
| F-UX-NOUN-1 | UI must NOT say 图谱 / 类 Obsidian / Project-as-container / Raycast/uTools/启动器 / 第二大脑 / model `[n]` footnotes. Overflow/graph chrome = 会话关系图; 🔗 = 相关 | **HOLD** | User-visible rename `[executed]` grep 0 banned nouns. `ThreadList.tsx:1484-1487` `会话关系图`; `ThreadGraphApp.tsx:673,690-691,967` same. 🔗 `ThreadList.tsx:961-963` `title="列表内相关"`. Chips are buttons labeled `本轮附带 · {title}` (`ChatView.tsx:784-807`), not `[n]` footnotes. Markdown `[1]` is not footnoted; GFM ref links are pre-existing marked behavior, not chip invention. |
| F-ID-1 empty | Empty/default still 「这页 / 这轮会话」, not repo path / diff-as-home | **HOLD** | `ChatView.tsx:506-507` EmptyState; `empty-state-copy.ts` titles 「要对这页做什么？」「要我帮你做什么？」 `[inspected]`. Workspace path lives in **场景** status (`PacksPanel.tsx:948-953`) and tool-error hints (`ChatView.tsx:1031-1039`), not empty home. |
| Chips ⊆ ledger | Disclosure chips ⊆ companion `retrieved_sources`; no inventing filenames in UI | **HOLD (untested)** | `ChatView.tsx:784` only maps `msg.retrieved_sources`. `useWebSocket.ts:378-391` copies array from `chat.done` onto the assistant message. Hydrate `sanitizeHydratedMessages` (`useWebSocket.ts:153-163`) pass-through — chips after reload ⊆ companion history, not model-text parse. **No exclusive-file test pins this.** markdown-breaks does not mention `retrieved_sources` `[executed]`. |
| Confirm-import HITL | Knowledge import is confirm-import HITL; no silent ingest | **PARTIAL** | File/URL: `knowledge.preview` + modal `user_gesture: true` (`KnowledgeSubPanel.tsx:218-231,256-269`; `ChatView.tsx:624-632`). Distill: `thread.distill_preview` → same modal (`useWebSocket.ts:974-990`; `ThreadList.tsx:975-984`). Attachment 「入知识」 opens modal, does not import (`ChatView.tsx:842-866`). **Folder: `knowledge.import_directory` with no preview** (`KnowledgeSubPanel.tsx:279-287`, comment 「imports each note directly」). Result hydrates list (`useWebSocket.ts:1654-1673`). Spec Wave 0b item 5 carves native picker; F-S-3 extracted-preview is still missing on this path. |
| related ≤3 | related ≤3 visible | **HOLD** | Knowledge: `limit: 3` (`background/index.ts:902-907`) + UI `.slice(0, 3)` (`KnowledgeSubPanel.tsx:554`). Threads: `findRelatedThreads(..., 3)` + server `.slice(0, 3)` (`ThreadList.tsx:401,407,424-427`). Background `thread.related` default 5 (`background/index.ts:892-896`) is overridden by UI `limit: 3` and display cap. |
| Knowledge 「相关」 | Row button, not only behind ⋯ (Wave 2 fold) | **HOLD** | Visible sibling of ⋯ (`KnowledgeSubPanel.tsx:560-569`), not inside `menuDropdown` (`:580-588`). |
| topic_folder CTA | 话题夹 empty CTA if claimed | **HOLD** | View tab 「话题」 (`ThreadList.tsx:1381-1384`). Ungrouped CTA 「点行上的「夹」把会话放进话题夹」 (`:1307-1310`). Row 「夹」 + `window.prompt("话题夹名称…")` (`:986-1009`). Type comment `not Project` (`types.ts:69-70`). |
| Overlay relay / no SP open from companion | Overlay new types relayed if Side Panel depends; do not open Side Panel from companion | **HOLD** | Companion → UI is generic `chrome.runtime.sendMessage(msg)` (`background/index.ts:427-431`). Side Panel handles `composer.lease` + overlay standby (`useWebSocket.ts:452-454,476-482`). New UI→WS: `knowledge.related` / `thread.distill_preview` / `knowledge.preview` (`background/index.ts:902-918,1201-1203`). `chrome.sidePanel.open` only on **user** `thread_graph.open_thread` (`:1389-1408`), not on companion WS types. SW `sendMessage` does not re-enter SW `onMessage` `[inspected]`. |
| Pack-first / ADR-020 | PacksPanel / SkillCraftPanel copy must not grow primary chrome that violates Pack-first | **HOLD** | PacksPanel: meeting accent iff `meeting-minutes` (`:909-911`); knowledge checkboxes `d.title \|\| d.name` (`:1368`). SkillCraft: drop alphanumeric slug, YAML `JSON.stringify` (`SkillCraftPanel.tsx:82-103`) — identity alignment, still 「提取技能」 modal, no Project/图谱 chrome. |
| markdown-breaks | Tests pin real renderer behavior | **PARTIAL** | HEAD renderer **does** pass `breaks:true, gfm:true` (`ChatView.tsx:56,1535`) `[inspected]`. Test file only regex-scans source + runs a **separate** `marked.parse` (`markdown-breaks.test.ts:16-22`). Mutation: strip one of two `breaks:true` sites → official test still green `[executed]`. Second test is PacksPanel meeting-card source lock, not markdown. |

---

## New defects (exclusive files)

### NIT N1 — 「本轮附带」 chip click is a dead control (Wave 1 click-to-open)

`ChatView.tsx:791-793` dispatches `cmspark:open-knowledge`. Repo-wide extension grep: **no listener** (not App, not KnowledgeSubPanel, not ContextPanelHost — those listen for `open-compose` / `open-context-panel` / `open-coding-handoff`). `[executed]`

Honesty of the ledger still holds (chips are not invented). Navigation acceptance 「点击打开知识面板该条」 does not. Cursor is `pointer`; users will think it failed. Non-blocking: disclosure exists without the jump.

### NIT N2 — Folder import is persist-without-preview (silent ingest vs Wave 0b carve-out)

`KnowledgeSubPanel.tsx:279-287` sends `knowledge.import_directory` after native picker; no `SET_KNOWLEDGE_PREVIEW`, no `user_gesture` confirm modal. `[inspected]`

Spec Wave 0b item 5 says keep native picker. F-S-3 still wants extracted preview. Up to 200 notes can land with only a folder-pick gesture. Not REJECT: carved out in locked spec; file/URL/distill/attachment **were** converted this range (`1d16b0ed..HEAD` KnowledgeSubPanel/ChatView diffs `[executed]`).

Tooltip at `:427` still says 「支持 Obsidian / iCloud vault」 — import-source, not 类 Obsidian product noun.

### NIT N3 — Confirm is enabled on placeholder / failed preview

Optimistic modal uses `preview: "正在解析…"` / `"正在抓取…"` (`KnowledgeSubPanel.tsx:223,264`) and **does not disable** 「确认导入」 (`ChatView.tsx:621-636`). User can persist before extracted markdown arrives.

Preview `error` handler sets `payload: {}` (`useWebSocket.ts:1851-1855`); `SET_KNOWLEDGE_PREVIEW` treats own `payload` as replacement (`agentStore.tsx:934-936`) and **wipes** the file/url payload. Modal still offers 确认导入. `[inspected]`

### NIT N4 — markdown-breaks / chip ⊆ ledger are not mutation-killed product tests

`markdown-breaks.test.ts` pins **source strings**, not `MarkdownRenderer`. Meeting-card test is unrelated to breaks. **Zero** exclusive tests for: chips ⊆ `retrieved_sources`, confirm-import `user_gesture`, related cap, dead `open-knowledge`. `[executed]`

### NIT N5 — Thread list chrome density (non-noun)

Wave 2 added per-row 「知识」「夹」 beside existing 🔗 🏷 🧠 🗑️ (`ThreadList.tsx:953-1035`). Nouns are legal. 320px side panel will overflow; not a banned-noun fail.

---

## Confirmed-safe (exclusive files)

- **Nouns**: graph chrome = 会话关系图; 🔗 = 相关; no Raycast/uTools/启动器/第二大脑/图谱 in painted UI `[executed]`.
- **Empty home**: this-page / this-thread, not workspace-as-home `[inspected]`.
- **Chips ⊆ ledger**: UI does not parse model text or filenames into chips (`ChatView.tsx:784`) `[inspected]`.
- **Main import HITL**: file, URL, distill, chat-document 「入知识」 all go through `KnowledgeImportModal` + `user_gesture: true` `[inspected]`.
- **related ≤3** on both knowledge and thread list `[inspected]`.
- **Knowledge 「相关」** is a row button (`KnowledgeSubPanel.tsx:560-569`) `[inspected]`.
- **话题夹** tab + empty CTA + `topic_folder` strip (`ThreadList.tsx:992-996`) — not Project `[inspected]`.
- **Background relay**: new types forwarded; companion cannot `sidePanel.open` via WS generic forward `[inspected]`.
- **Pack-first**: PacksPanel/SkillCraftPanel did not add a fourth container or graph as primary chrome; CJK skill name no longer client-collapsed to `--` (`SkillCraftPanel.tsx:82-85`) `[inspected]`.
- **Renderer at HEAD** actually sets GFM breaks (`ChatView.tsx:56,1535`) even though the test is weak `[inspected]`.
- **ChatView always mounted** (`App.tsx:237` out-of-range context) so distill/import modal is reachable from ThreadList `[inspected]`.

---

VERDICT: APPROVE_WITH_NITS
