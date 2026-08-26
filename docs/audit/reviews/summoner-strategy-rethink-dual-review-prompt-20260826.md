# Dual external review: Summoner strategy rethink (design SoT)

**Batch:** `summoner-strategy-rethink`  
**Stage:** Strategy / design — **pre-implementation**  
**Date:** 2026-08-26  
**Blast:** T0 docs; any later slice is T2+

## Capability declaration

```text
Surface:      L0 summoner = capture bar ; Side Panel = operate home
L2-classes:   (none new)
Compose:      outbound MCP + ACP + Pack
Autonomy:     Board stays multi-agent ; RunProgress is L0 display
Trust:        overlay ACL does not grow ; F-S-10 must not worsen
Channel:      summoner optional
```

## Required reading

1. `docs/superpowers/specs/2026-08-26-summoner-strategy-rethink-design.md` (under review)
2. `docs/audit/reviews/summoner-strategy-rethink-adversary-synthesis-20260826.md`
3. Must not contradict: ADR-020, ADR-022 L1–L9, ADR-025, Honesty F-UX-OVERLAY-1, Knowledge CRUD overlay get deny, C-thin
4. Spot-check: `companion/src/ws/summoner-acl.ts`, `summoner-web.ts`, `skill-engine.ts` matchSkills, `overlay-eligible.ts`

## Premise (weaken → REJECT)

```text
1. Summoner is not a second Codex/WorkBuddy/Side Panel.
2. "Anything that can leave Chrome goes in summoner" is REJECT as a rule.
3. Plugin-for-Codex = Outbound MCP adoption, not a Chrome extension they install.
4. Beat Gemini on launch grammar, not Connected Apps JTBD.
5. No default Python embeddings / vibesop-py in Companion.
6. No Jira-as-CMspark-object. No Mission Board as personal todo.
7. Code-fact claims must survive Read/Grep (TF not IDF; skill.activate doesn't flip manual; T1 unrun).
```

## Must answer

1. Did the spec actually kill overlay ACL growth and HUD-as-workbench, or smuggle them as P2?
2. Is Kimi-report handling accurate (T1 unrun, 0.5.2=NSIS)?
3. Point 9: is RunProgress distinct enough from Board to not reopen ADR-016?
4. Point 8: is "port IDF in TS" implementable without a new runtime?
5. ADR-020: any new primary chrome / runtime?

## Rejection gates

| # | Gate |
|---|------|
| R1 | Reopens overlay confirm / knowledge.get / mcp.add as in-scope |
| R2 | CWS plugin-for-Codex or BrowserSkill clone as this-quarter ship |
| R3 | Default embedding / Python matcher in Companion |
| R4 | Native Jira/GitHub PM product |
| R5 | Side Panel IDE / ACP allow_exec |
| R6 | Major false code facts |
| R7 | Treats Mission Board as the user checklist without declaring L2/complete |

## Output

Findings file:line. Final line exactly:

VERDICT: APPROVE  
or  
VERDICT: APPROVE_WITH_NITS  
or  
VERDICT: REJECT
