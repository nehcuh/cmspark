# Independent adversary (Runtime / Correctness) — Chrome vault-browser one-shot L2

**Batch**: `chrome-cu-oneshot-20260822`  
**Role**: independent Runtime / Correctness adversary (did **not** implement)  
**Worktree**: `/tmp/cmspark-chrome-cu` branch `feat/chrome-cu-oneshot-l2` (`85cd7a5`) vs `origin/main` (`56a5973`)  
**Diff**: `docs/audit/reviews/chrome-cu-oneshot-diff-20260822.patch`  
**Blast (claimed)**: T3 Trust. Browser pixel CU was structurally denied (ADR-017 A10.3). This change lets Chrome/Safari reach existing `host_computer` task L2 as a **one-shot**; persistent `coordinateAllowed` stays false.

```text
Surface:      L2 host_computer (vault-browser one-shot)
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        forceConfirm L2; NEVER skipped by unattended / 三旗 cruise / G1 session-trust;
              does NOT persist Apps coordinateAllowed; LOLBIN/password-manager/terminal/wallet still STRUCTURAL
Channel:      community
```

Product lock (user 2026-08-22): popup; user must click allow; then Chrome pixel inject. Unattended must **not** silence this dialog.

This lane attacks dual-write (admission vs executor), platform classifiers, hwnd ownership, missing tests, and `resolveL2ForceConfirm` wiring. Not a rubber stamp.

---

## Machine `[executed]`

Host: Darwin (`uname -s`), Node v24.16.0. `companion/node_modules` present.

| Command | Result |
|---------|--------|
| `./node_modules/.bin/tsc -p tsconfig.test.json` | exit 0 |
| `node --test` `computer-policy` + `l2-admission-pure` + `web-act-loop-wave1` + `apps-coordinate` | **80 pass / 0 fail** |
| Private throwaway probes against `.test-dist` (not committed; no worktree mutation) | see attacks 1–5 |

WAVE-1 source lock and policy unit tests are green on this Darwin CI-equivalent. They do **not** pin the unattended/G1 *admission* skip-clear (attack 4).

---

## Attack 1 — Dual-write: l2-admission one-shot vs executor `assertCoordinateAllowed`

**Claim to falsify**: L2 can approve a vault-browser task, then executor STRUCTURAL-fail on the same token (user clicked Allow, inject never starts). Or worse: admission thinks it is a one-shot (forces dialog) while executor treats it as a normal `coordinateAllowed` app (unattended/G1/cruise skip re-L2).

### What the two call sites actually do `[inspected]`

Admission (`companion/src/tool/l2-admission.ts:499-502`):

```499:502:companion/src/tool/l2-admission.ts
        const entryC = assertCoordinateAllowed(getConfig(), String(finalParams.app || ""), {
          allowVaultBrowserOneShot: true,
        })
        vaultBrowserOneShot = isVaultBrowserEntry(entryC)
```

Executor (`companion/src/computer/executor.ts:454-455,500`):

```454:455:companion/src/computer/executor.ts
    entry = assertCoordinateAllowed(deps.config, params.app, { allowVaultBrowserOneShot: true })
    vaultBrowserOneShot = isVaultBrowserEntry(entry)
```

Both **always** pass `allowVaultBrowserOneShot: true`. The flag is not computed independently per layer; `isVaultBrowserEntry(entry)` is the real classifier. For a Chrome GUI entry, `canEverCoordinate` is false and the one-shot early-return in `assertCoordinateAllowed` (`policy.ts:173-176`) is taken on **both** sides. `[executed]` `assertCoordinateAllowed(..., { allowVaultBrowserOneShot: true })` on `C:\...\chrome.exe` with `coordinateAllowed: false` returns the entry; without the flag it is `APP_COORDINATE_STRUCTURAL` (unit test + probe).

So: **L2 cannot approve Chrome then executor `assertCoordinateAllowed` STRUCTURAL-fail** unless `deps.config` diverges from `getConfig()` between minting the token and `runComputerTask` (pre-existing config-vs-deps split, not introduced here).

### Where dual-write *does* exist — hwnd is the second writer

`assertCoordinateAllowed` one-shot only skips the **persistent bit**. The WP2 hwnd vault recheck still treats `chrome.exe` as vault (`basenameToVault` → `win.chrome`). Without the hwnd waiver, the sequence is exactly the failure mode:

