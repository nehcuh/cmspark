#492 plugin+shared backend review (native T3 DESIGN is checkpoint only; overlay allowlists still deny `import_reference`/`set_reference` and that is in-scope honest).

## Outcome
Plugin loop matches the ticket: live raw STT, independent original archive, Word/MD/TXT notes, ACK-before-LLM, evidence JSON, stale fingerprint, per-meeting lock, 7 MiB cap, no-notes Markdown, local STT privacy. Tests/UI evidence support that. One introduced regression on the new primary CTA.

## Process
Companion 5049/0, extension 1338/0, typecheck/build 0. Workflow UI: live raw vs delayed refine, stop→save→minutes, notes/correction, failed save blocks LLM, WAV append, DOCX/corrupt, engine switch; close/nav and fake-mic PASS. Isolation incident (five synthetic dirs) documented, not a product fail. Native summoner is a separate HTML/HTTP/SSE slice — not complete here.

## Components
`MeetingPanel` + `meeting-close`/`meeting-audio-import`; companion `meeting-handlers`/`store`/`minutes`/`reference`/`minutes-prompt`; WS validate + SW cases; tests/docs. Overlay ACL unchanged (correct for this packet).

## Findings

**P1 — default 结束并生成纪要 clobbers 结束时智能分段 (default on)**  
`finalizeCapture` still sends `meeting.apply_silence_cut` then waits 150 ms and calls `sendMinutesJob`. New `saveMeetingMaterials` always `set_transcript` with `silence_cut: false` using the uncut textarea; handler now prefers explicit `msg.text` over stored lines (`meeting-handlers.ts` generate path). Previously stored cut could win (`transcriptToText(m.transcript) || inline`). Primary CTA + `autoSegmentOnStop` default true makes stop-and-generate undo segmentation. Plan: 分段 must remain.  
Evidence: `MeetingPanel.tsx` `finalizeCapture` (cut then 150 ms → `sendMinutesJob`); `meeting-close.ts` `saveMeetingMaterials` `silence_cut: false`.

**P2 — new session does not reset local original**  
`startLiveCapture` clears live corrections, not `originalTranscript`. `meeting.created` has no `original_transcript` array, so the idle sync does not clear. Prior meeting ASR can remain until a later idle `meeting.updated`.  
Evidence: `MeetingPanel.tsx` `startLiveCapture` / top-of-`onMsg` original sync.

**P2 — import `waitForWrites` failure is swallowed**  
Failed appends throw; `onImportAudioFile` `catch` replaces with generic “音频导入失败”. Recovery path is less obvious than 保存转写.  
Evidence: `MeetingPanel.tsx` `onImportAudioFile` try/catch.

**NIT — UI stale includes template; server fingerprint does not** (`transcript`+notes+name only).  
**NIT — `parseReferenceMinutes` fails the whole job on one bad correction** (prompt said omit). Fail-closed, originals kept.  
**NIT — user-guide §3.5 omits `original-transcript.json` / `reference.json`.**

Not scored: overlay `generate_minutes` may carry inline `reference_notes` (existing overlay generate + new fields). Native T3 should treat that explicitly. Reasons remain unproven prose (as specified).

## Verdict
Core materials/privacy/recovery/plugin wire are real. Default stop-and-generate vs default smart-segment is a slice-owned regression.

**VERDICT: REJECT**
