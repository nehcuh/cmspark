All checks complete. I have everything needed, including the primary failure receipt.

---

# Pi INCREMENTAL composition re-review — CMspark #758 merge onto new main
## Eval Gate T3 · scope: shared merge/contracts only

Reviewer: Pi, non-author. **Not** a whole-feature opinion panel. Read-only (`read`, `bash`); all builds/tests ran under Node **22.23.2** with provider env unset; test artifacts in `/tmp`; **zero product edits**.
Runtime identity: **`PI_PROVIDER=deepseek`, `PI_MODEL=deepseek-v4-flash`**, `PI_REASONING_LEVEL=high`.

Feature parent `81057e01a2174cad691dc7c9def90dcc5344335a`; pending `MERGE_HEAD` `ab61257e377e24662c883ee934585f6b2667e195`.

---

## 1. Frozen surface verified before judging anything

Both frozen views reproduce **byte-exactly** from the current index — and only with the correct generation flags, which I derived rather than assumed:

| Frozen view | Reproducing command | SHA-256 | Match |
|---|---|---|---|
| incoming delta since 810 | `git diff --cached --binary` | `8ef3327265c38a485b65152c7713781ca64ac1f8dc148d417ac2d9b4edac004d` | **exact** (170,529 B) |
| full PR delta vs new main | `git diff --binary MERGE_HEAD` | `ea9347165f07aff2449d8d40b989db98b7bdd2bd2367e93fe72441b29543305b` | **exact** (566,258 B) |

Methodological note worth recording: the naive `git diff a3ecd5f2 MERGE_HEAD` yields `01b5b554…` — the frozen A is the **staged delta from HEAD**, not the merge-base diff, and requires `--binary` for the `activity-linux-758.png` blob. So the adversary, the integration report and this review read the same bytes.

Tree untouched by me: `git status --short` still shows the same 23 staged entries + 2 pre-existing untracked audit docs; `git diff --cached --binary | sha256` re-run **after** the build still equals `8ef3327…`.

---

## 2. Composition conservation — the decisive result

**`git diff <git-merge-tree autotree> <staged index>` returns exactly two entries:**

```
M  CHANGELOG.md
A  docs/audit/reviews/2026-10-22-activity-platform-main-integration.md
```

Everything else in the merge is **byte-identical to git's own automatic merge** (`af78a953…`). Concretely:

- `ci.yml`: autotree blob `4baac8ce644c` = index blob `4baac8ce644c` (feature `f9eb7df4`, main `f07f265c`).
- `windows-ci-feedback-750-contract.mjs`: autotree `7686f9f1e5a5` = index `7686f9f1e5a5`.

So the only human decisions in this integration are the declared CHANGELOG conflict and staging one audit document. **No hand-edited production code, workflow or test.**

**All 31 product-source files in the PR delta are byte-identical to `81057e01`** (`companion/src/activity/*`, `message-router.ts`, `ws/lifecycle.ts`, `ws/validate.ts`, `settings-assistant/*`, `host-use/win/scripts/activity-windows.ps1`, and 14 `chrome-extension/src/**` UI/background files). **Main's squash touches zero `companion/src` or `chrome-extension/src` files** (`git show --name-only ab61257e | grep -E '^(companion|chrome-extension)/src'` → none). The product capability surface in the composed tree is therefore *not new bytes*; reusing the earlier component approvals is justified structurally, not by assertion.

**All 18 upstream-owned files re-checked against `ab61257e` are identical** — registrar, prepared-build helper/paths, first-evidence/gate/sites/real-first, phase observation/integration, both `#723` source consumers, `windows-development.md`, `browser-native-bridge.md`. Only `docs/TESTING.md` differs from both parents, and it is the true both-sides auto-merge: it retains main's `120 秒` prepared phase and "两段不是旧整体 45 秒测量", plus the feature's `活动记录平台适配（#758）` and `聊天事项与语义设置` sections.

**CHANGELOG resolution is exactly the union:** every non-blank line added by main and by the feature vs merge-base is present (`grep -Fqx` per line, zero missing), and line arithmetic closes with no duplication — `671 + 6 + 5 = 682` = staged total.

---

## 3. Shared CI / contract composition

