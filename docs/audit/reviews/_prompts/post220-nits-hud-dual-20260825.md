# Dual external review — post220-nits-hud

Re-review after **independent four-lane adversary all APPROVE_WITH_NITS**.

- Branch: `fix/post220-head-p1-fold`
- Range: `d4cbbfae..8f5c94c6` (nits fold + Windows C-thin paper HUD)
- Adversary synthesis: `docs/audit/reviews/post220-nits-hud-adversary-synthesis-20260825.md`
- Frozen patch: `docs/audit/reviews/post220-nits-hud-diff-20260825.patch`
- SHA256: `AB1D1A1285F558BE52A86D5A1F5A6B8EDB5BC671F565348337B7240F6EFE6825`

Do **not** rubber-stamp the adversary. Inspect live code. Replay at least: overlay `pack.apply` strip, HTML `mcp.toggle` tray client, COM0 reserved, evaluate `short-eval-secret` history collapse, `CHAT_MARKED_OPTIONS` import.

```text
Surface:      L0 overlay HUD workbench (Mac NSPanel + Win C-thin HTML restyle)
L2-classes:   none on HUD; mcp.toggle HTML rides tray client
Compose:      threads / pack.apply overlay-safe / knowledge USE / skill toggle
Autonomy:     n/a
Trust:        overlay never Allow/Deny; knowledge.import denied on summoner WS
Channel:      community
```

Blast T2. REJECT if overlay WS can mcp.add/knowledge.import/config.set or new confirm dialect.

Machine (already run by adversary; re-run if you doubt):
- companion `tsc --noEmit`
- summoner-acl + summoner-web; doc-identity + distill; history; chrome-extension markdown-breaks

Final line exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
