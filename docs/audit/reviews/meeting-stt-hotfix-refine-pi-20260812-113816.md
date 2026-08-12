I've completed a full review of the batch: read the entire 3140-line patch, verified it against the live working tree (patch is current — matches `git diff origin/main` + staged, 26 files/1666 insertions), and inspected the actual control flow in every listed file. I also re-ran the machine checks rather than trusting the implementer's numbers.

**Verification performed**

- **Tests (not stale)**: chrome-extension `tsc -p tsconfig.test.json` + `node --test` → **643/643 pass** (incl. meeting-live-refine 6/6, error-map, whisper-settings-copy). Companion `voice-asr-refiner` + `voice-stt-session-service` → **31/31 pass**. Companion `tsc --noEmit` clean.
- **Floors 1–8 (all pass, code-verified)**:
  1. Soft set narrowed to `infer_failed/empty_result/infer_timeout/binary_broken/partial_skipped`; `resource_conflict`/`session_busy` → abort parent+seg, single retry, then hard stop; `oom` hard (`isHardSttSegmentError`). Streak≤3 then `onEnd`. Verified in `local-stt-adapter.ts` (continuous, streaming, and no-pending `onWs` branches).
  2. `resolveWhisperBinary` (`binary-resolve.ts:186-192`): user-cache accepted only with matching `install.manifest.json` digests (primary + all staged files); no bare pin skip; mismatch → `hash_mismatch`. Pin matrix fail-closed via `allowUnpinned:false`; darwin-arm64 pin matches the actual `dist/bin` SHA. Windows zip installs (no manifest) now fail-closed on pin drift rather than bypassing — safe.
  3. `refine-handlers.ts`: origin fence (`isChromeExtensionOrigin`), client `systemPrompt` stripped, `priorContext` capped 2k server-side, `guardAsrRefineOutput` still compares model out vs **raw segment**.
  4. Dual ack: button `disabled={...||!ack||!voicePrivacyAckV2}`; path checks in `startLiveCapture` + `startLocalSegments`; wire `privacy_ack_v1` on `meeting.start` + `privacy_ack_v2:true` enforced in `ws/validate.ts:372`. Ack persists to chrome.storage.
  5. Soft banner = mapped message + 「本段转写已丢失（不可恢复）；后续段继续；结束会议默认仍删音频」 — no retry-this-segment claim.
  6. `priorContext` bounded at client (`clipPriorContextForRefine`, 2k), WS validate (2k), and handler (2k); guard is vs raw only.
  7. `asrRefinerEnabled` defaults false, persists; no auto-send.
  8. `asr_refiner` source tag distinct from `user_edit`/`stt`; minutes job untouched.
- **ADR-020 checklist** (`dual-review-capability-checklist.md` applied): declaration present and accurate (L0 Surface, no L2/Compose/Autonomy, Trust = dual ack + manifest + correct_only, Channel community). Axes fit — reuses existing `voice.refine.*`, no new tools/Pack/runtime, no new confirmations, no originWs regression, no P1 watchlist touch. No "中层 Agent" language anywhere.
- **End-to-end refine path**: background relays companion `voice.refine.result` to the sidepanel via `chrome.runtime.sendMessage` (`background/index.ts:429`), which is exactly what `requestMeetingSegmentRefine` subscribes to (same mechanism as dictation refine). SW whitelist additions (`voice.stt.partial_request`, `voice.binary.download/cancel`) close the「扩展版本过旧」false-alarm holes.
- **F-merge-4**: `package.sh` hard-fails on 0 dylibs and on absolute Homebrew otool paths (`set -euo pipefail` active).

**Nits (non-blocking)**

1. Meeting live refine gates on `asrRefinerEnabled` + dual ack only, while dictation refine additionally requires `privacyAckV3` (`MeetingPanel.tsx:291-319` vs `useVoiceInput.ts:477-496`). Meeting ack v1 covers LLM use, so this is a consistency nit, not a trust decrease.
2. `finalizeCapture` race: `meeting.end` + `apply_silence_cut` snapshot the transcript before in-flight refines resolve; late refined segments append after end (may miss minutes; if user starts a new meeting first, `meetingIdRef.current` at resolve time redirects the segment into the new meeting) — `MeetingPanel.tsx:303-307, 344-352`.
3. Early-SIGKILL runner message contains "OOM" (`whisper-runner.ts:258`), so `stt-session-service.ts:479-481`'s oom regex fires before the dyld regex (line 483) → a dyld early-kill can be labeled 内存不足. Both are hard-stop, so only the copy is off.
4. `package.sh:282-299` fails only on **0** dylibs; a partial set (libwhisper present, libggml-cpu/metal soname missing) ships and relies on `DYLD_FALLBACK_LIBRARY_PATH` (still includes `/opt/homebrew/lib`, `/usr/local/lib` — `whisper-runner.ts:216-222`, adversary A-F3 residual). otool gate is skipped when otool is absent.
5. Near-rt soft streak is double-counted per failed window (no-pending start-error branch + end-error branch both increment) → hard stop after ~2 windows instead of 3. Bounded and fail-safe.
6. `build-cmspark-whisper.sh` only WARNINGs on 0 dylibs (package.sh is the hard gate) — matches the claim's scope, but a direct `dist/` consumer could still ship broken.

Residual risks noted per instructions (brew trust chain = manifest binds install-time state, self-referential vs a local attacker; SEA hot-swap untouched; concurrent refine: 20s client timeout vs 45s server timeout means late results are discarded client-side but server work continues). None rise to blocking.

VERDICT: APPROVE_WITH_NITS
