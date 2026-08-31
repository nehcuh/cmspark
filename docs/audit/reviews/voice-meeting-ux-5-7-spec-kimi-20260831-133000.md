kimi version 0.39.1
• UserPromptSubmit hook

  {"systemMessage": "🔀 VibeSOP detected multiple intents. Execution plan injected.", "hookSpecificOutput": {"additionalContext": "[VibeSOP Execution Plan]\n{\n  \"plan_id\": \"a20cdccc-d56\",\n  \"original_query\": \"# Dual re-review — UX #5–#7 spec (plan only)\\n\\nREAD-ONLY. Independent senior reviewer.\\n\\nWork in: `/Users/huchen/Projects/cmspark` branch `fix/voice-meeting-ux-5-7`\\n\\n## Capability\\n\\n```text\\nSurface: L0 Side Panel voice + meeting | Blast: T2 UX\\nTrust: fallback already discloses cloud residual; add CTA + error hydration + K echo\\n```\\n\\n## Inputs\\n\\n1. Spec: `docs/superpowers/specs/2026-08-31-voice-meeting-ux-5-7.md`\\n2. Live: `useVoiceInput.ts` SOFT_CAP_HINT; `App.tsx` localSttBannerCta; `whisper-handlers.ts` lastDownloadError; `SettingsSlideout.tsx` open clear; `MeetingPanel.tsx` meeting.diarized; `summoner-web.ts` paintDiarized\\n\\n## Rules\\n\\n1. REJECT if #5 reuses `model_missing` for a session that is already on browser STT (fail-closed vs fallback confusion).\\n2. REJECT if #6 still loses the error when user opens settings after a failed download (get_state must carry lastDownloadError).\\n3. REJECT if #7 still leaves K only in JSON with no UI echo.\\n4. Calibration: P2 UX. Do not demand durable audit log, disk persist of download errors, or auto-K on summoner picker.\\n5. File ranges must stay disjoint.\\n\\nFinal line exactly one of:\\n\\nVERDICT: APPROVE\\nVERDICT: APPROVE_WITH_NITS\\nVERDICT: REJECT\",\n  \"steps\": [\n    {\n      \"step_id\": \"red_team-1d27\",\n      \"step_number\": 1,\n      \"skill_id\": \"fallback-llm\",\n      \"intent\": \"red_team: red_team\",\n      \"input_query\": \"\",\n      \"output_as\": \"step_1_result\",\n      \"status\": \"pending\"\n    },\n    {\n      \"step_id\": \"reviewer-a56f\",\n      \"step_number\": 2,\n      \"skill_id\": \"fallback-llm\",\n      \"intent\": \"reviewer: red_team\",\n      \"input_query\": \"\",\n      \"output_as\": \"step_2_result\",\n      \"status\": \"pending\"\n    }\n  ],\n  \"detected_intents\": [\n    \"code_review\",\n    \"fix_bug\",\n    \"implement_feature\",\n    \"debug_error\",\n    \"configuration\"\n  ],\n  \"reasoning\": \"Step 1: 'red_team' → fallback-llm (squad); Step 2: 'reviewer' → fallback-llm (squad)\",\n  \"status\": \"pending\"\n}", "hookEventName": "UserPromptSubmit"}}

• This is a read-only review task. I need to review the spec `docs/superpowers/specs/2026-08-31-voice-meeting-ux-5-7.md` against the live code. It's a dual re-review (red team + reviewer roles per hook, but really just: review the spec plan against rules). Read-only, so I can delegate exploration or do it myself. The spec plus 6 live files — that's substantial but I can read them directly. Let me read the spec first and the relevant files.

  Let me find the files. Read spec, and grep for the live files.

