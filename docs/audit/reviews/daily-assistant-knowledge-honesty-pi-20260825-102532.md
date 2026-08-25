All spot-checks complete. Here is my review.

---

# Dual External Review — Daily Assistant · Knowledge Honesty (design SoT)

## 1. Factual spot-checks (must-answer Q1)

All five claims survive Read/Grep:

| Claim | Verdict | Evidence |
|---|---|---|
| (a) CJK name throws "alphanumeric" | ✅ substantively true, ⚠️ one precision gap | `skill-engine.ts:1309` throws `Use alphanumeric characters`; `safeName` at `1307` strips non-ASCII. **Nuance**: the guard `!safeName \|\| safeName === "-"` only catches names collapsing to empty/`-` (single CJK char). Multi-char CJK like `产品` silently becomes `--.md` — it does *not* throw, it *silently collides* (worse than throwing). Directionally the claim holds; see nit N1. |
| (b) RAG chunk path skips sanitizer | ✅ TRUE | `getKnowledgeSummary` (`skill-engine.ts:680`): RAG branch `684–689` returns `matched.map(c => c.text)` **unsanitized**; `sanitizeKnowledgeContent` runs only in the truncate fallback at `694`. Chunks are also built unsanitized (`rebuildKnowledgeChunks` `185–191`). **Plus a second un-named site**: `searchKnowledge` (`1417–1428`) returns unsanitized chunks too — see N2. |
| (c) Overlay allowlist has no `knowledge.*` | ✅ TRUE | `SUMMONER_WEB_DISPATCH_ALLOW` (`summoner-web.ts:18–30`): `system.ping, chat.*, thread.*, mcp.list, pack.*, file.upload, composer.lease.*`. No `knowledge.*`, no `config.*`, no `mcp.add`. |
| (d) Companion cannot open Side Panel | ✅ TRUE | `platform.ts:147–152` `openSidePanel()` is a stub — comment: *"Chrome Side Panel cannot be opened programmatically"*; only activates Chrome. Test lock `summoner/tests/summoner-client.test.ts:420`. The three `chrome.sidePanel.open` call sites in the extension (`background/index.ts:1386`, `thread-graph/ThreadGraphApp.tsx:332`, `popup/index.tsx:47`) are **UI/user-initiated** (popup click, graph focus), not companion WS-initiated. |
| (e) `file.upload` parses PDF/Office into thread | ✅ TRUE | `file-parser.ts:41–44` maps pdf/docx/pptx/xlsx; `message-router.ts:693` `file.upload` requires `thread_id`, parses into the thread with the full lease/conductor/run_active gates (`726–756`). |

Supporting infra for the design is real: `validateWildcardPattern` (`security.ts:101`) rejects `*.com` via `isMultiTenantOrPublicSuffix` (F-S-4 implementable); `threads/related.ts` exists (Wave 2 citation accurate); `chat.done` is already in `SUMMONER_WEB_EVENT_ALLOW` (`summoner-web.ts:37`) so Wave 1 overlay chips are feasible with zero ACL growth; six `writeFileSync` sites in `skill-engine.ts` (`779/861/1094/1255/1319/1477`) back the "六条写路径" claim.

## 2. Bundle cut (Q2) — PASS

Project / graph / model footnotes / remote KB / overlay ACL growth are killed, not parked: `F-UX-NOUN-1`, `F-I-2`, `F-E-3`, `F-E-6`, `F-UX-OVERLAY-1`, `F-S-5`, plus §5 "明确不在任何 Wave". Wave 2 deferrals are *scoped differently* from the banned bundle: 相关≤3 is query-time (borrows `related.ts`, no edge DB); 话题夹 is thread grouping, and the spec explicitly forbids "把 Pack 改名为 Project" as NEVER. No gate R2/R3/R8.

## 3. Identity split (Q3) — implementable

F-I-1 keeps legacy docs on `name == id` (no rewrite of `active_knowledge_ids`; legacy ids still resolve via `get(name)` at `skill-engine.ts:303`), while new docs get stable slug/uuid `id` + CJK `title` + OS-safe `filename`. The Wave 0 acceptance ("旧英文 id 仍能 resolve") is machine-checkable. One gap: `get()` resolves strictly by `s.name === name` — new-doc resolution by the new `id` field needs an explicit resolver change in Wave 0 (N3). F-I-6's flat-namespace collision concern is real (skills+knowledge share one cache).

