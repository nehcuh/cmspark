# Dual-review prompt — clipboard / composer user images (design only)

**Batch**: `clipboard-image-paste-design`  
**Nature**: product + architecture lock. **No implementation code in this batch.**  
**Confirm order already done**: 3 isolated adversary lanes REJECTED the strawman; orchestrator absorbed blockers into the locked spec.

## Read these (in order)

1. `docs/superpowers/specs/2026-08-17-clipboard-image-paste-design.md` — **SoT, review this**
2. `docs/audit/reviews/clipboard-image-paste-adversary-synthesis-20260817.md` — locked table
3. `docs/decisions/clipboard-image-paste-strawman-2026-08-17.md` — superseded where it conflicts
4. `docs/decisions/vision-reuse-main-llm-brief-2026-08-08.md` — P0 “main loop does not receive images” is now **split**: screenshots stay pre-analyze; **user attachments** may be native
5. ADR-020 + `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

Ground in real code (do not rubber-stamp):

- `chrome-extension/src/sidepanel/App.tsx` (InputArea, file.upload, optimistic ADD_MESSAGE)
- `companion/src/llm/adapter.ts` (`fileContents`, `rebuildMessagesFromHistory`, `skipUserMessage`)
- `companion/src/llm/providers/anthropic-convert.ts` (consecutive user merge)
- `companion/src/llm/context-budget.ts` (`serializeMessage`, redact)
- `companion/src/ws/lifecycle.ts` (`MAX_WS_MESSAGE_SIZE`)
- `companion/src/ws/validate.ts` (`file.upload`)
- `companion/src/threads/thread-manager.ts` (Message, delete)
- `chrome-extension/src/sidepanel/components/vision-reuse-logic.ts` (`likelyMultimodal`, `VISION_COPY`)

## Capability declaration (from spec §0)

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

## What you must decide

This is a **design** review. Ask:

1. **Outcome**: If implemented faithfully, does paste-screenshot-into-chat + native-if-multimodal actually work (first send, regenerate, model switch, Anthropic compact merge, WS 10MB, OS Retina screenshot)?
2. **Trajectory**: Did the locked table absorb Product/Security/Architecture blockers, or paper over them?
3. **Component**: Any remaining hole that will 400, drop pixels, escape paths, or ship a lie in settings copy?
4. **ADR-020**: Axes, Pack-first, no new confirm family, trust monotonicity, no new runtime.

Do **not** reject solely because there is no code. Reject if the **spec** is still incomplete or internally contradictory.

User-locked (do not reopen unless product-broken): all clipboard sources; mixed send; paste+picker+drop; native when multimodal else vision; no silent native→vision fallback; no new L2 confirm.

## Verdict

End with exactly one of:

VERDICT: APPROVE  
VERDICT: APPROVE_WITH_NITS  
VERDICT: REJECT  

If REJECT: blocking list with spec section or file:line **before** the verdict line.  
If APPROVE_WITH_NITS: non-blocking nits only before the verdict line.
