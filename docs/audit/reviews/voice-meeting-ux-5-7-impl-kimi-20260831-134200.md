kimi version 0.39.1
• UserPromptSubmit hook

  {"systemMessage": "🔀 VibeSOP detected multiple intents. Execution plan injected.", "hookSpecificOutput": {"additionalContext": "[VibeSOP Execution Plan]\n{\n  \"plan_id\": \"69734254-e09\",\n  \"original_query\": \"# Dual re-review — UX #5–#7 implementation\\n\\nREAD-ONLY. Independent senior reviewer.\\n\\nWork in: `/Users/huchen/Projects/cmspark` branch `fix/voice-meeting-ux-5-7`\\n\\n## Capability\\n\\n```text\\nSurface: L0 voice + meeting chrome | Blast: T2 UX\\n```\\n\\n## Inputs\\n\\n`git diff` vs main. Spec: `docs/superpowers/specs/2026-08-31-voice-meeting-ux-5-7.md`\\n\\nMachine (this session):\\n- companion `voice-whisper-handlers` 26/26 including lastDownloadError hydrate\\n- chrome-extension targeted 36/36 (CTA, reducer keep/clear, copy, formatMeetingDiarizeStatus)\\n\\n## REJECT if\\n\\n- #5 uses `model_missing` for fallback sessions\\n- #6 get_state still omits lastDownloadError after fail\\n- Settings open still blanks voiceModelError before hydration\\n- #7 status still has no K echo\\n- file ranges overlap in a way that reverts another ID\\n\\nFinal line exactly:\\n\\nVERDICT: APPROVE\\nor\\nVERDICT: APPROVE_WITH_NITS\\nor\\nVERDICT: REJECT\",\n  \"steps\": [\n    {\n      \"step_id\": \"implementer-f5df\",\n      \"step_number\": 1,\n      \"skill_id\": \"fallback-llm\",\n      \"intent\": \"implementer: agent_squad\",\n      \"input_query\": \"\",\n      \"output_as\": \"step_1_result\",\n      \"status\": \"pending\"\n    },\n    {\n      \"step_id\": \"reviewer-3055\",\n      \"step_number\": 2,\n      \"skill_id\": \"fallback-llm\",\n      \"intent\": \"reviewer: agent_squad\",\n      \"input_query\": \"\",\n      \"output_as\": \"step_2_result\",\n      \"status\": \"pending\"\n    }\n  ],\n  \"detected_intents\": [\n    \"code_review\",\n    \"code_review\",\n    \"fix_bug\",\n    \"debug_error\",\n    \"debug_error\"\n  ],\n  \"reasoning\": \"Step 1: 'implementer' → fallback-llm (squad); Step 2: 'reviewer' → fallback-llm (squad)\",\n  \"status\": \"pending\"\n}", "hookEventName": "UserPromptSubmit"}}

• I'm asked to do a read-only independent senior review of the branch `fix/voice-meeting-ux-5-7` diff vs main, against spec `docs/superpowers/specs/2026-08-31-voice-meeting-ux-5-7.md`, with specific REJECT criteria. This is a substantial review task — I could delegate to an explore/review subagent, but I need to check the diff carefully. Actually, I can do this directly, or delegate. Given the size, delegating to a subagent could help, but the review criteria are precise and I need to verify them myself. Let me do it directly but efficiently.

  Start: check git status, branch, diff vs main, read spec.

• I'll review the branch diff against the spec and the reject criteria. Starting with the diff and spec.fix/voice-meeting-ux-5-7
 M CHANGELOG.md
 M chrome-extension/src/sidepanel/components/MeetingPanel.tsx
 M chrome-extension/src/sidepanel/components/SettingsSlideout.tsx
 M chrome-extension/src/sidepanel/hooks/useVoiceInput.ts
 M chrome-extension/src/sidepanel/hooks/useWebSocket.ts
 M chrome-extension/src/sidepanel/voice/error-map.ts
 M chrome-extension/src/sidepanel/voice/session-reducer.ts
 M chrome-extension/src/sidepanel/voice/types.ts
 M chrome-extension/src/sidepanel/voice/whisper-settings-copy.ts
 M chrome-extension/tests/voice-composer-ux.test.ts
 M chrome-extension/tests/voice-session-reducer.test.ts
 M chrome-extension/tests/voice-whisper-settings-copy.test.ts
 M companion/src/summoner-web.ts
 M companion/src/voice/whisper-handlers.ts
 M companion/tests/voice-whisper-handlers.test.ts
?? chrome-extension/src/sidepanel/voice/meeting-diarize-copy.ts
?? chrome-extension/tests/meeting-diarize-copy.test.ts
?? docs/audit/reviews/_prompts/voice-meeting-ux-5-7-impl-dual-20260831.md
?? docs/audit/reviews/_prompts/voice-meeting-ux-5-7-spec-dual-20260831.md
?? docs/audit/reviews/voice-meeting-ux-5-7-impl-claude-20260831-134200.md
?? docs/audit/reviews/voice-meeting-ux-5-7-impl-kimi-20260831-134200.md
?? docs/audit/reviews/voice-meeting-ux-5-7-spec-claude-20260831-133000.md
?? docs/audit/reviews/voice-meeting-ux-5-7-spec-kimi-20260831-133000.md
?? docs/superpowers/specs/2026-08-31-voice-meeting-ux-5-7.md
 CHANGELOG.md                                       |  7 ++-
 .../src/sidepanel/components/MeetingPanel.tsx      | 10 ++--
 .../src/sidepanel/components/SettingsSlideout.tsx  |  2 +-
 .../src/sidepanel/hooks/useVoiceInput.ts           |  6 ++-
 .../src/sidepanel/hooks/useWebSocket.ts            |  7 +++
 chrome-extension/src/sidepanel/voice/error-map.ts  |  1 +
 .../src/sidepanel/voice/session-reducer.ts         |  8 ++-
 chrome-extension/src/sidepanel/voice/types.ts      |  3 +-
 .../src/sidepanel/voice/whisper-settings-copy.ts   |  7 +--
 chrome-extension/tests/voice-composer-ux.test.ts   |  4 ++
 .../tests/voice-session-reducer.test.ts            | 44 ++++++++++++++++
 .../tests/voice-whisper-settings-copy.test.ts      |  7 +++
 companion/src/summoner-web.ts                      |  4 +-
 companion/src/voice/whisper-handlers.ts            | 29 ++++++++---
 companion/tests/voice-whisper-handlers.test.ts     | 60 ++++++++++++++++++++++
 15 files changed, 177 insertions(+), 22 deletions(-)


• Now let me look at the diff. It's ~200 lines. Read the full diff.