## 4. Trust (Q4) — adequate

F-S-1..10 are sufficient and correctly layered: untrusted-data framing + hard delimiters (F-S-1), write+retrieve sanitize incl. RAG (F-S-2), gesture+preview (F-S-3), frontmatter allowlist with `*.com` rejection via existing machinery (F-S-4), no ACL growth (F-S-5), no model-authored filenames as sources (F-S-6), tags-as-drafts (F-S-7), no auto-promotion with body secret scan beyond `SENSITIVE_TAG_RE` (F-S-8 — correctly, that regex at `digest.ts:46` is tags-only), no remote KB this wave (F-S-9 — current URL import is already SSRF-guarded at `message-router.ts:2574`), and overlay MCP-without-confirm parked as pre-existing/non-worsening (F-S-10). No elevation, no auto_approve, no new confirm dialect, no `originWs` surface (no new `securityConfirmations.request`). The parked MCP issue is a spec-recognized separate ticket — not a blocker for this SoT.

## 5. Sequencing (Q5) — no inversion

Wave 0 (identity + RAG sanitize + safe write) lands sanitizer *before* Wave 0b exposes import UX; 0b requires preview+gesture before any persisted ingest; Wave 1 chips depend on the Wave 0 ledger collection. The ThreadDigest empty-shell failure mode is explicitly guarded ("无 Category 实体", "无预览、无 gesture 的 import 从 UI 主路径消失", "未注入任何知识时无芯片", "不新增 query_knowledge"). No ingest-without-trust.

## 6. ADR-020 (Q6) — compliant

Capability declaration present in spec header and prompt (Surface L0 / L2-classes none / Compose knowledge / Trust no elevation / Channel unchanged). No new runtime (F-E-10), no Pack→Project rename, no "中层 Agent" bare usage anywhere in the docs (grepped). Confirm-import reuses the existing KnowledgeSubPanel + chat attachment card — not a new first-level resident entry — so Pack-first is not violated. Trust monotonicity holds (overlay C-thin untouched; side-panel paths unchanged).

## 7. Implementability (Q7) — closed enough

Minimal schema (frontmatter fields only, no new DB), code locations in §6, machine-checkable Wave 0/0b/1 acceptance criteria. Open questions (slug vs uuid, overlay chips, MCP ticket priority) are correctly marked non-blocking. A Wave 0 impl issue can be opened without inventing schema.

---

## Nits (non-blocking)

- **N1 (factual precision)**: Claim (a) as written ("CJK-only throws alphanumeric") understates the worse failure — multi-char CJK silently writes `--.md` and collides (`skill-engine.ts:1307–1310`, guard misses `--`). Suggest framing as "CJK 导入 throw 或静默塌缩为 `--.md`" — the fix direction is unaffected.
- **N2 (missing code site in §6)**: `searchKnowledge` (`skill-engine.ts:1417–1428`) is a *second* unsanitized chunk-return path that §6's implementation table doesn't name (only `getKnowledgeSummary`). F-S-2's "RAG chunk 路径" covers it in spirit, but name it in §6 so the Wave 0 sanitizer sweep can't miss it. Same for `getEntriesSummary` (`~596`) under the "entries" promise.
- **N3 (F-I-1 resolver)**: state explicitly in Wave 0 that `get()`/resolve must also match the new `id` frontmatter field for new docs — legacy `name==id` keeps working, but new ids will not equal names.
- **N4**: Wave 1 "落盘 assistant meta" — storage shape of `retrieved_sources` (per-turn vs per-message; `chars` semantics) is not pinned; spec open question 3 covers only WS field names.
- **N5**: Wave 1 overlay-chip feasibility is confirmed safe (`chat.done` already fanned via `SUMMONER_WEB_EVENT_ALLOW`) — keep as open question but note it's resolvable without ACL growth.

No rejection gates (R1–R8) are triggered.

VERDICT: APPROVE_WITH_NITS
