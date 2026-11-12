# Task browser tab lifecycle

GitHub: #848

Task-created research tabs should stop accumulating after their content has been read. Preserve the page/task/evidence relationship locally before closing, and retain pages that are still needed.

## Behavior

- `create_tab` creates a temporary task tab by default; `keep_open: true` expresses an intentional deliverable that must remain open. User-existing tabs are never automatic cleanup candidates.
- Reuse the existing authenticated local-page evidence capture and `EvidenceStore`; keep immutable observations unchanged. Add a bounded task-page ledger with thread ID, execution ID, source URL/title, observation IDs, creation time and actual closure outcome. URLs use the existing query/credential-free browser target representation. No extra page reads or new persistence bypass is introduced.
- After reading, the assistant calls `close_tab` when no further page interaction is needed. The runtime saves the association before forwarding closure. If closure is a task cleanup, the extension validates its own creation identity and the latest observed navigation key, then checks pinning, user adoption and unsaved forms. Ordinary user-directed closing of pre-existing tabs retains its existing behavior.
- On a successful run's finalization, clean up remaining temporary tabs with saved observations. Keep the current foreground tab, user-adopted or pinned/audible tabs, edited forms, uncaptured/changed pages, explicitly retained tabs and in-flight work. Cancellation, supersession and failed runs do not initiate automatic closure.
- The cleanup reuses the normal tool executor and its existing permission/lease gates. Internal cleanup metadata is a restriction, not a permission grant. Browser-created identities remain private to the running task wrapper; service-worker restart loses automatic-close eligibility safely.
- `browser_sources` reads only the current authenticated chat's saved source/observation links and closure states, including after task or Companion restart. Evidence excerpts remain in the existing evidence store. Listing saved sources performs no browser operation.
- Saving failure leaves the tab open. Save `closing` before dispatch; write `closed` only after actual success. A missing or failed acknowledgement stays retained/uncertain and is never reported as closed. The existing evidence capacity applies; unsupported or uncaptured page reads are retained rather than silently discarded.

## Acceptance

1. Multiple real-producer page reads, persisted source associations and task-end cleanup leave the matching local evidence retrievable after tabs close.
2. Explicit early closure does not wait for the entire run. A `keep_open` tab and every pre-existing user tab survive automatic cleanup.
3. A failed archive, failed read/capture, navigation change, user adoption, edited form, active foreground tab, cancellation or superseded execution cannot cause an automatic close.
4. Existing evidence redaction/navigation identity, tool validation, plan policy, lease and authenticated browser dispatch remain in force. A forged cleanup identity fails closed.
5. Reopening the evidence store and querying sources retains task/run/observation association and truthful closure state.

## Capability / verification

T3. Surface: local Chat browser tools. L2 classes: existing browser gates. Compose: read -> existing evidence store -> source ledger -> guarded close. Autonomy: task-owned temporary tabs only. Trust and outbound profiles remain unchanged. Channel: authenticated extension and local Companion storage.

Machine checks cover the real page-read producer, evidence capture/store, task wrapper and extension guard with an in-memory Chrome tab actuator. Then an independent adversarial reviewer examines the same diff and evidence, followed by Pi rereview under the project's eval-engineering-gate.
