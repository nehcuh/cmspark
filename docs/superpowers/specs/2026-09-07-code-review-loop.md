# Code review loop

GitHub: #464 (parent), #465 (web evidence), #466 (terminal return), #467 (materials)

Status: implementation authorized 2026-09-07; independent Grok 4.6 and DeepSeek V4 Pro design MAJORs closed. Implementation gates are separate.

## User outcome

CMspark can inspect actual code changes from authenticated unified/raw diff pages without an
installed coding Agent. With an Agent installed, the user can work in one embedded
terminal, reuse their login shell and credentials, and explicitly return a report
to the originating task. Both routes preserve the exact comparison and sources.

## First delivery and boundaries

- Reuse atomic `get_page_text` observations. A unified diff shown in a browser
  (including a code host's raw diff view) is an independently usable first adapter.
  Parse only exact cited text from the stored observation; never accept model
  supplied diff text as a browser fact. Normal code-host split views without a
  unified diff receive an explicit unsupported-format error, not fabricated lines.
- Every comparison has repository identity, full base/head SHA (40 or 64 hex,
  matching length), an immutable scope and hash. Base is explicit, including merge
  parent selection. One job covers one repository/comparison; multiple repositories
  require separate jobs. Branch names and abbreviated commits are not identities.
- Website coverage is conservatively partial/unknown until a platform-specific
  completeness contract exists. Valid hunk counts prove syntax, not that the host
  loaded all files. Binary, combined diff, unknown headers, missing hunks, truncated
  observations and omitted files never become a complete review.
- Identity supplied at job creation is a requested scope, not proven release
  provenance. Page citations must support identity before claiming it observed;
  otherwise display unverified. No model boolean can promote completeness.
- Review jobs live in a separately versioned bounded store scoped by server-owned
  Chat thread. Existing draft v1 and evidence v1 bytes remain compatible. Browser
  observations are referenced, not rewritten. Reads revalidate digests and schema.
- A job exposes a review prompt containing scope, captured changes, and explicitly
  untrusted business context. User copies this prompt into their chosen Agent in
  the same PTY. No automatic command injection or second background ACP process.
- Terminal opens bound to the original thread/job, validated server-side before
  and after confirmation. All later terminal frames require the opening peer and
  session. Reopening a tab must not silently rebind a live terminal to another job.
- Start a login shell (`-l`) so shell configuration/PATH and existing Agent login
  can be reused. Explicit user-env overrides retain Agent keys; Companion internal
  CMSPARK_* / pairing secrets remain excluded from the initial child environment.
  Shell startup files can alter that environment: this is full user shell access,
  not an OS sandbox. The environment map is not serialized to the extension;
  anything a user or shell prints is visible in the PTY stream.
- Explicit report return is a bounded structured JSON import with a preview and
  origin-bound user confirmation. It carries job id, repository/base/head/diff
  hash, summary, findings with file/side/line, reviewed files, and business mappings.
  Server validates identity, referenced captured lines and bounds. Manual import
  is labelled user-confirmed external assessment, never independently verified
  Agent execution. ANSI transcripts, process exit and cancellation are not reports.
- Persist report before acknowledging, make retries idempotent, then expose via
  Chat review-read and deterministic material rendering. Failed persistence never
  produces a successful handback. Receipt delivery must not depend on active tab.
- Business mappings retain actual platform task id separately from story draft;
  requirement and test references require exact observation citations. Unproven
  semantics remain assessments. Tests at another SHA, changed draft revision,
  incomplete diff and missing criteria/coverage block a complete review claim.
- Attach review references to materials as an explicit supplement. Existing v1
  readiness describes existing field rules only; when review is requested, render
  a separate review readiness and combined readiness which cannot be true with
  unresolved review gaps. Report text never sets the underlying field states.

## Capability declaration / threats

### Pinned first-version contracts

- Peer means the authenticated opening WebSocket object. Preserve the existing
  close-on-disconnect policy: WS/extension-tab disconnect kills its PTY, marks the
  UI closed and requires a new explicit confirmed open. There is no background
  lingering terminal or automatic reattach. Persisted review jobs/reports survive;
  shell processes do not. Durable PTY reconnection is outside this first slice.
- Prompt is displayed only as escaped React text/textarea, never written or echoed
  into the PTY. A copy button removes C0/C1 control characters (except LF/TAB),
  with an explicit instruction to paste inside the chosen Agent, not a shell.
  Prompt begins with an untrusted-data boundary warning. Original stored diff and
  hashes are unchanged. CMspark cannot guarantee an external Agent obeys the warning.
- Import is JSON pasted into an extension textarea, never a host file path or
  transcript scraper. Validate the whole report atomically; a malformed identity
  or invalid citation rejects the whole import with a bounded error. No dropping
  of bad findings. Preview includes the full bounded submitted JSON before the
  server's origin-bound confirmation. A matching retry returns the same receipt.
- Diff hash is SHA-256 of the exact cited diff after the existing evidence
  normalization (CRLF/CR to LF, Unicode NFC), UTF-8 encoded. It is explicitly a
  normalized-observation hash, not a Git blob/object hash. Scope uses base-to-head
  trees; a PR's three-dot view must specify the actual merge-base SHA as base.
  Metadata and identifiers appearing inside changed source lines cannot prove
  comparison identity. Ambiguous host semantics remain unverified.
- Without a web snapshot, an Agent report may still be stored as an unverified
  assessment of the requested comparison, with diff_hash=null and every code
  reference unverified. It is never promoted to complete. Adding a capture creates
  a new immutable review job rather than silently rebinding an existing report.
- This generic first adapter has no platform completeness contract, therefore
  review_ready/combined_ready remain false with an explicit coverage gap, even if
  a user confirms a report. Manual confirmation attests import intent, not tests,
  source authenticity, coverage or approval. Existing supported test evidence can
  resolve test-specific gaps independently, but cannot resolve diff completeness.
- Production implementation starts only after both design reviews close their
  major findings. Baseline checks and producer fixture recording are preparation.
- Repository identity is a required canonical HTTP(S) URL without credentials,
  query or fragment. URL origin normalization applies, path stays case-sensitive,
  trailing slash and a terminal `.git` suffix are removed. SCP/SSH/shorthand names
  are rejected with guidance to supply the web repository URL. Equality uses this
  canonical value. Observed identity requires exact bounded citations outside the
  diff span containing this repository URL and full base/head SHA; this proves
  page text presence only, not host comparison semantics (still unverified without
  a host contract). Source literals inside hunks never count as identity metadata.
- Creation accepts either no capture (Agent-only requested scope) or one exact
  observation diff citation, plus optional identity citations. There is no mutable
  capture/update operation. A new capture, base or head requires a new job/id;
  terminal and report bindings never follow a replacement. Idempotent create uses
  request_id + canonical validated input; same key/different input is rejected.
- One report per job. Same canonical report payload SHA-256 is a retry returning
  the same receipt; different payload is rejected (new job required). Model tools
  cannot import an Agent report: only the confirmed terminal UI path can do so.
- A generated prompt includes server-derived requested/observed identity state,
  normalized diff hash or null, every coverage gap, and an untrusted-data warning.
  No report text or caller completeness field can modify these generated states.
- Store new observation metadata `text_transform`: unchanged only when the real
  browser producer returns threats_removed=[]; sanitized if nonempty, unknown if
  absent. This metadata comes only from the authenticated local capture boundary.
  Reject code capture from sanitized/unknown observations. Existing observations
  require recapture. Preserve the existing NFC/LF representation and label it;
  observation and diff digests are revalidated on read. No raw-capture bypass.
- Bounds: existing observation limit 64 KiB; cited diff 64 KiB and 128 files;
  report JSON 64 KiB, 128 findings, 128 reviewed files, 64 business mappings;
  strings max 8 KiB except summary max 16 KiB; 16 jobs per thread, store 2 MiB.
  Enforce before parsing/writing, never evict. Diff paths are relative, no empty,
  dot/dotdot components, controls or backslashes. Strip a single a/ or b/ header
  prefix; unsupported quoted/ambiguous formats fail explicitly. Findings use
  the exact captured old/new path and side/positive line (zero is not a line).
- Closed review gap predicates: no capture, transform unknown, truncated source,
  unknown host identity semantics, unknown page completeness, no report, requested
  identity/hash mismatch, missing reviewed files, missing business references,
  invalid/stale cited requirement/task/test evidence, different test SHA, changed
  attached draft revision or commit. Structurally invalid imports are rejected;
  missing/unverified/coverage states remain explicit. `review_ready` is false in
  this generic adapter due to absent host semantics/completeness contracts;
  `combined_ready = existing_draft_ready && review_ready` when attached. No prose
  or model boolean can promote either. Inspection tools never mark approval.
- Retry digests use existing `canonicalRequest`: code-point-sorted object keys,
  array order preserved, NFC strings, compact JSON, then SHA-256 UTF-8. URL path
  suffix removal repeats (trailing slashes then `.git`) until stable. Percent
  aliases are not guessed equivalent; equality is deliberately conservative.
- Truncation uses the authenticated observation flag. Valid hunk counts never
  override it or imply absence of host omission markers. Every capture explicitly
  reports cited-span-only plus unknown host coverage. No job deletion in this
  slice: CODE_REVIEW_CAPACITY preserves previous jobs; start a new Chat and
  recollect evidence to continue. Reads of existing jobs remain supported.
- Web-only assessment is stored separately as `cmspark_assessment`, via
  `code_review_assess`. It is not an external Agent report/receipt and needs no
  terminal. It has the same scope/line/citation checks and immutable/idempotent
  semantics. Optional external receipt absence is not itself a coverage failure.
  Neither assessment source proves approval. Both may coexist and remain visible.
- `code_review_create` can freeze up to two material references (draft_id/revision)
  and up to 64 selected business references (kind/external_id/exact citation/test
  commit). Reports may assess only those selected references. Plain presence of
  an id is not evidence of a relationship; mappings remain labelled assessment.
  Prompt includes matching-version material fields and references, or an explicit
  omission when over its 256 KiB limit. It never silently substitutes new revisions.
  `code_review_render` accepts only a bound draft, returns original field checks
  plus review/matching gaps, and does not mutate v1 material readiness semantics.

T3. Surface: authenticated Chat tools + extension terminal. L2: terminal open and
report import confirmation. Compose: existing browser reads, optional user Agent.
Autonomy: no auto execution, patches, commits or external platform writeback.
Trust: source code and reports remain inert untrusted data. Channel: user's allowed
browser and explicitly chosen Agent; no outbound MCP profile expansion.

Reject cross-thread/peer requests, stale sessions, wrong SHA/hash, forged citations,
oversize inputs, unknown persisted versions, executable HTML/report markup, and
interrupted/read-only mutations. Server chooses filesystem paths and opaque ids.
Bound limits apply before parsing and before persistence; no silent eviction.

## Implementation sequence / gates

1. #465: strict diff parser, scope/record store, Chat create/capture/read wiring,
   actual producer fixtures, unsupported/partial and isolation tests.
2. #466: terminal owner checks, task binding, login env, prompt/confirmed result
   return UI and service, success/failure/retry/close tests.
3. #467: business citations and deterministic materials supplement, pack guidance,
   integration tests for both paths and explicit remaining real pilot gaps.

Design and each important implementation checkpoint: actual independent Grok 4.6
and DeepSeek V4 Pro using identical frozen packets, no cross-sharing reports.
Machine checks precede implementation review. BLOCK/MAJOR must close, regardless
of a positive verdict label. PR, latest-head CI, merge and issue closure follow.
Real enterprise adapters/Agent compatibility and two first-release scenarios stay
under #450/#452/#454/#455/#457. This change does not claim 0.7.0 release acceptance.
