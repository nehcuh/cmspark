# Dual external review task — thread-graph Obsidian v1.1 polish

## Batch
`thread-graph-obsidian-v11-20260812`

## Capability declaration (ADR-020)
```
Surface:      L0
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        no elevation
Channel:      n/a
```

## What shipped (user-requested sequence)
1. Primary-tag color groups (`tag-colors.ts` + legend)
2. Labels hidden by default; show on hover / focus / zoom ≥ ~1.15
3. Floating pure-canvas chrome (glass toolbar + collapsible panel; localStorage only on explicit toggle)

Plus denser force-layout + Obsidian-dark tiny dots (prior session).

## Files in scope (ignore host-integrity.ts)
- chrome-extension/src/thread-graph/ThreadGraphApp.tsx
- chrome-extension/src/thread-graph/force-layout.ts
- chrome-extension/src/thread-graph/tag-colors.ts
- chrome-extension/tests/tag-colors.test.ts
- docs/superpowers/specs/2026-08-11-thread-graph-obsidian-view-design.md (§6 updated)

## Machine evidence
- `cd chrome-extension && npm test` → **628 pass**, 0 fail (this session)

## Independent multi-adversary synthesis (READ THIS)
Path: `docs/audit/reviews/thread-graph-obsidian-v11-20260812-adversary-synthesis.md`

Summary:
- Round-1 Correctness **REJECT** on reseed-on-focus / fit / hit / pin → **fixed**
- Round-2 Correctness **APPROVE_WITH_NITS**
- UX / Security / Spec: **APPROVE_WITH_NITS**
- Synthesis: **APPROVE_WITH_NITS**

## Your job
1. Read the synthesis + real git diff (not only this summary)
2. Confirm blockers are truly fixed in code (layoutSignature, fit exhausted, sticky pin on drag only, screen hit pad)
3. Challenge residual nits — mark only **blockers** if any remain
4. ADR-020: confirm no Trust/L2 elevation
5. End with EXACTLY one of:
   - VERDICT: APPROVE
   - VERDICT: APPROVE_WITH_NITS
   - VERDICT: REJECT

Do not rubber-stamp. Cite file:line for any issue.