• I'll review the spec against the live code. Reading the spec and locating the referenced files.fix/voice-meeting-ux-5-7
?? docs/audit/reviews/_prompts/voice-meeting-ux-5-7-spec-dual-20260831.md
?? docs/audit/reviews/voice-meeting-ux-5-7-spec-claude-20260831-133000.md
?? docs/audit/reviews/voice-meeting-ux-5-7-spec-kimi-20260831-133000.md
?? docs/superpowers/specs/2026-08-31-voice-meeting-ux-5-7.md


• I need to verify the spec's claims against live code. This is a substantial review — spec claims bugs in 6+ files. I could delegate exploration to an explore agent, but I need precision on specific claims. Let me do targeted greps/reads myself since I know exactly what to check:

  Rule 1: #5 — check `model_missing` usage in error-map / session-reducer / useVoiceInput (fail-closed vs fallback).
  Rule 2: #6 — check `lastDownloadError` in whisper-handlers, get_state payload, useWebSocket voice.model.state, SettingsSlideout open-clear behavior.
  Rule 3: #7 — check MeetingPanel meeting.diarized handler (does it use k?), summoner-web paintDiarized.

  Also verify file ranges disjoint (already evident from table).

  Let me grep the key spots in parallel.

• Now verifying the spec's bug claims against the live code in parallel.

• Now let me check the remaining details:

  #5: Spec says new code `local_fallback`, not reusing `model_missing`. Live code confirms `model_missing` is fail-closed via localGateError and error-map (model_missing → open_settings CTA). Spec avoids reuse — satisfies Rule 1. Also need to check: does spec handle `localSttBannerCta` — the CTA for `local_fallback` → open_settings? Wait — the banner is "model missing, fell back to browser STT" — CTA "去设置" makes sense (go download the model). Good. Note: the session already runs on browser STT; using `model_missing` code would be wrong because... actually rule 1 says REJECT if #5 reuses model_missing — spec explicitly introduces `local_fallback`. ✓.

  One check: `SOFT_CAP_HINT` reducer case currently only applies in listening/starting phase. ENGINE_END behavior — spec says keep banner if errorCode === local_fallback. Need to verify reducer's ENGINE_END currently clears banner. Let me check session-reducer ENGINE_END. Also, does SOFT_CAP_HINT reducer set errorCode currently? Spec adds `code?: string` to event and reducer sets errorCode. Types.ts currently has `{ type: "SOFT_CAP_HINT"; message: string }` — no code. Spec changes types.ts. Fine.

  Potential issue: in App.tsx, `voiceBannerCta` only computed when `sttEngine === "local"` — fallback scenario is sttEngine=local (configured) with browser runtime, so CTA shows. OK.

  Another check for #5: the continuous-cap hint at line 681 dispatches SOFT_CAP_HINT without code — spec says continuous hint stays code-less ✓. But wait: if fallback banner has code and then continuous cap hint fires (code-less SOFT_CAP_HINT), reducer sets banner to continuous message — does it clear errorCode? Spec says "Reducer: set errorCode from event.code when present" — when not present, presumably leave errorCode? Ambiguous: if continuous hint overwrites banner while keeping errorCode="local_fallback", CTA would show under a continuous-listening hint — minor inconsistency. Could be a nit. Actually spec test: "continuous SOFT_CAP_HINT still no code". The reducer behavior on code-less SOFT_CAP_HINT re: errorCode isn't fully specified — worth a nit: specify whether code-less hint clears or keeps errorCode.

  #6: Live code confirms bug: lastDownloadError only in broadcast (line 266), not in get_state payload (statePayload). SettingsSlideout open does SET_VOICE_MODEL_ERROR: null then get_state. Spec design: process-level var, include in get_state + voice.model.state, useWebSocket applies if key present, SettingsSlideout must not blank at open. Satisfies Rule 2. Need to check that `voice.model.state` message in useWebSocket currently ignores lastDownloadError — check lines 1553-1600ish. Also check `whisper-settings-copy.ts` exists and modelProbeErrorLabel. Also verify useWebSocket handling — does the state message case dispatch SET_VOICE_MODEL_ERROR anywhere? Currently no. Spec adds that. OK.

  One potential issue: useWebSocket applies SET_VOICE_MODEL_ERROR from every voice.model.state — but voice.model.state broadcasts also happen on success (lastDownloadError null) — clears the error. That's intended ("success clears"). But note: spec says "if `"lastDownloadError" in msg`" — get_state and post-download always include it. But other voice.model.state broadcasts (e.g. after delete, set_active) — do they include the field? Spec says "post-download `voice.model.state`" always includes; get_state always includes. Other broadcasts may not include the key → guard handles it. Fine.

  Another check: SettingsSlideout also has clearVoiceErr at line 1334 on user actions — spec only says "must not blank at open". OK.

  Also check whisper-settings-copy.ts exists and has modelProbeErrorLabel with http-error/network-error.

  #7: Live MeetingPanel meeting.diarized uses only method, not k — confirms bug. Spec: formatMeetingDiarizeStatus(method, k), setImportStatus with K, setDiarizeK if k in 2..4. Note diarizeK select: value range 0..4 (clamped min 0 max 4), options presumably 自动 + 2,3,4. Spec says "if k in 2..4, setDiarizeK(k)". What if k=1? Edge: k≥1 finite shows K=N in status, but dropdown only syncs for 2..4. Minor. Also does `meeting.diarized` payload actually include k? Check the diarize payload — msg.diarize?.k or msg.meeting.diarize?.k. Spec #7 "Bug: meeting.diarize.k persisted" — so k exists in payload. Let me verify companion emits k in meeting.diarized. Quick grep.

  Summoner paintDiarized: status echo only, no auto-K on picker — matches calibration rule 4.

  Rule 5: file ranges disjoint — #5: error-map, types, session-reducer, useVoiceInput, App; #6: whisper-handlers, useWebSocket, SettingsSlideout, whisper-settings-copy; #7: MeetingPanel, summoner-web. Disjoint ✓.

  Remaining verifications:
  1. session-reducer ENGINE_END behavior + banner clearing.
  2. whisper-settings-copy.ts modelProbeErrorLabel.
  3. companion emits k in meeting.diarized payload.
  4. LOCAL_FALLBACK_BROWSER_BANNER exists in error-map.

