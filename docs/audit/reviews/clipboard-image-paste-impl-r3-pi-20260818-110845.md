# Independent dual-review — clipboard-image-paste-impl-r3

**Scope**: Feature branch `feat/clipboard-image-paste` @ `ad48d6e` vs `origin/main` (`7a88b8c`). I verified the patch file matches the live `git diff origin/main` (identical file list), re-ran the machine suites myself, and inspected the r3 fold commit plus the M1–M6 paths at HEAD.

## MACHINE (re-executed this session)

- companion `tsc --noEmit` + `tsc -p tsconfig.test.json`: **PASS**
- companion targeted (likely-multimodal, image-sniff, image-parts, image-preview, split-upload-files, thread-image-sidecar, context-budget, adapter, llm-provider-anthropic, logger-redact): **111 pass / 0 fail**
- extension `tsc --noEmit` + `tsc -p tsconfig.test.json`: **PASS**
- extension targeted (image-compose, vision-reuse-logic, ws-frame-budget, sidepanel-state, composer-slash-parity): **76 pass / 0 fail**
- `clipboardRead` / `navigator.clipboard.read` in extension: **none**; manifest permissions unchanged
- `MAX_WS_MESSAGE_SIZE` still 10 MiB (`companion/src/ws/lifecycle.ts:67`); soft refuse added at 10MiB−256KiB (`WS_SOFT_MAX`)
- No `fetch`/`fetchImageAsBase64` on composer path; no new `securityConfirmations.request`; no new tools/L2

## M1–M6 at HEAD (r1 REJECT list) — verified closed

| ID | Evidence at HEAD |
|----|------------------|
| M1 thumbs | `message-router.ts:751-759` → `makePreviewB64` (≤8KB/96px) persisted via `thread-manager.ts stampAttachments` → `ChatView.tsx UserImageThumb` renders 48px thumb with `onError` → empty-tile fallback |
| M2 ghost/chips | No optimistic user on upload path (`App.tsx handleSend` file branch adds no bubble); chips clear only on WS `file.uploaded` → `BUMP_COMPOSER_UPLOAD_CLEAR` → `setSelectedFiles([])` (`useWebSocket.ts:1666`, `agentStore.tsx:970`); error path leaves chips intact |
| M3 dest host | `App.tsx:811-819` `effectiveLlmBase` merges `thread.config_override.base_url`; ack keyed `cmspark.imageDestAck.<host>` with ISO; r3 fold fixes storage race by merge-on-hydrate (`App.tsx:831`) |
| M4 tokens | `image-parts.ts estimateImagePartTokens` numeric 1600 / 2800 (aspect ≤1.3 && short ≥1200); `context-budget.ts:79` feeds dims; `estimateMessagesTokens` **is** the runtime budget estimator (`context-budget.ts:320/342/379`); pinned test vectors (1568×1568→2800) |
| M5 edit splice | `spliceEditedCaption` preserves `📎` + `<!-- 用户附图分析 -->` on caption edit (`message-router.ts:1009`); regenerate path hydrates from disk; `captionOnlyForEdit` for the edit box |
| M6 sidecar/HEIC | `planStandaloneImageAnalysis` gates before any `writeImageSidecar` (no vision-off orphans); `partitionUploadFiles` refuses HEIC/HEIF/SVG by MIME **and** basename; sniff-must-match (`admitComposerImage`); sidecar I/O is containment-hardened (lstat dir not symlink, realpath strictly inside, 0o600/0o700, `removeAttachmentsDir` refuses symlink, fork copies via `copyAttachmentsToThread`) |

## r2 named leftovers — all folded in `ad48d6e`

2800-with-dims ✓ · companion WS_SOFT_MAX ✓ · `<untrusted-image>` wrap (+ sanitized name, base64 cannot escape the tag) ✓ · typeless `.heic/.svg` basename refuse (`split-upload-files.ts:56`, `mimeFromName`) ✓ · dest-ack storage race ✓ · `previewDataUrl` ✓ · classifyDrop html/data/blob/file ✓.

## ADR-020 checklist

Declaration present and accurate (Surface L0 — chat composer attachments, no new CDP/tool; L2-classes none; Compose none; Autonomy single; Trust = user-initiated image bytes → effective chat LLM or config.vision, no new confirm dialect; Channel community). No new runtime, no bare "中层 Agent", no new confirm family (dest line is P5-style info, not a gate), trust monotonicity holds (bytes go to the same effective endpoint/key as ordinary chat), originWs N/A (no new confirm `request`). Pixel-prompt-injection mitigated via `<untrusted-image>` markers + system prompt's `<untrusted-*>` DATA rule.

## Leftovers verified at file:line (non-blocking — adversary was accurate, not loose)

1. Mixed HEIC+PNG: paste gate silently filters non-allowlisted types (`App.tsx:1395`); drop can wipe the banner via `setFileError("")` (`App.tsx:1358`). PNG+text survive. Real, minor UX.
2. Composer chips are text not 48px blob thumbs (`App.tsx:1487-1511`) — spec §3.2 deviation; transcript thumbs exist.
3. Transcript dest subtitle `📎 name · → host` not rendered (chip + first-send line only).
4. `if (!written) return uploadError` mid-loop (`message-router.ts:745-748`) returns without throwing → catch-based orphan cleanup skipped if a later image write fails (narrow FS-error window; single 0o600 file; message row never written).
5. Tray origin still allowed for `file.upload` after HMAC (pre-declared).
6. `previewImageSafe` 300KB guard vs companion 8KB generation cap (defense-in-depth, guarded).
7. `ChatCreateParams.imageAttachments` type omits `width`/`height` (`adapter.ts:103-110`) — runtime persists them (structural typing), so the 2800 charge path works; typing hygiene only.
8. Empty `File.type` paste fail-closed (some OS clips never attach) — spec §6.4 wanted client sniff-fill; safe default.
9. Dest ack stamped before WS send — a failed send won't re-show the "图片将发送至" line on retry.

No missed blocker found: orphan-cleanup claim in the fold commit message is accurate for the throw path, and leftover #4's mid-loop `return` gap is correctly named, not silently papered over. No security regression, no data-integrity hole, no stale synthesis.

VERDICT: APPROVE_WITH_NITS