• Now the full diff:diff --git a/chrome-extension/src/sidepanel/hooks/useVoiceInput.ts b/chrome-extension/src/sidepanel/hooks/useVoiceInput.ts
index c7e681c8..3d7b0abb 100644
--- a/chrome-extension/src/sidepanel/hooks/useVoiceInput.ts
+++ b/chrome-extension/src/sidepanel/hooks/useVoiceInput.ts
@@ -643,7 +643,11 @@ export function useVoiceInput(opts: UseVoiceInputOpts) {
         if (fallbackRef.current) {
           // Visible per-session notice (SOFT_CAP_HINT = non-terminal info chip;
           // applies in starting/listening). Dismissible; cleared on next start.
-          dispatchEv({ type: "SOFT_CAP_HINT", message: LOCAL_FALLBACK_BROWSER_BANNER })
+          dispatchEv({
+            type: "SOFT_CAP_HINT",
+            message: LOCAL_FALLBACK_BROWSER_BANNER,
+            code: "local_fallback",
+          })
         }
         try {
           if (eng === "local") {
diff --git a/chrome-extension/src/sidepanel/hooks/useWebSocket.ts b/chrome-extension/src/sidepanel/hooks/useWebSocket.ts
index 026a39b9..c58b1f1f 100644
--- a/chrome-extension/src/sidepanel/hooks/useWebSocket.ts
+++ b/chrome-extension/src/sidepanel/hooks/useWebSocket.ts
@@ -1596,6 +1596,13 @@ export function useWebSocket() {
               : {}),
           }
           dispatch({ type: "SET_VOICE_MODEL_STATE", modelState })
+          if ("lastDownloadError" in msg) {
+            const err =
+              typeof msg.lastDownloadError === "string" && msg.lastDownloadError.trim()
+                ? msg.lastDownloadError.trim()
+                : null
+            dispatch({ type: "SET_VOICE_MODEL_ERROR", error: err })
+          }
           try {
             chrome.storage.local.set({
               lastKnownVoiceEngine: sttEngine,
diff --git a/chrome-extension/src/sidepanel/voice/error-map.ts b/chrome-extension/src/sidepanel/voice/error-map.ts
index e5874ba9..7da7749f 100644
--- a/chrome-extension/src/sidepanel/voice/error-map.ts
+++ b/chrome-extension/src/sidepanel/voice/error-map.ts
@@ -234,6 +234,7 @@ export function localSttBannerCta(code: string | null | undefined): LocalBannerC
     case "hash_fail":
       return { kind: "switch_browser", label: CTA_SWITCH_BROWSER }
     case "model_missing":
+    case "local_fallback":
       return { kind: "open_settings", label: CTA_OPEN_SETTINGS }
     default:
       return null
diff --git a/chrome-extension/src/sidepanel/voice/session-reducer.ts b/chrome-extension/src/sidepanel/voice/session-reducer.ts
index 107b33ab..bee48f52 100644
--- a/chrome-extension/src/sidepanel/voice/session-reducer.ts
+++ b/chrome-extension/src/sidepanel/voice/session-reducer.ts
@@ -219,6 +219,8 @@ export function reduceVoiceSession(
       return {
         ...state,
         banner: event.message,
+        // Code-less hint (continuous cap) must not keep a stale local_fallback CTA.
+        errorCode: typeof event.code === "string" && event.code ? event.code : null,
       }
     }
 
@@ -316,7 +318,8 @@ export function reduceVoiceSession(
         state.errorCode !== "no-speech" &&
         state.errorCode !== "empty" &&
         state.errorCode !== "timeout" &&
-        state.errorCode !== "continuous-timeout"
+        state.errorCode !== "continuous-timeout" &&
+        state.errorCode !== "local_fallback"
       ) {
         const mapped = mapVoiceError(state.errorCode)
         return resetToIdle(state, {
@@ -362,7 +365,8 @@ export function reduceVoiceSession(
         baseText: state.baseText,
         finals: state.finals,
         committed: true,
-        banner: timeoutBanner,
+        banner: timeoutBanner || (state.errorCode === "local_fallback" ? state.banner : null),
+        errorCode: timeoutBanner ? state.errorCode : state.errorCode === "local_fallback" ? "local_fallback" : null,
       })
     }
 
diff --git a/chrome-extension/src/sidepanel/voice/types.ts b/chrome-extension/src/sidepanel/voice/types.ts
index cb727653..91ec9f7c 100644
--- a/chrome-extension/src/sidepanel/voice/types.ts
+++ b/chrome-extension/src/sidepanel/voice/types.ts
@@ -48,7 +48,8 @@ export type VoiceEvent =
   /** Hard cap stop. code: timeout | continuous-timeout for banner copy. */
   | { type: "TIMEOUT"; code?: string }
   /** Dictation+ continuous: soft cap hint (still listening). */
-  | { type: "SOFT_CAP_HINT"; message: string }
+  /** Dictation+ continuous: soft cap hint (still listening). Optional code for CTA (e.g. local_fallback). */
+  | { type: "SOFT_CAP_HINT"; message: string; code?: string }
   | { type: "ENGINE_START" }
   | { type: "ENGINE_RESULT"; interim?: string; finalChunk?: string }
   | { type: "ENGINE_ERROR"; code: string; message?: string }
diff --git a/chrome-extension/src/sidepanel/voice/whisper-settings-copy.ts b/chrome-extension/src/sidepanel/voice/whisper-settings-copy.ts
index 4326fbef..381b7614 100644
--- a/chrome-extension/src/sidepanel/voice/whisper-settings-copy.ts
+++ b/chrome-extension/src/sidepanel/voice/whisper-settings-copy.ts
@@ -186,9 +186,9 @@ export function modelProbeErrorLabel(error: string | undefined | null): string |
     case "model-unknown":
       return "未知模型型号"
     case "http-error":
-      return "下载失败：网络/镜像返回错误（HuggingFace 需可访问）。可检查网络后重试。"
+      return "下载失败：网络/镜像返回错误（HuggingFace 需可访问）。可改设置里的模型下载源（如 hf-mirror.com）后重试。"
     case "network-error":
-      return "下载失败：网络中断。请检查网络后重试。"
+      return "下载失败：网络中断。可改设置里的模型下载源（如 hf-mirror.com），或检查网络后重试。"
     case "disk-budget-exceeded":
       return "磁盘预算不足。请在设置删除不用的模型，或增大预算后重试。"
     case "hash-mismatch":
@@ -196,7 +196,8 @@ export function modelProbeErrorLabel(error: string | undefined | null): string |
     default:
       // Prefer full HTTP message from companion when present
       if (/HTTP \d+|redirect|network/i.test(error)) {
-        return `下载失败：${error.length > 160 ? error.slice(0, 160) + "…" : error}`
+        const body = error.length > 160 ? error.slice(0, 160) + "…" : error
+        return `下载失败：${body}。可改设置里的模型下载源（如 hf-mirror.com）。`
       }
       if (error.length > 120) return error.slice(0, 120) + "…"
       return error
diff --git a/chrome-extension/src/sidepanel/components/MeetingPanel.tsx b/chrome-extension/src/sidepanel/components/MeetingPanel.tsx
index ce2b6876..5f767fe4 100644
--- a/chrome-extension/src/sidepanel/components/MeetingPanel.tsx
+++ b/chrome-extension/src/sidepanel/components/MeetingPanel.tsx
@@ -33,6 +33,7 @@ import {
   MEETING_STOP_FAILSAFE_MS,
 } from "../voice/meeting-caps"
 import { VOICE_DEFAULT_LANG } from "../voice/detect"
+import { formatMeetingDiarizeStatus } from "../voice/meeting-diarize-copy"
 import { mapLocalSttError } from "../voice/error-map"
 import {
   createSerialRefineQueue,
@@ -662,11 +663,10 @@ export function MeetingPanel(props: {
         }
         setBusy(false)
         const method = msg.diarize?.method || msg.meeting.diarize?.method
-        setImportStatus(
-          method === "text_gap"
-            ? "已弱标说话人（按行交替 · 非声学）"
-            : "已自动标匿名发言人（实验 · 非身份识别）",
-        )
+        const kRaw = msg.diarize?.k ?? msg.meeting.diarize?.k
+        const k = typeof kRaw === "number" && Number.isFinite(kRaw) ? Math.floor(kRaw) : null
+        setImportStatus(formatMeetingDiarizeStatus(method, k))
+        if (k != null && k >= 2 && k <= 4) setDiarizeK(k)
       }
       if (msg.type === "meeting.minutes_result") {
         if (msg.minutes?.raw_md) setMinutesMd(msg.minutes.raw_md)
diff --git a/chrome-extension/src/sidepanel/components/SettingsSlideout.tsx b/chrome-extension/src/sidepanel/components/SettingsSlideout.tsx
index 06e15031..80e4e624 100644
--- a/chrome-extension/src/sidepanel/components/SettingsSlideout.tsx
+++ b/chrome-extension/src/sidepanel/components/SettingsSlideout.tsx
@@ -235,7 +235,7 @@ export function SettingsSlideout() {
     dispatch({ type: "SET_COMPUTER_MODEL_ERROR", error: null })
     chrome.runtime.sendMessage({ type: "computer.model.get_state" })
     // Path B M0: mirror voice.model state on settings open (UI Task 7).
-    dispatch({ type: "SET_VOICE_MODEL_ERROR", error: null })
+    // Do not blank voiceModelError here — get_state / WS lastDownloadError hydrates it.
     setVoicePendingDownload(null)
     setVoiceEndpointDraft(null)
     chrome.runtime.sendMessage({ type: "voice.model.get_state" }, (resp: unknown) => {
diff --git a/companion/src/summoner-web.ts b/companion/src/summoner-web.ts
index f2117899..3d425b98 100644
--- a/companion/src/summoner-web.ts
+++ b/companion/src/summoner-web.ts
@@ -2225,7 +2225,9 @@ try{
     if(!m||!Array.isArray(m.transcript)) return;
     paintTranscript(m.transcript);
     var method=d.diarize&&d.diarize.method||m.diarize&&m.diarize.method;
-    setStatus(method==="text_gap"?"已弱标说话人（按行交替 · 非声学）":"已标匿名发言人（实验 · 非身份识别）");
+    var k=d.diarize&&d.diarize.k||m.diarize&&m.diarize.k;
+    var kPart=typeof k==="number"&&k>=1?" · K="+Math.floor(k):"";
+    setStatus((method==="text_gap"?"已弱标说话人（按行交替 · 非声学）":"已标匿名发言人（实验 · 非身份识别）")+kPart);
   }
   function runDiarize(mode){
     var id=meetingId||lastMeetingId;
diff --git a/companion/src/voice/whisper-handlers.ts b/companion/src/voice/whisper-handlers.ts
index 3f5ce4fd..f03e9258 100644
--- a/companion/src/voice/whisper-handlers.ts
+++ b/companion/src/voice/whisper-handlers.ts
@@ -71,6 +71,8 @@ type ActiveBinaryDownload = { controller: AbortController }
 let activeDownload: ActiveDownload | null = null
 let activeDelete: ActiveDelete | null = null
 let activeBinaryDownload: ActiveBinaryDownload | null = null
+/** Process-level; not config.json. Hydrates get_state after a failed download. */
+let lastDownloadErrorMem: { error: string; modelId: WhisperModelId } | null = null
 
 /** Test seam: clear download/delete mutex + abort any in-flight controller. */
 export function _resetVoiceModelHandlersForTests(): void {
@@ -91,6 +93,7 @@ export function _resetVoiceModelHandlersForTests(): void {
   activeDownload = null
   activeDelete = null
   activeBinaryDownload = null
+  lastDownloadErrorMem = null
 }
 
 // --- errors -------------------------------------------------------------------
@@ -99,6 +102,17 @@ function modelError(error: string, extra?: Record<string, unknown>) {
   return { type: "error" as const, family: "voice.model" as const, error, ...extra }
 }
 
+function attachLastDownloadError(state: VoiceModelStatePayload): VoiceModelStatePayload & {
+  lastDownloadError: string | null
+  lastDownloadModelId?: WhisperModelId
+} {
+  return {
+    ...state,
+    lastDownloadError: lastDownloadErrorMem?.error ?? null,
+    ...(lastDownloadErrorMem ? { lastDownloadModelId: lastDownloadErrorMem.modelId } : {}),
+  }
+}
+
 const SETTINGS_SOURCE_TYPES = new Set([
   "voice.model.download",
   "voice.model.cancel",
@@ -227,6 +241,7 @@ function startBackgroundDownload(
         },
       })
       logger.info("voice.model.download.completed", { modelId })
+      lastDownloadErrorMem = null
       // A1: auto-activate the just-downloaded model when the configured active
       // model is not ready (does not touch sttEngine).
       maybeAutoActivateModel(modelId, deps)
@@ -253,6 +268,7 @@ function startBackgroundDownload(
       }
       const state = await statePayload(deps)
       if (downloadError && !downloadError.includes("aborted")) {
+        lastDownloadErrorMem = { error: downloadError, modelId }
         // Push machine error into family:"voice.model" so Side Panel shows it
         // (not only probe residue like unexpected-files).
         ctx.broadcast?.(
@@ -261,13 +277,12 @@ function startBackgroundDownload(
             modelId,
           }),
         )
-        ctx.broadcast?.({
-          ...state,
-          lastDownloadError: downloadError,
-          lastDownloadModelId: modelId,
-        })
+        ctx.broadcast?.(attachLastDownloadError(state))
       } else {
-        ctx.broadcast?.(state)
+        if (downloadError?.includes("aborted")) {
+          lastDownloadErrorMem = null
+        }
+        ctx.broadcast?.(attachLastDownloadError(state))
       }
     }
   })()
@@ -316,7 +331,7 @@ export async function handleVoiceModelMessage(
       // persist localModelId correction before assembling the payload.
       autoCorrectActiveLocalModel(deps)
       const state = await statePayload(deps)
-      return state
+      return attachLastDownloadError(state)
     }
 
     case "voice.model.download": {


• Now check remaining diffs: tests, CHANGELOG, error-map, new meeting-diarize-copy.ts, voice-composer-ux test, and check for things like App.tsx CTA wiring (spec says #5 includes App.tsx CTA wiring only — but diff doesn't show App.tsx changes. Spec's design says `localSttBannerCta("local_fallback")` → open_settings; that's in error-map.ts which was changed. App.tsx already calls localSttBannerCta(voice.errorCode) presumably — "CTA wiring only" may not be needed if it already exists. Let me check.

  Also check ENGINE_END logic: the reducer change in the ENGINE_END case — the spec says "ENGINE_END / successful idle: if errorCode === 'local_fallback', keep banner + errorCode (timeout banner still wins)". Let me view the relevant reducer section fully to verify correctness.

  Also check reject criteria:
  1. #5 uses `model_missing` for fallback sessions → they added `local_fallback` new code, good. But error-map groups it with model_missing → open_settings, that's fine per spec item 4.
  2. #6 get_state still omits lastDownloadError after fail → attachLastDownloadError applied in get_state and post-download broadcast. Good.
  3. Settings open still blanks voiceModelError → removed. Good.
  4. #7 status still has no K echo → MeetingPanel uses formatMeetingDiarizeStatus with k; summoner has kPart. Good.
  5. File ranges overlap in a way that reverts another ID → check.

  Need to read the new meeting-diarize-copy.ts, the reducer ENGINE_END context, and the tests. Also verify tests pass (machine claims 26/26 and 36/36 — but this is a re-review; should I re-run tests? The machine says tests passed this session. Running targeted tests would be good verification. They're read-only runs. Let me run them.)

  Also check `useWebSocket` — spec says "if 'lastDownloadError' in msg, SET_VOICE_MODEL_ERROR to that string or null". Implemented. Good.

  Check `USER_TOGGLE_START`/`DISMISS_BANNER` still clear — presumably untouched.

  Check the ENGINE_END reducer hunk: the code at line ~365:
  ```
  banner: timeoutBanner || (state.errorCode === "local_fallback" ? state.banner : null),
  errorCode: timeoutBanner ? state.errorCode : state.errorCode === "local_fallback" ? "local_fallback" : null,
  ```
  This is inside some `successful idle` branch. Need context to verify. Also the earlier hunk at line 316: a condition that resets to idle when errorCode is not in a list — they added local_fallback exclusion, meaning if errorCode is local_fallback, it does NOT reset with mapped error... wait, need context.

  Let me read session-reducer.ts around those lines.

• Diff looks aligned with the spec. Let me read the reducer context and the new copy module, then verify tests.

• Check some nuances:

  1. ENGINE_END keep: when `errorCode === "local_fallback"` and finals non-empty and not timeout, banner kept + errorCode kept. When timeout: timeout banner wins, errorCode = state.errorCode — which would be "local_fallback"! Wait: `errorCode: timeoutBanner ? state.errorCode : ...`. If errorCode is local_fallback and abortReason is timeout, errorCode stays "local_fallback" while banner becomes the timeout message. Hmm — can that happen? local_fallback is set via SOFT_CAP_HINT, which doesn't set abortReason. TIMEOUT event sets errorCode to timeout/continuous-timeout, overwriting local_fallback. So if timeout occurs, errorCode becomes "timeout" not "local_fallback". So timeoutBanner with errorCode "local_fallback" seems unreachable. Fine.

  2. In the empty finals branch (line 335-353): if errorCode is local_fallback and finals empty... wait, can finals be empty while errorCode local_fallback? Yes — fallback session where nothing was said. Then empty branch returns banner = timeoutBanner || emptyMsg, without errorCode → resetToIdle presumably clears errorCode. Spec says "ENGINE_END / successful idle: if errorCode === 'local_fallback', keep banner + errorCode (timeout banner still wins)". The empty case shows empty message instead — arguably acceptable, "successful idle" implies content. Tests pass for ENGINE_END keep chip. This could be a nit.

  3. `errorCode: timeoutBanner ? state.errorCode : ...` — hmm, wait in the non-empty branch, when timeout, errorCode stays state.errorCode which is "timeout" or "continuous-timeout" (set by TIMEOUT event). Good.

  4. Also check the local_fallback exclusion at line 322: if errorCode is local_fallback, we skip the hard-error branch so mapVoiceError("local_fallback") isn't applied. Check mapVoiceError for unknown code — would return generic error banner; the exclusion avoids that. Good.

  5. Reject check #1: "uses model_missing for fallback sessions" — new code local_fallback used in useVoiceInput dispatch. Good.

  But wait — the error-map groups local_fallback with model_missing → same CTA {kind: "open_settings"}. Spec item 4 explicitly says that. Fine.

  6. Now check `USER_TOGGLE_START` / `DISMISS_BANNER` still clear errorCode — presumably resetToIdle clears errorCode by default. Need to verify resetToIdle signature — the diff doesn't show it, and tests pass.

  7. Check the App.tsx wiring: spec listed App.tsx CTA wiring in #5 files, but diff has no App.tsx change — meaning the existing `localSttBannerCta(voice.errorCode)` wiring already exists. Verify quickly.

  8. useWebSocket change: spec item 3 matches. But check: SET_VOICE_MODEL_ERROR is dispatched with null when lastDownloadError is null — fine.

  9. #6 check: "get_state still omits lastDownloadError after fail" — attachLastDownloadError covers get_state. Set on fail (non-abort). Clear on success (line 241 lastDownloadErrorMem = null) and cancel-success (aborted → null). Wait — on abort (cancel), they clear lastDownloadErrorMem. Spec: "clear on success/cancel-success". Good.

  10. #7: formatMeetingDiarizeStatus for audio: `已自动标匿名发言人（实验 · 非身份识别）· K=N` — spec says audio string is "已自动标匿名发言人（实验 · 非身份识别）· K=N" — matches with space before ·. text_gap unchanged or with K. Good. Summoner: kPart when k>=1. But summoner uses `d.diarize.k||m.diarize.k` — falsy 0 falls through, fine.

  Note: MeetingPanel requires k in 2..4 for setDiarizeK — matches spec. Summoner spec says "Summoner K picker has no auto-0; status echo only" — summoner doesn't set picker. Good.

  11. Overlap check: #5 files: error-map.ts, types.ts, session-reducer.ts, useVoiceInput.ts, tests. #6: whisper-handlers.ts, useWebSocket.ts, SettingsSlideout.tsx, whisper-settings-copy.ts. #7: MeetingPanel.tsx, summoner-web.ts, new meeting-diarize-copy.ts. No overlap that reverts another ID. But #5 spec lists App.tsx — not touched; verify wiring exists.

  12. Tests: need to verify the claimed test runs. Let me run the targeted tests. Machine claims companion 26/26 and chrome-extension 36/36. Let me run them read-only.

  Also check the new tests: voice-session-reducer.test.ts +44, meeting-diarize-copy.test.ts, voice-whisper-handlers.test.ts +60, voice-composer-ux.test.ts +4, voice-whisper-settings-copy.test.ts +7.

  Let me quickly grep App.tsx for localSttBannerCta, and check the test files, then run tests.diff --git a/chrome-extension/tests/voice-composer-ux.test.ts b/chrome-extension/tests/voice-composer-ux.test.ts
index 3fe998a4..bbcc1588 100644
--- a/chrome-extension/tests/voice-composer-ux.test.ts
+++ b/chrome-extension/tests/voice-composer-ux.test.ts
@@ -62,6 +62,10 @@ test("localSttBannerCta: disconnect/binary → browser; model_missing → settin
   assert.equal(localSttBannerCta("aborted"), null)
   assert.equal(localSttBannerCta(null), null)
   assert.equal(localSttBannerCta(""), null)
+  assert.deepEqual(localSttBannerCta("local_fallback"), {
+    kind: "open_settings",
+    label: CTA_OPEN_SETTINGS,
+  })
 })
 
 test("toast residual mentions cloud vendor path (SoT §5.3)", () => {
diff --git a/chrome-extension/tests/voice-session-reducer.test.ts b/chrome-extension/tests/voice-session-reducer.test.ts
index 85ff5f9e..0b06d263 100644
--- a/chrome-extension/tests/voice-session-reducer.test.ts
+++ b/chrome-extension/tests/voice-session-reducer.test.ts
@@ -175,6 +175,50 @@ test("SOFT_CAP_HINT keeps listening and sets banner", () => {
   })
   assert.equal(s.phase, "listening")
   assert.match(s.banner || "", /连续听写/)
+  assert.equal(s.errorCode, null)
+})
+
+test("SOFT_CAP_HINT local_fallback sets code; ENGINE_END keeps chip", () => {
+  let s = initialVoiceSession(true)
+  s = reduceVoiceSession(s, {
+    type: "USER_TOGGLE_START",
+    sessionId: "s1",
+    baseText: "",
+  })
+  s = reduceVoiceSession(s, { type: "ENGINE_START" })
+  s = reduceVoiceSession(s, {
+    type: "SOFT_CAP_HINT",
+    message: "本机模型未就绪，本次使用浏览器听写。可能经浏览器厂商云端",
+    code: "local_fallback",
+  })
+  assert.equal(s.errorCode, "local_fallback")
+  s = reduceVoiceSession(s, { type: "ENGINE_RESULT", finalChunk: "你好" })
+  s = reduceVoiceSession(s, { type: "USER_TOGGLE_STOP" })
+  s = reduceVoiceSession(s, { type: "ENGINE_END" })
+  assert.equal(s.phase, "idle")
+  assert.equal(s.errorCode, "local_fallback")
+  assert.match(s.banner || "", /本次使用浏览器听写/)
+})
+
+test("code-less SOFT_CAP_HINT clears stale local_fallback code", () => {
+  let s = initialVoiceSession(true)
+  s = reduceVoiceSession(s, {
+    type: "USER_TOGGLE_START",
+    sessionId: "s1",
+    baseText: "",
+  })
+  s = reduceVoiceSession(s, { type: "ENGINE_START" })
+  s = reduceVoiceSession(s, {
+    type: "SOFT_CAP_HINT",
+    message: "本机模型未就绪，本次使用浏览器听写。可能经浏览器厂商云端",
+    code: "local_fallback",
+  })
+  s = reduceVoiceSession(s, {
+    type: "SOFT_CAP_HINT",
+    message: "仍在连续听写，可点麦克风结束",
+  })
+  assert.equal(s.errorCode, null)
+  assert.match(s.banner || "", /连续听写/)
 })
 
 test("D1b START_REFINE → REFINE_OK keeps committed raw path", () => {
diff --git a/companion/tests/voice-whisper-handlers.test.ts b/companion/tests/voice-whisper-handlers.test.ts
index 0f5d6ce6..073a668f 100644
--- a/companion/tests/voice-whisper-handlers.test.ts
+++ b/companion/tests/voice-whisper-handlers.test.ts
@@ -155,6 +155,7 @@ test("get_state: shape includes models/binary/budget/whisperRoot", async () => {
   assert.ok(r.models.medium)
   assert.ok(r.models["large-v3-turbo"])
   assert.equal(r.models.medium.status, "absent")
+  assert.equal(r.lastDownloadError, null)
   assert.ok(r.binary)
   assert.ok(
     r.binary.status === "ready" ||
@@ -328,6 +329,65 @@ test("download: started + progress broadcast with mock downloadImpl", async () =
   for (let i = 0; i < 8; i++) await flush()
 })
 
+test("download fail: get_state hydrates lastDownloadError; success clears", async () => {
+  resetVoiceConfig()
+  const broadcasts: any[] = []
+  await handleVoiceModelMessage(
+    { type: "voice.model.download", modelId: "medium", source: "settings" },
+    { broadcast: (d: any) => broadcasts.push(d) },
+    {
+      probe: () => ({ status: "absent" }),
+      downloadImpl: async () => {
+        throw new Error("HTTP 403 huggingface.co")
+      },
+      buildState: async () =>
+        ({
+          type: "voice.model.state",
+          sttEngine: "browser",
+          localModelId: "medium",
+          recommendedModelId: "medium",
+          models: { medium: { status: "absent" } },
+          binary: { status: "not_found" },
+          diskBudgetMB: 4096,
+          diskUsedMB: 0,
+          whisperRoot: "/tmp/w",
+        }) as any,
+    },
+  )
+  for (let i = 0; i < 12; i++) await flush()
+  const failedState = broadcasts.find(
+    (b) => b.type === "voice.model.state" && b.lastDownloadError,
+  )
+  assert.ok(failedState)
+  assert.match(String(failedState.lastDownloadError), /HTTP 403/)
+  const hydrated = await handleVoiceModelMessage({ type: "voice.model.get_state" })
+  assert.match(String(hydrated.lastDownloadError), /HTTP 403/)
+
+  await handleVoiceModelMessage(
+    { type: "voice.model.download", modelId: "medium", source: "settings" },
+    { broadcast: () => {} },
+    {
+      probe: () => ({ status: "absent" }),
+      downloadImpl: async () => {},
+      buildState: async () =>
+        ({
+          type: "voice.model.state",
+          sttEngine: "browser",
+          localModelId: "medium",
+          recommendedModelId: "medium",
+          models: { medium: { status: "ready" } },
+          binary: { status: "not_found" },
+          diskBudgetMB: 4096,
+          diskUsedMB: 0,
+          whisperRoot: "/tmp/w",
+        }) as any,
+    },
+  )
+  for (let i = 0; i < 12; i++) await flush()
+  const afterOk = await handleVoiceModelMessage({ type: "voice.model.get_state" })
+  assert.equal(afterOk.lastDownloadError, null)
+})
+
 test("download refused while delete in progress", async () => {
   resetVoiceConfig()
   let releaseDelete!: () => void
Test additions look right. Now verify tests actually pass. Run the targeted tests. Check package.json scripts. The machine claims: companion voice-whisper-handlers 26/26, chrome-extension targeted 36/36 (voice-composer-ux, voice-session-reducer, voice-whisper-settings-copy, meeting-diarize-copy).

  Let me check how tests are run (probably node --test with tsx or vitest). Check package.json test scripts quickly.

• Tests look aligned with the spec. Now running them to verify the claimed passes.    "test": "node -e \"require('fs').rmSync('.test-dist',{recursive:true,force:true})\" && tsc -p tsconfig.test.json && node scripts/run-tests.mjs",
_acp-gates-setup.ts
_companion-client-auth-setup.ts
_computer-evidence-setup.ts
_config-router-setup.ts
_outbound-grants-setup.ts
_threads-history-setup.ts
_ws-auth-paired-setup.ts
acp-agent-env.test.ts
acp-confirm-copy.test.ts
acp-diff-apply.test.ts
acp-discover.test.ts
acp-git-status.test.ts
acp-handback-workspace.test.ts
acp-handlers-gates.test.ts
acp-jsonrpc-timeline.test.ts
acp-live-events.test.ts
acp-open-local-terminal.test.ts
acp-win-spawn.test.ts
adapter-recovery.test.ts
adapter-steer-overflow.test.ts
adapter-usage.test.ts
adapter.test.ts
alias-commit.test.ts
allow-dir-expand.test.ts
allow-dir-sensitive-credentials.test.ts
apps-add-flow.test.ts
apps-biometric-gate.test.ts
apps-cli-phase2.test.ts
apps-config.test.ts
apps-coordinate.test.ts
apps-guards.test.ts
apps-handlers.test.ts
apps-launch.test.ts
apps-llm-index.test.ts
batch-c-host-p1.test.ts
batch-d-runtime-p1.test.ts
batch-e-handshake-p2.test.ts
batch-f-integrity-p2.test.ts
board-collect-handback.test.ts
board-complete.test.ts
board-intent-claim.test.ts
board-schema.test.ts
board-service.test.ts
bridge.test.ts
browser-download-admission.test.ts
browser-download-schema.test.ts
capability-shell-netsec.test.ts
capability-workspace.test.ts
chat-shell-copy-lockstep.test.ts
classify-error-browser-unavailable.test.ts
client-message-id-passthrough.test.ts
companion-client-auth.test.ts
companion-ui-rects.test.ts
composer-lease.test.ts
computer-coords.test.ts
computer-danger.test.ts
computer-darwin-capture-degraded.test.ts
computer-darwin-estop-owner.test.ts
computer-darwin-foreground.test.ts
computer-darwin-inject-contract.test.ts
computer-estop.test.ts
computer-evidence.test.ts
computer-executor.test.ts
computer-gui-action-parse.test.ts
computer-input-ps1.test.ts
computer-l2-preview-image.test.ts
computer-locate-chain.test.ts
computer-model-admission.test.ts
computer-model-handlers.test.ts
computer-model-license.test.ts
computer-model-states.test.ts
computer-model-test-env.ts
computer-ocr-describe.test.ts
computer-png-decode.test.ts
computer-policy.test.ts
computer-preview.test.ts
computer-python-runtime.test.ts
computer-qwen-vl-coords.test.ts
computer-qwen-vl-locator.test.ts
computer-qwen-vl-worker-path.test.ts
computer-rate-limit.test.ts
computer-self-ui.test.ts
computer-session-trust-g1.test.ts
computer-session-trust.test.ts
computer-uia-watch.test.ts
computer-uia-writeback.test.ts
computer-uia.test.ts
computer-unattended-grant.test.ts
computer-win-adapters.test.ts
config-broadcast-redact.test.ts
config-test-probe-keyed.test.ts
config.test.ts
confirm-fanout.test.ts
content-sanitizer.test.ts
context-budget.test.ts
context-handoff.test.ts
cookie-trust-message.test.ts
crash-handlers.test.ts
cruise-path.test.ts
daemon.test.ts
dictation-hotkey.test.ts
distill.test.ts
doc-identity.test.ts
dom-script-budget.test.ts
enterprise-session-trust.test.ts
file-parser-safe-name.test.ts
file-parser.test.ts
file-upload-sidecar-keep.test.ts
file-url-admission.test.ts
fixtures
healthz.test.ts
history.test.ts
host-bin-resolve.test.ts
host-use-blacklist.test.ts
host-use-darwin-adapter.test.ts
host-use-darwin-integrity.test.ts
host-use-linux-nonce.test.ts
host-use-win-adapter.test.ts
host-use-win-blacklist.test.ts
host-use-win-hello.test.ts
host-use-win-nonce.test.ts
hud-protocol.test.ts
hud-shell-router.test.ts
hud-spike.test.ts
image-data-url.test.ts
image-fetch-admission.test.ts
image-parts.test.ts
image-preview.test.ts
image-sniff.test.ts
integration
knowledge-active-ids.test.ts
knowledge-crud-ws.test.ts
knowledge-crud.test.ts
knowledge-related.test.ts
l1-actuator.test.ts
l2-admission-pure.test.ts
l2-conductor.test.ts
l2-summoner-confirm-origin.test.ts
likely-multimodal.test.ts
llm-connection-test.test.ts
llm-endpoint-url.test.ts
llm-headers-policy.test.ts
llm-provider-anthropic.test.ts
llm-stream-jailbreak-scan.test.ts
llm-supersede-generation.test.ts
log-event-gate.test.ts
log-event-no-echo.test.ts
log-rotation.test.ts
logger-redact.test.ts
m10-abort-orphans.test.ts
m2-untrusted-marker.test.ts
markdown-export.test.ts
mcp-confirm-cache.test.ts
mcp-confirm-target.test.ts
mcp-error-hints.test.ts
mcp-filesystem-home.test.ts
mcp-manager.test.ts
mcp-stdio-l2-gate.test.ts
mcp-tool-whitelist-alias.test.ts
mcp.test.ts
meeting-audio-gc.test.ts
meeting-minutes.test.ts
meeting-mtg2.test.ts
meeting-mtg3-diarize.test.ts
meeting-test-data-dir.ts
message-router-config-acp.test.ts
message-router-config-security.test.ts
message-router-nextrun-drain.test.ts
message-router-summary.test.ts
model-probe.test.ts
native-vision-probe-cache.test.ts
netsec-scope.test.ts
notes-verify.test.ts
obsidian-export-compose.test.ts
obsidian-summary-compose.test.ts
orchestrator-l2-flight.test.ts
orchestrator-tab-lease.test.ts
orchestrator-tool-pregate.test.ts
outbound-grant-cli.test.ts
outbound-mcp-companion-http.test.ts
outbound-mcp-docs-grant.test.ts
outbound-mcp-dual-entry.test.ts
outbound-mcp-facade.test.ts
outbound-mcp-grants.test.ts
outbound-mcp-http-e2e.test.ts
overflow.test.ts
overlay-capture-acl.test.ts
overlay-eligible.test.ts
overlay-l0.test.ts
overlay-md.test.ts
overlay-session.test.ts
overlay-shell-open.test.ts
p0-deep-diagnosis-batch.test.ts
p1-deep-diagnosis-batch.test.ts
p2-deep-diagnosis-batch.test.ts
p2-residual-closeout.test.ts
packs-audit-log.test.ts
packs-engine.test.ts
packs-suggest-scene.test.ts
packs-validator.test.ts
path-sandbox.test.ts
pending-tool-origin-ws.test.ts
process-path.test.ts
project-dir.test.ts
protocol.test.ts
run-progress.test.ts
run-queues.test.ts
runtime-context-budget.test.ts
security
security-confirmation-broadcast.test.ts
security-confirmation-origin.test.ts
security-thread.test.ts
session-trust-v4.test.ts
settings-web.test.ts
shell-abort-timeout.test.ts
shell-progress-windowsHide.test.ts
single
site-matcher.test.ts
site-op-memory.test.ts
skill-engine.test.ts
skill-install.test.ts
skills.test.ts
slash-skill-pin.test.ts
split-upload-files.test.ts
summary-export.test.ts
summoner-acl.test.ts
summoner-client.test.ts
summoner-hotkey.test.ts
summoner-hydrate.test.ts
summoner-journeys.test.ts
summoner-overlay.test.ts
summoner-protocol.test.ts
summoner-shell-open.test.ts
summoner-talk.test.ts
summoner-thread-manage.test.ts
summoner-web.test.ts
summoner-workbench-compose.test.ts
swift-tray-integrity.test.ts
tab-url-cache.test.ts
text-sanitize.test.ts
thread-batch-delete.test.ts
thread-cleanup-context.test.ts
thread-digest.test.ts
thread-image-sidecar.test.ts
thread-manager-lock.test.ts
thread-pack-patch.test.ts
thread-path-sanitize.test.ts
thread-provisional-title.test.ts
thread-recall.test.ts
thread-related.test.ts
threads-history.test.ts
tool-batch-heal.test.ts
tool-catalog-lockstep.test.ts
tool-format-leak.test.ts
tool-forward-actuator.test.ts
tool-persistence-redact.test.ts
tool-schemas.test.ts
tray-pairing.test.ts
ui-open-sidepanel-lockstep.test.ts
ui-open-sidepanel.test.ts
url-cookie-admission.test.ts
user-env.test.ts
vault-index.test.ts
vault-profiler.test.ts
vault-templates.test.ts
version-lockstep.test.ts
vision-pipeline.test.ts
vision-reuse-inherit.test.ts
voice-asr-refiner.test.ts
voice-binary-resolve.test.ts
voice-config.test.ts
voice-pack-deny.test.ts
voice-privacy-origin-p1.test.ts
voice-stt-handlers.test.ts
voice-stt-partial.test.ts
voice-stt-session-core.test.ts
voice-stt-session-service.test.ts
voice-stt-tmp.test.ts
voice-whisper-download.test.ts
voice-whisper-handlers.test.ts
voice-whisper-manifest.test.ts
voice-whisper-runner.test.ts
wait-for-extension-peer.test.ts
wait-for-params.test.ts
web-act-loop-wave1.test.ts
whisper-binary-download.test.ts
worker-hard-deny-runtime.test.ts
ws-auth-paired-marker.test.ts
ws-fanout-behavior.test.ts
ws-origin.test.ts
ws-router-validator-lockstep.test.ts
ws-tool-forward.test.ts
ws-validate-strict.test.ts
    "test": "node -e \"require('fs').rmSync('.test-dist',{recursive:true,force:true})\" && tsc -p tsconfig.test.json && node --test .test-dist/tests/*.test.js",
active-tab-hostname-budget-log.test.ts
active-tab-hostname.test.ts
apps-panel-logic.test.ts
autopilot-tier.test.ts
background-notifications.test.ts
bottom-bar-strip-flag.test.ts
browser-download-handler.test.ts
chat-shell-copy.test.ts
chat-shell-popout.test.ts
cockpit-status-rail.test.ts
cockpit-window-logic.test.ts
coding-handoff-progress-tail.test.ts
coding-handoff-repo-context.test.ts
coding-handoff-task-package.test.ts
companion-canon-s12.test.ts
compose-drawer-pr6.test.ts
composer-slash-parity.test.ts
computer-model-state.test.ts
computer-task-state.test.ts
context-panel-host.test.ts
context-strip-logic.test.ts
create-blank-thread.test.ts
dangerous-apis.test.ts
download-busy-entry.test.ts
download-waiter.test.ts
downloads-find.test.ts
empty-state-copy.test.ts
evaluate-code-integrity.test.ts
find-element-by-text.test.ts
focus-band-coding-session.test.ts
focus-band-priority.test.ts
force-layout.test.ts
gate-error-copy.test.ts
hotkey-chord.test.ts
image-compose.test.ts
image-extract-utils.test.ts
knowledge-truncated-save.test.ts
layout-signature.test.ts
locator-classify.test.ts
log-event-normalize.test.ts
log-forward-policy.test.ts
markdown-breaks.test.ts
meeting-audio-import.test.ts
meeting-caps.test.ts
meeting-capture-mutex.test.ts
meeting-diarize-copy.test.ts
meeting-live-refine.test.ts
meeting-template-storage.test.ts
minimal-confirm-hint.test.ts
mode-controller.test.ts
model-switch-logic.test.ts
node-shims.d.ts
notebooklm-extractor.test.ts
notebooklm-markdown-builder.test.ts
notebooklm-selectors.test.ts
notebooklm-v12-modules.test.ts
overlay-standby.test.ts
page-sanitizer.test.ts
redacted-stub-utils.test.ts
run-progress-ui.test.ts
running-tools.test.ts
security-confirmation-forward.test.ts
selector-js-literal.test.ts
settings-intent.test.ts
settings-sections.test.ts
shell-card-utils.test.ts
sidepanel-state-security.test.ts
sidepanel-state.test.ts
spa-scroll-expr.test.ts
stream-partial-poll.test.ts
stream-stabilize.test.ts
stream-thread-gate.test.ts
tab-queue.test.ts
tag-colors.test.ts
thread-busy.test.ts
thread-graph-bg.test.ts
thread-related.test.ts
thread-timeline.test.ts
tokens-helpers.test.ts
type-fallback.test.ts
ui-mode-acceptance.test.ts
ui-open-sidepanel.test.ts
upload-send.test.ts
use-modal-dialog.test.ts
user-env-utils.test.ts
vision-reuse-logic.test.ts
voice-composer-ux.test.ts
voice-detect.test.ts
voice-fallback.test.ts
voice-local-continuous.test.ts
voice-local-error-map.test.ts
voice-local-stt-adapter-ws.test.ts
voice-local-stt-adapter.test.ts
voice-local-stt-spike.test.ts
voice-model-state.test.ts
voice-session-processing.test.ts
voice-session-reducer.test.ts
voice-web-speech-continuous.test.ts
voice-whisper-settings-copy.test.ts
wait-for-mode.test.ts
ws-frame-budget.test.ts


• Run targeted tests. Both projects compile with tsc then run node --test. To be targeted, build test-dist then run specific test files. Full build may take a while. Let me run in background or with timeout. Actually the test script does rm + tsc + run all tests — full suite could be long. Better: tsc then run only the specific test files.

  For chrome-extension: `tsc -p tsconfig.test.json && node --test .test-dist/tests/voice-composer-ux.test.js .test-dist/tests/voice-session-reducer.test.js .test-dist/tests/voice-whisper-settings-copy.test.js .test-dist/tests/meeting-diarize-copy.test.js`

  For companion: check run-tests.mjs — probably runs node --test on .test-dist. Do: `tsc -p tsconfig.test.json && node --test .test-dist/tests/voice-whisper-handlers.test.js` — but the companion test script uses scripts/run-tests.mjs; check its layout. Just try; if .test-dist layout differs, adapt.

  Run in background with generous timeout.

• Running the targeted test files in both packages.npm warn Unknown user config "//registry.npmmirror.com" (registry https://registry.npmmirror.com). This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
ℹ tests 36
ℹ suites 0
ℹ pass 36
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 34.62125


npm warn Unknown user config "//registry.npmmirror.com" (registry https://registry.npmmirror.com). This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 168.72325
• Both test claims verified: 36/36 and 26/26.

  Now finalize the reject-criteria check:

  1. `#5 uses model_missing for fallback sessions` — NO. New `local_fallback` code dispatched in `useVoiceInput.ts:646-650`; error-map adds a separate case label (grouped with model_missing for CTA, per spec item 4). ✓
  2. `#6 get_state still omits lastDownloadError` — NO. `attachLastDownloadError` applied in `get_state` (`whisper-handlers.ts:334`) and post-download broadcasts; process-level mem reset in test seam. ✓
  3. `Settings open still blanks voiceModelError` — NO. `SettingsSlideout.tsx:238` dispatch removed, comment added. ✓
  4. `#7 status still has no K echo` — NO. `formatMeetingDiarizeStatus(method, k)` used in MeetingPanel; summoner-web paintDiarized appends `· K=N`. ✓
  5. File-range overlap reverting another ID — ranges match the spec table: #5 (error-map, types, session-reducer, useVoiceInput, composer/reducer tests), #6 (whisper-handlers, useWebSocket, SettingsSlideout, whisper-settings-copy + tests), #7 (MeetingPanel, summoner-web, new meeting-diarize-copy + test). No overlaps. ✓

  Nits to consider:

  - Reducer ENGINE_END non-timeout local_fallback branch: `errorCode: timeoutBanner ? state.errorCode : ...` — when timeoutBanner is set, errorCode = state.errorCode; but TIMEOUT event overwrites errorCode to timeout/continuous-timeout, so the local_fallback/timeout combination is unreachable. Not a bug.

  - Empty-finals path (no speech during a fallback session): ENGINE_END takes the empty branch at line 335, which does not preserve the fallback banner/errorCode — user sees「未识别到内容」 instead of the fallback chip. Spec says keep on "successful idle"; the empty case is arguably not "successful", and the spec tests don't cover it. Minor nit at most.

  - `useWebSocket` `msg.lastDownloadError.trim()` — fine.

  - MeetingPanel `Math.floor(k)` on kRaw then format floors again — fine.

  - Summoner-web: `var k=d.diarize&&d.diarize.k||m.diarize&&m.diarize.k;` — k=0 falls through to m.diarize.k; harmless since 0 isn't valid anyway. Also kPart only when k>=1 — spec says audio K echo when k finite ≥1. ✓

  - Spec design #6 item 1 says "clear on success/cancel-success" — implemented: success clears at download completion; aborted path clears. ✓

  - One more: spec says the post-download broadcast on failure previously included lastDownloadError inline; now routed through attach — same shape. ✓

  - types.ts duplicated comment lines ("Dictation+ continuous: soft cap hint" twice) — trivial nit.

  Also check spec item: "#5 ... App.tsx (CTA wiring only)" — App.tsx unchanged because wiring already existed (`App.tsx:850`). Fine.

  Verdict: APPROVE_WITH_NITS seems right. Nits are minor. Could be APPROVE, but the duplicate comment and empty-finals edge are legit nits. I'll go APPROVE_WITH_NITS.

  Format the review concisely, end with the exact final line.

• Both claims verified locally: companion `voice-whisper-handlers` 26/26, chrome-extension targeted 36/36. Here's the review.

  ## Re-review — UX #5–#7 (`fix/voice-meeting-ux-5-7` vs `main`)

  Scope check: diff matches the spec's file-range table exactly, no cross-ID overlap:

  - **#5** — `error-map.ts`, `types.ts`, `session-reducer.ts`, `useVoiceInput.ts` (+ reducer/composer tests)
  - **#6** — `whisper-handlers.ts`, `useWebSocket.ts`, `SettingsSlideout.tsx`, `whisper-settings-copy.ts` (+ tests)
  - **#7** — `MeetingPanel.tsx`, `summoner-web.ts`, new `meeting-diarize-copy.ts` (+ test). `App.tsx` needed no change — the CTA wiring (`localSttBannerCta(voice.errorCode)`, App.tsx:850) already existed; the fix was upstream in `errorCode` propagation, as the spec diagnosed.

  ### REJECT criteria — all clear

  1. **#5 fallback ≠ `model_missing`** ✓ — new `local_fallback` code dispatched at `useVoiceInput.ts:646`; `error-map.ts` gives it its own case label (grouped with `model_missing` only for the shared open-settings CTA, exactly per spec item 4).
  2. **#6 `get_state` hydrates `lastDownloadError`** ✓ — process-level `lastDownloadErrorMem` set on non-abort fail, cleared on success and on abort, reset in the test seam, and `attachLastDownloadError()` wraps both `get_state` and post-download broadcasts. Covered by the new fail→hydrate→success→clear test.
  3. **Settings open no longer blanks `voiceModelError`** ✓ — the `SET_VOICE_MODEL_ERROR: null` dispatch at `SettingsSlideout.tsx:238` is removed; `useWebSocket.ts:1599` applies `lastDownloadError` from `voice.model.state` when the key is present.
  4. **#7 K echo present** ✓ — `formatMeetingDiarizeStatus(method, k)` emits `· K=N` for finite k ≥ 1 (text_gap unchanged otherwise); MeetingPanel also syncs the dropdown for k ∈ 2..4; summoner `paintDiarized` appends the same suffix, echo-only as specified.
  5. **No reverting overlap** ✓ — ranges disjoint.

  Reducer semantics verified by reading `session-reducer.ts:216-225,303-371`: code-less `SOFT_CAP_HINT` clears stale CTA code; `ENGINE_END` keeps banner+`errorCode` for `local_fallback` on the commit path, and timeout banner still wins (the `local_fallback` exclusion at :322 prevents `mapVoiceError` from clobbering it as a hard error).

  ### Nits (non-blocking)

  - `types.ts:50-51` — the `SOFT_CAP_HINT` doc comment is duplicated (old line kept, new line added above it).
  - Empty-finals path (`session-reducer.ts:335-353`): a fallback session with zero speech ends on the「未识别到内容」empty banner rather than keeping the fallback chip. Spec only mandates keep on successful idle, so this is arguably intended, but the CTA-to-settings recovery disappears in exactly the session where the user got nothing — worth a conscious call, not a fix demand.
  - `summoner-web.ts:2228` — `d.diarize.k || m.diarize.k` treats k=0 as falsy and falls through; harmless today since 0 isn't a valid K, just slightly loose.

  Tests re-run this review: 26/26 companion, 36/36 chrome-extension.

  VERDICT: APPROVE_WITH_NITS

To resume this session: kimi -r session_56042acf-59be-4258-a98d-b9a1365a2567