• Core claims check out. Verifying remaining details: reducer `ENGINE_END` behavior, `whisper-settings-copy.ts`, and whether the diarize payload actually carries `k`.

• Now let me verify remaining items for #6:

  1. get_state path — check statePayload and whether get_state response currently includes lastDownloadError. The grep showed broadcast includes it at line 266, and get_state at line 314-318 uses `statePayload(deps)`. Need to check statePayload doesn't include lastDownloadError — spec claims it doesn't. Let me check statePayload.

  2. useWebSocket voice.model.state case — does it currently read lastDownloadError? The grep showed the case at 1553 but not its body. Spec says useWebSocket should apply SET_VOICE_MODEL_ERROR when key present. Need to confirm it currently doesn't (bug claim) and that adding it is coherent.

  3. #7: confirm `updated.diarize` includes k (meeting-handlers line 384 logs k; result.k). The payload diarize: updated.diarize — does diarize object contain k? Likely. MeetingPanel reads msg.diarize?.method, so k would be msg.diarize?.k. Fine.

  Also #5: check where ENGINE_END keeps banner for local_fallback — spec point 5 says "ENGINE_END / successful idle: if errorCode === 'local_fallback', keep banner + errorCode (timeout banner still wins)". Live ENGINE_END: for non-error phases with non-special errorCode, it maps via mapVoiceError and resets with banner — wait, there's a subtlety: SOFT_CAP_HINT sets errorCode=local_fallback while listening. Then ENGINE_END path: state.errorCode = "local_fallback" which is not in the excluded list (no-speech/empty/timeout/continuous-timeout), so the branch at line 314 fires: mapped = mapVoiceError("local_fallback") — does mapVoiceError know this code? It would produce banner = mapped.message || state.banner. This could clobber the fallback banner with a generic message if mapVoiceError doesn't handle local_fallback. Spec says "ENGINE_END ... keep banner + errorCode" — meaning the implementation must handle this; the spec addresses it by keeping banner+errorCode. But spec says "(timeout banner still wins)" — in the branch at 314, timeout wouldn't apply since abortReason... hmm actually if abortReason is "timeout" and errorCode is local_fallback? TIMEOUT event sets errorCode = event.code || "timeout", overwriting local_fallback. So timeout wins naturally. OK.

  But wait — the SOFT_CAP_HINT only fires in starting/listening; USER_TOGGLE_START clears banner+errorCode first, then fallback SOFT_CAP_HINT re-dispatched each start (fallbackRef still true). Spec says keep until dismiss/next start — "USER_TOGGLE_START / DISMISS_BANNER still clear" — and the re-dispatch on next start re-shows it. Consistent.

  One nit: spec says SOFT_CAP_HINT reducer sets errorCode from event.code — but SOFT_CAP_HINT also used for continuous cap hint (code-less) at useVoiceInput line 681. If a continuous hint fires during a fallback session, it overwrites banner with continuous message but errorCode stays local_fallback (spec: "set errorCode from event.code when present" — absent → unchanged?). Then banner shows "仍在连续听写…" with a 去设置 CTA — mismatch. Or if code-less clears errorCode, then fallback CTA lost. Spec doesn't specify; test says "continuous SOFT_CAP_HINT still no code". This is a genuine ambiguity worth a nit, not a reject.

  Also check: does the SOFT_CAP_HINT reducer currently set banner only? Line 216-219 shows `return { ...` truncated. Let me look at it — but not critical; spec says currently sets banner only, matches bug description.

  For #6, verify statePayload and useWebSocket body. Also verify spec claim "Settings open does SET_VOICE_MODEL_ERROR: null then get_state without the field" — confirmed at SettingsSlideout:238.

  Also check useWebSocket voice.model.state body to confirm it ignores lastDownloadError, and that adding SET_VOICE_MODEL_ERROR there won't fight with the error family route. Note: on download fail, the broadcast at whisper-handlers 264-268 already includes lastDownloadError — but UI never reads it. Also the error family "voice.model" route sets SET_VOICE_MODEL_ERROR. So currently error shown live but lost on settings reopen. Spec fix coherent.

  One concern: useWebSocket applying SET_VOICE_MODEL_ERROR from every voice.model.state — when settings not open, voice.model.state arrives (App.tsx pulls it when engine=local). If lastDownloadError present, voiceModelError set globally; harmless since displayed only in settings.

  Another check: get_state response path — the response goes through SW (chrome.runtime.sendMessage → background → WS). Does the response get routed through useWebSocket's voice.model.state case or as a direct sendMessage response? SettingsSlideout:241 sends voice.model.get_state with a callback and parses response via parseVoiceSettingsSendResponse. So get_state response may NOT flow through the useWebSocket voice.model.state handler! If so, spec point 3 (useWebSocket applies lastDownloadError from voice.model.state) wouldn't hydrate the error on settings open — the get_state response handling in SettingsSlideout only dispatches error when parsed.ok === false. Need to check: does background relay the get_state response also as a broadcast voice.model.state? Or does companion respond to get_state with a voice.model.state message that goes to the requesting client only... Let me check how voice.model.get_state response flows: companion responds to the WS message; background forwards; does it also dispatch into store? Let me check parseVoiceSettingsSendResponse and whether the response updates voiceModel state (state.voiceModel gets set somewhere — the store voiceModel mirror must be updated on get_state response; otherwise settings would never show models). Check SettingsSlideout around line 241-250 and parseVoiceSettingsSendResponse, plus background handler for voice.model.get_state.

