# Dual external review — Batch B (G4 Notes / G5 Mail / G6 prompt)

Implementer claims:
- G4: Notes create returns posted+verified via list-notes target_id re-read (evaluateNotesCreateVerify)
- G5: host_read Mail returns verified when sender/subject/date/body non-empty + summary line
- G6: macOS Rule 12 prefers host_read/host_write over host_computer; posted≠verified discipline

Read:
- docs/decisions/v1.3/computer-use-grill-locked-2026-07-26.md
- docs/decisions/v1.3/computer-use-batch-b-impl-2026-07-26.md
- companion/src/host-use/darwin/notes-verify.ts
- companion/src/server.ts (host_read / host_write)
- companion/src/llm/adapter.ts (Rule 12)
- companion/tests/notes-verify.test.ts

Inspect real code. End with:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
