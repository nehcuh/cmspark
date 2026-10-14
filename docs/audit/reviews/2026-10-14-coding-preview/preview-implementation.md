# #532 confirmation preview — frozen implementation handoff

Component implementation and focused machine checks complete; independent review, shared full machine/ARM and exact-head CI remain the parent task's gates. This is not an author approval or merge-ready claim. No commit/push/issue mutation performed.

## Scope and base

- Existing GitHub #532; minimal spec first: `docs/superpowers/specs/2026-10-14-confirmation-preview-532.md`. #530 only factual clarification: the current confirmation default is 45000ms; 5000ms is the preview budget. Neither changed.
- Reused `/Users/huchen/.codex/worktrees/issue-convergence/cmspark`; verified tracked clean before switch. Previous HEAD `047462ef` was a committed audit-docs state. Created `codex/confirmation-preview-532` from requested `origin/main` **04353ca73b06e245cf0f114ec1ec946b90173dad**; no reset/clean/other worktree edits.
- Complete patch includes all tracked and untracked files: `/tmp/cmspark-532-full.diff`, **SHA256 bd18af1a8ffa3530320acad35403d3478b37372aecf653a9889b499adf764a12**.
- `/tmp/cmspark-532-manifest.json`: exact base/branch/path and SHA256 of all **16 files** (9 production, 6 test/fixture/script files, 1 spec). No node_modules/symlink/version/lockfile artifacts in patch. Implementation frozen; stop writing source after this handoff.
- Important merge intersection: UI #484/#522 lane separately changes `useWebSocket.ts`. This patch adds `confirmationPreviewFromMessage` import and replaces only the existing 3 preview assignments with its whitelist spread. Keep that lane's independent differences; do not copy this whole file over it.

## Root cause and change

`buildComputerL2PreviewImage` folded every failure into null, admission only attached successful image/caption, manager had no failure metadata, and Cockpit silently hid absent/load-failed images. The fixed path is real helper → real admission → actual manager request → frontend whitelist/reducer → actual confirmation card.

- Preserve the nullable helper public API. Add an optional typed `onUnavailable` callback, delivered once from the **settled race winner**, never from the late pipeline. Internal fixed stages: target_unavailable, capture_failed, ocr_failed, render_failed, timeout; import/helper construction catch uses preview_failed. Native error text remains on the prior log path; no native text/path/OCR/title is promoted into the new reason/wire/LLM/knowledge. Degraded log now includes a fixed reason so `timeoutMs:5000` cannot alone be interpreted as actual timeout.
- Darwin and Windows existing admission branches pass the callback; success/unsupported/unattempted continue without a reason. Metadata is never inserted into finalParams/tool results. Actual manager accepts only the 6 fixed values as `preview_unavailable_reason`, independent of authorization.
- Frontend `confirmationPreviewFromMessage` retains the old image/caption/full_preview fields and whitelists the new value. Cockpit uses `ConfirmationPreview` to show fixed Chinese “预览不可用（降级确认）” and fixed cause. Unknown/hostile values are discarded, never rendered. Old peer/unattempted missing image remains neutral. Oversize image and actual onError have fixed client messages. Failure state is keyed to confirmation_id, so a new id cannot inherit the prior image error.
- Real ConfirmElevated is exported for component testing and the isolated React/Chromium fixture; no navigation/tool/approval surface added. Existing image sizing/colors retained. Screenshot notice viewed in the isolated browser, not merely grep-tested.

## Capability declaration / DoD

Conservative T3 because fields traverse a human security-confirmation channel. Surface: fixed operator diagnostic only. L2 classes, Compose, Autonomy, Trust unchanged. Channel: same origin-bound confirmation request; no additional model/tool/knowledge channel. No token issuance, new tool, ACL/nonce changes, retry, autoapproval, timeout increase, action budget change, capture-permission request, live app/browser/SSO operation, or package installation.

Outcome evidence: actual capture failure/no target/timeout show distinct cause; success/unattempted/old protocol not labeled capture failure; image onError visible; new ID clears error. Existing origin/nonce/deny remain authoritative and actual test denies produce no token or session trust.

Trajectory: existing issue → minimal spec → real producer and real UI red cases → narrow implementation → focused green/build → isolated DOM observation → frozen patch. No issue closure/commit/self-approval. Whole inventory/ARM/CI delegated to parent once for the combined group.

Component evidence:

