# Dual external review: Knowledge Honesty Wave 0b + Wave 1

**Batch:** `knowledge-honesty-wave0b1`  
**Stage:** implementation on `feat/knowledge-honesty-wave0` after Wave 0 dual both AWN  
**Blast:** T2 Compose / L0 Surface

```text
Surface:      L0 confirm-import modal + retrieved_sources chips
L2-classes:   (none)
Compose:      knowledge preview/import allowlist + ledger
Autonomy:     n/a
Trust:        user_gesture on confirm import; overlay ACL unchanged; sources = companion ledger
Channel:      unchanged
```

## Read

- Spec §5 Wave 0b / Wave 1: `docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md`
- `companion/src/skills/skill-engine.ts` (previewKnowledge, allowlist, buildSystemPromptWithSources)
- `companion/src/message-router.ts` knowledge.preview / import
- `companion/src/llm/adapter.ts` retrieved_sources on chat.done
- `chrome-extension/.../KnowledgeSubPanel.tsx`, `ChatView.tsx` modal + chips
- `companion/src/summoner-web.ts` allowlist must still have no `knowledge.*`

## DoD

Wave 0b: preview before persist; confirm modal; overlay does not import; F-S-4 allowlist drops `*.com` site; parseFile reused.

Wave 1: retrieved_sources on assistant message from companion; chips ⊆ ledger; fake filenames not chips; heading `## Knowledge: {title} [{id}]`; no query_knowledge tool.

## REJECT if

R1 false tests · R2 overlay knowledge.import/preview added to summoner allowlist · R3 model-authored citations as UI truth · R4 Trust elevation · R5 Project/graph/taxonomy smuggled

VERDICT line required.
