**Reassessment #465 — MAJOR disposition**

**MAJOR: CLOSED — no normal-operation reproduction remains.**

The over-cap branch is unreachable via normal operation. [inspected] `transaction()` computes `JSON.stringify(state, null, 2)` and rejects with `EVIDENCE_CAPACITY` **before** `atomicWriteJSON` when serialized bytes exceed `scopeBytes`; `capture()` catches that and sets `capacity_gap=true` without writing. Base case (ENOENT → valid empty file) plus induction: every file ever emitted passed the ≤4MB serialized-byte check, and temp+rename atomicity excludes torn intermediates. A transaction-mutated store can saturate but can never contain an over-cap file, so `read()`'s size guard never trips in normal operation — the review job stays readable even at saturation. My 64×64KB arithmetic ignored JSON overhead: the cap binds earlier than 64 observations, still reject-before-write. The append-only saturation scenario resolves to "store stops accepting," not "store poisons readers."

The corrupt branch requires external/unauthorized modification (or hardware fault) — not operation through the supported write path. The approved design explicitly revalidates source bytes on read and denies unknown/corrupt schema without overwriting: an intentional integrity-over-availability contract. Caching a derived snapshot would bypass precisely that source-integrity revalidation. The read-time coupling is the design's liveness check, not a defect; I cannot construct a reachable reproduction, so the MAJOR is not sustained.

**NIT dispositions:**
1. **Closed.** io.ts confirms `atomicWriteJSON` defaults `mode = 0o600` and re-chmods after rename. No permissions regression.
2. **Closed.** Overlap-dropped identity emits `requested_only` **with** `CODE_IDENTITY_UNVERIFIED` — an explicit verifiable state, not silent promotion.
3. **Closed.** Cited-range coverage staying `WEB_DIFF_COVERAGE_UNKNOWN` is the stated boundary; already mitigated by `review_ready: false` + `untrusted: true`.
4. **Residual, non-gating.** Percent-encoding aliases (`%2e`/`.`, `~`/`%7e`) can yield distinct canonicals for one repo; a genuine trailing `.git` segment is stripped. No integrity impact — identity remains citation-backed and canonical is documented as heuristic. Optional future hardening only.

**VERDICT: APPROVE** — no reachable normal-operation MAJOR; no gating NITs remain. One optional heuristic-hardening note (NIT 4).
