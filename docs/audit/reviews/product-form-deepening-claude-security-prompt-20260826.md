You are Claude Code doing an independent **Security/Trust** review of the product-form deepening SoT. Use Read/Grep/Bash. Do not edit.

Primary: docs/superpowers/specs/2026-08-26-product-form-deepening-design.md
Also: F-UX-OVERLAY-1 in docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md
ADR-022 L3/L4/L8/L9 · summoner-acl.ts · mcp/confirm-target.ts · outbound-mcp grant/profile · l2-admission.ts

Check Trust monotonicity:
- Overlay never Allow/Deny (not reopened)
- Four channels four ACLs; HUD stdin freeze not treated as license
- F-S-10 repair = L8 fan-out, not overlay MCP admin
- L3+ disclosure = user HITL, not cmspark__accept_data_disclosure self-ack
- require_grant default true; ws_secret never deputy
- knowledge.get on tray REJECT this season
- Win/Linux fail-closed
- T1 gates width not form; default profile not widened

If the spec lets implementers put grant-issue or Allow/Deny on overlay, REJECT.
If L8 is optional relative to 5-min 租手, REJECT.

End with exactly:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
