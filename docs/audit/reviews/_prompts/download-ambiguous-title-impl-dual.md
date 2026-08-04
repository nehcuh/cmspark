# Dual re-review: download / ELEMENT_AMBIGUOUS / thread title fixes

**Goals doc (mandatory):** docs/superpowers/specs/2026-08-04-download-ambiguous-title-fix-goals.md

**Range:** origin/main..HEAD on branch fix/download-ambiguous-thread-title

## Verify G1–G3 against real code

1. G1: static import of downloads-find in browser-bridge; user_hint_zh on failures
2. G2: ELEMENT_AMBIGUOUS user_hint_zh + matches; fail-closed (no auto-click first)
3. G3: provisionalTitleFromUserText + ensureProvisionalThreadTitle on first user; generateThreadTitle upgrades provisional; ThreadList 未命名 fallback; title fail logs

## Capability

Surface L1 browser; Compose tools UX; Trust no weaker; no confirm-skip.

## Verdict

REJECT if G1.1 fails (still dynamic import) or auto-click multi-match or no provisional title path.
APPROVE_WITH_NITS if only polish remains.
APPROVE if all G1–G3 solid.

End with exactly:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
