> Archive note (maintainer): the original reviewed `.patch` input is preserved byte-for-byte in [2026-11-12-task-tabs-848.patch.gz](2026-11-12-task-tabs-848.patch.gz); use `gzip -dc` to recover it. The review text below is unchanged.

# Independent adversarial review — task tab lifecycle #848

Base: `e0bf978abf95f1870eb241cfdf8631324c3cc7a5`.

Scope: the #848 staged implementation and the subsequently corrected implementation/test deltas in this checkout. Unrelated `file-parser.ts`, `wps-doc.ts`, and `office-word-compatibility.test.ts` changes belong to another task and were excluded. This reviewer did not modify implementation files.

Capability declaration: **T3**. Surface: local Chat browser tools. L2 classes: existing browser permission/lease gates. Compose: authenticated browser read → existing immutable EvidenceStore observations → task/source ledger → guarded tab close. Autonomy: task-created temporary tabs only. Trust and outbound profiles remain unchanged. Channel: authenticated extension and local Companion persistence.

## Result

No unresolved blocking finding remains in the reviewed #848 change. The first pass identified integration defects below; the implementation agent corrected them, and I rechecked the corrections against their actual consumers and fresh machine evidence. Approval covers the corrected source, not the initial staged snapshot before these corrections.

## Confirmed findings, corrected before approval

### P1 — automatic cleanup reopened a permanently running sidebar tool card

Trigger: a normal answer emitted `chat.done`, then `chatCreate`'s finalizer called the ordinary executor to close a temporary page. The server emitted `tool.start`; unlike the model's per-tool loop, final cleanup emitted no matching `tool.result`. `useWebSocket` handles `tool.start` by setting the thread busy and adding a running card, so an otherwise completed task became stuck busy after cleanup. `logToolFinish` only logs and could not settle this UI state.

Correction verified: `TaskBrowserTabs` carries the trusted `taskTabCleanupExecutionId` invocation option (`companion/src/business-evidence/task-pages.ts:128`). The server suppresses the start event only when this option matches the current server-derived execution and the close is automatic (`companion/src/server.ts:656`). Ordinary/model closes still produce their usual events; model arguments cannot supply the trusted invocation option. The real `createToolExecutor` orchestration shell regression at `companion/tests/task-tabs-server-path-848.test.ts:49` checks the automatic, ordinary and forged-argument cases.

### P2 — newly scoped worker reads could persist evidence under inherited plan mode

Trigger: the newly scope-bound autonomous worker path read a page while its parent had entered `plan_readonly`, with no explicit policy stamped on the worker. The normal tool pregate inherited the parent's policy, but capture eligibility checked only the worker's own field. The read was allowed as observation, while its body could newly be written to EvidenceStore despite the effective read-only policy.

Correction verified: both the start-time capture decision (`companion/src/server.ts:552`) and the post-dispatch capture decision (`companion/src/server.ts:1051`) now use `resolveEffectiveExecutionPolicy`. The actual server-shell regression at `companion/tests/task-tabs-server-path-848.test.ts:73` covers the parent being read-only before dispatch and changing during dispatch; both preserve the ordinary read result while skipping evidence writes.

### P1 — the original edit probe missed standard rich-text and framed drafts

Trigger: a task-created page contained a `contenteditable="plaintext-only"`/case-insensitive editable region, or an ordinary textarea/rich-text editor inside an iframe. The initial selector recognized only top-frame empty/`true` contenteditable attributes. A page that became a background tab could therefore pass the edit check despite a user draft in the embedded editor. This directly violated the specified edited-form protection. The initial select/default-value comparisons also conservatively misclassified some untouched native controls, unnecessarily preventing cleanup.

