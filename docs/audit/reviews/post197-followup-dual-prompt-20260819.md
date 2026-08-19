# Dual review: post-#197 Important follow-up (F2 retract + vision mime + dims)

## Context

Post-merge review of `98bb586` found 3 Importants. This branch lands them, then folded 4-lane adversarial (security/correctness/UI/tests). UI+Tests R2 REJECT'd a real P0 (stale `state.messages` in a mount-once listener); that is now folded via `pendingUploadRef`.

Adversarial synthesis: `docs/audit/reviews/post197-followup-adversary-synthesis-20260819.md`

## Capability declaration (ADR-020)

```text
Surface:      L1 observe (vision analyze + sidepanel composer)
L2-classes:   none
Compose:      none
Autonomy:     single
Trust:        no new gate; raster sniff allowlist reused
Channel:      community
```

## Locked DoD

1. Failed `file.upload` send (SW `{ok:false}` or no answer) retracts the optimistic user bubble by exact `clientMessageId`.
2. SW-answered `{ok:false}` does **not** stack a second 「Companion 未连接」 bubble (`uploadSendOutcome` → `refused`; SW already broadcast `file.upload_error`).
3. `lastError` + `{ok:true}` is **ok** (do not retract a landed turn).
4. Companion `file.upload_error` after WS accept retracts via `pendingUploadRef` (never `state.messages` in the mount-once listener).
5. Caption restored if the composer is still empty (send-callback `restore_composer` **and** parse-fail `REQUEST_COMPOSER_RESTORE`).
6. `visionImageDataUrl` is sniff-only; SVG/garbage/`image/jpeg` on non-raster → `null` → fallback "not a recognized raster".
7. Fallback subject omits empty `(url)` and `0x0px`. GIF/WebP/VP8* dims parse.

## Files in scope

```
chrome-extension/src/sidepanel/App.tsx
chrome-extension/src/sidepanel/store/agentStore.tsx
chrome-extension/src/sidepanel/utils/upload-send.ts
chrome-extension/src/sidepanel/hooks/useWebSocket.ts
chrome-extension/tests/upload-send.test.ts
chrome-extension/tests/sidepanel-state.test.ts
chrome-extension/tests/stream-thread-gate.test.ts
companion/src/llm/vision-pipeline.ts
companion/src/llm/image-preview.ts
companion/src/llm/adapter.ts
companion/src/message-router.ts
companion/tests/vision-pipeline.test.ts
companion/tests/image-preview.test.ts
```

Read full files, not only the patch. Ignore unrelated dirty tree (`.grok/`, `.impeccable/`).

## Tests claimed

- chrome-extension: 738 pass / 0 fail
- companion: `npm test` exit 0 this session

You may re-run targeted tests. Do not require full monorepo green if targeted pass.

## Review focus (hostile)

1. Can `pendingUploadRef` still be stale, or can `REMOVE_MESSAGE` hit the wrong turn after F1 adopt?
2. Double ❌ still possible on the real offline path?
3. `visionImageDataUrl` still jpeg-wrap anything?
4. Missing tests that would stay green if App forgot `SET_PENDING_UPLOAD`?
5. Trust monotonicity / new confirms / data: scheme expansion?
6. Apply ADR-020 checklist.

## Output

Findings with file:line, then **exactly one final line**:

`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
