# #464 review ledger

Base 68ccb023. Actual Grok 4.6 CLI and DeepSeek V4 Pro (Claude CLI transport). No substitution with an internal agent. Design reviews approve; #465 checkpoint reviews approve after own-finding follow-ups. The later terminal/material corrections have their own six independent reports; final notification/type corrections have an additional two-model gate.

- DeepSeek web MAJOR: over-cap source could break reads. Closed by reviewer after verifying EvidenceStore rejects over-cap writes before rename. Corrupt externally changed sources intentionally fail closed; no cached-source bypass.
- Grok web MAJOR: raw excerpt normalization. Reviewer acknowledged existing citationSchema already normalizes, so claimed original path was not reachable. Parsing the authenticated Observation slice was nevertheless adopted and an NFC/NFD/CRLF test added.
- File mode default was already 0600; made explicit. Source validation guarantees stored NFC/LF; no additional normalization bypass required. Invalid URL and corrupt JSON codes now explicit; URL alias equality remains conservative.
- Design MINORs: no deletion added; at 16 jobs start a new Chat and recapture, preserving the audit trail. Retry uses existing canonicalRequest deterministic encoding. Pending terminal open rechecks peer and context after confirmation. Display value and copy both strip controls. Agent-only lines explicitly unverified.

Regression case:
1. Proposed reviewer failure was checked against the real imported citation schema and store writer.
2. Partial review packets omitted relevant dependency guarantees, producing conditional false positives.
3. Attribution: review packet context and reviewer inference, not reproduced production failure.
4. Future packets include dependency contracts, and all BLOCK/MAJOR claims need source or a reproducer.

## #466 / #467 code checkpoints

Every P0/P1/MAJOR is closed by its originating judge in the corrected reports.

| Area | Reproduced problem / disposition | Evidence |
| --- | --- | --- |
| PTY ownership | Require live exact peer object; cancel pending open on matching close; recheck thread/workspace/cwd/review after L2 | PTY regression suite; corrected-terminal-* |
| PTY output/input | Preserve UTF-8 frame boundaries, strict canonical base64, hard 256KiB unacked bound, resume cannot bypass ACK watermark | Long CJK/emoji and malformed-input/overflow tests |
| Workspace | `..cache` inside workspace was falsely denied; restrict traversal test to actual parent segments | PTY dot-directory test |
| Relay | Reject nonterminal sender and other-session frames; immutable session id; existing outer single-Port gate plus identity-based detach | terminal-relay tests; corrected-return-ui-* |
| Disconnect UI | Stop input and ping, disable submission after connection loss | Isolated Chrome React/xterm test |
| Material/store | Match schema caps, preserve corrupted store bytes, explicit corruption errors, missing commit is unverified rather than falsely mismatched | code-review tests; corrected-materials-* |
| Draft immutability | No delete API; update increments revision. Missing/corrupt source fails closed, changed revision becomes a gap. Multi-process writers unsupported; synchronous single-process store operations | Source proof accepted by both judges |
| Handback delivery | Durable receipt/history success must survive live Chat push failure; same payload retry returns same receipt and history row | Final delta; PTY test injects send throw |
| Production UI typing | Extension Thread omitted existing server execution_policy field; add optional exact union, retain backend enforcement | Production extension build exit 0 |

## Nonblocking observations / ownership

Owned by #464 maintainers for subsequent polish; no new scope is implied by closing the child implementation issues:
- Generic schema describes most bounds but does not express every cross-field refine/UUID check; strict server validation remains authoritative.
- Invalid non-object store JSON is classified unsupported-schema rather than corrupt; both fail closed.
- Empty unsupported commit text can list both unverified and mismatch; no ready/approval path is produced.
- UI's `user_gesture` open flag is an intent hint. Existing click opens the tab, but a fresh server L2 is mandatory even when the flag is set.
- Relay accepts the existing server pause/resume messages and uses a type/session allowlist; actual handler validates payloads. It does not treat its client allowlist as authorization.
- Non-disconnection post-open errors use reportStatus for retry feedback; terminal fatal-state UX can be refined after real Agent testing.
- JSON-string comparison of post-L2 review context is conservative; unexpected ordering can require reconfirmation, never grant it.
- Different checkpoint packets intentionally omit unrelated components; absent source in a packet is not treated as proof of an implementation defect. Cross-checkpoint reports and tests are retained.

Regression cases:
1. Large UTF-8 terminal output was split into individually invalid frames; decoded text could be corrupted.
2. Per-frame round-trip and output bounds now pass real producer tests, including CJK and emoji.
3. Attribution: implementation protocol boundary; fixed before merge after external review.
4. Protects readable Agent output and bounded terminal memory without bypassing confirmation.

1. Browser-level layout test exposed flex sizing that compressed the report pane; full production build exposed a missing shared Thread field.
2. Real React/xterm layout and production compilation now pass; targeted test compilation alone had missed the UI type.
3. Attribution: implementation and incomplete verification scope.
4. Protects usable report import and requires actual production build before completion claims.
