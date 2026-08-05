# Dual review: User scene tools policy + AI create design

## Document under review

`docs/superpowers/specs/2026-08-06-user-scene-tools-and-ai-create.md`

Also read for grounding (use tools):
- companion/src/packs/pack-engine.ts (`saveUserPack`, `computeWhitelist`, `applyPack`)
- companion/src/packs/validator.ts
- companion/src/packs/suggest-scene.ts
- chrome-extension/.../PacksPanel.tsx (user scene editor)
- docs/adr/014-mission-pack-enterprise-modules.md
- docs/audit/reviews/_templates/dual-review-capability-checklist.md

## Capability declaration (from design)

```
Surface: n/a
Compose: pack | skill | mcp-server
Autonomy: single
Trust: module + profile + L2 unchanged; Pack forbids auto_approve
Channel: community user packs may *declare* enterprise tools; apply still gated
```

## What to verify

1. **Security**: Does the design prevent Pack from becoming a Trust bypass? Is allowlist expansion risk handled? MCP+whitelist footgun?
2. **Product completeness**: G1–G4 closed? Order of implementation sound?
3. **Feasibility**: Matches existing engine or invents runtime?
4. **Gaps / REJECT criteria**: Missing MUST that would make implementation unsafe or incomplete.

## Output

Findings by severity with section refs.
End with exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