1. Admission one-shot passes → user clicks Allow.
2. Executor `assertCoordinateAllowed` one-shot passes.
3. `assertHwndOwnedByEntry(chromeHwnd, chromeEntry)` throws `APP_COORDINATE_STRUCTURAL`.

The patch adds the waiver (`policy.ts:240-244`, executor `:500` and per-action `:825`). Unit test `policy: hwnd chrome allowed only on one-shot browser entry` pins Chrome hwnd **with** flag = ok, **without** = STRUCTURAL. `[executed]` private probe: Chrome hwnd + one-shot = inject success (`runComputerTask` clicks=1).

**Residual dual-write (not a live hole, is a fuse)**: admission and executor both hard-code `allowVaultBrowserOneShot: true` for *every* `host_computer` app. Safety depends entirely on `isVaultBrowserEntry` / `canEverCoordinate` staying in lock-step. A future “only pass the flag for browsers” refactor that misses one side re-opens L2-approve-then-STRUCTURAL.

### Admission skip vs executor skip is a *third* writer

`hostComputerTrustSkip` (initial L2) and executor `reL2()` (mid-task) are independent. Both were patched. Executor skip is real (attack 3/4). Admission skip is **set-then-cleared** (attack 4) — the dangerous dual-write.

**Outcome**: no live L2-approve-then-`assertCoordinateAllowed`-STRUCTURAL path for Chrome. Hwnd waiver is load-bearing; tests cover the Chrome hwnd happy path only.

---

## Attack 2 — macOS `bundleId` vs Windows `chrome.exe` path; Linux/Darwin CI

**Claim to falsify**: one-shot works on only one platform; unit tests are Linux-shaped and lie on Darwin, or Darwin-shaped and lie on Windows.

### Classifier is platform-agnostic `[inspected]` + `[executed]`

`isVaultBrowserEntry` (`policy.ts:75-86`):

- `entry.bundleId ∈ MAC_BROWSER_VAULT_BUNDLE_IDS` → true (no `os.platform()` check).
- else `basenameToVault(entry.exe.path) ∈ WIN_BROWSER_VAULT_TOKENS` → true.

`canEverCoordinate` already treats `MAC_VAULT_BUNDLE_IDS` (which spreads `MAC_BROWSER_VAULT_BUNDLE_IDS`) as structural on **all** platforms (`policy.ts:114-116`), then Windows path vault/LOLBIN unless `darwin && bundleId`.

`[executed]` on Darwin:

| Entry | `isVaultBrowserEntry` | one-shot `assertCoordinateAllowed` |
|-------|------------------------|--------------------------------------|
| `exe.path = chrome.exe`, no bundleId | true | OK |
| `bundleId = com.google.Chrome`, no exe | true | OK |
| `exe.path = powershell.exe` | false | `APP_COORDINATE_STRUCTURAL` |
| `exe.path = 1Password.exe` | false | `APP_COORDINATE_STRUCTURAL` |

So **both** macOS bundleId and Windows chrome.exe one-shot work on Darwin CI. They would also work on Linux CI: neither branch is gated on `win32`/`darwin`. That is why the mac Chrome unit test can run in GitHub linux runners. Intentional, not an accident.

### Hwnd identity *is* platform-specific `[executed]`

`assertHwndOwnedByEntry` (`policy.ts:215-218`):

- Darwin: `entryPath = bundleId ?? exe.path`
- else: `entryPath = exe.path`
- Darwin + bundleId ⇒ `isMacEntry` ⇒ **Windows vault/LOLBIN recheck skipped** (`policy.ts:232`)

`[executed]` Darwin:

| Entry | hwnd `exePath` | one-shot hwnd result |
|-------|----------------|----------------------|
| chrome.exe | chrome.exe | OK |
| chrome.exe | powershell.exe | `HWND_NOT_OWNED` (not STRUCTURAL) |
| `com.google.Chrome` | `com.google.Chrome` | OK |
| `com.google.Chrome` | chrome.exe path | `HWND_NOT_OWNED` |
| `com.google.Chrome` | `com.apple.Terminal` | `HWND_NOT_OWNED` |

