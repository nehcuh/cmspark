# Real router producer fixture (#614)

`router-responses.json` was recorded from Companion's actual
`handleMessage` / `chatCreate` outputs in the `office-import-entry.test.ts`
font-warning test. The controlled parser result supplies synthetic document
text and the existing conversion warning; no business file, font name or
credential is included. The upload preview's request id is added on the wire
by `ws/lifecycle.ts`, rather than invented in this router-body fixture.

Regenerate after compiling Companion tests, from `companion/` using Node22:

```
CMSPARK_RECORD_WARNING_FIXTURE=/absolute/output.json node scripts/run-tests.mjs .test-dist/tests/office-import-entry.test.js
```

Frontend tests consume these production fields through the same notice and
preview whitelist used by the live WebSocket handler. Negative cases mutate
the captured payload to test missing/malformed metadata and stale requests.
