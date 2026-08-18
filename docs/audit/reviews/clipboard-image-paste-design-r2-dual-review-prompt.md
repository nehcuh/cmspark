# Dual-review prompt r2 — folded clipboard-image-paste design

**Batch**: `clipboard-image-paste-design-r2`  
**Nature**: design re-review after r1 fold. **No implementation code.**  
**r1**: Claude **REJECT** + Pi **APPROVE_WITH_NITS** → `clipboard-image-paste-design-verdict-20260817-161248.json`

## Your job this round

This is **not** a first-principles redesign. Decide whether the **folded spec** closed r1, and whether anything still blocks implementation planning.

1. Read the **current** SoT: `docs/superpowers/specs/2026-08-17-clipboard-image-paste-design.md`
2. Read r1 reports and confirm each item is absorbed or explicitly residual:
   - Claude REJECT: `docs/audit/reviews/clipboard-image-paste-design-claude-20260817-161248.md`  
     Blocker was: vision-rail `analyzeImage` text had no persist/replay carrier.
   - Pi nits: `docs/audit/reviews/clipboard-image-paste-design-pi-20260817-161248.md`
   - Orchestrator fold note: `docs/audit/reviews/clipboard-image-paste-adversary-synthesis-20260817.md` (Dual review section)
3. Ground remaining claims in real code (same files as r1). Do not rubber-stamp.

## r1 items that MUST be closed in the folded spec (verify by section)

| Source | Claim | Expected lock |
|--------|--------|----------------|
| Claude blocker | Vision-rail description vanishes on regenerate | **§5.1a** — description appended to disk `content` (`<!-- 用户附图分析 -->`); no `vision_text`-only field; DoD #16 |
| Pi nit 1 | Preflight ignored `enable_vision_analysis` | §3.3 + §4 use `vision.enabled && enable_vision_analysis !== false` |
| Pi nit 2 | 1600 tok under-counts squares | §5.4 1600 vs 2800 by aspect |
| Pi nit 3 | Companion must re-validate caps | §5.1 step 6 |
| Pi nit 4 | Extension test file unnamed | §10 item 1 names `vision-reuse-logic.test.ts` |
| Claude nit | `deleteMessagesFrom` orphans sidecars | §5.5 |
| Claude nit | Sidecar written before LLM gates | §5.1 step 5 |
| Claude nit | Ack key not hostname | §3.6 keyed by hostname including override |

If any of the above is missing or internally contradictory → **REJECT** that item as still blocking.

## Still do not reopen (unless newly product-broken)

User locks: all clipboard sources; mixed send; paste+picker+drop; native when multimodal else vision; no silent native→vision fallback; no new L2 confirm.

## Capability (unchanged)

```text
Surface:      L0 (chat composer attachments — no new CDP/tool)
L2-classes:   (none)
Compose:      none (reuses file.upload + vision rail)
Autonomy:     single
Trust:        user-initiated image bytes → effective chat LLM (native)
              or config.vision (text-only). No new confirm dialect.
              Destination hostname on chip + first-send line.
Channel:      community
```

## Verdict rules

- Do **not** reject solely because there is no code.
- REJECT only if the folded spec is still incomplete / contradictory / r1 blocker unfixed.
- APPROVE_WITH_NITS = r1 closed; leftover nits are non-blocking for writing an implementation plan.
- End with exactly one line:

VERDICT: APPROVE  
VERDICT: APPROVE_WITH_NITS  
VERDICT: REJECT  
