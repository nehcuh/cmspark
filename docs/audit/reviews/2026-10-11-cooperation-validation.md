# Cooperation reliability validation

Date: 2026-10-11. Issue: [#590](https://github.com/nehcuh/cmspark/issues/590). Base: `9429ec61597a651a99ccb53cb59921197901e730`.

## Delivered behavior

The existing Supervisor + Blackboard now has immutable bounded task plans, capability/dependency checks, criterion-based acceptance, durable attempt/result checkpoints and explicit confirmed replacement. Runtime completion alone does not release dependencies. Confirmation binds the plan, task, expected attempt and complete goal. Execution begin/settle identities prevent a crashed rerun from reusing an older completion; late attempts are rejected before Board mutation. Existing worker denials, read-only mode and creation/occupancy limits remain effective.

Recovery preserves accepted criteria and supplies missing criteria to the replacement worker. It does not replay writes automatically. One plan is supported per parent thread; a completed plan is not a reusable template or an unlimited resettable attempt budget. ACP shares result/status visibility but is not an interchangeable executor of browser plan tasks. Acceptance is explicitly an orchestrator judgment with source references, not proof of semantic truth.

Reviewed unmerged branches also supplied ACP/WS malformed-peer isolation, cancellation/process cleanup, folder-picker error classification, persistent UI errors and the return-to-chat entry. ACP operations now require the actual owning thread.

## Machine evidence

All commands used locked dependencies after `npm ci`; Node 22.23.2 on the macOS host. Test totals describe unique tests in each final run, not the sum of repeated runs.

| Check | Final result |
|---|---|
| `companion: npm test` | 5,538 total; 5,505 pass, 33 platform/condition skips, zero failures |
| `chrome-extension: npm test` | 1,509/1,509 pass |
| `companion: npm run build` | Pass |
| `chrome-extension: npm run build` | Pass |
| Fresh Linux arm64 container, test TypeScript compile + selected production-boundary suites | 118/118 pass |
| Final host execution-fence/supervision regression selection | 29/29 pass |
| Companion production dependency audit | Zero high/critical; nine moderate advisories, existing high+ gate passes |
| Extension production dependency audit | Zero advisories |
| `git diff --check` | Pass |

The arm64 container was recreated from `cmspark-cooperation-validation:590`, based on `node:22-slim`, with an independent `npm ci --ignore-scripts`. It copied current source into a writable container workspace; it did not use host `node_modules`. Selected tests include actual dispatcher/ThreadManager persistence, concurrent Board-lock interleavings, real ACP child processes and an actual adapter/provider-await process kill followed by reload. These complement the full host suite.

Detailed local logs and container build inputs are preserved under `/Users/huchen/Projects/cmspark-cleanup-backup-20261011`; this host-specific archive is not required to build the repository. Earlier failing test runs exposed two stale assertions (a fixed-length catalog regex and an explicit error-code table). Both were corrected to assert the actual contracts; no gate was weakened.

## Measurements and limits

The checked-in synthetic fault report exercises the real plan/spawn/collect path with a fake provider: 9/9 tasks accepted, one injected failure recovered, ten launches, zero duplicates. Width 1/2/4 used 10/6/4 scheduling waves. It makes zero model calls, so waves and serialized bytes are not latency or token measurements.

The separate actual-model smoke used eight public synthetic facts, seven provider calls and one sample per width. All three widths had coverage and precision 1.0; observed latency was 919/965/1069 ms and provider-reported tokens 372/502/791 (total 1,665). The configured model alias was `deepseek-v4-flash-vision-exp`; the provider returned `deepseek-flash`. No private repository content was sent by this fixture. This simple task shows parallel overhead; it does not establish a quality or speed improvement on complex tasks, model-led decomposition or production solo chat.

Native Windows ConPTY interaction, macOS foreground-dialog behavior and live MV3 reconnect are not established by these tests. No packaged release or installed application replacement is part of this change.

## Review and merge gates

The [independent adversarial report](2026-10-11-cooperation-adversary.md) approves the scoped implementation after six concrete race/freshness defects were repaired and regression-tested. External reviewers returned `APPROVE_WITH_NITS`; neither identified a merge blocker. Review approval is separate from remote CI.

- **Kimi:** full patch plus targeted live-source checks of attempt binding, rollback, execution fences, owner enforcement, peer isolation and permissions. A second pass verified the final patch hash below and every final production/test delta, retaining `APPROVE_WITH_NITS` with no new blocker. Static review; it did not claim to reproduce the test runs.
- **Pi:** second-stage review after the adversary approved. It verified the final patch identity (`dea56996969cd3655f7e132b96b77cb7473fd9fb8c77adf34caf75fe3e561681`) against the working diff and matched all five critical-file hashes in the adversary report. It independently recompiled and ran the full Companion and extension suites under Node 24.20.0, plus 143 selected tests (141 pass, two platform skips). Its additional probes rejected foreign plans, worker/readonly mutation, stale confirmations, invented references, changed reports, excess attempts and late handbacks. These repeated runs are not added to the unique-test totals above.

Non-blocking observations remain explicit: review details are carried in the returned plan snapshot rather than a separate verdict object; the opt-in model script requires a readable existing config; completed ACP metadata can retain its historical PID. ACP peers without typed assistant-message updates produce a partial empty handback instead of treating status/timeline text as an answer. Collection relies on the existing activity predicate; a false negative is reported as interrupted. The emergency worker-denial fallback omits the new names, but the independently tested owner guard still rejects worker access. Rollback conservatively retains parent promotion when a trashed sibling exists. Kimi's separate suggestion that a genuine picker timeout triggers a second dialog is refuted by the explicit timeout return before the fallback in `folder-picker.ts`; fallback applies to other errors. Likewise, acceptance can be read directly from the returned snapshot without another tool call. None of these observations was used to claim broader native-platform acceptance.

Raw external-review output and prompts are archived with the local validation logs. Remote CI status is authoritative on the linked PR; local checks alone do not authorize merge.

Repository reference cleanup, recoverable backups and the disposition of archived prototypes are documented in [the cleanup record](2026-10-11-repository-cleanup.md). The [article comparison](2026-10-11-multi-agent-article-comparison.md) separates supported architecture claims from ideas intentionally deferred.
