Review complete. All code-fact claims verified against the repo.

## Verification summary

**Code facts — all survived Read/Grep:**

| Claim | Evidence |
|---|---|
| `matchSkills` = TF cosine, comments say TF-IDF, no IDF | `companion/src/skills/semantic-match.ts` `tokensToVec` = normalized TF only (zero IDF anywhere); `skill-engine.ts:526,549` comments claim "TF-IDF" |
| ≥70 skips LLM, else `llmRerank` | `skill-engine.ts:548-551` |
| Tokenizer already ported from VibeSOP | `semantic-match.ts:2` |
| `skill.activate` doesn't flip manual; auto unions 勾选∪matchSkills∪site | `resolveSkillIdsForThread` auto branch; `activate()` only appends to `threadSkillMap` |
| knowledge auto = 勾选 ∪ 站点, not query semantics | `resolveKnowledgeIdsForThread` |
| `chat.create` runs full tool-loop (incl. CDP) on summoner | `message-router.ts:422+` same loop path; `summoner-acl.ts:16` allows |
| pack.apply overlay-eligible + allowTrust forced false | `message-router.ts:3000-3029`; `overlay-eligible.ts` |
| knowledge get/import/update denied on summoner | `message-router.ts:2651-2786` |
| `mcp.toggle_server`/`skill.activate` already in ACL (freeze/rollback claim) | `summoner-acl.ts:39,43` |
| 0.5.2 = NSIS installer | `companion/package.json` 0.5.2; `docs/GOAL.md:3` |
| T1 unrun | ADR-022 status "未产品 ship"; no bake-off results doc exists in repo |
| HUD Expand 对标 Codex/千问/WorkBuddy | `2026-08-25-overlay-hud-expand-design.md:5,8,40` |
| ADR-022 L7/L8; require_grant default on | `022-outbound-mcp-server.md:77-78`; `config.ts:402` |
| ADR-025 `acp.enabled` default false, apply via L2 | `025-acp-coding-agent-client.md:12,31` |
| ADR-016 board_complete = L2 HITL, LLM self-confirm never trusted | `016-mission-board.md:276-277` |
| PRODUCT.md 看山 canon; H1 `open_todos`; launcher-plugins doc | `PRODUCT.md:35`; `context-handoff.ts:17`; `docs/summoner-launcher-plugins.md` exists |

**Must-answer questions:**
1. **Overlay ACL growth / HUD-as-workbench:** killed, not smuggled. NEVER list + point-2 table + "展开工作台 = 冻结，不再加轨". The P2 items are Side-Panel L0 polish (explicitly 不 Gemini 化) and RunProgress display — neither regrows ACL nor revives the workbench.
2. **Kimi handling:** accurate — T1 unrun (ADR-022 status, no results doc), 0.5.2=NSIS (package.json/GOAL.md), and the spec correctly refuses to treat the report as a license to expand.
3. **RunProgress vs Board:** distinct enough. L0 chat-column display, completion bound to tool_result/user gesture, seeded from H1 `open_todos`, model rows = drafts. Mission Board explicitly rejected as personal todo; no new `thread.todo` SoT. Does not reopen ADR-016.
4. **IDF in TS:** implementable — the tokenizer is already a TS port of VibeSOP; IDF is a pure-TS corpus-weighting change. No new runtime.
5. **ADR-020:** no new primary chrome (summoner stays L0 fadeable capture bar; Side Panel stays operate home), no new runtime (Python explicitly rejected; ACP/outbound MCP are "门面不是新 runtime").

**Capability checklist:** declaration present and complete (Surface/L2-classes/Compose/Autonomy/Trust/Channel); no bare 中层 Agent; Pack-first respected; trust monotonic (ACL doesn't grow, grants ≠ ws_secret); originWs N/A (docs-only, pre-implementation). All gates R1–R7 pass.

## Nits (non-blocking)

1. **Channel field mismatch:** prompt capability block says `Channel: summoner optional`; the design under review declares `Channel: community; summoner optional / fadeable`. Align the prompt's declaration with the design (`docs/audit/reviews/summoner-strategy-rethink-dual-review-prompt-20260826.md` capability block).
2. **`mcp.toggle_server` / `skill.activate` deferral:** the Security lane already flagged these as trust-elevating on the overlay; §4 leaves rollback-vs-freeze open with no committed follow-up ticket. For a T0 strategy SoT, name the ticket so "ACL 不涨" doesn't drift into "pre-existing elevation stays live indefinitely" (design §4 open Q1).
3. **RunProgress "用户确认"** — pin explicitly that this is an L0 UI gesture, not a security-confirm dialect, so a later slice doesn't trip checklist item 3 (new confirm family).
4. **F-S-10:** "must not worsen" is correct, but the quarter plan names no follow-up ticket for the pre-existing overlay `mcp__*`-without-confirm hole.
5. **"观察芯片"** (design point 5) is an undefined new term in an otherwise locked vocabulary — define or drop.

None of the above violate gates R1–R7 or contradict ADR-020/022/025/016, Honesty F-UX-OVERLAY-1/F-S-10/F-E-10, or C-thin. The diff is a pure T0 docs strategy with an accurate capability declaration and verified code facts.

VERDICT: APPROVE_WITH_NITS
