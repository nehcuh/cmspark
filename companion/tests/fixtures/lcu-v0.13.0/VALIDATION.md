# Focused LCU validation inputs

Five new test roots, 44 named Node test cases:

- `tests/lcu-contract.test.ts`: 12, actual upstream status producer, finite status projection, platform/command/env boundaries, probe identity/cancellation, original app approval payload, native authorization and stale ownership.
- `tests/lcu-session.test.ts`: 9, official SDK in-memory server handshake, exact original instructions/catalog, host-only exclusion, real metadata, reset lifecycle mapping, actual upstream elicitation, late approval, abort, cleanup failure and idempotent close.
- `tests/lcu-runtime.test.ts`: 9, disabled/no-start, per-run isolation and shared native-input ownership, pending-capacity reservation, install identity, config revocation, human refusal, cleanup quarantine and observational callback failure.
- `tests/lcu-result.test.ts`: 10, exact owned image bytes and original text/error, malformed/unsupported content, size/count limits, durable redaction in full-history mode, actual context-budget clone replacement, tool-response pairing, human image ownership, atomic aggregate batch limits and actual compaction redaction before summary generation.
- `tests/lcu-discovery.test.ts`: 4, owned inert executable metadata, writable/non-executable refusal, symlink retarget between identity observations, documented Linux path selection and finite status refusal accounting.

All dependencies are source imports or the existing locked MCP SDK. The server is `InMemoryTransport`; it starts no subprocess or sockets. The status producer executes in a VM with injected inert metadata/readers and never imports a runtime module. Native authorization is injected; no biometric/native/provider/GUI operation is invoked. The result pixel is an owned static 1px fixture. Discovery filesystem tests create only temporary owned inert files, never execute them, and remove only their own temporary directories.

Compile these test roots and their imported fixture helpers under the same frozen TypeScript and source version used by the parent machine gate, then run only these five emitted files using Node's test runner. Keep the complete TAP and natural exit. Do not assume the normal product `tsconfig.json` checks tests (its root is `src`). No test/build/native experiment has been executed by this test-authoring agent.

One test deliberately expects once-only app acceptance with no `_meta.persist`, matching the parent's revised explicit-consent policy. One test deliberately expects throwing `changed` observers not to change admission or leak ownership, matching the parent's runtime hardening. The SDK protocol test retains the upstream payload as produced, so missing/default `mode` behavior is tested rather than assumed.
