# Round 1 — 3-way Decision Synthesis

**Date**: 2026-07-14
**Voters**: Claude (main), Kimi (`kimi -p`), Pi-substitute (`claude -p` — no `pi` on system)
**Status**: ✅ Consensus on 6/7; 1 resolved disagreement (Q3).

## Verdict matrix

| Question | Claude (me) | Kimi | Pi-sub | Decision |
|---|---|---|---|---|
| Q1 v1 scope | A | A | A | **A** (download path only; B deferred to v1.1 opt-in) |
| Q2 Extraction layer | hybrid (ext + CDP Runtime.evaluate + companion formats) | hybrid (same) | hybrid (same) | **Hybrid** |
| Q3 PDF vs MD | CDP printToPDF + reader CSS, MD fallback | CDP printToPDF + reader CSS, MD fallback | **MD only — skip PDF for v1** | **MD only** (Pi wins; safety + simplicity) |
| Q4 LLM tool in v1? | no | (implied no — listed security overhead) | no | **No tool** in v1 |
| Q5 Entry surface | side panel + right-click | (not asked) | side panel only | **Side panel button only** (no right-click v1) |
| Q6 SecurityConfirmationManager for auto-upload? | yes | yes | yes | **Yes** (moot for v1-A, binding for v1.1-B) |
| Q7 Risks missed | MV3, cookie leak, ToS | MV3 SW killed, cookie leak, SecurityConfirmationManager gate | Account-level bot flagging, cookie/auth bleed into PDF, MV3 SW lifecycle, "moat nobody asked for is debt" | **All flagged** (see §Risks) |

## Q3 resolved disagreement — Pi's argument carries

**Pi's case for MD-only v1**:
1. NotebookLM accepts `.md` uploads → no functional loss for v1
2. `printToPDF` on the **live, logged-in tab** bakes cookies/account chips/email/personalized nav into the doc — irrecoverable privacy leak
3. Per-site print CSS is unreliable; reader-mode stylesheet injection is its own rabbit hole
4. Zero new dependencies (no `pdfkit`, no `puppeteer`, no print pipeline)
5. Print pipeline is new MV3 service-worker lifecycle surface (obsidian export never touches CDP attach)

**Kimi's stance** effectively concedes: "fallback to MD if print fails" — so MD is the floor regardless. Pi just makes MD the ceiling for v1.

**Claude's role**: I had printToPDF as primary. Pi's safety argument (cookie bleed) is decisive. **PDF deferred to v1.1** behind: (a) sanitization that strips auth-bearing elements, (b) explicit user opt-in, (c) real user demand.

## Risks flagged (all three)

| Risk | Mitigation for v1 |
|---|---|
| MV3 service worker killed mid-extraction | Keep extraction in one short-lived `Runtime.evaluate` round-trip; no long attach span |
| Cookie/auth bleed into exported content | MD extraction via `Runtime.evaluate` returns only title + main-article text + canonical URL; never serializes DOM/cookies |
| Google ToS / account bot-flagging for B | B not shipped in v1; gated by `SecurityConfirmationManager` + user opt-in when it lands |
| NotebookLM UI selector drift (v1.1 problem only) | Out of scope for v1 |
| Content-script-side PDF library bloat | N/A — no PDF in v1 |

## v1 scope (locked)

- ✅ Side panel button 📓 in header (between 🧠 and 📋)
- ✅ On click: extract current tab's main content via CDP `Runtime.evaluate` (title + readable text + canonical URL)
- ✅ Send to companion over existing WS pattern
- ✅ Companion wraps as frontmatter-marked Markdown (`title`, `source_url`, `extracted_at`)
- ✅ Return to extension; Blob download `.md`
- ❌ No PDF, no auto-upload, no right-click, no LLM tool

## v1.1 (deferred — needs real user demand)

- Right-click context menu (page / link / selection)
- PDF generation (with auth-element stripping + opt-in)
- 1-click auto-upload to NotebookLM via CDP `DOM.setFileInputFiles` (gated by `SecurityConfirmationManager`)
- LLM tool wrapper

## Original advisor outputs (for audit)

See:
- `advisor-kimi-round1.txt` (Kimi response)
- `advisor-pi-round1.txt` (Pi-substitute response)

## Sign-off

- ✅ Kimi: agreement on all 4 questions asked; concedes MD as fallback (effectively consents to MD-only)
- ✅ Pi-sub: agreement on 6/7; disagrees on Q3 with stronger argument; wins the disagreement
- ✅ Claude: concurrence —Pi's safety argument is decisive

→ **Proceed to Phase 2: implementation plan.**
