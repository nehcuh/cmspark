# Pi independent re-review — CMspark #758 (Windows/Linux activity), Eval Gate T3

Reviewer: Pi, non-author. Base `57b808651dccede3555ac64ebbd45aead393ab73`. Read-only inspection + bounded inert CPU tests; no product edits, no desktop capture, no provider/model enablement, no live config. `PI_PROVIDER=deepseek`, `PI_MODEL=deepseek-v4-flash`.

## 1. Frozen surface verified before reading anything else

- `git diff --cached --binary | sha256` = `d83e4ed54962359eccea7005b0728b55c662a03713ec96a3a40dc8440b75179f` — **exact match** to `/tmp/cmspark-758-review-r3.diff` (179,740 B, 2,338 lines). The frozen patch is byte-identical to the staged tree, so the three adversary reports and I reviewed the same bytes. (A plain `git diff --cached` differs only because the frozen file embeds the PNG as a binary patch; I confirmed the PNG blob `23090112…` and the working file hash agree.)
- Tree unchanged by me: `git status --porcelain` still shows only the same 40 staged files + the 4 pre-existing untracked audit docs. My scratch artifacts live in `/tmp` only.
- Read in full: adversary cycle-1, r2, r3; `machine.md`; `machine.json`; cross-platform plan; AGENTS.md / Windows discipline as routed.

## 2. Adversary claims I independently confirmed (not taken on prose)

**Cycle-1 P2 was real and is closed.** I did not rely on r2's assertion — I re-derived the two facts that make the fix load-bearing:
- `scripts/package.sh:340-342` *deletes* `node_modules/node-notifier/vendor/snoreToast` from the Windows portable package, so the old bare `require.resolve('node-notifier/package.json')` really did resolve to a path whose binary was already pruned → spawn ENOENT. Blocker genuine.
- Layout closure holds in both producers: `scripts/package.sh:193` places `cmspark-agent.js` at the staging root and `:216` stages `activity-bin/` at that same root → `__dirname` candidate hits; `scripts/build-windows-exe.ps1:330` copies the SEA exe into `$StagingDir` root and `:395` stages `$StagingDir\activity-bin` → `path.dirname(process.execPath)` candidate hits. `companion/src/activity/notifications.ts:10-20` orders exactly those two before the dev `createRequire(__filename)` (:18), and the array literal tolerates an SEA `__dirname` because the exe-dir candidate is tested first. The pure-JS notifier stays bundled; no externalization, no new capability.

**R3 consumer repair is genuine, not a weakening.** I re-parsed the actual `.github/workflows/ci.yml` with the repo's js-yaml and compared to the recorded fixture, independently of the contract's own assertions:
- fixture canonical digest `6a115607…4a2ea34` **matches** (`scripts/tests/windows-ci-feedback-750-contract.mjs:17`);
- `doc.jobs['activity-linux-x11']` is byte-equal (canonical) to `activity758.linuxJob`; key set is exactly `{name,runs-on,steps}` — **no `continue-on-error`, no `if`, no waiver**;
- exactly one `smoke-os` step matches the #758 native name, it deep-equals the fixture, has `CMSPARK_ACTIVITY_NATIVE_758=1` and `matrix.lane == 'native'`, and sits at index 13 = compile-step index 12 + 1 (post-compilation, as the contract asserts at `:75-79`);
- the augmented build step contains `node --test scripts/tests/activity-notifier-package.test.cjs` exactly once, and `ci.yml:58-60` runs it after `npm ci` (`build` step 2) so esbuild/node-notifier exist — no first-push ordering defect.
- No third consumer pins the job set: `grep` over `scripts/tests/*` finds only `nsis-ci-setup`, `windows-ci-feedback-750{,-contract}`, `windows-census-*`; the family passes (below). Original baselines/digests are untouched in the diff.

**R3's "8 mutation negative controls" are non-vacuous for the right properties**: missing addition, wrong lane, `continue-on-error`, wrong order, deleted X11 job, unknown X11 command, waived X11 job, omitted notifier command — each targets a property I verified separately in the real YAML, so a future weakening cannot pass silently.

