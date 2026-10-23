# #758 Windows / Linux independent adversarial review — cycle 1

Reviewer: independent non-author Codex agent `/root/platform_adversary_758`; 2026-10-22. No production edits, live capture, model request, installed-app action or live configuration access. Scope: all 34 staged files since base `57b808651dccede3555ac64ebbd45aead393ab73`; frozen `/tmp/cmspark-758-review.diff`, SHA-256 `16b300c15cfc724388f6959ec0c8a2ba8088a433f22e1168fa5aeaeafedb3726`. This is the cross-platform delta, not a renewed review of the original workspace feature. No further delegation.

Read the repository instructions, Windows development discipline, #758 cross-platform plan and full machine report/JSON. Capability: T3, L2 `host_read` of explicitly selected foreground applications, local OCR, separate model consent, candidates and human-confirmed personal todos; authenticated panel authority. No input, activation, chat switching, unseen-history traversal or full-screen fallback is authorized.

## Finding — P2, blocking: Windows standalone package cannot resolve its notification binary

`companion/src/activity/notifications.ts:8–12` resolves the binary exclusively through `require.resolve('node-notifier/package.json')`. The supported standalone/SEA builder `scripts/build-windows-exe.ps1:398–426` stages the systray dependency set, later PTY/ORT/office resources, but never stages the notifier package or SnoreToast. Moreover, the repository's actual bundler SoT `companion/scripts/esbuild-bundle-args.json:14–16` explicitly documents that SEA's embedder require cannot resolve filesystem bare package IDs. The new `require.resolve` survives bundling rather than being converted into an embedded package resource. Consequently this package path fails before spawning SnoreToast; a confirmed reminder becomes failed instead of submitting the promised bundled notification. This does not claim every Windows distribution fails: the portable `scripts/package.sh` distribution currently includes `node_modules/node-notifier`, and ordinary development module resolution also succeeds.

Independent bounded reproduction, Node22.23.2, using the installed real esbuild:

```js
const result = require('esbuild').buildSync({
  entryPoints: ['src/activity/notifications.ts'], bundle: true,
  platform: 'node', target: 'node22', format: 'cjs', write: false,
})
require('fs').writeFileSync('/tmp/cmspark-758-adversary-notifier-bundle.cjs', result.outputFiles[0].text)
```

esbuild emits `require-resolve-not-external` for the exact new line and leaves `require.resolve("node-notifier/package.json")` intact. Requiring that real output from `/tmp` and invoking its actual exported `resolveWindowsToast('x64')` produces `MODULE_NOT_FOUND: Cannot find module 'node-notifier/package.json'`. This is an actual emitted JS consumer proof for the missing package boundary, not Windows/SEA execution; the additional SEA limitation is corroborated by the repository's existing explicit packaging contract. The hosted `.test-dist` native test resolves against the repository's installed package and cannot catch this deployment defect.

Fix the resource closure for both supported Windows layouts: stage a fixed first-party-resolved SnoreToast resource (with its license), resolve it next to the real packaged executable/JS, and use an explicit filesystem `createRequire` only for the development layout. Do not externalize the pure JS notifier to bypass SEA's constraint. Add a regression executing actual emitted bundle output outside source `node_modules`, with positive fixed-sidecar and missing-resource controls, and cover both staging producers. Preserve the documented exit-status handling and no task content in notifications.

## Outcome

The remaining source matches the declared bounded platform contract: capture/model default off; application IDs derived from actual process paths; before/after window identity and geometry checks; Windows Passive and security/UIA checks; Linux XRes ownership and actual focus, local Unix display, XWayland refusal, observable broker lock-state refusal, and source-local pixels; explicit PNG import has a closed authenticated schema, size/dimension limits, local OCR only, generation/session fences, and unverified provenance. Import timestamps are not used to infer message deadlines. Wayland is honestly manual-only. Existing todo and handling/feedback ownership is retained.

The machine report distinguishes full Linux snapshot coverage from final incremental/native coverage, controlled D-Bus lock service from real GNOME/KDE lock behavior, and native Windows pending exact-head CI. Those distinctions are valid and remain release conditions: this review cannot certify Windows native DoD, real chat accuracy, notifications visually seen, or real compositor locks. No additional source blocker was found in the full delta. New Windows/Linux CI cases preserve prior gates and keep desktop operations isolated.

## Trajectory

Scope is consistent with #758 and the approved workspace. Setup errors (missing init/git, inherited provider environment, incorrect test-file/input selection) are retained and attributed rather than hidden by weaker assertions or repeated unchanged CI. The remaining packaged notification defect is a deployment-consumer omission, not an argument to waive native gates. Fix/review cycle 1 of at most 3.

## Component and independent checks

Reviewed native PowerShell/Python, PNG/process helpers, adapter/service/store/validation changes, panel and RPC plumbing, package producers, native fixtures and CI declarations. Independent clean-environment execution of the current compiled `activity-platform-758.test.js` through the canonical runner: **12 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**, exit 0. Independently checked `git diff --cached --check`, exit 0; verified the frozen diff digest. These controls support local behavior only and do not replace exact-head Windows/Linux CI.

Required next gate: fix the single packaging blocker, run the affected real consumer controls, request incremental independent review, then Pi must read this full report and the same updated delta. After both reviews pass, push for exact-head platform CI; do not claim merge-ready while Windows native remains unproven.

VERDICT: REJECT