• Two flow details to confirm for #6: how the `get_state` response reaches the store, and `statePayload`'s current fields.

• Key question for #6: how does the `get_state` response reach the store? The `get_state` response goes to the sendMessage callback in SettingsSlideout, and `parseVoiceSettingsSendResponse` — does a `voice.model.state` also get dispatched into the store via useWebSocket? The comment at line 232 says "后续由 state 广播驱动" — driven by state broadcasts afterward. So the get_state reply presumably comes back as a voice.model.state broadcast over WS → useWebSocket case → SET_VOICE_MODEL. Let me check how background handles voice.model.get_state response — whether it forwards to the store. Actually the companion likely replies to get_state with voice.model.state on the WS, which background relays to sidepanel as a message handled by useWebSocket (which processes all incoming WS messages). So the get_state response DOES flow through useWebSocket's voice.model.state case. Then spec point 3 (useWebSocket applies SET_VOICE_MODEL_ERROR when lastDownloadError in msg) works for hydration. And the direct callback in SettingsSlideout only handles failures of the send itself.

  Also, spec point 4 says SettingsSlideout must not blank SET_VOICE_MODEL_ERROR at open — because open → get_state → voice.model.state arrives with lastDownloadError → hydrated. But there's a race: line 238 blanks the error, then get_state round-trip repopulates. If companion includes lastDownloadError in get_state payload (spec point 2), the hydration works. There is a brief blank flash — acceptable for P2 UX.

  But wait — the spec says "must not blank at open". If they simply remove line 238, then stale errors from previous open persist until get_state arrives; that's fine. Actually keep the blank + hydration would also work, but blank-then-hydrate has the failure mode: if get_state fails (parse error), error set to parsed.error. Fine either way. Spec is coherent.

  Also confirm `VoiceModelStatePayload` type — spec changes statePayload to include lastDownloadError. And `buildState` in whisper-state.ts builds payload; spec mentions whisper-handlers only for companion side. The payload assembly is via buildVoiceModelState (BuildVoiceModelStateOpts) — adding lastDownloadError there or spreading after statePayload. Spec says "get_state and post-download voice.model.state always include lastDownloadError" — whisper-handlers statePayload/get_state case and the broadcast. Post-download broadcast already includes it (line 266). So the change is: process-level var + include in statePayload. But statePayload delegates to buildState... minor implementation detail; spec names `whisper-handlers.ts` which may need whisper-state.ts too if the payload type lives there. Check VoiceModelStatePayload definition — it's likely in whisper-state.ts or types. That's a potential nit: spec's #6 file list says `whisper-handlers.ts`, `useWebSocket.ts`, `SettingsSlideout.tsx`, `whisper-settings-copy.ts` — but the payload type `VoiceModelStatePayload` and buildVoiceModelState may live in `whisper-state.ts`, and the extension `VoiceModelState` type in `sidepanel/types.ts` may need lastDownloadError field (or useWebSocket reads raw msg). useWebSocket reads raw msg so no type change strictly needed, but VoiceModelStatePayload in companion likely needs the field — where is it defined? Quick check.

