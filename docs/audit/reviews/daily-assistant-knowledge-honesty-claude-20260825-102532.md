All spot-checks complete. Here is my review.

---

# Dual review: Daily Assistant · Knowledge Honesty (design SoT)

**Stage**: pre-implementation docs diff (3 new files, +385, no code changes). Patch file matches live `git status`/staged diff — not stale.

## 1. Factual spot-checks — all claims TRUE [inspected]

| Claim | Verdict | Evidence |
|---|---|---|
| (a) CJK-only name throws alphanumeric | **TRUE** | `companion/src/skills/skill-engine.ts:1307-1309` — `name.replace(/[^a-zA-Z0-9-]/g,"-")` turns pure-CJK into `-` → throw "Use alphanumeric characters". Prompt said ~1307; throw is at 1309 (within drift) |
| (b) RAG chunk path skips sanitizer | **TRUE** | `skill-engine.ts:683-687` — `searchChunks` results joined and returned **raw**; `sanitizeKnowledgeContent` only on the truncate path at `:694`. Prompt said ~684 — exact |
| (c) Overlay allowlist has no `knowledge.*` | **TRUE** | `companion/src/summoner-web.ts:18-33` — `SUMMONER_WEB_DISPATCH_ALLOW` = system/chat/thread/mcp.list/pack/file.upload/composer.lease only |
| (d) Companion cannot open Side Panel | **TRUE** | `companion/src/platform.ts:148-157` (macOS `openSidePanel` only activates Chrome; comment: "cannot be opened programmatically"); `summoner/client.ts:232-243` `attachChromeOnly` never calls it; test lock exists at `companion/tests/summoner-client.test.ts:420-434` ("never openSidePanel", asserts copy 我们不能替你打开侧栏). The tray call at `menu-bar-agent.ts:620` routes to the focus-only helper — not `chrome.sidePanel.open()` |
| (e) `file.upload` parses PDF/Office into thread, not knowledge | **TRUE** | `file-parser.ts:390-441` (text/csv/pdf/office); `message-router.ts:829-851` pushes parse results into the thread conversation; no knowledge write |
| `SENSITIVE_TAG_RE` insufficient | TRUE | `threads/digest.ts:46,52-64` — applied only to tag strings in `normalizeTag`, never body text; spec F-S-8's "不够" is accurate |
| `*.com` suffix match | TRUE | `skills/site-matcher.ts:37-41` — pattern `*.com` would match every `.com` host; `security.ts:101-122` `validateWildcardPattern` already rejects it (incl. no-dot suffixes), so F-S-4 is implementable with existing code |
| Supporting facts | TRUE | `MAX_TAGS = 8` (digest.ts); `active_knowledge_ids?: string[]` on Thread (thread-manager.ts:27,45) resolved via `get(id)` (skill-engine.ts:512-523); `normalizeTag`, `threads/related.ts`, `skill-install.ts`, `pack-engine.ts`, `KnowledgeSubPanel.tsx`, `knowledge.import` handler with `parseFile` branch (message-router.ts:2548-2560) all exist |

## 2. Rejection gates — all clear

- **R1**: no false code facts found (table above).
- **R2/R6**: Project/graph/embedding/remote KB explicitly NO-GO (§0, §5 "明确不在任何 Wave"); Wave 2 is explicitly "本 SoT 不开工" and contains only query-time related ≤3 (no edge store, mirrors existing `threads/related.ts`), thread grouping (话题夹 ≠ knowledge-container Project), and plugin distribution (≠ launcher rebuild). No smuggling.
- **R3**: F-I-3 + F-S-6 + Wave 1 acceptance ("模型文本里伪造文件名不会变成芯片") — chips render only the Companion ledger.
- **R4/R5**: F-UX-OVERLAY-1, F-I-4, F-S-5; no `sidePanel.open` deliverable; import adds a gesture gate, no auto_approve/Trust elevation.
- **R7**: Wave 0 items 1-2 (identity split, all write paths) + item 4 (RAG **and** truncate sanitize) — both present.
- **R8**: F-S-8 / F-E-5 forbid auto-ingest.

## 3. ADR-020 checklist

Capability declaration present and correct: knowledge hangs on the **Compose** axis (markdown + SkillEngine), chips on **L0 Surface**, no L2, no new runtime, no new confirm family (import gesture is a UI confirm, not a new `securityConfirmations` dialect), no originWs surface touched. Pack-first respected (pack already owns `knowledge_ids`; no new primary Side Panel chrome — chips live in existing chat/panel). No contradiction with ADR-008 (Obsidian stays outbound), ADR-025 (ACP default off, F-ID-1), or the 2026-08-11 no-graph ruling.

## 4. Must-answers

- **Identity split (Q3)**: implementable without rewriting `active_knowledge_ids` — old ids = frontmatter `name` and stay stable (§4 "旧文档 = 现 frontmatter name"); `get()` gains id lookup alongside name. Thread schema untouched.
- **Sequencing (Q5)**: sanitizer ships in Wave 0, *before* the 0b import surface — no ingest-without-trust inversion. Tags are import-time user-editable drafts (F-S-7), not post-hoc batch extraction — no ThreadDigest empty-shell repeat.
- **Trust (Q4)**: F-S-1..10 adequate; overlay MCP-without-confirm is parked as pre-existing/另票, which the review contract itself classifies as a non-blocking nit.
- **Implementability (Q7)**: schema fields enumerated (§4), file map (§6), machine-checkable acceptance (Wave 0) — closed enough to open the impl issue.

## Nits (non-blocking)

1. **§6 sanitize row names only `getKnowledgeSummary`** — the live injection path prefers `getEntriesSummary` (`skill-engine.ts:618`), whose entries text is also returned unsanitized (`:707-726`), and `searchKnowledge` (`:1412-1428`) is a second raw-chunk return path (currently dead — no callers found). F-S-2's lock text covers all three ("全文、RAG chunk、entries"), but the Wave 0 impl issue should enumerate them or one will be missed (sanitize or delete `searchKnowledge`).
2. **Weak acceptance collision test** — Wave 0 uses `产品A`/`产品B` (today sanitize to `--a`/`--b`, no collision). The real silent-overwrite case is pure-CJK-differing titles (e.g. `产品甲`/`产品乙` → both `---`). Use two pure-CJK titles in the acceptance.
3. **"六条写路径" not enumerated** — write sites are skill-engine.ts:779/861/1255/1319/1479 + skill-install.ts + pack-engine namer; enumerate in the impl issue so "all write paths" is checkable.
4. **0b keeps the gestureless protocol callable** ("协议可留但 UI 不裸发", message-router.ts:2548) — a server-side `user_gesture` flag on `knowledge.import` would close it; spec consciously parks it on the authenticated local WS surface.
5. Line-number drift in the prompt (~1307 → actual 1309); trivial.

Findings above; verdict below.

VERDICT: APPROVE_WITH_NITS
