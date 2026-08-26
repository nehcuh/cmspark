You are Claude Code doing an independent **Impl** review of an implementation PLAN (no code has been written). Use Read/Grep/Bash. Do not edit.

Primary: docs/superpowers/plans/2026-08-26-product-form-slices-123.md
Synthesis: docs/audit/reviews/product-form-slices-123-adversary-synthesis-20260826.md
SoT: docs/superpowers/specs/2026-08-26-product-form-deepening-design.md

Spot-check plan claims vs code:
- rejectAll kills unbound on any peer close
- disclosure-session is in-process Map
- url-cookie-admission same origin bind as L2
- grant CLI does not exist in index.ts
- summoner-workbench-compose.test.ts source-regex MCP rails
- extension handshake surface is "tray" not "extension"

Reject if the plan would make implementers invent overlay confirm, CLI HTTP, or miss url-cookie-admission / rejectAll.

End with exactly:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