DoD #5 asked for STRUCTURAL on hwnd swap. Runtime deny is `HWND_NOT_OWNED` because the path/bundle match runs **before** the vault recheck. Fail-closed, wrong code vs DoD wording. No mac-bundle hwnd unit test exists (only `assertCoordinateAllowed`).

### Set asymmetry (fail-closed, not a hole)

`MAC_BROWSER_VAULT_BUNDLE_IDS` includes Vivaldi + Chromium; `WIN_BROWSER_VAULT_TOKENS` does not (`win.chrome|edge|firefox|brave|arc|opera`). Windows Vivaldi/Chromium are **not** vault-mapped in `BASENAME_TO_VAULT_TOKEN` either, so they can still take the persistent `coordinateAllowed` bit (pre-existing, not this patch). Product lock named Chrome/Safari.

**Smuggle (Windows-only, config tamper)** `[inspected]`: `isVaultBrowserEntry` trusts `bundleId` on every OS. A hand-edited Windows entry with `bundleId: "com.google.Chrome"` and `exe.path = notepad.exe` is a vault-browser for one-shot (`canEverCoordinate` false via bundleId). On Darwin the hwnd compare uses bundleId first → `HWND_NOT_OWNED` against notepad `[executed]`. On win32, `entryPath` is notepad → path match + `basenameToVault(notepad)=null` → **inject allowed** after the user clicks Allow on whatever `display_name` the tampered entry has. Requires config tamper; add-flow on Windows does not set `bundleId`. Nit, not a default-path hole.

---

## Attack 3 — hwnd ownership + one-shot: Chrome hwnd OK; Chrome entry + powershell hwnd denied?

**Claim to falsify**: one-shot hwnd waiver is `allowVaultBrowserOneShot && isVaultBrowserEntry(entry)` only, so a Chrome-approved task can inject into a LOLBIN/password-manager hwnd.

### Code `[inspected]`

```240:244:companion/src/computer/policy.ts
    const browserHwnd =
      opts?.allowVaultBrowserOneShot === true &&
      isVaultBrowserEntry(entry) &&
      isBrowserVaultExePath(info.exePath)
    if (!browserHwnd && basenameToVault(info.exePath) !== null) {
```

Three conjuncts. `isLolbinPath` is **above** this and never waived (`policy.ts:233-238`).

### Probe `[executed]` (Darwin, Windows-shaped paths, `runComputerTask`)

| Setup | `errorCode` | clicks |
|-------|-------------|--------|
| Chrome entry + Chrome hwnd, one-shot | success | 1 |
| Chrome entry + powershell hwnd, one-shot | `HWND_NOT_OWNED` | 0 |
| Chrome entry + 1Password hwnd | `HWND_NOT_OWNED` (policy probe) | — |
| Chrome entry + notepad hwnd | `HWND_NOT_OWNED` (policy probe) | — |
| 1Password entry, one-shot `assertCoordinateAllowed` | `APP_COORDINATE_STRUCTURAL` | — |

There is **no** unit test for Chrome entry + powershell hwnd. If a later patch dropped the path-equality check or dropped `isBrowserVaultExePath(info.exePath)`, Chrome one-shot could follow a swapped hwnd. Today path equality fires first.

Per-action recheck (`executor.ts:825`) uses the same flag captured at task start. Mid-task hwnd swap to powershell still `HWND_NOT_OWNED`. Mid-task swap to another **browser** binary with a **different** path (Edge hwnd on a Chrome entry) is also `HWND_NOT_OWNED`. Swap to a same-path lolbin is impossible by basename.

**Outcome**: Chrome hwnd OK; Chrome+powershell **denied**. Not STRUCTURAL. Missing test is a nit, not a bypass.

---

## Attack 4 — Missing tests: unattended skip actually false for vault browser in l2-admission?

**This is the load-bearing product lock.** `hostComputerTrustSkip` **bypasses** `forceConfirm`:

```961:961:companion/src/tool/l2-admission.ts
    if ((!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip) {
```

Cruise is handled by `resolveL2ForceConfirm` (attack 5). Unattended + G1 are **not**. They set `hostComputerTrustSkip = true`, and that kills the dialog even when `forceConfirm === true`.

### What admission actually does `[inspected]`