## 3. My own executed checks (all actual, exit 0)

| Command (clean env, Node 22.23.2) | Result |
|---|---|
| `node --test scripts/tests/nsis-ci-setup.test.mjs scripts/tests/windows-ci-feedback-750.test.mjs` | **87 PASS / 0 FAIL / 0 SKIP**, exit 0 |
| `node --test scripts/tests/activity-notifier-package.test.cjs` | **1 PASS**, exit 0 (missing-resource reject → real staging bytes → resolve → delete → reject; both producers referenced) |
| `node scripts/run-tests.mjs .test-dist/tests/activity-platform-758.test.js .test-dist/tests/activity-752.test.js` | **40 PASS / 0 FAIL / 0 SKIP**, exit 0 |
| `tsc -p tsconfig.test.json --outDir /tmp/pi-758-td` then byte-compare 7 compiled units vs `companion/.test-dist` | all **SAME** → the committed-compiled artifacts I tested are not stale vs current `src/` |
| `git diff --cached --binary \| sha256` | matches frozen digest |

Bounds I applied: Node 22 only, provider keys/PI_* unset, all tests used their own temp dirs, nothing written inside the repo.

## 4. Source-level spot attacks (my own lens, beyond re-running approvals)

- **No activation/input on the passive path.** `computer-capture.ps1:202` fails a minimized Passive target *before* `ShowWindow` (`:203`), `ForceForeground`/`SetForegroundWindow` is gated behind `-not $Passive` (`:238-241`), and `:274` re-requires the target to still be foreground. `activity-windows.ps1` contains no `SendInput`/UIA pattern invocation. Contract "不恢复/激活窗口" holds on the shipped path.
- **Windows identity gates are reachable and fail-closed.** `computer-probe.ps1:99` really emits `{hwnd,pid,ownIl,targetIl,desktop}` (matches `platform.ts` reads), `computer-ocr.ps1:18` really accepts `-Language` with `OCRLANGMISSING` on stderr (matches the mapped error), `computer-capture.ps1:301-304` really emits `restoredFromIconic/observation_quality/occludedBy` (matches the post-conditions). Fallback yields `partial` only with a zero-occluder observation (`:270-272`), which `platform.ts` accepts; `occluded` is rejected — consistent.
- **Linux recorder gates are real, not decorative.** `linux-recorder.py`: XRes `mask==2` PID only (`client_pid`), `/proc/<pid>/stat` starttime field, same-uid check, `_NET_WM_PID` never consulted; `XWAYLAND` extension, wayland env, and non-`unix:` `DISPLAY` refused before pixels; `XGetInputFocus` ancestor chain to the active window; `_NET_CLIENT_LIST_STACKING` top-of-stack + no intersecting visible sibling above; XScreenSaver `state==0`; lock broker via `NameHasOwner`→`GetNameOwner`→`GetConnectionUnixUser`→`GetActive` with **before *and* after** broker-set equality; 32-bpp/mask/stride layout validation; `O_NOFOLLOW` + owner/mode/`nlink==1`/size-0 output validation.
- **`activity.import` is reachable on the trusted path and closed on the untrusted one.** `message-router.ts:1121` → `handlePersonalWorkspaceMessage` (requires `surface==='panel'` + chrome-extension origin + panelId + current session) → `handleActivityMessage` → `service.handle` → `importImage`. Budget chain is coherent: 8,388,608 base64 chars = 6 MiB decoded (`validation.ts:61`) < 10 MiB `MAX_WS_MESSAGE_SIZE` (`ws/lifecycle.ts:95`); client enforces 6 MB; `validatePng` caps 8 MiB/8192²/16.7 Mpx.
- **Default-off, distinct model consent, no auto-AI, no date inference** all survive: `DEFAULT_ACTIVITY_CONFIG` keeps `enabled:false`/`ocr_ai_enabled:false` with `ocr_language` added; `importImage` never calls `extract`; `adapters.ts:95` suppresses `due_at` for `manual_import` and `:107` replaces `captured_at` with "原消息日期未知"; reminder/feedback state machine (`deliverReminders` → `claimReminder`/`finishReminder`) is untouched except the platform branch.
- **Resource survival through compile + flatten** holds for both helper families: `companion/package.json` build copies `linux-recorder.py`→`dist/activity/`; `package.sh:220` flattens it next to the JS; `resolveLinuxRecorder` probes both; Windows `.ps1` set staged by the existing non-empty-count gate.

