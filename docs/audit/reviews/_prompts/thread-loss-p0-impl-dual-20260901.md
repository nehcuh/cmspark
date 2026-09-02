# Dual review — thread-loss-p0 IMPLEMENTATION (not diagnosis)

You are an independent senior reviewer. **Do not rubber-stamp.** Inspect the real diff and tests.

## What this is

Implementation of CMspark plugin thread honesty (incident 3qb5ea / w2k8z9):
- list clock `last_message_at` ≠ digest `updated_at`
- truncated tool-batch / abort persist one assistant (no extra disk error row)
- switch LRU + hydrating (not EmptyState)
- Anthropic/glm `max_tokens` default 32768
- alias hygiene (`cruise-wl` hostname class; duplicate title `preview · #id`)

PRD (SoT): `/Users/huchen/Projects/cmspark/.omx/plans/prd-thread-loss-p0.md`
r2 remainder: `/Users/huchen/Projects/cmspark/.omx/plans/prd-thread-loss-p0-r2.md`

## Diff to inspect

Working tree vs HEAD `3cd70cf8` (uncommitted). Patch file:

`/tmp/thread-loss-p0.diff`

Also `git diff -- chrome-extension companion` in `/Users/huchen/Projects/cmspark`.

Do **not** require the unpublished local commits on `main` (memory/skill) to be in this review.

## Must verify (file:line)

1. `get()` does not `saveIndex`. `update()` cannot forge `last_message_at`.
2. truncatedToolBatch: persist then `chat.done` + ephemeral `chat.error`; zero extra disk assistant.
3. `computeMaxTokens(1e6)` default 32768; not `vision.max_tokens`.
4. Human-facing sorts use `last_message_at || created_at` (timeline, overlay, summoner, related, graph). Cleanup/idle may keep `updated_at`.
5. Tests exist for clock + trunc + switch; companion/extension suites were reported fail 0 — spot-check the tests match the pin.

r2 dual fold (after first-round kimi REJECT): T-clock-4/5, T-abort-2, hydrate retry tests, graph slim last_message_at, merge-peer never-clobber-newer.

## Verdict

APPROVE / APPROVE_WITH_NITS / REJECT

If REJECT: blocking file:line before the verdict line.
If APPROVE_WITH_NITS: nits before the verdict line.

End with exactly:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
