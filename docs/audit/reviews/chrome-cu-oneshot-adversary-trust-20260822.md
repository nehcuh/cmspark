# Independent adversary — Chrome vault-browser one-shot L2 (Trust / ADR-020)

> **Lane**: Security / Trust (ADR-020)  
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp.  
> **Date**: 2026-08-22  
> **Worktree**: `/tmp/cmspark-chrome-cu`  
> **Branch**: `feat/chrome-cu-oneshot-l2` (`85cd7a5`) vs `origin/main` (`56a5973`)  
> **Diff**: `docs/audit/reviews/chrome-cu-oneshot-diff-20260822.patch`  
> **Blast**: **T3 Trust.** Browser pixel CU was structurally denied (ADR-017 A10.3). This change lets Chrome/Safari reach existing `host_computer` task L2 as a **one-shot**.

```text
Surface:      L2 host_computer (vault-browser one-shot)
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        forceConfirm L2; NEVER skipped by unattended / 三旗 cruise / G1 session-trust;
              does NOT persist Apps coordinateAllowed; LOLBIN/password-manager/terminal/wallet still STRUCTURAL
Channel:      community
```

Capability declaration: **present** in the spawn prompt. Axes fit: this is Surface (L2 `host_computer`), not a new runtime / Pack / confirm family. Confirm dialect is **reuse** of `host_computer` L2 (extra preview banner only). Trust monotonicity on the **injection skip** path holds; Trust monotonicity on the **persistent Apps bit** does **not**.

---

## MACHINE

Commands (cwd `companion/`):

```text
./node_modules/.bin/tsc -p tsconfig.test.json          # exit 0
node --test .test-dist/tests/computer-policy.test.js \
            .test-dist/tests/l2-admission-pure.test.js \
            .test-dist/tests/web-act-loop-wave1.test.js \
            .test-dist/tests/apps-coordinate.test.js   # 80 pass / 0 fail
```

Plus an adversarial probe script against `.test-dist` (handlers + `normalizeAppEntry` + `assertHwndOwnedByEntry` + one-shot flag). Results cited below as `[executed]`.

| Check | Result |
|-------|--------|
| `tsc -p tsconfig.test.json` | PASS `[executed]` |
| computer-policy + l2-admission-pure + WAVE-1 source lock + apps-coordinate | **80 pass / 0 fail** `[executed]` |
| Outcome DoD 1 (Chrome one-shot skips STRUCTURAL) | PASS `[executed]` |
| Outcome DoD 2 (Chrome `coordinateAllowed` cannot persist) | **FAIL on macOS production entry shape** `[executed]` |
| Outcome DoD 3 (unattended / 三旗 / G1 cannot skip L2 / re-L2) | PASS on inspected algebra + re-L2 branches; **no integration test of the `hostComputerTrustSkip` wipe** |
| Outcome DoD 4 (powershell / 1Password / Terminal still STRUCTURAL w/ flag) | PASS `[executed]` |
| Outcome DoD 5 (hwnd Chrome → lolbin denied; worker `host_computer` HARD_DENY) | PASS `[executed]` |
| Outcome DoD 6 (WAVE-1 does not *default* `host_computer` for DOM) | PASS `[executed]` source lock |

---

## Attack results

### 1. Can unattended grant, 三旗 cruise, G1 corpus-subset, or `auto_approve_dangerous` skip Chrome CU L2 or re-L2?

**No — not with the current control-flow order.** Skip is attempted, then unconditionally cleared for vault browsers; cruise cannot waive `forceConfirm`.

**Initial L2** (`companion/src/tool/l2-admission.ts`):

1. `assertCoordinateAllowed(..., { allowVaultBrowserOneShot: true })` then `vaultBrowserOneShot = isVaultBrowserEntry(entryC)` (`:499–502`). `[inspected]`
2. G1 `g1InitialSkipEligible` may set `hostComputerTrustSkip = true` (`:562–576`). `[inspected]`
3. Else unattended `evaluateUnattendedHostComputerSkipDetail({ coordinateAllowed: true, ... })` may set skip (`:591–606`, `:651–661`). The `coordinateAllowed: true` is **hardcoded**, with a now-false comment *“assertCoordinateAllowed already passed → coordinateAllowed true for this app”* (`:591`). For a vault browser the bit is **not** required. `[inspected]`
4. **Load-bearing wipe** (`:679–684`):

