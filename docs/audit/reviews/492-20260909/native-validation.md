# #492 Native meeting implementation validation

- Owned production files: companion/src/summoner-web.ts, companion/src/summoner/meeting-workflow.ts, companion/src/ws/summoner-acl.ts, and exactly two additions to meeting-handlers.ts OVERLAY_MEETING_TYPES.
- T3 ACL delta: meeting.import_reference and meeting.set_reference. No native meeting.import_text / auto_diarize / set_transcript or generic server-path import allowance.
- Actual menu-bar entry: menu-bar-agent.ts openSummonerWebShell invokes startSummonerWebServer with dispatchSummonerWeb. Chunk/abort wrappers use sendAppMessage and return an ok frame; the browser fixture extracts the real wrapper.
- POST reference/import parses actual DOCX/MD/TXT via the shared parser, up to 7 MiB bytes. HTTP drops unrelated path/tool fields. POST reference persists independent notes. POST create permits import-only sessions. All retain existing Host/Origin/token/nonce protection. Generate requires explicit meeting privacy acknowledgement.
- Final STT result is shown before append completes. HTTP/SSE final callbacks share the same commit promise. Capture stop waits queued chunks, final inference, append acknowledgement, then meeting.end; generate awaits that chain plus reference save.
- Failed write/lost ACK recovery compares actual transcript and original-ASR baseline before retry; tests use real meeting handler/store replies. Ambiguous concurrent changes fail explicitly. Ordinary requests have 15 s deadline, final STT 305 s, minutes 100 s.
- Reference autosave before new/history selection; save failure keeps current draft. Separate raw-ASR, source transcript, corrected transcript, corrections, supplements and conflicts display.
- Existing segmented capture is not seamless: inference pauses the microphone between roughly 8 s windows; UI and audit explicitly disclose this limitation.

## Machine verification

- Node v22.23.2 selected with nvm use 22.
- tsc -p tsconfig.test.json passed, latest .test-dist available.
- 90 focused tests passed, zero failures: summoner-meeting-492, meeting-reference, overlay-meeting-244, summoner-web. Log: native-focused.log.
- Genuine HTTP parser coverage includes DOCX/MD/TXT, corrupt docx with false MIME, accepted exact 7 MiB and rejected +1 byte, no-token rejection, no-consent generation rejection, exact allowed/denied meeting verbs, and full delivered HTML script syntax under CSP nonce.
- Runtime VM tests execute the production browser helper and real handlers/store to verify failed-write retry and lost-ACK deduplication; deadline test verifies abort and explicit recovery wording.
- Every test process has a temporary CMSPARK_DATA_DIR set before module loading. No user audio or live config inspected.
- git diff --check on owned files passed. No commit/push or full suite run by this agent.
- Actual browser verification is performed independently by the browser agent; latest results and screenshots live in ui-native.log and native/.

## Final #492 raw append recovery extension

Optional `segment_id` on meeting.append_transcript / TranscriptLine accepts 8–128 ASCII letters, digits, underscores or hyphens (first character alphanumeric). It persists in the original ASR archive. Within one meeting, replay of the same ID/text/source/speaker returns the existing meeting without writes; a different payload returns segment_id_conflict. Dedupe happens before archive capacity checks, and persists across reload and editable-transcript replacement. Repeated words under different IDs remain separate utterances; IDs in other meetings do not collide. Legacy clients without segment_id retain their existing behavior.

Real handler tests were red when original_transcript omitted the ID, then passed after implementation. Focused final segment+reference+routing+native runtime/HTTP batch: 20 passed, 0 failed (segment-green.log). Test compilation refreshed .test-dist and the plugin browser agent was notified. Native browser independently passed 9 scenarios, including genuine before-send and after-commit ACK loss, original/archive invariants, import-first consent clicks and readable 390/960 layouts (ui-native.log).
