I'll read only the specified review packet and follow its independent review instructions.Independently re-reviewed the revised packet against this reviewer’s prior MAJORs only. No other paths, reports, commands, or subagents.

Authorized shape is unchanged: always-on web unified/raw-diff evidence; optional same-terminal Agent; explicit, manual, confirmed JSON import. No auto-run Agent, ACP sidecar, outbound MCP expansion, or writeback.

## MAJOR

1. **Comparison hash — CLOSED.** Frozen as SHA-256 of the exact cited diff after existing evidence normalization (CRLF/CR → LF, Unicode NFC), UTF-8 encoded; a normalized-observation hash, not a Git object hash. Identity is stored and checked beside it, not mixed into the digest. Agent-only jobs use `diff_hash=null`. Reads revalidate digests.

2. **Repository identity — CLOSED.** Required canonical HTTP(S) URL; no credentials/query/fragment; origin normalization; case-sensitive path; trailing slash and terminal `.git` removed; SCP/SSH/shorthand rejected. Equality uses that canonical value. Observed identity requires exact citations outside the diff span of that URL plus full base/head SHA; hunk literals never count. Page-text presence is not host comparison semantics.

3. **Immutable scope vs recapture — CLOSED.** No mutable capture/update. Create is either Agent-only requested scope or one exact observation citation. A new capture, base, or head is a new job/id. Terminal and report bindings never follow a replacement. Adding a capture after an Agent-only report creates a new job; it does not rebind the stored report.

4. **Prompt verification state — CLOSED.** Generated prompt must include server-derived requested/observed identity, normalized diff hash or null, every coverage gap, and an untrusted-data warning. Display is escaped React text/textarea only; never written or echoed into the PTY. Copy strips C0/C1 except LF/TAB, with paste-into-Agent (not shell) instruction. No report text or caller completeness field can change those generated states.

5. **Report cardinality / retry — CLOSED.** One report per job. Same canonical report payload SHA-256 is an idempotent retry of the same receipt; a different payload is rejected (new job required). Persist-before-ack; failed persistence is not a successful handback. Only the confirmed terminal UI path may import; model tools cannot.

6. **Readiness as a model boolean — CLOSED.** Closed fail-closed gap predicates are enumerated. This generic adapter has no host completeness contract, so `review_ready` stays false even after a confirmed report; `combined_ready = existing_draft_ready && review_ready` when attached. Confirmation attests import intent only. Report prose, model booleans, and inspection tools cannot promote either bit.

7. **Observation bytes as browser facts — CLOSED.** New `text_transform`: `unchanged` only when the authenticated local producer returns `threats_removed=[]`; `sanitized` if nonempty; `unknown` if absent. Code capture from sanitized/unknown observations is rejected; existing observations require recapture. NFC/LF is the labeled stored form. No raw-capture bypass. Truncated/rewritten/partial sources cannot become complete.

## NIT

1. Freeze report-payload digest bytes: SHA-256 of the exact submitted UTF-8 JSON, or a named canonicalization (e.g. JCS). “Canonical” is still ambiguous for retries.

2. Freeze truncation detection (observation truncated flag vs in-span marker) so “truncated source” is the same check in capture, prompt gaps, and tests.

3. Specify strip order for repository URLs until stable (trailing slash and `.git` can nest, e.g. `…/repo.git/`), plus WHATWG origin details (default port, punycode) so equality is deterministic.

4. At 16 jobs / 2 MiB with no eviction, freeze the create-at-cap error and whether jobs are deletable. Capture iteration otherwise dead-ends.

5. Apply the copy-button C0/C1 strip to the displayed prompt value so manual textarea copy cannot reintroduce controls.

6. Line 0 is not a finding line; file-level comments need a later field or remain unsupported.

## VERDICT: APPROVE
