# Dual review — `clipboard-image-paste-design` (design only)

## Verification basis

Diff is docs-only (4 new .md, 791 insertions) and the patch file matches the staged diff — not stale. I grounded every load-bearing claim against real code before judging:

| Spec claim | Code ground | Status |
|---|---|---|
| No paste/drop; docs-only accept | `App.tsx:1244` (accept list), no `onPaste`/`onDrop` in file | ✅ |
| Optimistic user bubble before upload (ghost risk) | `App.tsx:1053-1062` ADD_MESSAGE before `file.upload` | ✅ |
| SW computes `over_companion_10mb` but still sends | `background/index.ts:601-620` | ✅ |
| `MAX_WS_MESSAGE_SIZE` 10MB / maxPayload kills control plane | `lifecycle.ts:67,663` | ✅ |
| Anthropic consecutive-user merge would stringify parts | `anthropic-convert.ts:167-176` (`String(next.content)`) | ✅ |
| `serializeMessage` garbles array content | `context-budget.ts:61` | ✅ |
| Single `addMessage` inside `chatCreate`; docs → `<document>` | `adapter.ts:325-357`; router adds only assistant error turns (`message-router.ts:472`) | ✅ |
| Empty `File.type` rejected today | `validate.ts:717` | ✅ |
| `IMAGE_FORMATS` includes svg/bmp/tiff (must not gate input) | `file-parser.ts:54` | ✅ |
| `kimi-k2`/`moonshot-v1*` false-positive multimodal | `vision-reuse-logic.ts:94` (`/kimi\|moonshot/` → true); companion has **no** `likelyMultimodal` yet (SoT file is new per §10.1) | ✅ |
| Settings lies exist | `vision-reuse-logic.ts:15,38`; `settings-web.ts:668` | ✅ |
| Regenerate replays original content, `skipUserMessage:true` | `message-router.ts:983,993` | ✅ |
| `ALLOWED_IMAGE_MIMES_LIST` = png/jpeg/gif/webp; `normalizeImageMime` reusable | `image-data-url.ts:11-40` | ✅ |
| Message-cap slice exists | `thread-manager.ts:182,904-905` | ✅ |

## ADR-020 capability check

Declaration present and well-formed. Surface L0 is the correct axis (ADR-020 L0 = 对话、附件); Compose none (reuses `file.upload` + vision rail); Autonomy single; Channel community. No new confirm dialect (destination disclosure is chip + one-line, not a `SecurityConfirmationManager` family). No new WS message family, no new runtime, no new primary Side Panel chrome. Trust monotonicity intact — vision rail keeps `shouldBlockVisionRequest`, no `clipboardRead`, main key same trust class as normal chat. Pack-first N/A for composer UX. `originWs` N/A (no new confirm `request(`). **Passes.**

## Trajectory

The locked table genuinely absorbed the three lanes' blockers — I traced S1–S8, A1–A8, P1–P8 into concrete spec sections and each corresponds to a real defect in current code (verified above). Not papered over.

## Blocking issue

The spec is incomplete on one of its three routing rows:

1. **Vision-rail turn has no carrier for the `analyzeImage` description and no replay story.** §4 (row `!useNative` 且 vision 开 → "`analyzeImage` → 文字") requires the description to reach the LLM, but §5.1 locks the persistence shape as `content = 用户文案 + "\n📎 " + 显示名列表` plus an `imageAttachments` schema that is metadata-only (name/mime/sha256/bytes/preview) — there is **no field anywhere** that can carry the description text, and `fileContents` is pinned to "解析后的文档 ONLY". Consequence under faithful implementation: `chat.regenerate` replays the original persisted content with `skipUserMessage:true` (`message-router.ts:983,993`) and `hydrateUserImageParts` (§5.2) injects parts only — so regenerating a vision-rail image turn drops the description entirely. The existing doc flow persists descriptions (`message-router.ts:601-607` → `adapter.ts:355` → persisted at `357`); this spec changes images off that path without defining the replacement. This is exactly the failure class the spec itself forbids (§10: "没有 hydrate 的 UI 只是「第一轮能看、regen 变瞎」"), it hits the spec's #2 JTBD persona (DeepSeek/llama3.1 + vision), and DoD §11 has no item covering vision-rail replay. Fix is a small amendment: choose the description's carrier (append to persisted disk content like the existing embedded-image flow, or add e.g. `vision_text` to `attachments`) + add a DoD line.

## Non-blocking nits

- §3.7/§5.4: 1600 tok/image is OpenAI-tile-calibrated; Anthropic ≈ (w·h)/750 ≈ 3.3k for 1568² — under-reserves on Anthropic protocol. Consider protocol-aware estimate or a note.
- §4: snippet says `useNative = likelyMultimodal(effective.model_name) // 不看 protocol` while the correction bullet says "Anthropic 协议 + Claude → true" — claude-family names already return true by name regex so there's no functional hole, but the two sentences read as contradictory; clarify (or pass protocol explicitly).
- §5.5 sidecar-cleanup list omits `deleteMessagesFrom` (`thread-manager.ts:996`) — regenerate deeper in history deletes later image turns and orphans their sidecars until thread hard-delete (leak only, not escape).
- Router writes the sidecar (§5.1 step 3) before the LLM-loop gate / thread re-checks (`message-router.ts:640-664`) — gate rejection after parse orphans a sidecar; bounded by thread-delete cleanup, worth one sentence.
- §3.3 preflight checks `vision.enabled` only; companion gates vision on `vision.enabled && file_upload.enable_vision_analysis` (`message-router.ts:569`). Mismatch lands on the specified `file.upload_error`, so not silent — but aligning avoids a guaranteed-fail send.
- §3.6: ensure the ack store is keyed by destination hostname itself (including `thread.config_override` base_url hosts), not by `llm.base_url`, since the chip copy promises per-rail hostname disclosure.

Everything else — WS frame budget math (6MiB decoded ≈ 8MiB b64 + joint envelope headroom), sniff/normalize reuse, sidecar containment, ghost-bubble recovery, kimi-k2 correction, settings-copy rewrite targets, and the hydrate-only injection architecture for the native path — is grounded, internally consistent, and implementable.

VERDICT: REJECT