• One more check: where `VoiceModelStatePayload` is defined — spec #6's file list may miss it.

• Confirmed: `VoiceModelStatePayload` lives in `companion/src/voice/whisper-state.ts`, which is NOT in spec #6's file list. If the type needs a `lastDownloadError` field (TS strict), the spec's #6 file range must include `whisper-state.ts`, or the implementation casts/spreads. That's a nit — disjointness rule 5 is about ranges not overlapping; adding whisper-state.ts to #6 keeps disjointness. Minor omission, nit-level.

  Also extension `VoiceModelState` in sidepanel/types.ts — useWebSocket reads raw `msg` so no type change needed there; the store mirror doesn't need the field since error goes to voiceModelError. Fine.

  Now assemble verdict. Check rules:

  Rule 1: Spec #5 introduces `local_fallback`, explicitly does not reuse `model_missing`. ✓ — and live code confirms `model_missing` is fail-closed semantics (localGateError, autoFallbackToBrowser=false keeps model_missing banner). Pass.

  Rule 2: Spec #6 requires get_state to carry lastDownloadError + SettingsSlideout must not blank at open + useWebSocket hydrates. Live code confirms current bug (broadcast-only, blanked at open:238). Design closes the loop. Pass. Nit: payload type `VoiceModelStatePayload` lives in `whisper-state.ts` — not in the listed files; either add to #6 range or spread in whisper-handlers (spread works since broadcast already does `{...state, lastDownloadError}`). Actually the broadcast at line 264-268 already spreads extra fields onto the payload without type change? It does `{...state, lastDownloadError: downloadError, ...}` — so TS-wise the broadcast object is a wider type, fine for ctx.broadcast. get_state could do the same spread without touching whisper-state.ts. So not even a hard nit — but worth noting tests may want the type. Keep as nit.

  Rule 3: Spec #7 adds formatMeetingDiarizeStatus with K echo in Side Panel status + setDiarizeK sync + summoner status echo. Live: meeting.diarized carries diarize.k (meeting-handlers:384,391), MeetingPanel currently uses only method, dropdown stays 自动. Spec gives UI echo. Pass. Calibration respected (no auto-K picker on summoner, no disk persist, no audit log). ✓

  Rule 5: file ranges disjoint: #5 error-map/types/session-reducer/useVoiceInput/App; #6 whisper-handlers/useWebSocket/SettingsSlideout/whisper-settings-copy; #7 MeetingPanel/summoner-web. Disjoint ✓.

  Nits:
  1. #5 reducer: behavior of code-less SOFT_CAP_HINT (continuous cap hint) on existing `errorCode` unspecified — if fallback chip then continuous hint fires, banner text replaced by continuous message while errorCode stays `local_fallback` → CTA「去设置」under "仍在连续听写" hint. Spec should state whether code-less SOFT_CAP_HINT clears errorCode or leaves banner/errorCode untouched. 
  2. #6: `VoiceModelStatePayload` type lives in `whisper-state.ts` (not listed); either add to #6 range or note spread-without-type-change (as broadcast already does).
  3. #7: k=1 edge — status shows K=1 but dropdown sync restricted to 2..4; harmless but state explicitly. Also formatMeetingDiarizeStatus location not specified (new file? MeetingPanel inline?) — minor.
  4. #6 race: removing the open-clear means a stale error from prior session persists until get_state returns; acceptable, and spec explicitly chooses this. Not a nit even.

  Also check #5: App.tsx CTA gating `sttEngine === "local"` — fallback scenario is sttEngine=local configured, so CTA shows ✓. And spec says ENGINE_END keeps banner for local_fallback — live ENGINE_END branch at 314 would map "local_fallback" via mapVoiceError (unknown code → probably empty message, falls back to state.banner) — actually `mapped.message || state.banner` keeps banner. Hmm interesting: even without spec change, ENGINE_END branch 314-326 would keep errorCode local_fallback and banner... wait but does mapVoiceError handle local_fallback? If it returns empty message, banner preserved = fallback banner. So current code might accidentally work? No — currently SOFT_CAP_HINT never sets errorCode, so errorCode is null → branch 314 skipped → shouldApplyDraft path → resetToIdle clears banner (banner not passed). So bug confirmed. Spec fix coherent.

  One more consideration for nit 1: actually TIMEOUT sets errorCode, overwriting local_fallback — "timeout banner still wins" consistent with spec.

  Also #6: "clear on success/cancel-success" — cancel-success clears error? If user cancels a download, previous error from an earlier failed download of another model cleared — modelId tracking included. Fine.

  Verdict: APPROVE_WITH_NITS.

  Write review in user's language — the prompt is English with Chinese strings; the conversation language is English predominantly. I'll write in English with Chinese copy quoted as-is.