Correction verified: `taskTabHasEdits` uses actual `isContentEditable`, inspects all frames, and returns only edit state and direct child-frame counts (`chrome-extension/src/background/task-tabs.ts:79`). Unique result frame IDs, a top-frame result, and aggregate child-frame coverage are checked before treating the inspection as complete (`chrome-extension/src/background/task-tabs.ts:107`). Missing/failed inspection retains the tab. The real probe tests at `chrome-extension/tests/task-tabs-848.test.ts:75` and `:111` cover editable variants, normalized untouched defaults, framed edits, and missing child-frame results. [Chrome's scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) documents the all-frame target and per-frame injection results used by this check.

### P2 — image analysis lost the task identity on its separate dispatch route

Trigger: `create_tab` → captured `get_page_text` → `analyze_image` on the same task page. Image admission uses `dispatchToExtension` for its phases, rather than the default forwarding function. Initially those frames omitted `task_context`; the new extension ownership observer therefore permanently marked the task's own tab as adopted by another actor, refusing both early and final cleanup.

Independent machine confirmation used the compiled production `dispatchToExtension` and `TaskTabs`: the image frame lacked task context and cleanup returned `USER_OR_OTHER_TASK_ADOPTED`, with zero closes. The command exited 0 and did not modify implementation files.

Correction verified: the server's image-admission dispatch closure forwards the same server-owned task context (`companion/src/server.ts:811`), and `dispatchToExtension` writes it into the frame. The actual server-shell image regression at `companion/tests/task-tabs-server-path-848.test.ts:62` and the WS-frame regression pin this alternate route. Missing context is still conservative for genuinely unowned operations; the fix does not weaken adoption protection.

## Outcome and path checks

- Creation claims originate from the extension's real `create_tab` result and are bound to thread/execution identity. Tokens are removed before the model receives the result and are not written into the local source ledger.
- Successful page evidence is selected by actual observation ID, tool-call ID, tool name and tab identity. Existing immutable observations remain unchanged; source URLs use the existing credential/query-free target representation.
- Local source associations are written before closure is dispatched. A successful browser acknowledgement is required for a `closed` record. Post-close persistence failure leaves a durable uncertain `closing` record and an explicit acknowledgement-not-recorded result, rather than pretending that the page remains open or that a durable close receipt exists.
- Automatic closure validates the private creation claim, actual navigation identity, ownership/adoption, foreground/pinned/audible state, edit state and browser operation state. The current execution/policy checks prevent automatic cleanup from starting on failed, cancelled, superseded or read-only runs.
- Existing user tabs and `keep_open` deliverables are not automatic candidates. Explicit early release and successful final cleanup continue through the original executor/permission/lease path.
- `browser_sources` is scope-bound and read-only; linked immutable evidence remains retrievable after closure and store reload. No live configuration, outbound profile, extension permission or second extension was introduced.

## Fresh machine evidence inspected

All commands below exited 0 after the corrections:

- Extension `npm test`: **1,886 passed, 0 failed**, including the actual edit probe and guard tests. Log: `/tmp/cmspark-848-extension-tests-full.log`.
- Extension `npm run build`: completed successfully. Log: `/tmp/cmspark-848-extension-build.log`.
- Companion `tsc -p tsconfig.test.json`: successful.
- Companion targeted runner: **209 passed, 0 failed**, covering task pages, actual `chatCreate`, actual server shell, source/evidence store, WS forwarding, tab leases/pregates, actuator selection, schemas, plan mode and persistence redaction. Log: `/tmp/cmspark-848-companion-tests.log`.
- Companion `npm run build`: successful. Log: `/tmp/cmspark-848-companion-build.log`.
- `node scripts/record-task-tabs-fixture.mjs --verify-lifecycle` from the extension directory: production BrowserBridge + `captureLocalPageResult` + TaskBrowserTabs + local EvidenceStore integration passed. Two temporary pages closed by early/final release; five guarded task pages remained; an explicitly retained page and a pre-existing user tab survived; closed-page evidence was read from a reopened store. Log: `/tmp/cmspark-848-integration.log`.
- Staged and working-tree `git diff --check`: successful.

The integration browser is an in-memory Chrome actuator exercising production entry points. These results do not claim a live installed-extension run or remote CI. The complete confirmation sequence still requires Pi's independent rereview of this report, the corrected diff and the machine evidence.

VERDICT: APPROVE
