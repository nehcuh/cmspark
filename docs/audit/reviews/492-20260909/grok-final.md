# #492 Final dual-surface T3 review

Independent reassessment of frozen code + machine evidence (base `e7be0d2f`). Prior Grok plugin **REJECT** is re-checked against the shipped native summoner, not the design checkpoint.

## Outcome

The ticket’s closed loop is present on **both** authorized surfaces: live raw ASR is painted before optional refine; stop-and-generate waits on real write/end receipts; notes are independent of ASR; generation is explicit and ACK-gated; invalid reference JSON fails closed without a silent Markdown fallback; raw archive is not overwritten by edits or AI draft. T3 expansion is the two bounded reference verbs only.

Prior plugin P1 (default **结束并生成纪要** undoing default smart-segment via `silence_cut: false` + 150 ms sleep) is **fixed**: `finalizeCapture` no longer cuts-then-sleeps; `saveMeetingMaterials(..., silenceCut)` ACKs `set_transcript` with `silence_cut: true` and feeds the receipt’s canonical lines to `generate_minutes`. Workflow UI holds append → end → set_transcript → set_reference and asserts segmented source + uncut `original_transcript`.

## Process / evidence used

- **[executed]** extension 1339/1339; extension + companion builds; plugin workflow UI (11 PASS); native summoner UI (9 PASS); close/nav UI; synthetic Mac ASR JSON (medium/large, not a Windows/mic claim).
- **[inspected]** frozen sources in the packet (panel, persistence, handlers/store/reference/minutes, summoner HTTP/ACL/workflow, validators, tests).
- Companion TAP in-packet is truncated to a 20-test settings slice; meeting unit tests are inspected in source, not re-proven by that log. That is an evidence-packaging gap, not a product fail.

## Components (in scope)

Extension `MeetingPanel` / `meeting-close` / `meeting-audio-import` + SW cases; companion `meeting-handlers` / `meeting-store` / `meeting-reference` / `meeting-minutes` / `minutes-prompt`; WS `validate` + `summoner-acl` + `SUMMONER_WEB_DISPATCH_ALLOW`; `summoner-web` HTTP/HTML + `SUMMONER_MEETING_WORKFLOW_JS`. Overlay still denies `import_text` / `auto_diarize` / `set_transcript`.

## Prior REJECT — disposition

| Finding | Now |
|---|---|
| P1 stop-and-generate clobbers segmentation | **Fixed** (`silenceCut` on material save; receipt text is the generate snapshot; UI gate test). |
| P2 new session keeps old original | **Fixed** (`meeting.created`/`started` reset; UI: new session detaches archive). |
| P2 import `waitForWrites` swallowed | **Fixed** (error keeps `cause.message` + 保存转写; UI recovery restores editor **and** raw). |
| NIT template in UI stale vs server fingerprint | **Accepted/documented** (fingerprint = text+notes+name). |
| NIT one bad correction fails the job | **Intentional** fail-closed; originals kept; tests. |
| NIT user-guide omits new files | **Fixed** (§3.5). |
| Native incomplete | **Shipped** with HTTP/ACL/parser/UI evidence. |

## T3 boundary (exact)

- Allowlist increment is only `meeting.import_reference` + `meeting.set_reference` (WS ACL, web dispatch, overlay type set, SW switch).
- HTTP import forwards `{name,type,content}` only; test proves `path` / `tool` are dropped.
- Unstamped tray and random Origin stay `origin_denied`; cookie/Origin/nonce/CSP nonce still required (403 without cookie).
- `import_text` / `auto_diarize` / `set_transcript` remain summoner-denied.
- Native **HTTP minutes** requires `privacy_ack_v1 === true` (400 `need_privacy_ack` otherwise). Local STT still sends `privacy_ack_v2`.
- No new outbound deps; notes are JSON data under a “never instructions” prompt; LLM runs only after material ACK (or native disk save) on an explicit minutes action.
- Known live-path mic pause is disclosed; #494 not claimed.

Native minutes send `{id}` after `end` + `set_reference` receipts (not inline text). That matches T3 (no `set_transcript` on overlay) and is gated in UI: held append ACK blocks end and blocks `generate_minutes`.

## Findings (actionable only)

**NIT — native STT append has no stable `segment_id`; split-archive retry cannot repair like the extension**  
`companion/src/summoner-web.ts` (`/api/meeting/append` dispatches `id+text+source` only); `companion/src/summoner/meeting-workflow.ts` `saveMeetingSegment`.  
Trigger: `saveMeeting` writes `transcript.json` then `original-transcript.json`. If the process dies between those files, native GET sees transcript length+1 but original unchanged → throws `会议材料已在别处变化`, shows `#meetingRetry`, and **cannot** replay a unique segment key. Extension persistence + `appendTranscript` collision/repair path *does* this (`meeting-segment-idempotency-492.test.ts`). Common lost-HTTP-ACK paths **are** covered (`before_send` / `after_commit` PASS). Same words in later windows still append (new `s.base`). Not a duplicate-on-ACK-loss bug; it is a dual-surface hole vs the stated “bounded stable per-segment id” retry rule.

**NIT — abort / “保存会议材料…” depend on refs that do not re-render**  
`MeetingPanel.tsx`: `{importDoneRef.current && <button … 中止导入>}` and `{generatingRef.current ? "保存会议材料…" : …}`.  
Trigger: abort only appears because `setImportStatus`/`setBusy` happen to re-render; the generating label never flips from the ref. Behavior of save-then-LLM is still driven by `pendingGenerate` + `busy`. Cosmetic / fragile UI, not an ACK skip.

**NIT — canonical generate snapshot joins with `\n`, live editor uses `\n\n`**  
`meeting-close.ts` `saveMeetingMaterials` vs `formatLinesFromMeeting`. After stop-and-generate the textarea flattens blank lines. Data/speakers/raw archive remain; tested canonical == `source_transcript`.

Not scored as regressions: template-only stale is live-panel by design; whole-job reject on one unverified correction is declared; native import has timeouts/abort-on-failure but no user **中止** control (extension does); native `/api/meeting/start` still server-stamps `privacy_ack_v1` (pre-existing; minutes was correctly *not* stamped).

## Trajectory

Plugin REJECT cause is gone and locked with receipt-order UI. Native is a real HTML/HTTP/SSE implementation with production handlers, not a panel reuse claim. T3 allowlist matches the authorized increment. Remaining nits are recovery-symmetry and render hygiene, not “generate from unconfirmed text” or privacy/ACL overreach.

VERDICT: APPROVE_WITH_NITS
