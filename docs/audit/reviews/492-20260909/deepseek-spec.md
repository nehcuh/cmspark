# Independent Design Checkpoint — CMspark #492

## Concrete Blockers

**None identified.**

## Nits and Observations

1. **Original transcript uniqueness match for corrections** — The contract requires that every `original` string in `corrections` must "uniquely match transcript." This is a sound integrity rule, but it creates a real UX edge: short, repeated phrases (common in meeting speech — e.g., "okay," "right," repeated filler) will fail uniqueness and cause the entire correction to be rejected. The contract says "invalid claims rejected," which could mean rejecting only the offending correction or the whole JSON. The spec does not state whether rejection is per-item or whole-payload. Worth pinning down in implementation: per-item rejection with a warning is safer than discarding otherwise valid corrections.

2. **Fingerprint staleness vs. raw transcript editing** — "Raw transcript source retained if unchanged" is stated, and fingerprint of text+reference marks old minutes stale when inputs change. But the correction flow itself produces a `corrected_transcript` that is separate. It is slightly ambiguous what "inputs change" means after a correction cycle: does applying corrections to produce `corrected_transcript` immediately invalidate the just-generated minutes, or is minutes staleness tied only to the underlying raw transcript and reference notes? If any derived text change invalidates the minutes, the user could never iterate without regenerating. Recommend explicitly defining the staleness fingerprint over raw transcript + reference material only, not over the corrected transcript or minutes output itself.

3. **Audio import append coherence** — "Import audio appends coherently, mismatch PCM invalidates diarization cache." No severity assigned to a coherent append but invalid diarization cache. In practice, appending audio with mismatched sample rate/encoding is common (e.g., a phone recording imported into a session recorded on desktop). The contract does not state whether such import is accepted-with-warning and diarization disabled, or hard-failed. If the intent is "appends coherently" but "PCM mismatch invalidates cache," this likely means the import succeeds but speaker labels become unavailable for the appended segment. That is acceptable, but should be explicit to avoid product/engineering disagreement over whether the import should be blocked absent diarization support.

4. **“Generation waits current text and reference save ACK” — timeout absent.** The contract specifies waiting for ACKs before generation, which is correct. But there is no stated timeout or degraded path if a write never ACKs (e.g., handler hang, store stuck). The ticket's own gate mentions "late/failed writes cannot generate old data," which correctly implies failure, but a bounded failure experience (error with retry, not infinite spinner) should be in the frontend implementation notes. This is a nit, not a blocker, since the failure mode is at least prohibited from silently using stale data.

5. **Reference note size cap interaction with LLM context** — 100k characters for reference notes plus transcript plus the required JSON schema could exceed context windows for smaller user-configured models. The contract says "runtime input capped" but does not state what happens when the combined generation input exceeds the model’s practical context. Since the user configures their own LLM, this is user policy, but a truncation or chunking strategy for `reference_excerpt` sourcing should be defined so evidence excerpt matching remains reliable beyond context limits. Without this, large notes may cause omissions that violate the "evidence excerpt must exist in notes" check downstream.

6. **JSON-only response with notes vs. Markdown protocol without notes** — Two distinct response modes is reasonable, but the UI must handle both paths. The contract does not state whether the same generation call can fall back to Markdown if JSON parsing fails during LLM output. Given real-world LLM output variance, a strict JSON requirement with notes present and a hard parse failure would discard an otherwise useful draft. This is a robustness nit, not a correctness blocker, since the user can retry.

## Trust, Data Loss, and Feasibility Assessment

- **Trust:** Local STT only, no cloud ASR, existing LLM only for explicit generation, no tools, no overlay allowlist expansion, no live-config edits. The stated privacy boundaries hold.
- **Data loss:** Impossible to generate from stale text (ACK-gated), impossible to overwrite raw transcript with corrections, old minutes explicitly marked stale. The fingerprint and "explicit snapshot wins" provisions are adequate.
- **Feasibility:** Reusing existing doc parser and STT; synthetic boundaries for tests; per-production handler/store tests. Doable within existing architecture. No new dependencies.

## Severity Summary

| Area | Issue | Severity |
|---|---|---|
| Corrections matching | Short repeated phrases may fail uniqueness; whole-payload vs per-item rejection unspecified | Nit |
| Staleness fingerprint | Ambiguity when corrected transcript is derived | Nit |
| Audio import | PCM-mismatch append diarization handling not explicit | Nit |
| Generation wait | No timeout/degraded path in contract, only prohibited failure mode | Nit |
| Context size | Combined input may exceed LLM context; excerpt sourcing strategy undefined | Nit |
| Response modes | JSON failure path with notes unspecified | Nit |

## Final Verdict

**APPROVE_WITH_NITS**