After `assertCoordinateAllowed` one-shot:

```591:606:companion/src/tool/l2-admission.ts
            // assertCoordinateAllowed already passed → coordinateAllowed true for this app.
            const {
              evaluateUnattendedHostComputerSkipDetail,
              isUnattendedArmed,
            } = await import("../computer/unattended-grant")
            const unattendedDetail = evaluateUnattendedHostComputerSkipDetail({
              coordinateAllowed: true,
              ...
            })
            if (unattendedDetail.ok) {
              hostComputerTrustSkip = true
              hostComputerTrustSkipReason = "unattended_session_grant"
```

Same lie at the no-`sessionId` branch (`:651-652`). Comment is **now false**: one-shot Chrome passes `assertCoordinateAllowed` with `coordinateAllowed: false`.

`evaluateUnattendedHostComputerSkipDetail` (`unattended-grant.ts:415-417`) returns `ok: true` whenever armed **and** `coordinateAllowed === true`. The call site **feeds it `true` unconditionally**. For a vault browser this computes a skip that the product lock forbids, then:

```679:684:companion/src/tool/l2-admission.ts
        if (vaultBrowserOneShot) {
          // Persistent coordinateAllowed is never set on browsers. Unattended /
          // G1 / 三旗 must not inherit a skip from a non-browser grant.
          hostComputerTrustSkip = false
          hostComputerTrustSkipReason = null
        }
```

Set-then-clear. The clear is after both G1 and unattended branches and before `computerPreview`. Early `failC` returns (busy / rate-limit) fail closed. I could **not** find a path that keeps `hostComputerTrustSkip === true` for `vaultBrowserOneShot` if this block runs.

Audit lie: `computer.unattended.task_auto_approved` / `computer.session_trust.task_auto_approved` fire **before** the clear. Then the dialog still shows. Incident response will read “auto_approved” for a prompt that happened.

### Tests that exist vs tests that pin the lock `[executed]` / `[inspected]`

| Test | What it pins | Unattended initial L2? |
|------|----------------|------------------------|
| `l2-admission-pure` `resolveL2ForceConfirm` cruise + `vaultBrowserOneShot: true` | cruise cannot waive **forceConfirm** | **No.** Unattended does not go through `forceConfirm`. |
| `computer-policy` one-shot / powershell STRUCTURAL / hwnd chrome | policy gate | No |
| `computer-executor.test.ts` | **zero** matches for `vaultBrowser` / `unattended` / `isUnattendedArmed` | No |
| `runL2ToolAdmission` | **no test file imports it** | **No** |

Private executor probes (not in suite) `[executed]`:

- Unattended armed + Chrome one-shot + `budget: 1` + two clicks + confirm=deny → `BUDGET_DENIED`, `reL2Calls=1`, clicks=1. Mid-task unattended skip **does not** fire (`executor.ts:656` `isUnattendedArmed() && !vaultBrowserOneShot`).
- G1 `trust.grant("sess-1", "win.app.chrome")` + same budget trap + confirm=deny → `BUDGET_DENIED`, `reL2Calls=1`, `isTrusted=true`. G1 re-L2 skip **does not** fire (`executor.ts:703`).

Those pin **executor re-L2**. They do **not** pin **initial** L2 `hostComputerTrustSkip`. That is the dialog the user must click.

**P1 nit (highest)**: pass `coordinateAllowed: entryC.coordinateAllowed === true` (false for browsers) into `evaluateUnattendedHostComputerSkipDetail`, and add a test that would fail if lines 679–684 were deleted. Today a one-line deletion of the clear **silences Chrome L2 under unattended** while every existing test stays green.

---

## Attack 5 — `resolveL2ForceConfirm` cruise waive vs `vaultBrowserOneShot` wiring

**Claim to falsify**: the new flag is not in scope at the call site, or the algebra is `||` instead of a hard true, or cruise still waives.

### Wiring `[inspected]` — flag **is** in scope

`vaultBrowserOneShot` is declared at `l2-admission.ts:486` in `runL2ToolAdmission`, assigned at `:502` inside `if (hostComputerGated)`, passed at `:887-893`:

