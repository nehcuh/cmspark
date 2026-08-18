All claims verified against real code and machine output. Here is my independent review.

## MACHINE (independently re-run)

- `companion` full suite: **2934 pass / 15 fail** — all 15 are pre-existing and unrelated (`computer-uia-watch` ×2, `computer-executor` ×12, `allow-dir-expand` ×1; none touched by this branch). New-file targeted suites green.
- `chrome-extension` full suite: **698 pass / 0 fail** (superset of the claimed 42).
- `chrome-extension` `tsc --noEmit`: **PASS**.
- Patch freshness: `git diff main` body matches the attached patch exactly (only appended review docs differ). Not stale.

## Adversary table — confirmed

**Product/UX REJECT is accurate.** I checked each claim against code and cannot argue it away:

- **M1 — no `preview_jpeg_b64` anywhere → empty history thumbs.** The companion never generates a preview: `message-router.ts:721–735` builds `imageAttachments` from `{name, mime, sha256, bytes}` only (comment: "preview JPEG skipped — no canvas"); `adapter.ts` addMessage passes them through unchanged; grep shows `preview_jpeg_b64` only at type/passthrough sites. `ChatView.tsx:561–584` (`UserImageThumb`) renders an **empty tile** (`thumbEmpty`) when preview is absent. In-session the optimistic bubble (`App.tsx:1204–1211`) carries no attachments at all. Spec §3.4/§5.5 (≤8KB/96px preview, "历史里看得到小图" JTBD) is unmet. **Blocking.**
- **M2 — ghost user + chips cleared on SW ok, before companion admit.** `App.tsx:1245` claims "chips stay until file.uploaded / SW ok", but the SW-callback `setSelectedFiles([])` fires on `response?.ok`, which in `background/index.ts:598` is only `ok: sent` (WS delivery, not companion admit). On companion refusal (`message-router.ts:481–488` writes the ❌ assistant row) the optimistic user bubble is never rolled back → ghost user + ❌, chips already gone. Spec §3.3/§7 explicitly forbid this. **Blocking.**
- **M3 — dest host ignores `config_override.base_url`.** `App.tsx:1064–1065` computes the ack key/host from `state.config.base_url` only; `App.tsx:810–816` `destHost` uses global `base_url`/`vision_base_url` (model is override-aware, base_url is not). A thread overriding `model_name` to a multimodal model on another endpoint shows the wrong destination on chip + first-send line. Spec §3.6 is explicit. This is the feature's only pixel-destination trust surface. **Blocking.**
- **M4 — token ≈3 not 1600.** `context-budget.ts:63–66` serializes image parts as `[image:${estimateImagePartTokens()}]` with **no dims** (→ 1600 literal), then `estimateMessagesTokens` runs `estimateTokens` (chars/4, `summary-export.ts:42–50`) → `[image:1600]` ≈ **3 tokens**. The §5.4 1600/2800 table never reaches the budget; the test at `context-budget.test.ts:56` even enshrines the `[image:\d+]` shape. **Real.**
- **M5 — edit strips §5.1a.** `image-compose.ts:86–89` `captionOnlyForEdit` removes `<!-- 用户附图分析 -->`; `ChatView.tsx:717` feeds it to the edit box; `message-router.ts:988–991` persists the stripped content; regenerate (`skipUserMessage`) then replays caption-only → the text-model vision rail loses the image description permanently. Locked spec §5.1a. **Real.**
- **M6 — sidecar written before plan; HEIC/SVG become docs.** `message-router.ts:721–744` writes sidecars, then `planStandaloneImageAnalysis` at :746 can still error → `uploadError` → **orphaned `.files/`** (cleaned only on thread delete). And `partitionUploadFiles` (`split-upload-files.ts:45–60`) sends declared `image/heic|image/svg+xml` to the **docs branch → parseFile** instead of refusing as image (spec §6). Extension-side ingest already rejects these (`App.tsx:1324–1326`), limiting user-facing blast, but the companion boundary deviates. **Real.**

**Security/Arch APPROVE_WITH_NITS is fair.** Independently verified: no `clipboardRead` / `navigator.clipboard.read()` (only pre-existing `writeText`); sidecar containment is solid (`image-sidecar.ts` — strict id regexes, `lstat` not-symlink, `realpath` strict-inside, client `rel` never used as a path, contained unlink/rmSync); Anthropic image blocks accept only `data:` URLs (no fetch); drop classifier never fetches; logger redaction extended (`base64|image_url|^content$`); SW refuses oversize frames with 256KiB headroom. Nits as the adversary listed: headroom is SW-only; `<untrusted-image>` system-prompt marking not implemented (accepted residual).

**ADR-020 checklist:** declaration present (L0 / no L2 / Compose none / single / no new confirm family / community). No new runtime, no new L2, no `clipboardRead`, no new `SecurityConfirmationManager` family (ack is a storage flag + chip), no `securityConfirmations.request` (originWs N/A), trust monotonic (pixels go to the same effective chat endpoint the user configured). No checklist violation.

## Verdict

The Product lane findings are locked-spec violations with code-level evidence, not nits — I cannot argue them to non-blocking. M1 kills the headline history-thumb outcome, M2 violates an explicit §7 prohibition, M3 mislabels the destination of user image bytes. Per the gate, VERDICT must not be APPROVE; since I do not believe these are non-blocking, APPROVE_WITH_NITS is not available.

**Blocking (before merge):**
1. `companion/src/message-router.ts:721–735` + `ChatView.tsx:561–584` — companion must generate `preview_jpeg_b64` (or blob thumbs that survive `chat.user` adoption); empty tiles ≠ P1.
2. `App.tsx:1157–1246` + `message-router.ts:481–488` — chips must survive until companion admit; remove the optimistic user bubble (or ❌) on `file.upload_error`.
3. `App.tsx:810–816,1064–1065` — destination host/ack key must use effective `{...llm, ...config_override}.base_url`.
4. `companion/src/llm/context-budget.ts:63–66` — add `estimateImagePartTokens(width,height)` numerically per part, not via text serialization.
5. `image-compose.ts:86–89` + `message-router.ts:988–991` — edit must splice, not strip, the §5.1a block.
6. `message-router.ts:721–746` — move sidecar writes after `planStandaloneImageAnalysis`; refuse `image/*` failing `normalizeImageMime` instead of routing to `parseFile`.

VERDICT: REJECT
