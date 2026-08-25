# Lane C r2 — Side Panel / chrome-extension (P1-fold adversary)

**Role**: Lane C r2 — independent adversary (did **not** implement Wave 2 AWN or the P1 fold; do not rubber-stamp r1)
**Prior**: `docs/audit/reviews/head-6ce291db-post220-lane-c-sidepanel-20260825.md` → **APPROVE_WITH_NITS** (nits×5; folder HITL **PARTIAL**)
**This pass**: falsify “P1 fold did not touch chrome-extension”; replay F-UX-NOUN-1 / chips ⊆ ledger / related≤3 / HITL import
**HEAD**: `6ce291db1c14b72823e26905df32bfe7d498c7e7` (`6ce291db feat: knowledge honesty Wave 0–2 + overlay HUD workbench compose (#222)`)
**Worktree fold** (not committed): companion-only dirty files vs HEAD — `content-sanitizer.ts`, `skill-engine.ts`, `distill.ts`, `tests/distill.test.ts`, `tests/skill-engine.test.ts` (+ `memory/session.md`). **No chrome-extension path.**
**Exclusive files only.** Overlay HUD = Lane A. Companion skill-engine/distill = Lane B.

```text
Surface:      L0 Side Panel chat UX (disclosure chips + confirm-import modal + related/topic_folder)
L2-classes:   (none added in exclusive files; P1 fold added none here)
Compose:      knowledge (title UI + confirm-import + related≤3) ; pack still owns knowledge_ids
Autonomy:     n/a
Trust:        knowledge remains untrusted retrieved data; import HITL on file/URL/distill/attachment;
              folder-import still persist-without-preview (spec Wave 0b item 5 carve-out)
Channel:      community
```

Axes fit unchanged vs r1: chips / confirm-import / 相关 / 话题夹 hang on **Surface L0 + Compose knowledge**. Pack-first: PacksPanel still has no Project/图谱 primary chrome.

---

## 1. Falsify “P1 fold did not touch chrome-extension”

**Claim (implementer)**: P1 fold is companion-only; exclusive chrome-extension paths vs HEAD must be empty.

**Exclusive paths** (r1 list + tests):

- `chrome-extension/src/sidepanel/components/ChatView.tsx`
- `chrome-extension/src/sidepanel/components/KnowledgeSubPanel.tsx`
- `chrome-extension/src/sidepanel/components/PacksPanel.tsx`
- `chrome-extension/src/sidepanel/components/SkillCraftPanel.tsx`
- `chrome-extension/src/sidepanel/components/ThreadList.tsx`
- `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`
- `chrome-extension/src/sidepanel/store/agentStore.tsx`
- `chrome-extension/src/sidepanel/types.ts`
- `chrome-extension/src/sidepanel/utils/thread-timeline.ts`
- `chrome-extension/src/thread-graph/ThreadGraphApp.tsx`
- `chrome-extension/src/background/index.ts`
- `chrome-extension/tests/markdown-breaks.test.ts`
- `chrome-extension/tests/thread-timeline.test.ts`

**Result: FAILED TO FALSIFY — claim HOLDS.** `[executed]`

| Check | Result |
|-------|--------|
| `git rev-parse HEAD` | `6ce291db1c14b72823e26905df32bfe7d498c7e7` |
| `git diff --exit-code HEAD -- <exclusive 13>` | **exit 0** (empty) |
| `git diff --name-only HEAD -- chrome-extension/` | **empty** (whole tree, not just exclusive) |
| `git status --porcelain -- chrome-extension/` | **empty** |
| worktree `git hash-object` vs `git rev-parse HEAD:<path>` | **13/13 MATCH** |
| dirty vs HEAD | `companion/` (5) + `memory/session.md` only |

There is **no exclusive-file diff to review**. Live Side Panel code is the same blob set r1 scored at `6ce291db`. Replay below is against those HEAD blobs, not a fold delta.

---

## MACHINE

