# Dual external review: Daily Assistant · Knowledge Honesty (design SoT)

**Batch:** `daily-assistant-knowledge-honesty`  
**Stage:** Design SoT — **pre-implementation**; dual-review of the **post-adversary spec**, not a code PR  
**Date:** 2026-08-25  
**Blast tier:** T0 docs today; Wave 0/0b/1 would be T2 Compose / L0 Surface

## Capability declaration (if later landed)

```text
Surface:      L0 chat UX (disclosure chips + confirm-import); overlay unchanged C-thin
L2-classes:   (none)
Compose:      knowledge (markdown + SkillEngine); pack 场景 already owns knowledge_ids
Autonomy:     n/a
Trust:        no elevation; knowledge = untrusted retrieved data; overlay ACL does not grow
Channel:      community | enterprise unchanged
```

## Required reading (order)

1. **Primary SoT (under review)** — `docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md`
2. **Adversary merge** — `docs/audit/reviews/daily-assistant-knowledge-honesty-adversary-synthesis-20260825.md`
3. **Must not contradict without explicit override**
   - `docs/adr/020-capability-model-three-axes.md`
   - `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md` (C-thin overlay)
   - `docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md` (E1–E3 no llm_wiki / no graph DB)
   - `docs/archive/2026-07/proposals/knowledge-mgmt-proposal/final-design.md` (conservative won; graph lost)
   - `docs/adr/008-obsidian-export.md` (outbound; companion does not write vault)
   - `docs/adr/025-acp-coding-agent-client.md` (coding is Composition, default off)
4. **Spot-check code claims**
   - `companion/src/skills/skill-engine.ts` (`importKnowledge` alphanumeric throw ~1307; `getKnowledgeSummary` RAG unsanitized ~684)
   - `companion/src/skills/content-sanitizer.ts`
   - `companion/src/file-parser.ts` (`parseFile` already PDF/Office)
   - `companion/src/summoner-web.ts` `SUMMONER_WEB_DISPATCH_ALLOW` (no `knowledge.*`)
   - `companion/src/summoner/client.ts` attachChrome never `openSidePanel`
   - `companion/src/packs/overlay-eligible.ts`
   - `companion/src/threads/digest.ts` `SENSITIVE_TAG_RE`
   - `companion/src/skills/site-matcher.ts` `*.com` suffix match
5. ADR-020 checklist — `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Premise (must not weaken without REJECT)

```text
1. KEEP THE BET: 6-month primary = daily browser + local-knowledge assistant, not Codex/IDE.
2. REJECT THE BUNDLE: no Project entity, no knowledge graph/ontology, no Perplexity [n]
   footnotes, no remote KB this bet, no Raycast marketing, no overlay knowledge admin.
3. Citations = Companion retrieved_sources ledger, never model-authored bibliography.
4. Chinese names = {id, filename, title} split across ALL write paths, not one regex.
5. Confirm-import = parseFile + extracted-text preview + user_gesture; overlay file.upload
   stays thread-only.
6. Knowledge is untrusted data; RAG path must sanitize (today it does not).
7. Overlay stays C-thin; companion cannot open Side Panel; do not lie that expand opens it.
8. Code-fact claims in the spec/synthesis must survive Read/Grep. Over-claim → REJECT.
```

## Your job

Independent **product + architecture + security + factual accuracy** review of the **design document**. You are confirming or rejecting the **adversary synthesis**, not rubber-stamping the original 10-bullet wishlist.

### Must answer

1. **Factual**: Are these true in current code? (a) CJK-only knowledge name throws alphanumeric; (b) RAG chunk path skips sanitizer; (c) overlay allowlist has no `knowledge.*`; (d) companion cannot open Side Panel; (e) `file.upload` already parses PDF/Office into the thread, not knowledge.
2. **Bundle cut**: Did the spec actually kill Project / graph / model footnotes / remote KB / overlay ACL growth, or smuggle them into Wave 2 as “later” that will still ship this quarter?
3. **Identity split**: Is F-I-1 implementable without rewriting existing `active_knowledge_ids`?
4. **Trust**: Are F-S-1..10 adequate, or is a blocker missing (especially overlay MCP-without-confirm left as “pre-existing”)?
5. **Sequencing**: Wave 0 → 0b → 1 — any inversion that would repeat ThreadDigest empty-shell or ingest-without-trust?
6. **ADR-020**: Any new runtime, primary Side Panel chrome, or Trust elevation?
7. **Implementability**: Closed enough to open a Wave 0 impl issue without inventing schema?

### Rejection gates (any → VERDICT: REJECT)

| # | Gate |
|---|------|
| R1 | Spec/synthesis claims code facts that are **false** on spot-check (major) |
| R2 | Re-introduces Project entity, knowledge graph DB, default embedding, or remote KB as in-scope |
| R3 | Endorses model-authored citations as UI truth |
| R4 | Overlay ACL grows (`knowledge.*` / `config.set` / `mcp.add`) or companion-initiated `sidePanel.open` as a deliverable |
| R5 | Knowledge or import **elevates Trust** / auto_approve |
| R6 | Second agent runtime / renaming Pack to Project as the product |
| R7 | Wave 0 omits RAG sanitizer or identity split (shipping CJK as regex-only) |
| R8 | Auto-ingest chats into global knowledge |

### Non-blocking nits (examples)

- uuid vs slug for new ids  
- Whether overlay HTML shows chips (must not grow ACL)  
- Effort estimates  
- Overlay MCP-without-confirm as a **separate** ticket (spec already parks it)  
- Exact WS field names for `retrieved_sources`

### Output

Findings with file:line. Then **exactly one** final line:

VERDICT: APPROVE  
or  
VERDICT: APPROVE_WITH_NITS  
or  
VERDICT: REJECT
