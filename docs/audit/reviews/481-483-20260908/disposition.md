# Implementation review disposition

Initial Grok4.6 APPROVE_WITH_NITS; initial DeepSeekV4Pro REJECT. Initial report attribution claiming both judges found duplicate final is incorrect: Grok explicitly confirmed HTTP-only dictation final. Never infer approval from a judge naming another judge.

## DeepSeek findings
1. Alleged partial/final duplication is refuted by exact code and new executed regression. poll does not mutate upload queue; SSE final does not call finish; end HTTP is sole commit. Added pending partial → stop → SSE final → partial HTTP fake final → end HTTP final tests in VM and real HTML; one final. Disputed finding requires explicit re-review, not implementer waiver.
2. overlay tracker is exit-cleanup ownership, not a lock. Error JSON clears it; thrown transport preserves last known ID for hide-abort. HTTP server tests cover both and new start. Clearing on throw would remove the recovery handle.
3. Created-session accepted/denied already derive owner from real session. Real pre-session legacy ctx.threadId error lacked owner: fixed using one validated resolved owner for execution and reply; red→green evidence.
4. Known session owner reassignment rejects. First background event before thread.list must be cached; active/hydrated-list restriction would lose legitimate background state. Added regression showing B hidden in A, recovered in B, owner immutable.
5. Other picker capabilities are outside changed scope; do not invent missing github.pick/terminal.cwd endpoints from a speculative report.

## Grok findings
- pagehide dictation cancellation added; keepalive abort, capture cleanup and late permission/result tests.
- onStart moved after real PCM capture and cancellation checks; once per logical session. Continuous segment notifications preserved. Actual React useVoiceInput + production PCM harness verifies starting/listening/interim/final and late-owner cancellation.
- Mixed version: ship companion and extension together; missing owner stays unknown, never guesses foreground. Installation instructions require extension Reload. No claim of arbitrary old/new skew compatibility.
- Retained dismissed session payloads: separately tracked #484, preserve no-resurrection behavior until explicit bounded-cache design/test. Initial reviewer marked harmless for this slice.
- Metadata controls minimum32px; owner row focus after save (search fallback); alias NFC; behavioral browser focus test added.

## Evidence boundaries
Actual App and summoner HTML / hook harnesses use synthetic transport and microphone. No real STT speedup or Windows runtime UX claim. Project entity, native #476 management/terminal, and full resource CRUD remain open. T3 metadata payload expansion is explicit; no new method, policy/path/config field, or approval capability.
