# Independent adversary — post-#222 nits fold + Windows HUD restyle

**Date**: 2026-08-25
**Base**: `d4cbbfae` (P1 fold already r2 AWN)
**Head**: `8f5c94c6`
**Frozen patch**: `docs/audit/reviews/post220-nits-hud-diff-20260825.patch`
**SHA256**: `AB1D1A1285F558BE52A86D5A1F5A6B8EDB5BC671F565348337B7240F6EFE6825`
**Diff**: `git diff d4cbbfae..HEAD -- ':!docs/audit' ':!memory'` (21 files, +381/−139)

## Why this range

P1 r2 already APPROVE_WITH_NITS. This round is the **nits fold** (`7ec76d78`) plus **Windows C-thin HTML → paper HUD** (`8f5c94c6`). Do not re-open folded P1s unless this increment **regressed** them.

Prior (context only, re-execute):
- `docs/audit/reviews/head-6ce291db-post220-p1-r2-synthesis-20260825.md`

## Capability (challenge vs live)

```text
Surface:      L0 overlay HUD workbench (Mac NSPanel + Win C-thin HTML restyle)
L2-classes:   none on HUD; mcp.toggle HTML now rides tray client
Compose:      threads / pack.apply overlay-safe / knowledge USE / skill toggle
Autonomy:     n/a
Trust:        overlay ACL: pack.apply extras stripped; knowledge.import still denied on summoner WS
              HTML restyle is visual only — no new confirm dialect, no Allow/Deny
Channel:      community
```

Blast: **T2**. Escalate to T3 if overlay WS can `mcp.add` / `knowledge.import` / `config.set`, or overlay grew Allow/Deny.

## Rules

Independent adversary. Default REFUTED until file:line + `[executed]`/`[inspected]`.
File-range exclusive. No production edits. Mutation copies only under `.tmp-adv-nits-hud-<letter>/` then delete.
Final line exactly:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT

## Intentionally out of slice

- D-N3 drain peek/take TOCTOU (explicitly not folded)
- Mac `dist/cmspark-tray` binary (cannot rebuild on Windows)
- Native WKWebView/WebView2 (C-thin Chromium --app title bar remains)