```679:684:companion/src/tool/l2-admission.ts
        if (vaultBrowserOneShot) {
          // Persistent coordinateAllowed is never set on browsers. Unattended /
          // G1 / 三旗 must not inherit a skip from a non-browser grant.
          hostComputerTrustSkip = false
          hostComputerTrustSkipReason = null
        }
```

5. `skipConfirmation` still includes `auto_approve_dangerous` / `allow_all_schemes` (`:802–807`). `[inspected]`
6. `resolveL2ForceConfirm({ vaultBrowserOneShot, hostComputerGated, userFullAutonomy })` returns **true** whenever `vaultBrowserOneShot && hostComputerGated`, **including full-autonomy cruise** (`:91`, `:887–893`). `[executed]` (`l2-admission-pure` + probe).
7. Dialog gate is `(!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip` (`:961`). `enterpriseSkip` is shell/netsec only (`familyOfTool`). With wipe + forceConfirm, Chrome still prompts under god-mode / auto_approve / 三旗 / G1 / unattended. `[inspected]`
8. `originWs: ws` still bound for non-outbound `securityConfirmations.request` (`:1275–1278`, `:1280`). `[inspected]`
9. `autoConfirmEligible: false` when `forceConfirm` (`:1305`). `[inspected]`

**Mid-task re-L2** (`companion/src/computer/executor.ts` `reL2`):

- Unattended silent-pass requires `isUnattendedArmed() && !vaultBrowserOneShot` (`:656`). `[inspected]`
- 三旗 cruise skip requires `!vaultBrowserOneShot` (`:678`). `[inspected]`
- G1 session-trust skip requires `!vaultBrowserOneShot` (`:703`). `[inspected]`

`auto_approve_dangerous` **alone** never waived `host_computer` forceConfirm (pre-existing; only three-flag cruise did). Chrome is now stricter than Notepad: cruise cannot waive it either.

**Caveat (not an exploit today):** the unattended/G1 skip is **set then cleared**. There is no unit test that `runL2ToolAdmission` actually leaves `hostComputerTrustSkip === false` for a vault browser when unattended is armed. A reorder that moves the wipe above the skip, or deletes it, would skip Chrome L2 because of the hardcoded `coordinateAllowed: true`. Comment at `:679` also claims “Persistent coordinateAllowed is never set on browsers” — **false on macOS** (Attack 2).

**Verdict Q1:** skip does not fire. Residual: wipe is a single untested assignment next to a lie about persist.

---

### 2. Can `coordinateAllowed` be persisted on Chrome (handler, `normalizeAppEntry`, hand-edited config)?

**Yes on macOS — DoD 2 FAIL.** Windows chrome.exe still denied.

Production add-flow for macOS GUI is **bundleId-only, no `exe.path`**:

```173:182:companion/src/apps/add-flow.ts
    const entry: AppEntry = {
      token,
      kind: "gui",
      display_name: display,
      source: "user",
      policy: input.policy ?? "ai",  // macOS: default to "ai" (code signing trust)
      enabled: true,
      added_at: now().toISOString(),
      bundleId,
    }
```

**Handler** (`companion/src/apps/handlers.ts:448–456`) only structural-denies when `entry.exe?.path` maps via **Windows** `basenameToVault` / `isLolbinPath`. It never calls `canEverCoordinate` / `isVaultBrowserEntry`. `[inspected]`

**`basenameToVault` is Windows-basename table.** Typical Chrome.app binary is not in it:

