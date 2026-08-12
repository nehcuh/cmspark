## Reviewer verdict

I read the prompt, the patch (`meeting-stt-hotfix-refine-diff-20260812-113816.patch`), and the live working-tree code at the cited paths. The patch file is **not stale** — `git status` shows the same file set with the listed changes uncommitted on `main`. I also re-ran the machine checks:

- `chrome-extension`: `npm test` → **643 pass / 0 fail** (incl. `meeting-live-refine` 6/6).
- `companion`: `voice-asr-refiner` + `voice-stt-session-service` (`tsconfig.test`) → **31 pass / 0 fail**.

### Floors (blocking checklist)

| # | Floor | Status | Evidence |
|---|---|---|---|
| 1 | No soft-loop on conflict/busy/oom | ✅ | `local-stt-adapter.ts:54-78` excludes those from `isSoftSttSegmentError`; streaming path at `local-stt-adapter.ts:657-670` aborts+retries then hard-stops on conflict/busy; `oom` is hard via `isHardSttSegmentError` and `stt-session-service.ts:480`. Streak cap `SOFT_FAIL_MAX=3` enforced in both classic and streaming branches. |
| 2 | User-cache whisper not trusted unpinned | ✅ (with nit) | `binary-resolve.ts:188-194` only accepts the user-cache path when `verifyUserWhisperInstallManifest` validates primary + every dylib digest. No bare pin skip. (See nit 1.) |
| 3 | `voice.refine` origin fence + correct_only | ✅ | `refine-handlers.ts:95-102` rejects non-chrome-extension origin; client `systemPrompt` ignored with warn at `:122-124`; guards in `asr-refiner.ts:78-102` compare model out vs **raw** (`priorContext` excluded from length base). |
| 4 | Dual ack gates start | ✅ | Button `disabled={busy || !ack || !state.voicePrivacyAckV2}` at `MeetingPanel.tsx:1308`; `startLiveCapture` (line 648) and `startLocalSegments` (line 394) both early-return when `voicePrivacyAckV2` missing. |
| 5 | Honest soft banner | ✅ | `meeting-live-refine.ts:11-13` + `MeetingPanel.tsx:432-434`. Copy explicitly says irreversible loss + default delete audio; no “retry this segment” language. |
| 6 | priorContext can't bypass length guard | ✅ | Triple-capped: `validate.ts:457-462` (≤2000 chars, must be string), `refine-handlers.ts:135` (re-clip 2000), `asr-refiner.ts:116-118` (re-clip 2000). `guardAsrRefineOutput` length base is `raw`, not prior. |
| 7 | Default refine off / no auto-send | ✅ | `agentStore.tsx:379` `asrRefinerEnabled:false`; checkbox at `MeetingPanel.tsx:1270-1278`; commit only on `finalChunk?.trim()`; no chat auto-send path. |
| 8 | asr_refiner ≠ meeting_minutes | ✅ | `asr-refiner.ts:10-29` correct_only prompt; meeting-minutes is a separate handler. `appendLocalAndRemote` source tag at `MeetingPanel.tsx:261,317` is metadata only. |

### ADR-020 capability check

Capability declaration is present and complete (Surface L0; no L2; no Compose; no Autonomy; dual ack + install.manifest + pinned binary + correct_only; community channel). Pack-first: no new tool/pack UI surface — both new toggles (`录制 AI 纠错`, `结束时智能分段`) bind to existing local state and existing tools. No new confirmation family. Trust monotonicity preserved (L0 path gains no L2 host perms). `originWs` not regressed: refine handlers do not call `securityConfirmations.request`. No new runtime. **All axes pass.**

### Adversary absorb verification (against synthesis doc)

F-merge-1..6 all materially present in code, not just prose:
- **F-merge-1** (`binary-resolve.ts:81-108, 188-194`): manifest check.
- **F-merge-2** (`local-stt-adapter.ts:54-78, 277-298, 632-670, 761-791`): narrow soft set + streak cap + conflict reclaim + oom hard.
- **F-merge-3** (`local-stt-adapter.ts:632-694`): stream path start/end soft/hard aligned; soft path does not call `onEnd` after streak threshold.
- **F-merge-4** (`package.sh:297-303` hard-fails 0 dylib and absolute homebrew otool paths; `build-cmspark-whisper.sh:135-220` rewrites install names; `SettingsSlideout.tsx:1539-552` and `whisper-settings-copy.ts` macOS brew honesty).
- **F-merge-5** (`whisper-runner.ts:252-261` early SIGKILL → `spawn_error`; `stt-session-service.ts:482-488` dyld regex → `binary_broken`; `error-map.ts:140-147` + `meeting-live-refine.ts:11-13` honest copy).
- **F-merge-6** (`MeetingPanel.tsx:1305-1318` dual ack disabled + tooltip).

