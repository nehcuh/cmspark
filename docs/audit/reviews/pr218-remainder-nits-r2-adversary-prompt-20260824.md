# Incremental adversary — PR #218 remainder nits fold (after APPROVE_WITH_NITS)

You previously wrote `docs/audit/reviews/pr218-remainder-nits-adversary-20260824.md` with VERDICT: APPROVE_WITH_NITS (N1–N9).

Implementer claimed to fold:

| Nit | Claimed fix |
|-----|-------------|
| N1 leftover steer after chat.done | `dropSteer(threadId)` in `chatCreate` try/finally (`adapter.ts`) |
| N2 steer not lease/conductor gated | `gateChatCreateOnLease` + `gateChatCreateOnConductor` in `chat.steer` |
| N3 no live chat.user for steer | `sendToExtension({type:"chat.user", ...})` after persist |
| N4 uncapped steer | `MAX_STEER=8`, `steer_queue_full` |
| N5 trim can keep [] | keep assistant+tools (over-cap) rather than empty |
| N6 missing tests | isTruncatedToolBatch; abort does not drain nextRun; lease gate test |
| N7 validate vs empty_steer strings | **not folded** (WS validate still fail-closed; empty_steer is handleMessage bypass) |
| N8 overflow "context window" miss | regex includes `context window` / `exceeds the (model's )?context` |
| N9 length retry may not enlarge output budget | **not folded** (retry-once then stop is the spec) |

READ live files. Confirm N1–N6 and N8 are actually gone at production call sites. Confirm N7/N9 remain documented residuals only.

Do NOT REJECT for missing Continue UI / lanes / op-log.

If a claimed fold is fake or a new BLOCK exists → REJECT.
If folds hold and only N7/N9 (or similar non-blocking) remain → APPROVE or APPROVE_WITH_NITS.

Write to `docs/audit/reviews/pr218-remainder-nits-r2-adversary-20260824.md`
End with exactly:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
