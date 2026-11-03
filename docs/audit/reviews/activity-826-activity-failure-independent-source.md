# #826 activity failure facts — independent source review

VERDICT: **APPROVE** the frozen six-file diagnostic implementation. No reachable blocker found. This approval supports the actual GLM source gate; it is not native Windows success or a fix for the still-observed d94 failures.

Base `d94d5db5ce30aee7d047baea53c0bc503f766461`, manifest `/tmp/cmspark-826-activity-failure-source-manifest.json`. Root authored the three changed runtime-test sources; A authored their consumers and reader. I independently read all six paths/diffs and executed actual current tests. No repository source edit, commit, dispatch, additional native probe, input, live config access or CI rerun was performed. The existing d94 census watch continued separately.

## Source and preserved contracts

All six frozen SHA256 values match. The exact paths are the scope C# fixture, Apps C# fixture, Apps native test controller, scope readiness tests, new focused activity-failure tests and new Apps closed reader listed in the manifest.

Scope adds one exact-message switch mapping the twelve existing setup throw strings to their fixed suffixes. Unknown/private/case-altered/suffixed/null inputs map only to UNKNOWN. The existing aggregate type, input refusal observation, success fence, best-effort write, Shutdown(2) and return remain. No guard, input, native API or retry changes. In particular SHORT means the original SendInput insertion count was not3; it does not invent a UIPI/OS cause. Compound groups such as PRECONDITION or CLIENT remain grouped. Only the fixed reason is added to the existing failure receipt; raw exception text is never projected.

Apps adds exactly six allowed timeout stage strings and passes them from both actual callsites: GUI/headless launch and the existing response command. Only the old timeout error gains a closed suffix or UNKNOWN. The single10000ms timer, final check at expiry, failure-before-ready priority, parsing, close/abort paths and listener cleanup remain original.

Apps C# adds MainThread capture before its first MAIN_ENTER fact, a first-attempt-only observed set and six actual positive events: MAIN_ENTER, RUN_ENTER, SOURCE_INITIALIZED, LOADED, CONTENT_RENDERED, READY_WRITTEN. It reuses the existing owned Record writer. READY_WRITTEN follows successful original GUI ready publication. All observation exceptions are swallowed; a failed first publication is not retried or interpreted as absence. Headless takes only the shared main-entry observation before its unchanged branch. No new timer, input, worker, clock, readiness decision or SDK call is introduced.

The Apps reader reads only those six fixed filenames and accepts exactly phase plus boolean sameSta. Missing/pending/malformed/foreign/extra-key data remains unknown. Finally projects the fixed GUI/headless folders only after the original child-close await, catches projection faults and then preserves original removal/lease order. These are historical facts, not continuous/deadline state or readiness authority.

## Independent actual machine evidence

Node22.23.4 selected with nvm. Companion cwd, official isolated runner, current compiled output from the author's targeted build:

```
node scripts/run-tests.mjs .test-dist/tests/activity-scope825-readiness.test.js .test-dist/tests/activity-failure-observation-826.test.js
```

**19 PASS / 0 FAIL / 0 CANCELLED / 0 SKIP**. Log `/tmp/cmspark-826-activity-failure-independent-tests.log`.

The13 scope cases preserve every previously approved12 case: full actual setup body and ABI/geometry/ownership guards, all128 IsReady results/query counts, one-shot/reentrant partial0/1/2/late-qualified-event fence, stale/main/popup/resize, reader and finally behavior. The new case executes the actual mapper/catch for all twelve exact throw strings plus unknown/private values, including unchanged shutdown and closed receipt behavior.

The6 focused cases execute actual current source consumers:

- Actual receipt function, its actual six-value Set and original10000ms timer callback, including final-check success and private/unknown stage refusal.
- Actual nested launch/control initializer integrated with that same actual receipt function. This is not a stubbed receipt implementation: both callsites reach its timer/watch/finish logic for GUI/headless and all fixed commands with controlled owned IO/process leaves.
- Original failure/ready priority, parse SyntaxError, actual close and abort reason identity, and listener retirement.
- Actual Apps Observe body, filename and two-field payload fed into the actual new reader; all six names, sameSta=false, missing/foreign/malformed/pending data, privacy, and first-once writer failure.
- Actual finally with both folder projections after close; success and throwing-reader paths preserve original primary and removal/settlement order.
- Full three-source LF/CRLF inverse and original90s Apps/180s scope registrations; these test-time checks have no Git dependency.

I separately invoked the actual test's inverse function, extracted via TypeScript AST, and compared each complete inverse against actual `git show d94:<path>` bytes under LF and CRLF. Genuine original SHA256 values match the recorded test pins:

- Scope C#: `d92faa281083ee1b5805f080974017a094a3be717267b896142ec99ee1a96ae0`
- Apps C#: `af037de7ba27b23e88312bcebdd5d7ff3cfe998f0c1d506533448ec8f821fd12`
- Apps controller: `95835e6694f4bdbe479a2cc473a4becd520d65f2f35a315a25947e59c7c24aad`

All restored source statements are byte-exact. The initial private inspection script expected `one` to be a function declaration; it is an arrow variable. Correcting only that AST selection made the inspection run pass; this was not a repository source failure. Evidence `/tmp/cmspark-826-activity-failure-independent-preservation.log`. The runtime tests themselves use the recorded full-source pins, not a historical Git subprocess or old object, so shallow checkouts do not require those objects.

The original scope native business test/helper, setup adapter and product service/chat-scope files also compare byte-identical to d94. The author strict targeted TypeScript PASS remains applicable (`/tmp/cmspark-826-activity-failure-types.log`); scoped diff-check passes. The independent19-case actual implementation run is the current evidence, not the earlier design34 controls.

## Decision

The unit retains already-available finite failure distinctions on supported paths without weakening original input/readiness/permission/budget/cleanup contracts. The next changed-head Windows execution still must demonstrate actual Apps readiness and complete scope OCR/crop/model/image/resize/popup business under the original gates. No current suffix, phase or UNKNOWN establishes a historical root cause. Preserve a new failure rather than adding a fallback or extending a deadline from these observations alone.

VERDICT: **APPROVE**.
