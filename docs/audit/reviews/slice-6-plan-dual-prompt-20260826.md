You are an independent re-reviewer of CMspark **slice 6 PLAN r2** (not an implementation yet).

This is a **T2 plan dual** after four-lane r1 REJECT (Security/Product/Impl) + External AWN. r2 pins were folded into the plan. Confirm the BLOCKs are actually pinned, or REJECT leftover holes.

Read:
1. docs/superpowers/plans/2026-08-26-slice-6-match-idf-runprogress.md (r2)
2. docs/audit/reviews/slice-6-plan-adversary-synthesis-20260826.md
3. docs/superpowers/specs/2026-08-26-product-form-deepening-design.md §11 slice 6
4. docs/superpowers/specs/2026-08-26-summoner-strategy-rethink-design.md §8–9
5. Spot-check live code: skill-engine resolveSkillIdsForThread auto union; message-router skill.activate; summoner-acl SUMMONER_ALLOW; thread-manager has NO thread.open_todos; H1 is runtime_context_budget.handoff.open_todos; ChatView EmptyState already ships slice 5

r2 pins that MUST still hold:
- Matching honesty door is `/技能` + 按需 → manual; overlay skill.activate MUST NOT write skill_selection_mode
- Seed from runtime_context_budget.handoff.open_todos, not thread.open_todos
- applyToolResult never ticks model_draft; exact item.tool match; wired in adapter after tool.result ok
- toggle WS denied on SUMMONER_ALLOW / WEB dispatch / thread.update allowlist
- ChatView only; copy 「本轮步骤」 not 「进行中」
- IDF test: rare token IN corpus; tokensToVec unchanged
- Docs GOAL G17 / architecture / CLAUDE A5; do not claim T1 done; do not expand outbound

HEAD already has the plan committed. Inspect files with tools; do not rubber-stamp an empty working-tree diff.

End with exactly:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
