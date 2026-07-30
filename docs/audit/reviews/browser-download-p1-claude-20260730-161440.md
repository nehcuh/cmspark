I have completed an independent review. Here is my assessment.

## Independent verification

**Diff scope**: 10 modified + 4 new src + 4 new tests + 2 workflow/rhai files + docs. Patch file matches live repo (re-ran apply script → all "skip (already)"); not stale.

### 7-point verification matrix

| # | Criterion | Result |
|---|---|---|
| 1 | Path sandbox Downloads-only; UNC/`..`/junction escape | **pass** — `companion/src/path-sandbox.ts:55-124` enforces root + boundary + path.sep + realpath container. `isUncOrDevicePath` catches `\\srv`, `//srv`, `\\?\`. `path-sandbox.test.ts` covers default/sub/parent/UNC/junction-realpath/case-fold (8 cases). |
| 2 | Alias `download`→`browser_download` before sandbox | **pass** — `server.ts:484` rewrites before the line-686 sandbox gate. `browser-download-schema.test.ts:111-202` proves: evil path → PATH_ESCAPE with zero `tool.execute`; rename + sandboxed path on success; direct `browser_download` also sandboxed (no alias-only hole). |
| 3 | DOWNLOAD_BUSY before TabQueue | **pass** — `browser-bridge.ts:52-64` routes through `runWithDownloadBusyBeforeQueue`; `download-busy-entry.ts:42-58` acquires busy *before* `tabQueueRun` and releases in `finally`. Test "production entry: concurrent same-tab … → DOWNLOAD_BUSY (not TabQueue serialize)" plus the TabQueue-only control test prove the gate is what rejects. |
| 4 | Waiter onCreated-only | **pass** — `download-waiter.ts:78-79,132-133` (`tracked` set, onChanged early-returns on unknown id). Tests cover pre-existing complete, foreign concurrent complete, and startTime-before-registration rejection. |
| 5 | text\|selector; no new L2 dialect | **pass** — `tool-schemas.ts:80-86` zod refine; `L2_GATE_TOOLS` in `server.ts:750-762` does **not** include `browser_download`; default-Downloads path is not L2-gated. |
| 6 | Tool catalog inject ok | **pass** — `tool-definitions.ts:108` calls `ensureBrowserDownloadTool(buildAllToolDefinitions())`; 47 entries in catalog JSON + 1 injected = 48; `isValidToolDefinition` still runs at load. Schema test "browser_download is in tool catalog" passes on win32 + darwin. |
| 7 | ADR-020 declaration | **pass** — `browser-download-p1-batch-report.md` declares Surface=L1, L2-classes=none for default, Compose=none, Autonomy=single, Trust=path-allowlist+tab-lease, Channel=community. No new confirm family, no new composition axis, no new autonomy runtime. |

### R4 fix (BD-TIMEOUT-DEADLINE-UNASSERTED)

`download-waiter.test.ts:103,158,240` assert `scheduledMs === timeoutMs` (10/50/50). `download-waiter.test.ts:252-273` exercises the wall-clock path with timeoutMs=40 and asserts `elapsed >= 25`, proving `setTimeout` was wired with the real timeout and not 0. Handler test `browser-download-handler.test.ts:114,223` asserts `scheduledMs === 60_000` and `=== 5_000` end-to-end. Fix verified.

### Test execution (re-run independently)

- companion path-sandbox + browser-download-schema: **35 pass / 0 fail**
- extension download-waiter + browser-download-handler + download-busy-entry + find-element-by-text: **32 pass / 0 fail**

Matches implementer claim.

### Nits (non-blocking)

- `apply-browser-download-p10.mjs` is wired into `npm test` and `prebuild` of both packages. It is idempotent (skip-on-already-applied), but the build-time coupling is process debt — once the spike lands, the script should be deleted and the source edits committed bare.
- `dispatchToExtension` at `server.ts:2303-2307` still hardcodes `TOOL_EXECUTION_TIMEOUT_MS` (15s). It is only used by `analyze_image` (line 1945, 2025), so no current browser_download regression — but a one-line comment there noting "browser_download must not route here without resolveToolDispatchTimeoutMs" would prevent a future footgun.
- `tool.start` is sent before the sandbox gate, but `summarizeToolParams` (server.ts:424-435) allowlist-filter means `downloadPath` is not leaked — no concern, noting for completeness.

VERDICT: APPROVE_WITH_NITS
