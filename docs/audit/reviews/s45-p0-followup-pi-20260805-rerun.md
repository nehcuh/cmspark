# Pi dual-review (rerun) — s45-p0-followup

Pi CLI on Windows initially emitted raw DSML tool_calls without completing.
Successful rerun (pi -p --no-session -t read) produced full review.

**VERDICT: APPROVE_WITH_NITS**

Nits (non-blocking):
1. SW !sent bare error unstamped (background file.upload) — dual path after switch
2. Oversized peek 400-byte window fragile to payload reorder
3. Legacy unstamped file.upload_error applies to active (compat)

See session terminal log for full narrative.
