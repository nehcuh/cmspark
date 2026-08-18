All verification complete. Here is my independent review.

## Pi re-review — clipboard image paste impl r2 (M1–M6 fold)

**HEAD verified**: `071514e` (post `b744d42` fold). Patch at `docs/audit/reviews/clipboard-image-paste-impl-r2-diff-20260818-094224.patch` matches working tree (only docs/memory deltas on top of HEAD — not stale).

### M1–M6 blockers — verified CLOSED in HEAD

| ID | Status | Evidence (file:line) |
|----|--------|----------------------|
| M1 thumbs | **CLOSED** | `companion/src/llm/image-preview.ts:115` `makePreviewB64` — JPEG passthrough ≤8KB, canvas JPEG downscale (96→48px fallback), PNG NN-downscale+encode; `PREVIEW_MAX_EDGE=96`/`PREVIEW_MAX_BYTES=8KB`. Called at persist `message-router.ts:747`; persisted/forwarded via `image-parts.ts:9`, `adapter.ts:108`, `thread-manager.ts:210`; rendered 48px `UserImageThumb` with `previewImageSafe` (≤300KB) guard + empty-tile fallback `ChatView.tsx:566-588`. Commit `071514e` covers large-JPEG canvas path. |
| M2 ghost/chips | **CLOSED** | Upload path appends **no** optimistic user message (only text `chat.send` does, deduped via `clientMessageId`, `App.tsx:1212-1244`). Chips survive until companion admit: cleared only on `file.uploaded` (`App.tsx:1461` onMessage; `useWebSocket.ts:1666` `BUMP_COMPOSER_UPLOAD_CLEAR`); `file.upload_error` keeps chips + renders ❌ (`App.tsx:1168-1173` comment "Keep chips on error"; `useWebSocket.ts:1626-1662`). |
| M3 dest host | **CLOSED** | `App.tsx:815-819` `effectiveLlmBase` = `config_override.base_url` → `state.config.base_url`; chip `App.tsx:1541`; first-send ack `App.tsx:1092-1096` uses effective host, ISO timestamp in `cmspark.imageDestAck.*`, set **before** send (`sendingRef.current=true` at 1109). |
| M4 tokens | **CLOSED** | `context-budget.ts:79` `n += estimateImagePartTokens()` — numeric, not `estimateTokens("[image:1600]")`. `image-parts.ts:24-31` returns 1600 (2800 square ≥1200). Test `context-budget.test.ts:59` asserts ≥1600. |
| M5 edit splice | **CLOSED** | `split-upload-files.ts:97` `spliceEditedCaption` preserves `<!-- 用户附图分析 -->` + 📎; wired at `message-router.ts:996` in `chat.regenerate`. Test `split-upload-files.test.ts:142`. |
| M6 sidecar/HEIC | **CLOSED** | Plan-before-write: `message-router.ts:721-726` `planStandaloneImageAnalysis` error → `uploadError` **before** `writeImageSidecar` at 742-755 (no orphans on vision-off). `image/heic`/`image/svg` declared → refuse `split-upload-files.ts:62-66` (not parseFile-as-doc); sniff+declared match `image-sniff.ts`. Sidecar containment: realpath, 0o600/0o700, symlink refusal (tests pass). |

### Machine (re-ran myself)
- Companion fold: `context-budget / image-parts / image-preview / split-upload-files / image-sniff / thread-image-sidecar` — **47/47 pass** (tsc test build clean).
- Extension: full suite **698/698 pass**; `tsc --noEmit` (test + build configs) clean.

### ADR-020 capability checklist
- Declaration present in batch (r2 synthesis): `Surface L0 · L2-classes (none) · Compose none · Autonomy single · Trust user images → effective LLM/vision · no new confirm · Channel community` — consistent with r1.
- No new tools / no new confirm family / no `securityConfirmations.request` (originWs N/A — only diff hit is a "do NOT copy Trust on fork" comment) / no clipboardRead / no new runtime / no TinyClick on write paths. Trust monotonic: pixels go to the same effective endpoint the user configured. No "中层 Agent" mislabel (Compose: none). No checklist violation.

### Nits (non-blocking)
1. `image-preview.ts:132` `previewDataUrl` and `previewFingerprint` are dead exports — ChatView.tsx:570-577 duplicates the magic-prefix→data-URL logic inline instead of importing `previewDataUrl`.
2. `estimateMessagesTokens` never passes dims → always charges 1600; the 2800 square path in `estimateImagePartTokens` is unreachable from the budget estimator (pre-declared leftover).
3. Capability declaration lives in the r2 synthesis doc, not the r2 prompt body — process nit only (no new tools/gates added, so non-blocking per checklist).
4. SW WS headroom compares UTF-16 code-unit length vs companion's byte budget — practically covered by 256KB headroom for base64/CJK (pre-declared leftover).

No blocking issues found. All six r1 blockers are genuinely closed with tests, and the residuals are exactly the pre-named leftovers.

VERDICT: APPROVE_WITH_NITS
