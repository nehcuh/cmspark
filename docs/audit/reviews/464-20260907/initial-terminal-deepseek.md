**Scope:** Terminal checkpoint #466/#467 — `pty/handler.ts`, `pty/session.ts`, `pty/env.ts`, `pty/cwd.ts`, `pty-terminal.test.ts`, report-persistence snippet. Capability T3 boundaries verified: panel-only gate, `user_gesture` required, origin-bound confirmation before every open/submit, no auto-execution path, single live PTY, review-bound report import with digest idempotency. `[inspected]`

**Passed gates** (no further action):
- `handler.ts` re-verifies peer readyState, thread policy/workspace identity, and re-resolved cwd after confirmation — the disconnected-peer and context-changed tests exercise both.
- Ownership is object-identity (`live.owner === owner`); cross-peer kill denied, covered by test.
- Report flow: preview → confirm → context recheck → `receive` (re-parses/validates identity), retry same payload returns same receipt, distinct digest rejected; handback message id is deterministic and ADD_MESSAGE-deduped — tests prove no duplicate history.
- Env strip (cmspark-prefix + exact pairing keys), cwd realpath containment with root/broken-symlink refusal, ack watermark hysteresis, 45s idle kill, busy-single-session — each has an executing test.
- No injection surface: confirmation JSON is display-only, messageId derives from UUID.

**Findings:**

**P1 — `session.ts` `emitChunks` (~L174): UTF-8 multi-byte split at fixed 16KiB byte boundaries.** `Buffer.from(text,"utf8")` is sliced at literal 16,384-byte offsets, so a 3-byte CJK/emoji codepoint straddling a boundary is split across two `terminal.data` frames. Failure mode: if the panel decodes each b64 frame independently (naive per-frame TextDecoder/atob), the split char renders as U+FFFD — for dense CJK output the probability is ~2/3 per boundary, i.e., visible mojibake on long outputs. The companion side provides no contract ensuring the client concatenates raw bytes before decoding. Fix cheaply here: chunk by code points (~5,461/boundary) before encoding, or confirm client uses streaming decode. Unverified boundary — must check panel decode before claiming clean CJK rendering.

**P2 — `session.ts` `writePtyInput` (~L293): dead `invalid_b64` branch.** `Buffer.from(b64,"base64")` never throws on malformed input (invalid chars silently dropped). Garbage base64 writes an empty string and returns `ok:true` — client cannot distinguish success from no-op. Either validate with a base64 regex/re-encode round-trip or drop the unreachable catch.

**P2 — `pingPty` docstring vs handler.** `session.ts` (~L284) documents "unknown id is a no-op (ext may ping after local close)", but `handler.ts` denies unknown ids with `TERMINAL_SESSION_NOT_OWNED` before dispatch (test `#432 ping` asserts `terminal.error`). The documented keepalive-after-close path is unreachable through the real router. Align comment or handler; current mismatch misleads future callers.

No P0 correctness/security defects found in the reviewed set; tests are strong and match every stated contract except the P1 boundary.

**VERDICT: /push-ready/** — 0×P0, 1×P1 (verify client-side UTF-8 decode or harden chunking), 2×P2.
