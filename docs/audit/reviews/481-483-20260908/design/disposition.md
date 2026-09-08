# Design review disposition

Actual independent reports: Grok4.6 APPROVE_WITH_NITS; DeepSeekV4Pro APPROVE_WITH_NITS. Judge text is evidence to verify, not product truth.

- Future Project and code/terminal integration remain expressly marked as proposals in plan §1/§5 and root DESIGN. No Project UI/entity is shipped. Current/future scope follows plan §1; visual policy follows root DESIGN; capability/trust retains docs/DESIGN and #476.
- Tags/folder remain labels, never cwd or grants; shared validator rejects unknown mixed payloads and preserves unsubmitted fields. Existing groups derive from the same thread store. No new summoner AI extraction/graph claim.
- Switching/new conversation cancels dictation; late results are discarded. Existing draft semantics are unchanged. Pagehide cleanup is verified in implementation follow-up. B must never display A recording status.
- Stop/continue/diff remain reachable only in the owning conversation; switching does not cancel the running coding agent. Return-to-owner behavior is browser-tested. Global activity remains future.
- Settings hosts remain separate. New dictation recovery copy points to Chrome sidepanel → 设置 → 输入与语音. Audit-only stale meeting/standalone settings paths remain explicitly deferred.
- Added measurable input/final event-loop acceptance and old 8s/12s deadline regression criteria. No real ASR latency improvement claim without before/after measurement. #476 native/no-browser product acceptance is not assigned to project metadata alone.
- Proposed fork defaults explicitly await the Project implementation Issue. Synthetic UI / code tests / native installation / platform runtime evidence are reported separately.
