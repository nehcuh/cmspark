Both suites green `[executed]` — chrome-extension 738/0, companion 3012 pass/0 fail/23 skipped. All hostile checks resolved; writing up findings.

## Findings

### DoD verification (all 7 confirmed)

1. **Retract on failed send** — `upload-send.ts:76` always emits `retract` first; App.tsx:1301-1304 dispatches `REMOVE_MESSAGE` by exact closure-captured `clientMessageId`. `[inspected]` + tests `[executed]`
2. **No double ❌** — verified against the real SW handler (`background/index.ts:641-664`): offline (`sent=false`) and frame-refusal both broadcast `file.upload_error` **and** answer `{ok:false}` → `uploadSendOutcome` maps any object response without `ok` to `refused` → no panel bubble. The only `error` outcome is no-response (SW dead = no broadcast either). Exactly one ❌ on every path. `[executed]`
3. **`lastError` + `{ok:true}` → ok** — `upload-send.ts:44-46` checks `ok` before `swErr`; test locked (`upload-send.test.ts:33`). `[executed]`
4. **Companion-side fail retract via ref** — `useWebSocket.ts:178-179` syncs `pendingUploadRef` every render (same pattern as `activeThreadRef`); listener at 1682-1689 reads the ref, never `state.messages`. After F1 adopt (`agentStore.tsx:573-592` replaces temp id with persisted id), `REMOVE_MESSAGE(tempId)` is a filter no-op — the landed turn survives; test-locked in `sidepanel-state.test.ts:295-320`. `[executed]`
5. **Caption restore both paths** — send-callback `restore_composer` (App.tsx:1310-1311) and listener `REQUEST_COMPOSER_RESTORE` → InputArea effect (App.tsx:380-386, token-keyed, `prev.trim()` guard makes double-restore safe). `[inspected]`
6. **Sniff-only data URL** — `vision-pipeline.ts:96-107`: declared `mime` can never rescue; SVG/garbage/jpeg-labeled non-raster → `null` → `buildFallback("Image is not a recognized raster")` at 174-175. Sniff allowlist (`image-sniff.ts:5-21`) is magic-byte-only on 4 rasters. `[executed]`
7. **Fallback copy + dims** — `formatVisionFallbackSubject` omits empty `(url)`/`0x0`; GIF LSD / WebP VP8X/VP8L/VP8 bit layouts verified against spec offsets (VP8X 24-29, VP8L sig 0x2f@20 + 14-bit fields@21, VP8 start-code 9d 01 2a@23-25); all byte-exact tests pass. `[executed]`

### Nits (non-blocking)

- **N1 — dead `mime` plumb + stale docstring**: `visionImageDataUrl` accepts `mime` but never reads it (`vision-pipeline.ts:96`); the docstring at line 94 implies a declared-mime-allowlist rescue that doesn't exist. The `mime` fields added at `adapter.ts:1186`, `message-router.ts:628,804` are consequently inert. Sniff-only is the right (stricter) call — but then the parameter/docstring mislead. Synthesis acknowledges this residual.
- **N2 — false-green gap on the initial `SET_PENDING_UPLOAD`**: `upload-send.test.ts` greps generic `/SET_PENDING_UPLOAD/` in App.tsx; the ops-loop *clear* (App.tsx:1304) satisfies it even if the *set* (App.tsx:1253) were deleted — the whole listener retract path would silently dead-end while tests stay green. A lock on `pending: { messageId: clientMessageId` would close it.
- **N3 — single-slot `pendingUpload` race**: cross-thread concurrent uploads are reachable (`canSend` at App.tsx:878 blocks only the *active* thread's busy state): upload B overwrites A's pending; A's `file.uploaded` clears it unconditionally (`useWebSocket.ts:1720`) and A's error won't match the tid guard (`useWebSocket.ts:1683`) — so a companion-side failure of the other upload misses its retract. Pre-diff behavior was "never retract at all," so this is an incomplete improvement, not a regression. A message-keyed map would fix it.
- **N4 — ungated cross-thread caption restore**: the listener dispatches `REQUEST_COMPOSER_RESTORE` *before* the thread gate (`useWebSocket.ts:1687`), so on a mid-upload thread switch the old thread's caption can be typed into the new thread's composer. The send-callback path gates `restore_composer` behind `applyToActivePanel` (`upload-send.ts:78-80`) — inconsistent.
- **N5 — redundant branch**: `upload-send.ts:51-52` (`if (swErr) return "error"; return "error"`) — both arms identical.

### ADR-020 checklist

Declaration present and accurate: L1 observe only, no L2/compose/autonomy change, no new gate. Data-URL construction *tightened* (fail-closed sniff; jpeg-wrap of non-rasters eliminated) — trust monotonicity preserved, `data:` usage narrowed. No new `securityConfirmations.request` (originWs n/a), no P1-watchlist surface touched, no new runtime, no experimental write-path dependency. Machine green `[executed]`; adversary lanes + this dual review satisfy the confirmation order; implementer self-approve was not the gate.

All 7 DoD items hold against real code and both suites re-ran green; residual issues are nits the synthesis mostly already owns.

VERDICT: APPROVE_WITH_NITS
