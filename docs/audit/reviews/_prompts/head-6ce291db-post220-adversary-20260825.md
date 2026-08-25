# Independent post-pull adversary — main HEAD after #221+#222

**Date**: 2026-08-25
**Base**: `1d16b0ed` (PR #220 squash MERGED)
**Head**: `6ce291db` (PR #222 squash MERGED; parent `ac0a3be0` = #221)
**Frozen patch**: `docs/audit/reviews/head-6ce291db-post220-diff-20260825.patch`
**SHA256**: `19B2A2F3DFDF41F4B5A5A22DD68763C19C861E5300FCCEF7876B791489246548`
**Diff**: `git diff 1d16b0ed..HEAD -- ':!docs/audit' ':!memory' ':!PROJECT_CONTEXT.md'` (68 files, +5792/−612)

## Why this range

Local workspace was on `fix/post219-kimi-nits-r2-fold` (#220). After `git pull origin main`, HEAD is `6ce291db` with two merged PRs this session did **not** implement:

- **#221** `ac0a3be0` — fold post-#220 residual nits (LLM leftover/heal/drain/lease/redact)
- **#222** `6ce291db` — knowledge honesty Wave 0–2 + overlay HUD workbench compose

In-tree reviews (post220-nits four-lane, knowledge-honesty waves, overlay-hud-expand B0–B4 adversaries + Claude/Pi) ran on **feature branches / dirty trees**, not against live squash `6ce291db`. This round is a **post-merge independent re-verify of live main**. Do **not** rubber-stamp those artefacts.

Prior artefacts (context only — re-execute, do not quote as proof):

- `docs/audit/reviews/post220-nits-adversary-synthesis-20260825.md`
- `docs/audit/reviews/knowledge-honesty-wave2-adversary-synthesis-20260825.md`
- `docs/audit/reviews/overlay-hud-expand-b1b4-adversary-security-20260825.md`
- `docs/audit/reviews/overlay-hud-expand-b1b4-r2-pi-20260825-191444.md`

## Capability declaration (implementer claim — challenge it)

Two specs shipped in one squash. They **disagree** on overlay ACL. Live code is the SoT.

Knowledge honesty (Wave 0–2):

```text
Surface:      L0 chat UX (disclosure chips + confirm-import); overlay unchanged C-thin
L2-classes:   (none)
Compose:      knowledge (markdown + SkillEngine); pack already owns knowledge_ids
Autonomy:     n/a
Trust:        no elevation; knowledge remains untrusted retrieved data; overlay ACL does not grow
Channel:      community
```

Overlay HUD expand (B0–B4, SUPERSEDES HUD A “overlay 不管 pack·MCP”):

```text
Surface:      L0 overlay HUD collapse + L0 overlay workbench expand
L2-classes:   (none on HUD; mcp.add stdio spawn uses existing tray L2)
Compose:      threads / pack / knowledge / skill / mcp — Companion-owned
Autonomy:     n/a
Trust:        summoner ACL grows for composition read + overlay-safe write;
              mcp.add + knowledge.import DENIED on summoner WS; launcher uses tray client;
              no overlay Allow/Deny dialect
Channel:      community
```

Blast: **T2** UI/compose. Escalate to **T3** if overlay socket can `mcp.add` / `knowledge.import` / `config.set`, if a new confirm family appears, or if overlay becomes Allow/Deny.

## Rules (mandatory)

1. Independent adversary. Default: REFUTED until `file:line` + `[executed]` / `[inspected]`.
2. Read **live files at HEAD `6ce291db`**. Optionally verify frozen patch SHA256 (`Get-FileHash -Algorithm SHA256` or `certutil -hashfile … SHA256`). Never invent file:line.
3. Score outcome / trajectory / component. Machine-checkable > prose.
4. Tests existing ≠ tests pinning the bug. Mutation-kill if you claim a test holds.
5. You may mutate a **private copy** of tests under `.tmp-adv-lane-<letter>/` then delete that dir. **Do not dirty the git worktree** except writing YOUR lane report.
6. Do not implement fixes. Do not edit production source.
7. Tag every claim `[executed]` / `[inspected]` / `[assumed]`.
8. Final line of the report MUST be exactly one of:
   `VERDICT: APPROVE`
   `VERDICT: APPROVE_WITH_NITS`
   `VERDICT: REJECT`
9. REJECT = blocking issues with file:line before the verdict.
10. APPROVE_WITH_NITS = non-blocking nits only.
11. **File-range exclusive.** Do not write findings that belong to another lane’s exclusive files. You may *read* out-of-range files for context.

## ADR-020

Read `docs/audit/reviews/_templates/dual-review-capability-checklist.md`. Challenge Trust monotonicity, overlay-as-confirm, new confirm dialects, Pack-first, missing declaration if tools/gates/primary UI were added.

## Intentionally out of slice (do not REJECT solely for these)

- M3 overlay `pack.apply` historical test gap from #219
- N1 `chat.done` idle flash / N9 length output budget
- Continue UI, persist `running=true`, pending_confirms
- Native WKWebView/WebView2/GTK (C-thin HTML is the Win/Linux shell)
- Knowledge honesty parked: `knowledge.import` `user_gesture` server 400 (Wave 0b parked if still documented)
- HTML skill activate-only / knowledge replace-not-toggle (documented nits on C-thin vs Swift HUD) — nits, not REJECT unless they skip Trust
