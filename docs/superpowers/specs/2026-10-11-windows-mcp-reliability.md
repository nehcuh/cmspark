# Windows and MCP reliability

GitHub: [#592](https://github.com/nehcuh/cmspark/issues/592)

The 2026-10-11 review of `2abb87f5` identified eleven groups of concrete defects and compatibility limitations. This work repairs those existing integration boundaries in three independently verified batches. It does not expand outbound profiles, change live configuration, or add OAuth, legacy SSE, sampling, or elicitation.

## Batch 1: lifecycle and selection

- The MCP global switch controls every start, in-flight completion, restart callback and offered catalog. Turning it off drains old connections and retries; turning it on restores enabled servers even when their individual configuration has not changed.
- Concurrent configuration changes reconcile process teardown and replacement in order; stale client events cannot revive a stopped generation or overwrite a replacement.
- Namespaced and meta tools enforce the same live thread selection. Worker selection can narrow but cannot widen the owner's selection. Selection is checked again after confirmation and before retries; an unavailable explicit thread fails closed.
- Existing trust, capability, whitelist and L2 confirmation gates remain in force.

## Batch 2: Windows lifecycle and paths

- Launchers preserve legitimate paths containing spaces, Unicode, ampersands, apostrophes and exclamation marks; paths and environment values are data rather than interpolated shell source.
- Installer stop logic targets the installation's tray and daemon without targeting unrelated Node processes.
- PTY close handles asynchronous process-cleanup errors without terminating Companion, and retains bounded tree cleanup.
- File roots resolve the three allowed Windows Known Folders. A consistent root snapshot is used during each operation; lexical and canonical-path restrictions remain effective, including junction escapes.
- Windows CI exercises launch/cleanup scripts and native resolver behavior. Redirected-user-folder and interactive desktop guarantees must be distinguished from synthetic or hosted-runner tests.

## Batch 3: protocol and cooperation

- Tools/resources/prompts enumerate bounded cursor chains and atomically replace caches only after successful full collection. List changes trigger coalesced refresh; stale disconnected results cannot overwrite current metadata.
- Structured MCP tool results survive both client and dispatcher projection. JSON Schema references retain their definitions and metadata safety scanning covers nested definitions.
- A cooperation task can require an actual live MCP route available to its parent. Identity, selection and tool authorization are checked again at execution; arbitrary names or changed aliases do not create new authority.
- Outbound cancellation crosses SDK, HTTP and pending-execution boundaries. Already executed side effects are never represented as rolled back.
- Existing outbound tools expose precise discoverable argument schemas, with matching execution validation and no profile expansion.

## Verification and release conditions

Use real SDK transports and child processes where feasible, isolate data directories and keep actual browser/OS effects mocked in unit tests. Each batch requires targeted host checks, a fresh Linux arm64 container using independent locked dependencies, Kimi review of its full diff, independent adversarial review followed by Pi rereview, and green remote CI before merge. Relevant Windows behavior requires Windows CI evidence, not an inference from macOS mocks.

Blast tier: T3. Surface: L1/L2. L2-classes: existing shell/host_read/host_computer. Compose: mcp-server/user-env. Autonomy: single/multi-worker. Trust: existing L2/session-trust/grant. Channel: community.

Record results and remaining limits by batch. Revert each atomic batch to roll back; do not weaken test or approval gates to obtain a green result.