| path | `exeBasename` | `basenameToVault` |
|------|---------------|-------------------|
| `C:\...\chrome.exe` | `chrome` | `win.chrome` → handler DENY `[executed]` |
| `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | `google chrome` | **null** `[executed]` |
| `/Applications/Safari.app/Contents/MacOS/Safari` | `safari` | **null** `[executed]` |
| `/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal` | `terminal` | **null** `[executed]` |
| `/Applications/1Password.app/Contents/MacOS/1Password` | `1password` | `win.1password` (path-present only) `[executed]` |

**Probe `[executed]`:**

| Path | Result |
|------|--------|
| `apps.set_coordinate_allowed` + mac Chrome **bundleId-only** | `apps.updated`, `coordinateAllowed: true`, persisted in config |
| same + mac Safari bundleId-only | persisted |
| same + mac Chrome **with** `/Applications/Google Chrome.app/.../Google Chrome` | **still persisted** (basename not vault-mapped) |
| same + Windows `chrome.exe` | `COORDINATE_STRUCTURAL_DENY` (existing test + probe) |
| `normalizeAppEntry({ bundleId: "com.google.Chrome", coordinateAllowed: true })` | **keeps `true`** (only clears when `exe.path` is vault/LOLBIN — `types.ts:295–304`) |
| `sanitizeAppEntries` (config load) | **keeps `true`** |

`replaceAppsEntries` writes the map as-is (`config.ts:915–935`) — no second `canEverCoordinate` belt.

Side Panel `AppsPanel.tsx:84–91,587–601` offers “允许坐标操作” on **every** entry and relies on companion `COORDINATE_STRUCTURAL_DENY`. On macOS Chrome/Safari the toggle **succeeds after biometric** and the card shows the “坐标” badge (`:515–518`). `[inspected]` UI + `[executed]` handler.

This PR **did not touch** `handlers.ts` / `normalizeAppEntry`. Tests only cover Windows `chrome.exe`. Safari (macOS-only) is in the product lock and is the shape that fails.

**Does persist skip L2 today?** No — `assertCoordinateAllowed` still STRUCTURAL-denies without one-shot (`canEverCoordinate` false via bundleId), and one-shot ignores the bit then wipes skip. Persist is still a **persistent grant bit** that ADR-021 unattended is specified to skip L2 for (`unattended-grant.ts:350–372` requires `coordinateAllowed === true`). Combined with the hardcoded `coordinateAllowed: true` after one-shot assert, this is one omitted wipe away from silent Chrome inject.

**Verdict Q2:** **BLOCKER.** DoD 2 / claimed “`apps.set_coordinate_allowed` still STRUCTURAL on Chrome” is false for the actual Chrome/Safari AppEntry.

---

### 3. One-shot flag smuggled for powershell / 1Password / Terminal?

**No.** `allowVaultBrowserOneShot` is **not** a tool param. Both call sites hardcode `true` (`l2-admission.ts:500`, `executor.ts:454`). The bypass is `opts?.allowVaultBrowserOneShot === true && isVaultBrowserEntry(entry)` (`policy.ts:174–176`). `[inspected]`

`isVaultBrowserEntry` is only `MAC_BROWSER_VAULT_BUNDLE_IDS` or Windows `basenameToVault ∈ WIN_BROWSER_VAULT_TOKENS`. `[inspected]`

**Probe `[executed]`** with `{ allowVaultBrowserOneShot: true }`:

| Entry | Result |
|-------|--------|
| mac Chrome `com.google.Chrome` | ALLOWED (one-shot) |
| mac 1Password `com.1password.1password` | `APP_COORDINATE_STRUCTURAL` |
| mac Terminal `com.apple.Terminal` | `APP_COORDINATE_STRUCTURAL` |
| Windows `powershell.exe` | `APP_COORDINATE_STRUCTURAL` |

`canEverCoordinate` remains false for those vault IDs (`MAC_VAULT_BUNDLE_IDS` still includes browsers **and** password-managers / terminals / wallets). `[executed]` policy tests + probe.

**Nit:** no unit test named for 1Password / Terminal (only powershell + Chrome). Logic holds.

**Verdict Q3:** cannot smuggle.

---

### 4. hwnd path swap Chrome → lolbin still denied?

**Yes.** `assertHwndOwnedByEntry` still requires `normalizeExePath(info.exePath) === normalizeExePath(entryPath)` **before** the vault-browser hwnd exception (`policy.ts:222–227`). Chrome entry + powershell hwnd → `HWND_NOT_OWNED`. Same for `1Password.exe`. `[executed]`

The new exception is conjunctive (`policy.ts:241–244`):

```text
allowVaultBrowserOneShot && isVaultBrowserEntry(entry) && isBrowserVaultExePath(info.exePath)
```

A lolbin hwnd is never `isBrowserVaultExePath`. Lolbin throw is **unconditional** (`:233–239`) before the browser carve-out. `[inspected]`

macOS bundleId entries skip the Windows vault recheck (`isMacEntry`); ownership is still `info.exePath` vs `entry.bundleId`. A Terminal window cannot satisfy a Chrome bundleId bind. `[inspected]` (darwin enumerator contract is pre-existing; not re-proven here.)

**Nit:** no computer-policy test “chrome one-shot + powershell hwnd”. Probe covers it.

**Verdict Q4:** denied (`HWND_NOT_OWNED`).

---

### 5. Worker / tab-lease `HOST_CHROME` still blocked?

**Workers: yes. Tab-lease Chrome heuristic: still the old substring; Safari/Edge not covered.**

- `WORKER_HARD_DENY` includes `host_computer` (`orchestrator/constants.ts:16–20`). `[executed]`
- Spawn strips HARD_DENY (`spawn.ts:46–48, 98–103`). `[inspected]`
- Runtime re-enforce in `ThreadManager.isToolAllowed` for `agent_role === "worker"` (`thread-manager.ts:1011–1015`), with fail-closed fallback listing `host_computer` (`:1018–1026`). `[inspected]`
- Pregate `HOST_CHROME_TAB_LEASE` unchanged (`tool-pregate.ts:224–241`): `JSON.stringify(finalParams).toLowerCase()` must contain `chrome` / `chromium` / `google chrome` / `com.google.chrome`. Existing test uses `app: "Google Chrome"`. `[inspected]`

This PR does not weaken worker deny. Orchestrator (not a worker) may still call `host_computer` while leases are held if the token/task JSON **lacks** those substrings — e.g. `mac.app.safari`, `win.app.edge`, or a localized slug. Pre-existing heuristic; **now that Safari/Edge one-shot CU is real**, CDP-vs-pixel races on non-Chrome vault browsers are in product scope. Not a worker escape.

**Verdict Q5:** workers cannot call `host_computer`. HOST_CHROME still blocks chrome-hinted orchestrator calls. Residual: substring, not `isVaultBrowserEntry`.

---

### 6. New confirm dialect vs reuse of `host_computer` L2 — Trust monotonic?

**Reuse, not a new family.** Same `securityConfirmations.request` / tray race / `originWs` / `criticalApis: ["computer.coordinate_injection"]`. Extra preview line only (`l2-admission.ts:693–697`). `[inspected]`

Trust monotonicity on **skip**: Chrome is **stricter** than generic `host_computer` (cruise cannot waive; G1/unattended wiped). Deeper browser-pixel surface does not inherit looser Notepad unattended skip. That part is correct.

Trust monotonicity on **persistent capability**: failed (Attack 2). A Surface-L2 one-shot must not leave an Apps-layer persistent bit that unattended is specified to treat as skip-eligible.

**Dialect nit:** Chrome L2 still sets `relevantApps: [app token]` (`:1299–1300`) so the panel offers “本会话自动同意同类操作”. On approve, `trust.grant(..., { explicitOptIn })` still runs (`:1447–1461`) including for vault browsers. Next Chrome task: G1 would set skip, then wipe. Checkbox is a **lie** (user thinks session auto-approve stuck; product says it must never skip). Not a skip today; it is a future “fix the checkbox” landmine.

**Audit nit:** `security.critical_api_waived` still logs `reason: "full_autonomy_cruise"` for `hostComputerGated && userFullAutonomy` (`:894–901`) even when `vaultBrowserOneShot` forced the dialog. Log ≠ gate.

**WAVE-1 / Rule 12:** source lock now `NEVER default to host_computer for browser-DOM` + `ALWAYS pops a confirm` (`adapter.ts:440,449,463`; `web-act-loop-wave1.test.ts`). Still CDP-first; Chrome CU only after freeze/volume cap or explicit 模拟点击. `[executed]`

**Catalog drift (nit):** `tool-definitions-catalog.json` `host_computer` still describes `coordinateAllowed=true` as required. Prompt and ADR-017 were updated; tool schema text was not.

---

## Findings

| ID | Sev | File:line | Claim |
|----|-----|-----------|--------|
| **T-01** | **P1 blocker** | `apps/handlers.ts:448–456` · `apps/types.ts:295–304` · `apps/add-flow.ts:173–182` | macOS Chrome/Safari (bundleId-only **and** typical Chrome.app path) **persist** `coordinateAllowed=true` via `apps.set_coordinate_allowed` + biometric; `normalizeAppEntry` / `sanitizeAppEntries` do **not** force-clear. DoD 2 / claimed STRUCTURAL deny is Windows-`chrome.exe` only. `[executed]` |
| T-02 | P2 / latent | `l2-admission.ts:591–597,651–657,679–684` | Unattended skip **lies** `coordinateAllowed: true` after one-shot assert; wipe is the only reason Chrome does not inherit ADR-021 skip. Untested at `runL2ToolAdmission`. Combined with T-01, deleting the wipe is silent Chrome inject under 值守. `[inspected]` |
| T-03 | nit | `l2-admission.ts:1296–1303,1447–1461` | G1 “本会话自动同意” still offered and recorded for vault-browser L2. `[inspected]` |
| T-04 | nit | `l2-admission.ts:894–901` | `critical_api_waived` log still fires under cruise for Chrome CU. `[inspected]` |
| T-05 | nit | `orchestrator/tool-pregate.ts:224–241` | HOST_CHROME is a JSON substring; Safari/Edge/Brave tokens do not match. Workers still HARD_DENY. `[inspected]` + HARD_DENY `[executed]` |
| T-06 | nit | tests | No 1Password/Terminal one-shot test; no chrome-hwnd→powershell test; no handler test for `bundleId: com.google.Chrome`. Probe covers behavior. `[executed]` |

Confirmed-safe (this diff, not the persist hole):

- powershell / 1Password / Terminal cannot use the one-shot flag. `[executed]`
- hwnd Chrome → powershell / 1Password → `HWND_NOT_OWNED`. `[executed]`
- `resolveL2ForceConfirm` never waives vault-browser + `hostComputerGated` under cruise. `[executed]`
- Workers cannot obtain `host_computer`. `[executed]` + `[inspected]`
- `originWs` still bound. `[inspected]`
- WAVE-1 does not default DOM to CU. `[executed]`
- No new L2-class / confirm family / Pack-first violation. `[inspected]`

P1 watchlist (2026-07-29): P1-1 god-mode — Chrome CU not skipped by 1–3 flags given wipe+forceConfirm `[inspected]`; P1-2 originWs — no regression `[inspected]`; P1-3 evaluate / P1-4 shell — untouched.

---

## Must-fix before MERGE (do not waive)

| ID | Fix |
|----|-----|
| **M1** | `apps.set_coordinate_allowed(true)` must deny when `!canEverCoordinate(entry)` (bundleId **or** exe), not `entry.exe?.path && basenameToVault`. Cover `com.google.Chrome` / `com.apple.Safari` **without** exe.path, and Chrome.app path `.../Google Chrome`. |
| **M2** | `normalizeAppEntry` / `sanitizeAppEntries` must force-clear `coordinateAllowed` (and UIA hints) via `canEverCoordinate`, so hand-edited mac Chrome/Safari bits die on load. Loud log stays. |
| **M3** | Tests: handler + normalize for mac Chrome/Safari bundle; keep Windows chrome.exe. Optional but cheap: 1Password/Terminal one-shot STRUCTURAL; hwnd Chrome→powershell under one-shot. |

M1+M2 are the DoD 2 belt the implementer claimed already existed. Without them the Apps “坐标” badge is a real persistent grant on the only platform that ships Safari.

Recommended (non-blocking if M1–M2 land): pass `entry.coordinateAllowed === true` into unattended skip **instead of hardcoded true**, and/or skip the unattended/G1 attempt entirely when `isVaultBrowserEntry`; drop `relevantApps` (G1 checkbox) for vault-browser L2; do not log `critical_api_waived` when `vaultBrowserOneShot`; HOST_CHROME via `isVaultBrowserEntry` on the resolved AppEntry.

---

## Residual (named, after must-fix)

- Unattended/G1 **set-then-clear** remains a footgun unless the attempt is skipped for vault browsers.
- HOST_CHROME substring vs Edge/Brave/Safari CDP-vs-pixel race (ADR-015 Q4 named Chrome; product now includes other vault browsers).
- Tool catalog still says `coordinateAllowed=true` is required.
- Darwin hwnd `exePath` vs bundleId contract is pre-existing, not re-proven on a live enumerator in this review.

---

## DoD scorecard

| # | Requirement | Result |
|---|-------------|--------|
| 1 | Chrome `host_computer` no longer STRUCTURAL before L2 when `allowVaultBrowserOneShot` | **PASS** `[executed]` |
| 2 | Chrome `coordinateAllowed` cannot be persisted (`set_coordinate_allowed` still deny) | **FAIL** macOS `[executed]` |
| 3 | Unattended + 三旗 + G1 cannot skip initial L2 or mid-task re-L2 | **PASS** algebra `[inspected]` / forceConfirm `[executed]`; wipe untested at integration |
| 4 | powershell / 1Password / Terminal still STRUCTURAL with one-shot flag | **PASS** `[executed]` |
| 5 | hwnd swap Chrome → LOLBIN/password-manager still STRUCTURAL/owned-deny | **PASS** `[executed]` (`HWND_NOT_OWNED`) |
| 6 | WAVE-1 still does not *default* `host_computer` for DOM | **PASS** `[executed]` |

---

VERDICT: REJECT
