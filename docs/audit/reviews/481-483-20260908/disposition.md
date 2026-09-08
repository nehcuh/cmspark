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

## Final independent delta disposition

Both final reports approve this slice. DeepSeek explicitly withdraws the speculative duplicate-final defect; Grok independently pins HTTP-only commit, cleanup tracker semantics, immutable coding ownership and first background-event caching. Final Grok remaining nits are handled as follows:

1. Non-stream continuous `onStart` precedes capture: existing separate path, nonblocking as judged; tracked #486 with observable acceptance requirements. Current ordinary progressive path is fixed/tested.
2. Abort keepalive plumbing: verified `summoner-web.ts` api passes opts unchanged to fetch (`fetch(url(path), opts)`), so controller keepalive is forwarded. No claim that synthetic pagehide proves the network survives a real browser/process termination; microphone cleanup is synchronous.
3. SSE test concern: production summoner uses `es.onmessage=function(ev)`, not addEventListener. The real HTML harness invokes that actual handler; its no-op addEventListener does not bypass the production handler. VM and HTML tests both exercise ignored duplicate SSE finals. No source change is necessary for this concern.
4. Dismissed-session cache retention: #484 remains open; approval explicitly says nonblocking. No unsafe GC added to bypass the tombstone behavior.

### Trace case: judge output validity
1. Requested a final Grok delta review against the frozen source packet.
2. First attempt produced preparation text and max-turns exit; retry produced a complete independent APPROVE_WITH_NITS report.
3. Attribution: external CLI turn-limit / response outcome; counting the first output as approval would have been an agent error.
4. Protects independent-review gate: neither preface nor another judge's attribution can authorize merge.