- `companion/tests/integration/confirmation-preview-532.test.ts` uses **actual runL2ToolAdmission, helper and SecurityConfirmationManager**, controlled native adapter methods and isolated config. Request emits actual critical coordinate marker and 45000ms wire. Every prompt first rejects a rogue origin, then denies from the bound origin; no actual computer executor runs. Uses owned tempfile raw and waits for actual fs.rm receipt in late-capture case.
- Timeout production opts still equal5000; only the existing injected sleep seam settles the controlled test quickly. Late capture finishes, raw is removed after processing, already-emitted timeout/no-image prompt remains fixed; no new callback updates it. Helper tests separately preserve credential blur, raw finally order, nullable API and one fixed stage reason.
- Frontend fixture JSON was captured from the actual producer test's emitted manager frames (TAP's doubled stdout backslashes restored). IDs/time are original synthetic receipts; fields were not invented. Replay calls the actual production whitelist and real reducer before actual ConfirmElevated SSR; hostile reason ignored.
- Isolated Chrome DOM test renders actual ConfirmElevated, actual whitelist and captured frames. Only valid image control substitutes a 2×2 canvas-generated JPEG raw base64; it is a synthetic pixel control, not native screen accuracy. Actual image error DOM event shows the message; switching the same mounted component to new id/unattempted/success clears the old error. Actual deny button emits approved=false for current id and no trust flags through synthetic transport. All network requests aborted; no user services reached.

## Red / green / commands

All Node commands preceded `source "$HOME/.nvm/nvm.sh" && nvm use 22` (22.23.2). Python command used `uv run --no-project /Users/huchen/Projects/ITCra/.venv/bin/python`, existing Playwright environment; no installation.

Red baselines (preserved):

- `/tmp/cmspark-532-red-companion.log`: actual capture/no-window prompt lacks reason, **3 tests,1 pass,2 fail**, exit1. Success/unattempted control passes.
- `/tmp/cmspark-532-red-extension.log`: actual ConfirmElevated SSR lacks visible reason, **3 tests,1 pass,2 fail**, exit1. Success/old/hostile controls pass. Only the named component export was added to make original UI testable before implementing behavior.

Final compile: `./companion/node_modules/.bin/tsc -p companion/tsconfig.test.json` and extension corresponding test tsconfig, exit0. A new test initially exposed implicit-any annotations; corrected. Early late-cleanup test used setImmediate as deletion evidence; it correctly failed because fs.rm had not settled. Replaced that test wait with the actual owned rm completion receipt, not a longer delay/product retry. DOM fixture initially double-prefixed canvas dataURL; fixed raw-base64 test data, no product change.

Final focused companion command:

```
node scripts/run-tests.mjs .test-dist/tests/integration/confirmation-preview-532.test.js .test-dist/tests/computer-l2-preview-image.test.js .test-dist/tests/security-confirmation-origin.test.js .test-dist/tests/l2-admission-pure.test.js .test-dist/tests/integration/confirmation-cancellation.test.js
```

`/tmp/cmspark-532-green-companion.log`: **61/61 pass,0 fail/cancel/skip**, exit0. Canonical config isolation. The actual 5-case new producer reproduction then repeated twice, **5/5 each** exit0 (`/tmp/cmspark-532-repro-repeat-2.log`, `-3.log`). These validate the original repro three times total, not repeated unrelated full inventory.

Frontend command in chrome-extension:

```
node --test .test-dist/tests/confirmation-preview-532.test.js .test-dist/tests/security-confirmation-forward.test.js .test-dist/tests/cockpit-focus-policy.test.js
```

`/tmp/cmspark-532-green-extension.log`: **51/51 pass,0 fail/cancel/skip**, exit0. Existing response fields and focus policy unchanged.

Both production `npm run build` exit0, logs `/tmp/cmspark-532-companion-build.log`, `/tmp/cmspark-532-extension-build.log` (Plasmo 8.3s). `git diff --check` exit0.

DOM command in chrome-extension:

```
uv run --no-project /Users/huchen/Projects/ITCra/.venv/bin/python scripts/test-confirmation-preview-ui.py
```

`/tmp/cmspark-532-dom.log`: PASS, exit0, zero browser page errors. Structured actual denial receipt `/tmp/cmspark-532-dom-evidence/evidence.json`; viewed screenshot `/tmp/cmspark-532-dom-evidence/capture-unavailable.png`; image-error and success screenshots adjacent. Synthetic independent headless Chrome; no native ScreenCaptureKit/Windows capture claims.

## Remaining gates / bounds

Parent must preserve both useWebSocket deltas, freeze combined source, run affected/shared machine/ARM, then independent adversary → Pi and CI. Native actual capture/backend pixels are outside controlled adapter tests; #530 old version human timing, #531 TCC, broader Browser/#563/535/533 issues remain separately tracked. No self-APPROVE or release verdict supplied.
