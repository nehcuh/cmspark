# Meeting 492 backend evidence

Node 22 selected with `nvm use 22` before all Node commands.

- Initial new reference tests: 2 passed / 7 failed against prior implementation;
  `backend-reference-red.log`.
- Added original-ASR archive, busy and context regressions: 9 passed / 4 failed
  before the follow-up implementation; `backend-reference-followup-red.log`.
- `tsc -p tsconfig.test.json`: exit 0, compiled current production source and
  tests into `companion/.test-dist`; `backend-typecheck.log`.
- Compiled reference + production router tests: 14 passed, exit 0;
  `backend-reference-green.log`. A fresh temporary `CMSPARK_DATA_DIR` is injected
  into the Node child process environment before module loading.
- Targeted `git diff --check`: exit 0.

## Verified behavior

Real TXT/Markdown/minimal valid DOCX archives pass the existing production file
parser. Unsupported, malformed, oversized and evidence-invalid inputs fail
explicitly. Raw files are limited to 7 MiB to fit the unchanged 10 MiB WebSocket
payload after base64 encoding; text is capped at 100000 characters without
truncation. The generator keeps the existing Markdown path when notes are empty.

Reference output validates unique, non-overlapping original substrings and exact
reference quotes; replacements must themselves appear in the cited quote. A
separate corrected copy is constructed after validation. Model-generated reasons
remain explanations, not proof of semantic entailment.

`original_transcript` stores original STT lines independently. Every STT append
retains repetitions; the first bulk STT import initializes an empty archive.
User/merged edits do not overwrite it. Both current and original transcript
archives have a 200000-character bound. `source_transcript` records the current
input used for one generation and is distinct from the original-ASR archive.

Material fingerprints include current transcript text, reference notes and
reference name, excluding generated output and original archive metadata. Source
changes—including edits while generation runs—mark retained minutes stale. One
in-flight generation per persisted meeting prevents late old jobs from replacing
new jobs. Validation or storage failure cannot produce a success response.

## Test execution correction

An initial broader invocation through `tsx` exposed two legacy tests whose
body-level environment assignment happens after static imports under that
runner. Three assertions failed from the split data roots. Five newly created
synthetic meeting directories were identified by exact test-owned metadata and
the four-second execution window, revalidated by unchanged modification times,
and removed. Recovery read metadata only, never transcript, notes, audio or user
configuration. Full paths, ID hashes and timestamps are recorded locally in
`test-fixture-recovery.json`. These failures are not claimed as product failures.

Subsequent tests use the compiled CommonJS output plus a process-level temporary
data root. The broad suite is owned by the root agent; no repeated broad suite
or merge approval is claimed here.