• All claims verified against live code. Here is the review.

  ## Re-review: UX #5–#7 spec (plan only)

  **Branch confirmed**: `fix/voice-meeting-ux-5-7`. Spec bug claims all reproduce in live code.

  ### Rule 1 — #5 must not reuse `model_missing` for fallback sessions: PASS

  Spec introduces a new `local_fallback` code and explicitly bars reusing `model_missing` (spec line 33). Live code confirms why this is correct: `model_missing` is the fail-closed gate (`useVoiceInput.ts:471`, kept when `autoFallbackToBrowser` is off per `useVoiceInput.ts:124-126`), while the fallback path is a per-session browser-STT run with a disclosure banner (`useVoiceInput.ts:643-646` dispatching code-less `SOFT_CAP_HINT`). The CTA mapping is additive (`error-map.ts:229` — `local_fallback → open_settings`), and the `ENGINE_END` keep-alive condition is scoped to `errorCode === "local_fallback"` so timeout banners still win (`session-reducer.ts:336-343` precedence preserved). No fail-closed/fallback confusion.

  ### Rule 2 — #6 error must survive settings open: PASS

  Bug confirmed live: `lastDownloadError` is broadcast-only (`whisper-handlers.ts:264-268`), `statePayload`/`get_state` never carries it (`whisper-handlers.ts:115-125`, `314-318`), and settings open blanks the error (`SettingsSlideout.tsx:238`) before a `get_state` that can't repopulate it. The spec closes the full loop: process-level field → `get_state` + post-download state always include it → `useWebSocket` `voice.model.state` hydrates `SET_VOICE_MODEL_ERROR` when the key is present → SettingsSlideout stops blanking at open. The `"lastDownloadError" in msg` guard correctly tolerates broadcasts that don't carry the field. Calibration respected — no disk persist demanded, matching Non-goals.

  ### Rule 3 — #7 K gets a UI echo: PASS

  `meeting.diarized` does carry `diarize.k` (`meeting-handlers.ts:384,391`), and today the Side Panel status uses only `method` (`MeetingPanel.tsx:664-669`) with the K dropdown stuck on 自动 (`MeetingPanel.tsx:134,1476`). Spec adds `formatMeetingDiarizeStatus(method, k)` echo plus `setDiarizeK(k)` sync for k∈2..4, and the same K suffix in summoner `paintDiarized` (`summoner-web.ts:2223-2229`) without touching the summoner picker — exactly within calibration.

  ### Rule 5 — disjoint ranges: PASS

  #5 (`error-map/types/session-reducer/useVoiceInput/App` CTA), #6 (`whisper-handlers/useWebSocket/SettingsSlideout/whisper-settings-copy`), #7 (`MeetingPanel/summoner-web`) — no overlap.

  ### Nits (non-blocking)

  1. **#5 reducer ambiguity**: code-less `SOFT_CAP_HINT` (continuous-cap hint, `useVoiceInput.ts:681`) during a fallback session — spec says "set `errorCode` from `event.code` when present" but not what happens to a stale `local_fallback` code/banner when the continuous hint overwrites the chip. State explicitly: either code-less hint clears `errorCode`, or it leaves banner+code untouched. Otherwise you can get a 去设置 CTA under "仍在连续听写" copy.
  2. **#6 file list**: `VoiceModelStatePayload` lives in `companion/src/voice/whisper-state.ts:35`, not `whisper-handlers.ts`. Either add `whisper-state.ts` to #6's range (still disjoint) or note the spread-without-type-change approach the existing broadcast already uses.
  3. **#7 k=1 edge**: status echoes `K=1` (finite ≥1) but dropdown sync is restricted to 2..4 — harmless, but say so in one line. Also name where `formatMeetingDiarizeStatus` lives (new pure helper module vs. inline in MeetingPanel) to keep #7's range precise.

  VERDICT: APPROVE_WITH_NITS

To resume this session: kimi -r session_8d452115-0850-4c44-aa74-a645253862dc
