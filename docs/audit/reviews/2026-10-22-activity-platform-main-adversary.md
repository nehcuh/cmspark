# #758 latest-main integration — independent composition review

Reviewer: non-author Codex agent `/root/platform_adversary_758`; 2026-10-22. Bounded review of normal main integration, not another proposed #723 cause/fix or a renewed review of byte-identical feature components. Feature parent `81057e01a2174cad691dc7c9def90dcc5344335a`; incoming main/MERGE_HEAD `ab61257e377e24662c883ee934585f6b2667e195`. Independently verified frozen incoming-delta SHA-256 `8ef3327265c38a485b65152c7713781ca64ac1f8dc148d417ac2d9b4edac004d` and combined-feature-against-new-main SHA-256 `ea9347165f07aff2449d8d40b989db98b7bdd2bd2367e93fe72441b29543305b`.

## Conservation and primary evidence

Read the full integration evidence document and the shared workflow/contract diffs. Git confirms main contributes exactly the one #755 squash commit after the original feature base. No unmerged paths remain; the resolved CHANGELOG retains both sides' additions.

Independently compared the staged activity implementation, personal workspace UI, native #758 case and Windows owned fixture to `81057e01`: no changes. Compared incoming registrar, native controller/gate, prepared-build implementation, first-error/site/phase helpers and their actual source/fixture consumers to `ab61257e`: no changes. Thus this integration does not invent a registrar/CDP fix, alter #758 capture behavior, or silently rewrite upstream runtime acceptance.

Independently queried GitHub run [39695825956](https://github.com/nehcuh/cmspark/actions/runs/39695825956). Its exact head is `e76f20415a9104fc82ff17a707fb76acef7ae2d0`, conclusion success; all six jobs succeeded, including Windows native and census. This confirms the cited upstream evidence rather than substituting it for the integrated branch's required CI. The integration document preserves the feature parent's unrelated site54/line220 `AWAIT_REFUSED` while evaluating service-worker `chrome.runtime.id`; it does not attribute that refusal to the registrar or claim the upstream merge has proved its cause fixed.

## Shared composition boundaries

Relative to main, the composed workflow contains exactly the reviewed #758 bundle resource test, Windows native case immediately after compilation, and independent Linux X11 native job. The upstream scalar preflight retains both its lifecycle and newly required prepared-build tests. The shared workflow contract combines both exact additions: it retains the upstream prepared-handoff argument and related negative controls while fully checking and then precisely normalizing the #758 additions before historical baseline comparisons. Old lane, failure/cancellation, artifact and cardinality/order protections remain. No continue-on-error, skip, permission widening, rescue activation or locally invented budget change is introduced by the merge.

The incoming build120/runtime-cleanup45 split and finite phase observation are accepted upstream changes with their own evidence, not a new local attempt to stretch #758 readiness. Product capability remains the original T3 selected-window `host_read`, local OCR, separate model consent and human confirmation. Existing full feature reviews and observer review are reused for unchanged bytes.

## Independent machine checks

Node22.23.2, clean environment, executed the actual combined script consumers:

```bash
node --test scripts/tests/nsis-ci-setup.test.mjs \
  scripts/tests/windows-ci-feedback-750.test.mjs \
  scripts/tests/cockpit-bridge-build-prerequisite.test.cjs \
  scripts/tests/cockpit-bridge-first-evidence.test.mjs \
  scripts/tests/cockpit-bridge-cdp-lifecycle.test.mjs \
  scripts/tests/cockpit-bridge-prepared-build.test.mjs \
  scripts/tests/cockpit-bridge-phase-observation.test.cjs \
  scripts/tests/cockpit-bridge-phase-integration.test.mjs \
  scripts/tests/activity-notifier-package.test.cjs
git diff --cached --check
```

**194 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**; diff check exit 0. Independent retained log `/tmp/cmspark-758-main-adversary-consumers.log`. These are controlled/source-consumer/resource tests; this review did not perform native capture, run a notification binary, read real chats/configuration or replace an installed app.

Outcome: the combined source conserves both reviewed implementations and their shared acceptance contracts; no composition blocker found. Trajectory: a normal main integration after checking actual upstream results, preserving prior failed evidence and reusing unchanged approvals. Component: only the documented combined workflow/contract boundaries and CHANGELOG resolution need composition approval; byte-identical upstream internals are not self-reapproved as newly authored fixes.

Proceed to Pi reading this report and the same frozen combined delta, then require **exact integrated-head CI**, including both Windows lanes and Linux native. This approval does not waive any gate, claim current CI green, establish the historical #723 cause, or authorize merge-ready status before the remaining gates pass.

VERDICT: APPROVE