- `ci.yml:278` retains main's `cockpit-bridge-prepared-build.test.mjs` **together with** the original lifecycle/preflight args.
- `ci.yml:59` retained `node --test scripts/tests/activity-notifier-package.test.cjs` (build job, after `npm ci`); `ci.yml:267`/`:760` `CMSPARK_ACTIVITY_NATIVE_758: '1'`; `ci.yml:735` `activity-linux-x11`; `:764` `bash scripts/test-activity-x11-758.sh`.
- **No waiver injected by the merge:** `continue-on-error: true` occurs exactly **2** times in merge-base, `81057e01`, `ab61257e` *and* the index — both pre-existing (`ci.yml:137` npm-audit, `:144` coverage observation). `permissions:` 0 lines and `if: false` 0 in both main and composed.
- Ordering holds in the composed file: `Actual passive activity capture and local OCR (#758)` sits immediately after `Compile shared companion test inputs (#650)`, guarded by `matrix.lane == 'native'` (no `always()`), i.e. an earlier pre-#758 failure yields a red job, never a silent green.
- The `#750` test family parses the **real** workflow (`windows-ci-feedback-750.test.mjs:6` reads `../../.github/workflows/ci.yml`) — so its PASS is a genuine composition check. Both sides' negative controls survive in the merged file: feature-side `activity native failure waived`, `activity X11 failure waived`; census-side wrong-lane / waived-job / lost-always-artifact / missing staged scripts; `#723` `native gate failure waived`, `finite artifact also census`.

---

## 4. Upstream evidence — re-verified myself, not taken on prose