| Check | Result |
|-------|--------|
| HEAD | `6ce291db1c14b72823e26905df32bfe7d498c7e7` `[executed]` |
| Exclusive vs HEAD | **empty** (13/13 blob MATCH) `[executed]` |
| Frozen patch SHA256 | `19B2A2F3DFDF41F4B5A5A22DD68763C19C861E5300FCCEF7876B791489246548` **match** (`certutil`) `[executed]` — range artefact; fold is uncommitted companion |
| Exclusive-file banned-noun grep (`图谱` · `类 Obsidian` · `Raycast` · `uTools` · `启动器` · `第二大脑` · `第二块` · `双链` · `Project-as-container`) | **0 hits** on all 13 exclusive files + whole `chrome-extension/src` for that regex `[executed]` |
| `cmspark:open-knowledge` in `chrome-extension/` | **1 dispatch** (`ChatView.tsx:792`), **0 listeners** `[executed]` |
| Targeted tests (cwd `chrome-extension/`, `tsc -p tsconfig.test.json` then `node --test .test-dist/tests/markdown-breaks.test.js .test-dist/tests/thread-timeline.test.js`) | **32 pass / 0 fail** (markdown-breaks 2 + thread-timeline 30). Full `npm test` **not** run. tsc 5.9.3 exit 0. `[executed]` |
| markdown-breaks mutation (private copy under `.tmp-adv-r2-c/`, then deleted) | HEAD source has **2** `/breaks:\s*true/` sites. Strip **either** `marked.use({breaks:true})` **or** `marked.parse(..., breaks:true)` → official regex still **passes**. Strip **both** → regex **fails**. Test file does **not** mention `MarkdownRenderer` and does **not** import `ChatView`. `[executed]` |
| marked GFM (library, not renderer) | `"行1\n行2"` + `breaks:true` → `<p>行1<br>行2</p>`. `[1] invented.md` stays text. Lone `[^1]: invented.md` / `[1]: invented.md` parse to **empty** (definition consumed). `see [1]\n\n[1]: invented.md` → `<a href="invented.md">1</a>` (reference link, not a chip). `[executed]` |

---

## Must-falsify scorecard (replay)

Default **REFUTED** until `file:line` + evidence tag. **HOLD** = implementer/r1 claim survives this pass. **PARTIAL** = claim true on main path, hole remains.

