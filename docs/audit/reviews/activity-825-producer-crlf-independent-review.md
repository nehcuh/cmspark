# #825 Apps producer source extraction — independent fix review

Reviewer: `conversation_scope_design`, not the author of this fix.

## Reproduction and fix verification

The independent probe reads the actual previous test implementation from commit `ec9edbd417a7889c5a436ac64b158b547e95d565`, extracts its original source-selection statements, and runs them against LF and CRLF variants of the real production PS source. It then extracts and transpiles the actual new `appsProducerParts825` function from the uncommitted test file.

Observed, exit 0:

- Previous actual extractor: LF passes; CRLF throws at the original anchor assertion (RED reproduced).
- New actual extractor: LF fragments exactly equal the previous LF output.
- New actual extractor: CRLF fragments exactly equal those same original fragments with only LF converted to CRLF. Original fragment bytes and line endings are preserved; no normalized PS is passed to the producer.
- Current production PS text is exactly equal to that commit's production PS text.
- The producer test suffix beginning with its temporary-directory setup is byte-for-byte unchanged, covering the actual PowerShell script construction, producer JSON assertions, 201/4096/4097 cases, cleanup and subsequent native acceptance test.
- Diff review confirms the existing Windows producer's 30-second timeout and all native conditions/assertions are unchanged.

Probe and evidence:

- `/tmp/cmspark-825-extractor-independent.cjs`
- `/tmp/cmspark-825-extractor-independent.log`

## Official runner

```sh
source "$HOME/.nvm/nvm.sh"
nvm use 22.23.4
node scripts/run-tests.mjs .test-dist/tests/activity-apps-825.test.js
```

Exit 0: **5 PASS / 2 Windows-only SKIP / 0 FAIL**. The newly added real-source LF/CRLF CPU control passed. Evidence: `/tmp/cmspark-825-extractor-official-runner.log`.

The review modified no repository source and made no commit or CI rerun. Windows execution of the corrected producer control remains a required CI check; the previous head already supplied passing actual Apps and Scope native capability receipts, documented separately.

VERDICT: APPROVE
