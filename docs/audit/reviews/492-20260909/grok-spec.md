Independent design review of packet #492 only. Constraints honored: no OCR, no overlay allowlist growth, local STT / no cloud ASR, notes to user LLM only on explicit generate, no new deps.

## Blockers
None that make the contract unimplementable as written.

## Failure cases the contract already closes
- Raw live STT appends immediately; live correction cannot stall or replace that buffer.
- Stop-and-generate is primary; stop-only secondary; close does not generate.
- Generate after save ACK of the in-memory snapshot; snapshot is the generate payload (never re-fetch). Failed/late writes do not emit old minutes.
- Import audio is serial, cancellable, timeout-aborts; PCM mismatch drops diarization cache; local-append vs remote-overwrite is forbidden.
- Notes are a meeting-scoped field, not a template. `.docx/.md/.txt` via existing parser; 10 MiB / 100 k chars; parse failure recoverable; original viewable.
- Corrections are patches: unique exact `original` in transcript, excerpt in notes, no overlap; `corrected_transcript` derived locally; invalid claims dropped. Original recognition stays.
- Input fingerprint (transcript + reference) marks prior minutes 待更新; old minutes remain viewable, not “current.”
- Overlay file input stays denied; import lives on the existing summoner/extension trusted channel.

## Nits (fix in the same ticket or they become trust bugs)

1. **Two caps, one store.** A 10 MiB `.docx` can extract to ≫100 k chars. Persist must clip or reject at 100 k with a visible state. Generation must use the stored slice, not a different parser pass.

2. **Combined runtime cap.** Transcript + 100 k notes + protocol can exceed the model window. Surface truncation before send; do not silently drop head/tail.

3. **Protocol fork must fail closed.** No notes → existing Markdown. Any notes → JSON only. Empty/whitespace notes = no notes. Malformed, truncated, or Markdown-when-JSON: error, keep raw + notes, persist no minutes. Never render raw JSON as `minutes_md`.

4. **`minutes_md` is unconstrained.** Patch validation does not bind the prose. UI must label 纪要 as AI draft; validated corrections/conflicts/supplements are the evidence lane; user verifies people/dates.

5. **Conflicts/supplements** need the same excerpt-exists gate as corrections (transcript span + notes span). Otherwise the JSON smuggles free-form claims.

6. **Raw buffer is append-only.** One mutable textarea would destroy “原始保留.” User edits, if any, are a separate layer. Live correction must not attach reference notes (notes only on explicit generate).

7. **ACK is versioned.** ACK the snapshot that includes last transcript chunk and last notes keystroke. In-flight generate lock (no double LLM). Close/crash must not depend on Stop; in-session raw persistence is already implied by live append + ACK.

8. **Import cancel.** Define whether partial segment text commits or rolls back; either is fine, mixed UI is not. Mid-record engine death freezes text, does not wipe.

9. **Enable vs check.** Preflight action entry navigates to explicit engine enable; it must not flip the privacy gate.

10. **Fingerprint** = raw transcript bytes + `reference_notes` (+ name if name is shown as material). Template/speaker/export changes do not clear 待更新 (matches “笔记独立于模板”).

Tests as specified (real handler/store/parser, synthetic STT/LLM, no user corpus, no ASR accuracy claim) are the right gate.

**VERDICT: APPROVE_WITH_NITS**