- `gh api repos/nehcuh/cmspark/commits/main` → `ab61257e…` — **origin/main head equals `MERGE_HEAD`**; no newer main commit exists. `git log MB..MERGE_HEAD` = exactly one commit.
- Run **[39695825956](https://github.com/nehcuh/cmspark/actions/runs/39695825956)**: `headSha = e76f20415a9104fc82ff17a707fb76acef7ae2d0`, `conclusion = success`, **6/6 jobs success** — `build`, `smoke (macos-latest)`, `smoke (windows-latest)`, `smoke (windows-native)`, `smoke (ubuntu-latest)`, `acp-history-restart`. Inside the `windows-latest` job, `Complete Windows Companion census (#650)` and `Windows census finite public receipts (#650)` are both **success** (the `#750` native-lane staging steps correctly *skipped* on the census lane).

This confirms the **cited upstream** result. It is **not** evidence about the composed branch.

---

## 5. Actual feature evidence preserved — verified to step level and to the primary artifact

Run **39698906267** @ `81057e01` (still `in_progress` overall), job `smoke (windows-native)` steps:

| # | Step | Result |
|---|---|---|
| 14 | Compile shared companion test inputs (#650) | success |
| **15** | **Actual passive activity capture and local OCR (#758)** | **success** |
| 39 | Windows cockpit native bridge first identity STOP gate (#723) | **failure** |
| 40 | Publish finite cockpit first failure (#723) | success |

`activity (Linux X11 native)` = **success**; `build`, `smoke (macos-latest)`, `smoke (ubuntu-latest)`, `acp-history-restart` = success; `smoke (windows-latest)` = in_progress (census still running).

I downloaded the 593-byte artifact `cockpit-first-identity-finite` and read it verbatim:

```json
"sourceSHA256":"0746936eac4d8b54e0a2a0f7af2e1c5982a0851bcdabd38cb400af18bd4eebd7"
"first":{"role":1,"site":54,"line":220,"column":24,"code":"AWAIT_REFUSED", ...}
"stage":"first-identity-incomplete","masking":"NOT_IMPLEMENTED","exitCode":1
```

The integration report's "site54 / line220 / `AWAIT_REFUSED`", "旧 controller SHA256 `0746936e…`", "原失败保留" and "不是 registrar 原因证明" are **factually exact against primary evidence**, not paraphrase. Note the receipt binds its own `sourceSHA256`; current `scripts/tests/cockpit-bridge-first-sites.cjs:218` maps site 54 to `[247, 24]` — same site id, same column 24, line moved only because `ab61257e` changed that controller source (184 lines). That is coherent, and **nobody claims the upstream registrar fix resolved it**; `masking: NOT_IMPLEMENTED` is also preserved. Historical root remains **UNKNOWN**.

---

## 6. My own executed checks (all actual, exit 0)

Node `v22.23.2`, provider env unset (`env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u DEEPSEEK_API_KEY -u GOOGLE_API_KEY -u PI_PROVIDER -u PI_MODEL`).

| Command | Result |
|---|---|
| `npm run build` (companion, formal) | **exit 0**; verified `src/activity/linux-recorder.py` → `dist/activity/` copy ran (resource survival proven by real build) |
| `tsc -p tsconfig.test.json --outDir /tmp/pi758-td` | **exit 0**, 1,179 files |
| byte-compare 15 compiled units (`/tmp` fresh vs `companion/.test-dist`) | **all SAME** → existing artifacts not stale vs merged `src/` |
| `node --test` 9 script families (nsis750, prepared, phase-obs, phase-integration, cdp, first-evidence, build-prereq, notifier) | **194 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**, exit 0 |
| `node scripts/run-tests.mjs` selected activity/auth/source consumers (activity-752, activity-platform-758, fixture-observation-758, personal-workspace-transport, settings-assistant, controller-source-723, gate-source-723, ws-auth-paired-marker, ws-router-validator-lockstep, companion-client-auth, tool-catalog/version lockstep) | **150 PASS / 0 FAIL / 0 SKIP**, exit 0 (superset of the cited 117) |
| `git diff --cached --check` | **exit 0** |

T3 envelope re-confirmed on composed bytes: `companion/src/activity/types.ts:88` `enabled: false, allowed_apps: [], ocr_ai_enabled: false`. Frontend build/UI and macOS runtime evidence **reused unchanged** (bytes identical), not re-run; no model, provider, desktop, install, notification or config access.

---

## 7. Findings

**No composition blocker. No file:line defect introduced by the merge.** The adversary's COMPOSITION `APPROVE` is upheld, and on stronger grounds than it argued: the composition is *git-deterministic* except for one declared conflict and one added audit doc.

Carried forward unchanged (byte-identical source, so these survive verbatim):

- **N1** `companion/src/activity/image.ts:10` says "不超过 8 MB" while the import contract elsewhere is 6 MB (`validation.ts:61`) — wrong budget named on a correct rejection. User-facing only.
- **N2** `companion/src/activity/notifications.ts:22` resolves the toast binary in a default parameter, outside the `try` → a package missing `activity-bin` throws raw `MODULE_NOT_FOUND` instead of `NOTIFICATION_FAILED`; `service.ts:142` still catches it, so state machine and UI are safe.
- **N3** `ci.yml:750` installs `xvfb` but not `xauth`. **Update:** the first hosted proof now exists — `activity (Linux X11 native)` = success at `81057e01`. Still unproven for the composed head.
- **N4** Methodology: the `deepEqual(fixture, actual)` pins are drift locks recorded from the producer; they cannot detect a defect present at record time.

New in this increment (non-blocking, operational):

- **CN1** Composed-head CI has **not** run. `ab61257e` main run `39699576403` = in_progress; `81057e01` run `39698906267` = in_progress. **I do not claim integrated native CI passed.**
- **CN2** Expect the composed head to stay **red on the pre-existing `#723` first-identity gate** (step 39 above). A red composed run must be read as *preserved upstream/historical failure*, not as a merge regression — the merge neither fixes nor claims to fix it. This distinction needs stating before the run lands, or it will be mis-triaged.
- **CN3** Because the `#758` native step is guarded by `matrix.lane == 'native'` without `always()`, an earlier failure in the pre-`#758` chain produces a *skipped-in-red-job* shape rather than an explicit `#758` failure. Job conclusion is still failure, so there is no silent green — but per-step reading of a composed run needs that nuance.

So the honest overall verdict level matches the parent review: composition **APPROVE**, with carried nits open in composed bytes and the composed-head CI gate explicitly **not waived**.

---

## 8. Outcome / trajectory / component

- **Outcome:** confirmed the adversary's composition verdict. The staged tree equals git's automatic merge for every product file, workflow and contract; the sole human resolutions are the CHANGELOG conflict (exact union, no loss, no duplication) and one audit document. Product capability bytes are identical to the already-approved `81057e01`; main contributed no product source. Shared CI keeps both `#755` prepared-handoff arguments and all `#758` native/job/notifier gates, with both families' negative controls intact and no waiver, permission widening or budget change.
- **Trajectory:** normal main integration after independently checking real upstream results, preserving the failed `#723` evidence verbatim in its primary artifact instead of re-explaining it.
- **Component:** only the composed `ci.yml`, `#750` contract/test and `CHANGELOG` need composition approval; upstream internals and feature internals are not self-reapproved as newly authored work.

PI_PROVIDER=deepseek
PI_MODEL=deepseek-v4-flash

VERDICT: APPROVE_WITH_NITS
