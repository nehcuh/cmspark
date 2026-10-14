# Coding session feedback and inactive cache

GitHub: #522 / #484. Existing behavior repairs; T2 maximum. #481 project/native workbench scope remains open; #432 execution/PTY gates unchanged.

## Stop and entry (#522)

Stop targets the captured session and immutable conversation owner. Missing identity, stale owner, forwarding failure and companion refusal are visible errors. Forwarded `ok:true` means request sent, not stopped; a matching owner/session authoritative cancel receipt or actual closed event confirms stop. Late callbacks cannot affect a replacement owner/session. Mode C continues to explain that the outer/embedded agent may still run; no new kill or focus authority.

Missing receipt after ten seconds becomes a visible unconfirmed/retry state; this UI feedback deadline never declares completion or changes the backend process timeout.

R3: actual handler errors include server-stamped `request_type`. Only cancel refusals use Stop error/pending state. Followup/prompt/apply errors use one at-most-1000-character notice for the current selected immutable owner/session, including closed, cancel-confirmed and compacted rows; records and selection are untouched. Switching/removing the owner, selecting a new session, dismissing or retrying clears it. A non-Stop refusal cannot clear a pending Stop. Legacy, unknown and non-string request types retain the existing processingStatus route without coercion. A plain authoritative closed event is terminal before ack; only a new session ID starts a new lifecycle. Compaction retains a minimal cancelled outcome even when the rich error and ack are absent. Offered/confirmed UI state says waiting rather than running. Non-Stop runtime callback handling remains outside this incremental repair; do not claim it was broadly changed.

CLI retains the exact existing outer-terminal producer's generated command (at most 32KiB UTF-8, no partial command). Copy is an explicit local user gesture, never execution/relaunch. Too-large/missing commands show unavailable. Command comes from the frozen session launch, not later config. ACP live composer continues using the original session/owner. A separate new login shell isn't entering the existing outer agent. No PTY/platform/permission change.

The original command may reference an existing temporary task file. Its conservative copy deadline begins at the opener request and uses the existing 60-second unlink TTL; the timer hides Copy on expiry and the click rechecks the deadline. No task-file lifetime is extended. After expiry the UI directs the user to their existing terminal, with no claim of a reusable launch or resume command.

Parent R3 alone has partial #522 entry coverage: default `open_local_terminal=false`, missing/oversize command and expired command have no usable CLI entry in this batch. A manual-switch instruction is not an entry implementation. ACP same-session input and optional independent embedded-terminal work are not substitutes for CLI entry. No `Closes #522` claim until its remaining entry route is delivered and verified.

## Retirement policy (#484)

Rich inactive terminal session records are bounded to **16 rows and 256KiB UTF-8** (serialized full-record bytes). Current selected session, any nonterminal/unknown state and actionable pending diffs are protected. Both count and bytes enforced; oversized eligible rows compact even below count threshold. Oldest eligible rich rows compact first, deterministic tie by session ID.

Compacted records retain minimal immutable session/owner/agent/terminal metadata and a client-owned terminal marker. Dismissed terminal rows compact immediately. Late events for a compacted terminal ID cannot restore bulk, ownership or selection. Real followup has a new session ID; old markers never imply resumed execution. Tiny marker count itself is not bounded without a server watermark/epoch protocol; this scope bounds rich eligible payload, not all frontend memory. Running/actionable/current exclusions are explicit, never forcibly stopped or evicted to meet budget.

Original result history remains in existing ThreadManager messages. A compacted selected old result shows a truthful link/instruction to its conversation history, not a fake reconstructed report or new backend store. Pending-diff rows stay rich and actionable. No new project entity, persistent credentials, permission or live config migration.

Before live WS listeners, ACP progress and live handback messages use a 128KiB UTF-8 display projection: capped textual metadata/timeline, no full diff body/hunks, and a bounded real diff descriptor set retaining an actionable item if one exists. A `output_truncated` marker distinguishes partial display. Immutable owner/session metadata is never rewritten to fit; oversized metadata frames are withheld with a bounded diagnostic. The server's full diffs and canonical saved message are unchanged. Generic ordinary saved-message fetch/reload is outside this coding-cache resource scope; `acp.list` does not hydrate coding sessions.

## Acceptance and grouped gate

Actual producer outputs feed contract fixtures (only synthetic task/identities, normalized opaque IDs/owned paths; keys preserved). Reducer tests cover count/UTF-8 bytes, protected records, clear/late event/non-resurrection, immutable owner and A/B return. Real React DOM tests cover click/keyboard Stop transport error vs receipt, stale callback after owner switch, CLI copy exact command, safe Mode C text, compacted history notice and independent drafts.

Focused red→green then shared final host/Linux/build/exact-CI. #484 requires actual independent Grok4.6 + DeepSeekV4Pro reviews of the same frozen batch; implementation isn't self-approval. No release/merge claim before root completes those gates.

## #522 leaf: fresh manual interactive entry

Foundation: immutable root R3 + #532 manifest37 (04353ca7); leaf changes do not imply approval of the foundation or duplicate its feature scope. Existing issue522 authorizes completing the missing CLI entry.

An explicit current-owner/session UI gesture requests `acp.session.prepare_manual_entry`; a separate explicit Copy copies the prepared command. It is read-only text preparation, never native focus/open, process start, PTY, task-file write or master toggle. The UI says this starts a **new interactive Agent**, not resume/attach of the monitored bridge. Default outer=false and expired/missing original command use this independent path.

At an actual successful CLI child spawn, retain a private immutable descriptor: absolute executable alias with matching known CLI kind, real executable stat identity and workspace directory dev/ino identity (ordinary contents may change), actual canonical workspace/cwd, platform and safe shell. Known conventions come from the existing production launch presets; arbitrary executables/Node wrappers, custom configured args, unknown kinds and absent legacy descriptors are visibly unsupported. No env, task, startup flags, task-file path or secret args are stored/exported. Descriptor never enters session records/events/report/handback/model tools. Live config changes cannot redirect a prepared command. Missing/replaced executable or workspace is refused.

Reuse existing no-prompt/no-file builders for verified POSIX paths and Windows **cmd.exe** syntax; do not label it PowerShell. Both identity paths and shell metacharacters must be safe: control characters/apostrophes are refused on the POSIX path because the existing builder does not safely quote apostrophes; Windows expansion/control/quote/meta characters are refused conservatively. Bounded whole command <=32KiB UTF-8; no partial command and no old60s task-file reference/lifetime change.

RPC requires strict string session/thread/request IDs, literal user_gesture=true, enabled ACP, known stored owner matching the requested current owner and non-worker policy. UI accepts only its pending request, selected session and active immutable owner; retries/navigation/dismissal invalidate prior replies and cached commands. Runtime forwarding failure, authoritative refusal and missing response are visible; forwarding ok is not preparation. Copy is local clipboard only and stale controller cannot copy. No new tool is registered and `acp_get_status`/report/propose/handback omit descriptor/prepared command.

Evidence must originate from the real CLI start and real handler reply. Synthetic known-CLI executable fixtures are inert print/stdio agents (not Node REPL claimed to be a product Agent); source/protocol output shape is captured. Focused negatives cover missing/expired old task file, default outer=false, unknown/legacy/unsafe paths, wrong owner, disabled/worker/structured type, later config change, no subprocess/fswrite during prepare, no model exports, real App prepare/copy and late reply/navigation. Native Windows command execution remains a separate gate; pure cross-platform construction is not native acceptance.