## 5. Findings

**No blocking finding. No missed concrete blocker.** The adversary's non-negotiable claims (cycle-1 P2 real → closed; R3 = test-contract-only with frozen production bytes; Windows native unproven) all hold under my own inspection, not just their prose. Non-blocking nits (do not change the verdict, worth a later touch):

- **N1** `companion/src/activity/image.ts:10` reports "不超过 8 MB" while the import contract everywhere else (UI `PersonalWorkspace.tsx` ImportScreenshot, docs, `validation.ts:61`) is **6 MB**; a 6.5 MB file is correctly rejected with a message naming the wrong budget. Cosmetic/user-facing only.
- **N2** `companion/src/activity/notifications.ts:22` evaluates `binary = resolveWindowsToast()` as a default parameter, i.e. outside the function's `try`. A package missing `activity-bin` therefore throws a raw `MODULE_NOT_FOUND` instead of `NOTIFICATION_FAILED`; `deliverReminders` (`service.ts:142`) still catches everything and marks `failed`, so the state machine and the UI message are safe — only the specific "please check the complete installer" reason is lost.
- **N3** `ci.yml:750` installs `xvfb` but not `xauth`, which `xvfb-run` needs; if the runner image lacks it the new Linux lane is red at setup. Red-not-green (no silent pass), and the new lane's first proof is exactly the hosted run this verdict admits.
- **N4** Methodology note for the record: the `deepEqual(fixture, actual)` checks (`windows-ci-feedback-750-contract.mjs:77,139,188`) are drift locks recorded from the actual producer — they cannot detect a defect present at record time. That is why I re-derived the substantive properties (no `continue-on-error`, correct lane, post-compile order, notifier command present) directly from the real YAML instead of trusting the pin.

## 6. Scope and gaps (explicit, not waived)

- **Windows native DoD remains NOT_RUN.** No WPF/WinRT/PS execution, no SEA launch, no visible notification. Nothing here — and nothing in the three adversary reports — makes passing macOS/Linux evidence transferable to Windows. This review admits the delta to **exact-head hosted CI**; it does not certify native acceptance or merge-readiness.
- Real GNOME/KDE lock behaviour remains NOT_RUN (the fixture is an explicit controlled private-bus `org.freedesktop.ScreenSaver`); real chat accuracy, real mixed-DPI Windows reality, and human-visible notification delivery remain unproven.
- I did not run the full companion suite (8,524-test snapshot), the extension 1,807 suite, the ACP 86 family, or the Linux native lane (no Linux host in this session); those remain the machine report's declared evidence, not my verification.

## 7. Outcome / trajectory / component

- **Outcome:** the frozen R3 delta is internally consistent, the cycle-1 P2 is genuinely closed for both shipped Windows layouts, and the newly written CI consumer enforces the added gates without normalizing away any historical pin. No capability expansion, no activation/input, no model side-effect, no unverified-identity capture path found.
- **Trajectory:** one real P2 → bounded sidecar + resolver fix → the author's own preflight caught a *second* class of omission (stale workflow pin) before push, retained the RED, stopped an incomplete Pi, and repaired only the consumer with fixed digests, whole-object validation before precise normalization, and 8 matching negatives. That is the correct behaviour, not a ratchet downward.
- **Component:** activity notifications resolver/staging producers, CI workflow + its preflight contract, platform adapters, Linux X11 sidecar, import protocol and store/config plumbing — reused for byte-identical source from cycles 1–2.

PI_PROVIDER=deepseek
PI_MODEL=deepseek-v4-flash

VERDICT: APPROVE_WITH_NITS