| ID | Claim | Score | Evidence |
|----|--------|-------|----------|
| Fold ⊄ CE | P1 fold did not touch chrome-extension | **HOLD** | Empty `git diff` + 13/13 blob MATCH `[executed]`. Dirty tree is companion skill-engine/distill/sanitizer + tests. |
| F-UX-NOUN-1 | UI must NOT say 图谱 / 类 Obsidian / Project-as-container / Raycast/uTools/启动器 / 第二大脑 / model `[n]` footnotes. Overflow/graph chrome = 会话关系图; 🔗 = 相关 | **HOLD** | Exclusive grep **0** banned nouns `[executed]`. `ThreadList.tsx:1484-1487` `会话关系图`; `ThreadGraphApp.tsx:673,690-691,967` same. 🔗 `ThreadList.tsx:961-963` `title="列表内相关"`. Chips are buttons `本轮附带 · {title}` (`ChatView.tsx:784-807`), not `[n]` footnotes. Comment leftovers still not painted: `ThreadList.tsx:441` `Obsidian-style`; `ThreadGraphApp.tsx:1,43` `Obsidian-like` / `Obsidian-adjacent`. Tooltip leftover: `KnowledgeSubPanel.tsx:427` `支持 Obsidian / iCloud vault` — import-source, not 「类 Obsidian」 product metaphor. `项目` at `ChatView.tsx:1039` / `PacksPanel.tsx:155,953` is workspace/repo copy, not Project-as-container. |
| F-ID-1 empty | Empty/default still 「这页 / 这轮会话」, not repo path / diff-as-home | **HOLD** | `ChatView.tsx:506-507` EmptyState; `ChatView.tsx:1675-1676` calls `emptyStateCopy(level)` — titles 「要对这页做什么？」「要我帮你做什么？」 (`empty-state-copy.ts`, out-of-exclusive inspect). Workspace path lives in **场景** status (`PacksPanel.tsx:948-953`) and tool-error hints (`ChatView.tsx:1031-1039`), not empty home. |
| Chips ⊆ ledger | Disclosure chips ⊆ companion `retrieved_sources`; no inventing filenames in UI | **HOLD (untested)** | `ChatView.tsx:784` only maps `msg.retrieved_sources`. `useWebSocket.ts:378-391` copies array from `chat.done` onto the assistant message. Hydrate `sanitizeHydratedMessages` (`useWebSocket.ts:153-163`) pass-through; `thread.messages` / fork apply it (`:1081`, `:1218`) — chips after reload ⊆ companion history, not model-text parse. **Zero** exclusive tests mention `retrieved_sources` `[executed]`. GFM `[1] invented.md` is not a chip. |
| Confirm-import HITL | Knowledge import is confirm-import HITL; no silent ingest | **PARTIAL** | File/URL: `knowledge.preview` + modal `user_gesture: true` (`KnowledgeSubPanel.tsx:218-231,256-269`; `ChatView.tsx:621-632`). Distill: `thread.distill_preview` → same modal (`useWebSocket.ts:974-990`; `ThreadList.tsx:975-984`). Attachment 「入知识」 opens modal, does not import (`ChatView.tsx:842-866`). **Folder: `knowledge.import_directory` with no preview** (`KnowledgeSubPanel.tsx:279-287`, comment 「imports each note directly」). Result hydrates list (`useWebSocket.ts:1654-1673`). Spec Wave 0b item 5 carves native picker; F-S-3 extracted-preview is still missing on this path. Fold did not (and could not) close this hole in CE. |
| related ≤3 | related ≤3 visible | **HOLD** | Knowledge: SW `limit: 3` (`background/index.ts:902-907`) + UI `.slice(0, 3)` (`KnowledgeSubPanel.tsx:554`). Threads: `findRelatedThreads(..., 3)` + server `.slice(0, 3)` (`ThreadList.tsx:401,407,424-427`); panel maps `relatedHits` (`:1537-1542`). Background `thread.related` default 5 (`background/index.ts:892-896`) is overridden by UI `limit: 3` and display cap. Store of raw `d.related` (`KnowledgeSubPanel.tsx:48`; `ThreadList.tsx:435`) is uncapped; **paint** is capped. |
| Knowledge 「相关」 | Row button, not only behind ⋯ | **HOLD** | Visible sibling of ⋯ (`KnowledgeSubPanel.tsx:560-569`), not inside `menuDropdown` (`:580-588`). |
| topic_folder CTA | 话题夹 empty CTA if claimed | **HOLD** | View tab 「话题」 (`ThreadList.tsx:1381-1384`). Ungrouped CTA 「点行上的「夹」把会话放进话题夹」 (`:1307-1310`). Row 「夹」 + `window.prompt("话题夹名称…")` (`:986-1009`). Type comment `not Project` (`types.ts:69-70`). |
| Overlay relay / no SP open from companion | Overlay new types relayed if Side Panel depends; do not open Side Panel from companion | **HOLD** | Generic `chrome.runtime.sendMessage(msg)` forward is background; new UI→WS: `knowledge.related` / `thread.distill_preview` / `knowledge.preview` / `knowledge.import_directory` (`background/index.ts:902-918,1201-1203`). `chrome.sidePanel.open` only on **user** `thread_graph.open_thread` (`:1389-1408`) and ThreadGraphApp user path — not on companion WS types. |
| Pack-first / ADR-020 | PacksPanel / SkillCraftPanel copy must not grow primary chrome that violates Pack-first | **HOLD** | PacksPanel: meeting accent iff `meeting-minutes` (`:909-911`); knowledge checkboxes `d.title \|\| d.name` (`:1368`). SkillCraft: YAML `JSON.stringify` name (`SkillCraftPanel.tsx:82-103`) — identity alignment, still 「提取技能」 modal, no Project/图谱 chrome. Fold did not retouch these files. |
| markdown-breaks | Tests pin real renderer behavior | **PARTIAL** | HEAD renderer **does** pass `breaks:true, gfm:true` (`ChatView.tsx:56,1535`) `[inspected]`. Test only regex-scans source + runs a **separate** `marked.parse` (`markdown-breaks.test.ts:16-22`). Mutation: strip one of two `breaks:true` sites → official test still green `[executed]`. Second test is PacksPanel meeting-card source lock, not markdown. |

---

## New defects (exclusive files)

**None introduced by the P1 fold** — fold never entered this lane. r1 nits are **still live** because CE blobs are identical.

### NIT N1 — 「本轮附带」 chip click is a dead control (Wave 1 click-to-open) — UNCHANGED