```887:893:companion/src/tool/l2-admission.ts
    const forceConfirm = resolveL2ForceConfirm({
      toolName,
      capabilityForceConfirm,
      hostComputerGated,
      userFullAutonomy,
      vaultBrowserOneShot,
    })
```

Algebra (`:90-91`):

```
if (opts.vaultBrowserOneShot && opts.hostComputerGated) return true
```

Both conjuncts required. `vaultBrowserOneShot` is only set inside `hostComputerGated`, so the extra `&& hostComputerGated` is belt. `[executed]` pure helper:

| Inputs | Result |
|--------|--------|
| `host_computer` + gated + cruise + `vaultBrowserOneShot: true` | `true` |
| same + `vaultBrowserOneShot: false` | `false` (cruise still waives normal CU) |
| `vaultBrowserOneShot: true` + `hostComputerGated: false` | `false` |

Dialog gate is `(!skipConfirmation || forceConfirm) && !hostComputerTrustSkip`. Cruise sets `skipConfirmation` via `allow_all_schemes` / `auto_approve_dangerous`. `forceConfirm === true` still enters the dialog **if** skip was cleared (attack 4).

**Nit**: `security.critical_api_waived` at `:894-901` still logs for `hostComputerGated && userFullAutonomy && !acpForceConfirm` **without** checking `vaultBrowserOneShot`. Chrome + 三旗 still prompts, but the log says waived.

Executor cruise re-L2 (`executor.ts:678`) adds `&& !vaultBrowserOneShot`. Flag is the closure local from `:452-455`. In scope. `[inspected]`

---

## DoD vs evidence

| # | DoD | Result |
|---|-----|--------|
| 1 | Chrome `host_computer` no longer STRUCTURAL before L2 when `allowVaultBrowserOneShot` | **Hold** `[executed]` policy + executor inject |
| 2 | Chrome `coordinateAllowed` cannot persist (`set_coordinate_allowed` still deny) | **Windows exe: hold** `[executed]` `apps-coordinate` chrome.exe → `COORDINATE_STRUCTURAL_DENY`. **macOS bundle-only: miss** `[inspected]` `handlers.ts:448` only checks `entry.exe?.path`. add-flow mac Chrome is bundleId-only (`add-flow.ts:173-182`). `normalizeAppEntry` force-clear also requires `exe.path` (`types.ts:295-303`). Bit can persist; `canEverCoordinate` still false so one-shot path is taken and skip-clear still applies. Inert for *today's* skip, violates DoD text. |
| 3 | Unattended + 三旗 + G1 cannot skip initial L2 or mid-task re-L2 for vault browser | **Executor re-L2: hold** `[executed]` private probes. **Cruise initial: hold** `[executed]` pure helper + wiring. **Unattended/G1 initial: hold by inspection of set-then-clear, untested.** |
| 4 | powershell / 1Password / Terminal still STRUCTURAL even with one-shot flag | **Hold** `[executed]` powershell + 1Password `assertCoordinateAllowed` |
| 5 | hwnd swap Chrome → LOLBIN/password-manager still STRUCTURAL | **Deny holds, code is `HWND_NOT_OWNED`** `[executed]`. No suite test. |
| 6 | WAVE-1 still does not *default* `host_computer` for DOM | **Hold for “default”** `[executed]` source lock. **Contradicts Rule 7/8** `[inspected]` — see N3. |

---

## Findings (none live-skip)

### P1 N1 — Admission unattended/G1 skip is a lying set-then-clear; suite cannot kill it

`l2-admission.ts:597,652` pass `coordinateAllowed: true` after a one-shot admit. `unattended-grant.ts:350` still documents “coordinateAllowed must already be true at call site”. Clear at `:679-684` is the only thing that keeps the product lock. `l2-admission-pure` does not execute `runL2ToolAdmission`. Deleting the clear is CI-green and silences Chrome L2 under unattended.

Fix: pass `entryC.coordinateAllowed === true`; do not log `task_auto_approved` until after the vault-browser veto; add a test that mocks `evaluateUnattendedHostComputerSkipDetail` / armed grant and asserts the confirm path (or extract the skip-veto to a pure helper next to `resolveL2ForceConfirm`).

### N2 — `set_coordinate_allowed` / `normalizeAppEntry` still ignore macOS vault bundleIds