### Residual risks (non-blocking nits)

1. **F-merge-1 partial close (binary-resolve.ts:188-194)**: `install.manifest.json` is written into the same user-writable dir (`~/.cmspark-agent/bin/whisper/<arch>/`) as the binary. The digest check catches *accidental* corruption (partial writes, mismatched dylib soname) but an attacker who controls that cache dir can substitute both the binary and the manifest in one pass. True pin would require either a hard-coded brew-version digest or a signed-HTTPS source for macOS. Treat the user-cache path as a soft trust boundary, not a strong pin.

2. **meeting.end / generate_minutes race with in-flight refine (MeetingPanel.tsx:355-378)**: `finalizeCapture` waits `refinePending > 0 ? 800 : 100` ms before sending `meeting.generate_minutes`. A slow LLM (refine timeout is 20s in `meeting-live-refine.ts:133`) can still resolve *after* `meeting.end` and `meeting.generate_minutes` fire. `appendTranscript` (meeting-store.ts:287-298) always appends regardless of status, so the refined segment lands in the transcript store but may be absent from the minutes. User can regenerate — not silent data loss, but a visible-but-not-in-minutes edge case.

3. **`binary_broken` in soft-continue set (local-stt-adapter.ts:60)**: by F-merge-2 spec this is intentional, but `binary_broken` is sticky (dyld missing libs doesn't self-heal between 8s windows). The streak cap of 3 means up to ~24s of wasted audio capture + 3 rapid infer failures before hard-stop. A first-strike hard-stop on `binary_broken` would be more honest.

4. **DYLD expansion in whisper-runner.ts:213-225**: `DYLD_FALLBACK_LIBRARY_PATH` is set to include `/opt/homebrew/lib` and `/usr/local/lib` at whisper spawn. On a normal macOS install these are root-writable so the risk is low, and hardened-runtime binaries often ignore `DYLD_*` anyway, but it does expand the dyld search path beyond `@loader_path`. Worth a comment or a future tightening.

5. **Dead defensive check at local-stt-adapter.ts:643-647**: `!isHardSttSegmentError(streamErr)` in the `else if` is unreachable — `isSoftSttSegmentError` and `isHardSttSegmentError` are disjoint by construction (no error code appears in both sets). Not a bug; cosmetic.

### Other observations (informational, not nits)

- SW runtime whitelist additions in `background/index.ts` (`voice.binary.download/cancel`, `voice.stt.partial_request`) are purely additive — no new gate is bypassed; they fix the false “扩展版本过旧” alarm.
- `host-integrity.ts` SHA256 bump (`CMSPARK_HOST_SHA256`) is a routine re-sign; if the cmspark-host binary was rebuilt for unrelated reasons this is expected. Worth confirming the new hash matches the rebuilt artifact in CI.
- `installWhisperFromBrewDarwin` uses `execFileSync` for `brew`/`otool`/`install_name_tool` inside an async function — sync I/O on the event loop, but the call only fires on explicit user action and runs at most once per install. Acceptable.
- `voice.refine.request` validation correctly enforces `refineGen` is a non-negative integer (validate.ts:447-449) — client and server both increment monotonically per segment.

---

Nits (non-blocking):

1. `companion/src/voice/binary-resolve.ts:188-194` — install.manifest.json shares the writable cache dir with the binary it claims to pin; closes accidental corruption but not a true substitution attack.
2. `chrome-extension/src/sidepanel/components/MeetingPanel.tsx:355-378` — 800ms wait before `meeting.generate_minutes` may miss slow refines; refined text persists in transcript but can be absent from minutes.
3. `chrome-extension/src/sidepanel/voice/local-stt-adapter.ts:60` — `binary_broken` in soft set triggers up to 3 wasted capture+infer cycles before hard-stop; consider first-strike hard-stop.
4. `companion/src/voice/whisper-runner.ts:213-225` — `DYLD_FALLBACK_LIBRARY_PATH` includes `/opt/homebrew/lib`, `/usr/local/lib`; consider tightening to `@loader_path` only after packaging rewrite is verified.
5. `chrome-extension/src/sidepanel/voice/local-stt-adapter.ts:643-647` — `!isHardSttSegmentError(streamErr)` branch is dead code (soft/hard sets are disjoint).

VERDICT: APPROVE_WITH_NITS