`ChatView.tsx:791-793` dispatches `cmspark:open-knowledge`. Repo-wide extension grep: **no listener** (App listens `open-compose` / `open-coding-handoff`; ContextPanelHost listens `open-context-panel`; KnowledgeSubPanel listens `knowledge_related`). `[executed]`

Honesty of the ledger still holds. Navigation acceptance 「点击打开知识面板该条」 does not. Cursor is `pointer`. Non-blocking.

### NIT N2 — Folder import is persist-without-preview — STILL PARTIAL

`KnowledgeSubPanel.tsx:279-287` sends `knowledge.import_directory` after native picker; no `SET_KNOWLEDGE_PREVIEW`, no `user_gesture` confirm modal. `[inspected]`

Spec Wave 0b item 5 keeps native picker. F-S-3 extracted-preview still missing. Up to 200 notes can land with only a folder-pick gesture. **Not REJECT**: carved out in locked spec; file/URL/distill/attachment remain HITL. Tooltip `:427` still 「支持 Obsidian / iCloud vault」 — import-source, not banned product noun.

### NIT N3 — Confirm is enabled on placeholder / failed preview — UNCHANGED

Optimistic modal uses `preview: "正在解析…"` / `"正在抓取…"` (`KnowledgeSubPanel.tsx:223,264`) and **does not disable** 「确认导入」 (`ChatView.tsx:621-636`).

Preview `error` handler sets `payload: {}` (`useWebSocket.ts:1851-1855`); `SET_KNOWLEDGE_PREVIEW` treats own `payload` as replacement (`agentStore.tsx:934-936`) and **wipes** the file/url payload. Modal still offers 确认导入. `[inspected]`

### NIT N4 — markdown-breaks / chip ⊆ ledger are not mutation-killed product tests — UNCHANGED

`markdown-breaks.test.ts` pins **source strings**, not `MarkdownRenderer`. Meeting-card test is unrelated to breaks. **Zero** exclusive tests for: chips ⊆ `retrieved_sources`, confirm-import `user_gesture`, related cap, dead `open-knowledge`. `[executed]`

### NIT N5 — Thread list chrome density (non-noun) — UNCHANGED

Per-row 「知识」「夹」 beside 🔗 🏷 🧠 🗑️ (`ThreadList.tsx:953-1035`). Nouns are legal. 320px side panel will overflow; not a banned-noun fail.

---

## Confirmed-safe (exclusive files, r2 replay)

- **Fold ⊄ CE**: implementer claim HOLDS; nothing to re-diff in this lane `[executed]`.
- **Nouns**: graph chrome = 会话关系图; 🔗 = 相关; banned-noun regex 0 in exclusive files `[executed]`.
- **Empty home**: this-page / this-thread, not workspace-as-home `[inspected]`.
- **Chips ⊆ ledger**: UI does not parse model text or filenames into chips (`ChatView.tsx:784`) `[inspected]`.
- **Main import HITL**: file, URL, distill, chat-document 「入知识」 all go through `KnowledgeImportModal` + `user_gesture: true` `[inspected]`.
- **related ≤3** on both knowledge and thread list paint `[inspected]`.
- **Knowledge 「相关」** is a row button `[inspected]`.
- **话题夹** tab + empty CTA + `topic_folder` strip — not Project `[inspected]`.
- **Background relay**: new types forwarded; companion cannot `sidePanel.open` via WS generic forward `[inspected]`.
- **Pack-first**: PacksPanel/SkillCraftPanel did not add a fourth container or graph as primary chrome `[inspected]`.
- **Renderer at HEAD** actually sets GFM breaks (`ChatView.tsx:56,1535`) even though the test is weak `[inspected]`.
- **ChatView always mounted** (`App.tsx:237` out-of-range context) so distill/import modal is reachable from ThreadList `[inspected]`.

---

## Out of slice (do not score)

Companion P1-1/2/3 fold (`skill-engine.ts` / `distill.ts` / `content-sanitizer.ts`) is Lane B exclusive. CE still hydrates `knowledge.import_directory_result` as a docs dump (`useWebSocket.ts:1654-1673`); any identity/overwrite change is companion-owned and not re-litigated here.

---

VERDICT: APPROVE_WITH_NITS