DoD #2 is Windows-exe only. macOS Chrome from add-flow has no `exe.path`. Pre-existing, now load-bearing because Chrome is a CU surface. Belt: deny when `bundleId ∈ MAC_VAULT_BUNDLE_IDS` (or `isVaultBrowserEntry` / `!canEverCoordinate`).

### N3 — Rule 7/8 still forbid the path Rule 12 now allows

`adapter.ts:478` Rule 7: CDP_ATTACH_FAILED → `do NOT retry via evaluate or host_computer`.  
`adapter.ts:482` Windows/Linux Rule 8: `host_computer is NOT a browser-DOM fallback`.  
Rule 12 (`:440,449`) and 12b (`:463`): after CDP freeze / DOM-script cap / explicit 模拟点击, MAY `host_computer` on Chrome, always confirm.

WAVE-1 test was **weakened** (`web-act-loop-wave1.test.ts`) from `NEVER use host_read/host_write/host_computer for browser-DOM` to `NEVER default` + `ALWAYS pops a confirm`. It no longer fails on Rule 7/8. Runtime gates are fine; the model is told two opposite things. Likely under-use of the feature, not a skip.

### N4 — User guide step 3 still requires `coordinateAllowed === true`

`docs/computer-use-user-guide.md` item 3 still lists the persistent bit as required; item 4 describes the browser one-shot exception. Operators following the checklist will think Chrome CU is impossible until they flip a bit that `set_coordinate_allowed` (Windows) refuses.

### N5 — Hwnd swap error code vs DoD; no Chrome→powershell test

Deny is `HWND_NOT_OWNED`. Add the probe I ran to `computer-policy.test.ts`. Optional: also pin executor Chrome one-shot inject + unattended/G1 budget re-L2 (the private probes).

### N6 — `security.critical_api_waived` lies for vault-browser + cruise

`l2-admission.ts:894-901`. Exclude `vaultBrowserOneShot` (same shape as ACP).

### N7 — User-guide / ADR-017 bullet 3 still says 三旗 cruise may waive host initial L2

Bullet 2 now carves browsers; bullet 3 was not restated. Docs-only.

---

## Trajectory / component

Diff scope matches the claim: `policy.ts`, `executor.ts`, `l2-admission.ts`, Rule 12 prompt, two ADRs/guides, three test files. No drive-by.

Hotspots:

- `companion/src/tool/l2-admission.ts:597,652,679-684,887-893,961`
- `companion/src/computer/policy.ts:75-86,173-176,232-250`
- `companion/src/computer/executor.ts:452-455,500,656,678,703,825`
- `companion/src/apps/handlers.ts:448-455` (persist hole, unchanged)
- `companion/src/llm/adapter.ts:440,449,478-482,463`

Trust monotonicity (ADR-020 checklist item 4): one-shot **raises** Surface (browser pixels) without inheriting unattended/cruise/G1 skip **if** N1’s clear stays. No new confirm dialect — existing host_computer L2 + banner line.

---

## Residual risks

- Dual-write `allowVaultBrowserOneShot: true` on every `host_computer` call: classifier drift between `isVaultBrowserEntry` and `canEverCoordinate` becomes an admit/execute split.
- Windows bundleId smuggle (tamper).
- Companion UI is Chrome (`self-ui.ts`); one-shot CU now targets the same exe as the side panel. Pre-existing self-UI recovery still treats chrome.exe foreground as companion. Not a new skip; inject-into-sidepanel is a targeting quality issue if `enumerateByExe(chrome)` prefers the panel window.
- No `runL2ToolAdmission` integration test existed before this patch; this change makes that gap T3-relevant.

---

## Verdict rationale

I did not find a **live** path that silences the Chrome one-shot dialog or injects into powershell/1Password after a Chrome one-shot admit. Executor unattended/G1 re-L2 holds under private execution. Cruise forceConfirm holds under the pure helper and is wired at the call site.

I also will not APPROVE: the product lock for **initial** L2 under unattended is a six-line veto sitting on top of a hardcoded `coordinateAllowed: true`, and the test suite cannot kill it. That is the opposite of “tests pin the bug.” Fix N1 (true `coordinateAllowed` into the unattended evaluator + one test) before treating this as locked.

VERDICT: APPROVE_WITH_NITS
