# Independent adversary — Chrome CU one-shot residual nits fold (Trust / ADR-020)

> **Lane**: Security / Trust (ADR-020)
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-22
> **Worktree**: `/tmp/cmspark-chrome-cu`
> **Branch**: `feat/chrome-cu-oneshot-l2` HEAD `f4a743e` (`fix(computer): fold Chrome CU one-shot residual nits`)
> **Nits fold**: `9a2a0f3..f4a743e`
> **Feature vs**: `origin/main` (`56a5973`)
> **Diff**: `docs/audit/reviews/chrome-cu-oneshot-nits-diff-20260822.patch`
> **Prior Trust REJECT (folded at `204429e`)**: `docs/audit/reviews/chrome-cu-oneshot-adversary-trust-20260822.md`
> **Prior dual residual list**: `docs/audit/reviews/chrome-cu-oneshot-claude-20260822.md`

```text
Surface:      L2 host_computer (vault-browser one-shot)
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        forceConfirm L2; NEVER skipped by unattended / cruise / G1;
              does NOT persist Apps coordinateAllowed; LOLBIN/PM/terminal/wallet STRUCTURAL
Channel:      community
```

Capability declaration: **present** in the spawn prompt. Axes fit: Surface L2 `host_computer`, Compose none, Autonomy single. This fold is supposed to close named residuals, not open a new persist/skip path.

---

## MACHINE

Commands (cwd `companion/`) `[executed]`:

```text
npx tsx --test tests/computer-policy.test.ts     # 45 pass / 0 fail
npx tsx --test tests/l2-admission-pure.test.ts   # 10 pass / 0 fail
npx tsx --test tests/apps-coordinate.test.ts     # 27 pass / 0 fail
# extra (not required, run anyway)
npx tsx --test tests/apps-guards.test.ts \
               tests/orchestrator-tool-pregate.test.ts \
               tests/web-act-loop-wave1.test.ts  # 52 pass / 0 fail
```

Specified trio: **82 pass / 0 fail**. Suite is green and does **not** cover the win-path identity hole below.

Independent probes (throwaway `/tmp/cmspark-cu-trust-probe.mts` + `/tmp/cmspark-cu-handler-probe.mts`, DATA_DIR pinned to a temp dir, **no worktree mutation**) `[executed]` on **darwin**:

| Probe | Result |
|-------|--------|
| stock mac Chrome / Safari / Canary / lowercase canary / Chrome.dev / `org.chromium.Chromium` | `canEverCoordinate=false`, `isVaultBrowserEntry=true`, one-shot admits, no-flag `APP_COORDINATE_STRUCTURAL` |
| win `chrome.exe` / `chromium.exe` | same |
| notepad.exe + pasted `com.google.Chrome` | `isVaultBrowser=false`, one-shot `APP_COORDINATE_DENIED` (not a browser smuggle) |
| **mac Chrome bundleId + `dummy.exe` / `C:\...\notepad.exe` / `C:\Applications\Google Chrome` / `TextEdit.exe`** | **`canEverCoordinate=true`, `isVaultBrowser=false`, `normalizeAppEntry` keeps `coordinateAllowed:true`** |
| `apps.set_coordinate_allowed(true)` on hybrid Chrome+`dummy.exe` | **`apps.updated`, bit persisted, biometric gate invoked (1 call)** |
| same handler on stock bundleId-only Chrome | `COORDINATE_STRUCTURAL_DENY`, gate **not** invoked |
| `sanitizeAppEntries` on hybrid with bit true | **keeps the bit** |
| darwin hwnd: hybrid entry vs `exePath: "com.google.Chrome"` | **`assertHwndOwnedByEntry` allows** (bundleId bind ignores fake win path) |
| hwnd Chrome entry + powershell hwnd + one-shot | `HWND_NOT_OWNED` |
| powershell / 1Password / Terminal + one-shot | `APP_COORDINATE_STRUCTURAL` |
| skip-algebra helper / relevantApps / `resolveL2ForceConfirm` | stock one-shot: algebra closed, `relevantApps=[]`, cruise cannot waive |

---

## Attack results (must-falsify)

### 1. Can unattended / 三旗 / G1 still skip vault-browser initial L2 or mid-task re-L2?

**Not on a stock vault-browser entry.** Skip algebra is not entered; cruise cannot waive `forceConfirm`; re-L2 carries `!vaultBrowserOneShot`.

**Initial L2** (`companion/src/tool/l2-admission.ts`) `[inspected]` + helpers `[executed]`:

1. `assertCoordinateAllowed(..., { allowVaultBrowserOneShot: true })` then `vaultBrowserOneShot = isVaultBrowserEntry(entryC)` (`:516–519`).
2. G1 / unattended branches gated by `hostComputerTrustSkipAlgebraOpen(vaultBrowserOneShot)` (`:548`, `:656`). Helper is `return vaultBrowserOneShot !== true` (`:126–128`). `[executed]`
3. All three `hostComputerTrustSkip = true` sites (`:592`, `:622`, `:677`) live inside those guards. `[inspected]`
4. Belt wipe retained (`:696–700`) — dead for stock browsers because skip was never set; still useful if a future branch re-opens.
5. `resolveL2ForceConfirm({ vaultBrowserOneShot: true, hostComputerGated: true, userFullAutonomy: true }) === true` `[executed]`.
6. Dialog gate `(!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip` (`:976`). `skipConfirmation` still includes `auto_approve_dangerous` / `allow_all_schemes` (`:817–819`); `forceConfirm` holds it closed for one-shot. `enterpriseSkip` is shell/netsec only.
7. `autoConfirmEligible: false` when `forceConfirm` (`:1320`). `[inspected]`
8. `originWs: ws` still bound for non-outbound (`:1285–1293`). `[inspected]`

**Mid-task re-L2** (`companion/src/computer/executor.ts`) `[inspected]`:

- Unattended silent-pass: `isUnattendedArmed() && !vaultBrowserOneShot` (`:656`)
- 三旗 cruise: `!vaultBrowserOneShot` (`:678`)
- G1 session-trust: `!vaultBrowserOneShot` (`:703`)

**Caveat:** this belt is keyed off `isVaultBrowserEntry`. If a Chrome AppEntry is **mis-classified** as a native app (Attack 2), skip algebra **is** entered, the wipe does **not** fire, and unattended / G1 / cruise behave like Notepad. That is the live hole.

**Verdict Q1:** stock one-shot cannot be skipped. Residual is classification, not the wipe.

---

### 2. Does `canEverCoordinate` win-path identity let Chrome persist the bit, OR let notepad+fake bundleId one-shot inject?

**Yes on persist (darwin). No on notepad one-shot smuggle.**

The fold added `looksLikeWinExePath` and made a Windows-looking `exe.path` the **first** identity for both `canEverCoordinate` and `isVaultBrowserEntry` (`policy.ts:92–108`, `:145–156`). Comment says this is so notepad + pasted `com.google.Chrome` is not a browser.

**Notepad + fake bundleId (claimed nit 9) — closed** `[executed]`:

| Check | Result |
|-------|--------|
| `looksLikeWinExePath(notepad.exe)` | true |
| `isVaultBrowserEntry` | false |
| `assertCoordinateAllowed` + one-shot | `APP_COORDINATE_DENIED` (needs persist bit as notepad, not one-shot) |

On win32, hwnd bind uses `entry.exe.path` (`policy.ts:260–262`), so even a confused entry injects notepad, not Chrome.

**Chrome persist via the same identity — OPEN on darwin** `[executed]`.

Win-path branch **returns true without ever reading `bundleId`**:

```145:156:companion/src/computer/policy.ts
export function canEverCoordinate(entry: AppEntry): boolean {
  if (entry.exe?.path && looksLikeWinExePath(entry.exe.path)) {
    if (isLolbinPath(entry.exe.path)) return false
    try {
      if (basenameToVault(entry.exe.path) !== null) return false
    } catch {
      return false
    }
    return true
  }
```

`looksLikeWinExePath` is a **string shape** (`/\.exe$/i` **or** `^[a-zA-Z]:[\\/]`), not `os.platform()==='win32'`, and does not require the file to exist (`policy.ts:92–95`).

`isVaultBrowserEntry` uses the same short-circuit (`:101–108`): a non-vault win-looking path → **not a browser**, even when `bundleId` is `com.google.Chrome`.

Meanwhile hwnd / enumerate on darwin **still prefer bundleId** and ignore the fake path:

```260:262:companion/src/computer/policy.ts
  const entryPath = os.platform() === "darwin"
    ? (entry.bundleId ?? entry.exe?.path ?? "")
    : (entry.exe?.path ?? "")
```

```264:264:companion/src/computer/darwin-adapters.ts
      exePath: w.bundleId ?? exePath,    // macOS ownership anchor = bundle ID
```

**Probe on this darwin host `[executed]`:**

| Entry | `canEverCoordinate` | `isVaultBrowser` | `normalizeAppEntry` bit | handler `set_coordinate_allowed(true)` | hwnd vs Chrome window |
|-------|---------------------|------------------|-------------------------|----------------------------------------|------------------------|
| stock mac Chrome (bundleId only) | false | true | cleared | `COORDINATE_STRUCTURAL_DENY`, gate=0 | n/a (one-shot) |
| Chrome + `exe.path: "dummy.exe"` | **true** | **false** | **kept true** | **`apps.updated`, bit persisted, gate=1** | **OWNED** |
| Chrome + `C:\Windows\System32\notepad.exe` | **true** | **false** | **kept true** | (same algebra) | **OWNED** |
| Chrome + `C:\Applications\Google Chrome` | **true** | **false** | **kept true** | | **OWNED** |

`sanitizeAppEntries` / `normalizeAppEntry` (`types.ts:295–314`) call `canEverCoordinate` — they **cannot** save this, because the identity function already lied. `replaceAppsEntries` writes the map as-is (`config.ts:915–935`); no second belt.

**Skip consequence `[inspected]`:** hybrid is **not** `vaultBrowserOneShot`. Then:

- `hostComputerTrustSkipAlgebraOpen(false) === true` → G1 / unattended **run**
- unattended still hardcodes `coordinateAllowed: true` (`l2-admission.ts:613–614`, `:668–669`)
- wipe at `:696` does **not** run
- `resolveL2ForceConfirm` can waive under 三旗 (`vaultBrowserOneShot` false)
- dialog gate `:976` skips when `hostComputerTrustSkip`
- executor re-L2 unattended / cruise / G1 all see `!vaultBrowserOneShot`

End state on macOS (the platform that ships Safari): **plant a Windows-looking non-vault `exe.path` on a Chrome/Safari bundleId entry → persist `coordinateAllowed` → unattended/G1/三旗 silent pixel inject into the real Chrome window.** Planting is config tamper (add-flow on darwin is still bundleId-only, `add-flow.ts:173–182`), which is **in-scope for A10.3** — that is why `normalizeAppEntry` exists, and why the prior Trust REJECT treated hand-edited mac Chrome bits as P1.

This hole **did not exist** before the nits fold: bundleId was checked first, so a dummy path could not un-vault Chrome.

**Verdict Q2:** **BLOCKER.** DoD 6 ("especially `canEverCoordinate` win-path identity") **FAIL**. Notepad one-shot smuggle is closed; Chrome persist is re-opened on darwin.

---

### 3. Canary / lowercase / `chromium.exe` still `canEverCoordinate===true`?

**No for the named stock identities.** `[executed]`

| Identity | `canEverCoordinate` | `isVaultBrowserEntry` |
|----------|---------------------|------------------------|
| `com.google.Chrome.canary` | false | true |
| `com.google.chrome.canary` (lowercase) | false | true (`bundleIdInSet`) |
| `com.google.Chrome.dev` | false | true |
| `org.chromium.Chromium` | false | true |
| `chromium.exe` → `basenameToVault` `win.chrome` (`guards.ts:60`) | false | true |

Windows Canary/Dev still ship as `chrome.exe` (basename already vault-mapped). Silent inject on these stock shapes still requires the hybrid tamper in Attack 2, not a catalog miss.

**Verdict Q3:** named residual closed.

---

### 4. Skip algebra still set-then-wipe instead of never entered?

**No on stock one-shot.** `[executed]` helper + `[inspected]` call sites.

- `hostComputerTrustSkipAlgebraOpen(true) === false` — G1 (`:548`) and no-session unattended (`:656`) **not entered**.
- Wipe at `:696–700` is belt, not the primary control. Comment even says "Do not compute skip then wipe".
- `hostComputerTrustSkip = true` has exactly three sites, all inside the helper.

**Unless classification fails** (Attack 2), in which case algebra **is** entered and there is nothing to wipe.

**Verdict Q4:** stock claim holds. Not a leftover T-02 on the intended path.

---

### 5. `relevantApps` still offers G1 checkbox for vault-browser L2?

**No on stock one-shot.** `[executed]` + `[inspected]` UI.

- `hostComputerConfirmRelevantApps(true, app) === []` (`l2-admission.ts:131–136`, used at `:1314–1315`).
- Cockpit: `relevantApp = request.relevant_apps?.[0]`; checkbox only if `canSessionTrust && relevantApp` (`CockpitApp.tsx:418–420`, `:565–573`). Empty array → no checkbox.
- `respondFrom` only stamps `addToSessionTrust` when `pending.relevantApps.length > 0` (`security-confirmation.ts:455–458`) — WS inject of the flag is stripped.
- `trust.grant` still runs on approve (`l2-admission.ts:1462–1476`) with `explicitOptIn=false`; next-task G1 still **not entered** for a real vault browser. Re-L2 also gated. Inert on stock path.

**Verdict Q5:** checkbox not offered for one-shot. Hybrid (Attack 2) **would** offer it, because `vaultBrowserOneShot` is false.

---

### 6. `critical_api_waived` still logged when `vaultBrowserOneShot` forces L2?

**No on stock one-shot.** `[inspected]`

```909:917:companion/src/tool/l2-admission.ts
    if ((capabilityForceConfirm || hostComputerGated) && userFullAutonomy && !acpForceConfirm && !vaultBrowserOneShot) {
      logger.info("security.critical_api_waived", {
        ...
        reason: "full_autonomy_cruise",
      })
    }
```

Claude residual item 2 is folded for the intended flag. Log still fires for hybrid-as-native (Attack 2) — then it would **match** a real skip, which is worse than a lying log.

**Verdict Q6:** named residual closed on stock path.

---

### 7. hwnd Chrome entry + powershell hwnd allowed under one-shot?

**No.** `[executed]` (`computer-policy` + probe)

`assertHwndOwnedByEntry` compares `normalizeExePath(info.exePath)` vs entry path **before** the browser hwnd carve-out (`policy.ts:267–273`). Chrome exe ≠ powershell exe → `HWND_NOT_OWNED`. Lolbin throw remains unconditional (`:278–284`). Carve-out requires `allowVaultBrowserOneShot && isVaultBrowserEntry(entry) && isBrowserVaultExePath(info.exePath)` (`:285–288`).

**Verdict Q7:** denied.

---

## Claimed nits fold (checklist)

| # | Claim | Result |
|---|-------|--------|
| 1 | Catalog `host_computer` no longer requires persist `coordinateAllowed` | **PASS** `[executed]` WAVE-1 catalog lock + `[inspected]` `tool-definitions-catalog.json` |
| 2 | User-guide checklist no longer says 浏览器 must 允许坐标 | **PASS** `[inspected]` `docs/computer-use-user-guide.md` |
| 3 | Rule 7/8/9c no longer forbid Rule 12 one-shot | **PASS** `[executed]` WAVE-1 source lock |
| 4 | ADR-017 D3 / ADR-021 / GOAL / architecture synced | **PASS** `[inspected]` |
| 5 | Canary / `chromium.exe` vault-mapped | **PASS** `[executed]` |
| 6 | HOST_CHROME matches Safari/Edge/Brave via **params.app only** | **PASS** `[executed]` pregate tests (`hostComputerAppHintsVaultBrowser`) |
| 7 | hwnd Chrome-entry + powershell hwnd = `HWND_NOT_OWNED` | **PASS** `[executed]` |
| 8 | G1/unattended skip algebra **not entered**; relevantApps empty | **PASS** on stock `[executed]`; **FAIL** if identity is poisoned (Q2) |
| 9 | win32 notepad.exe + pasted Chrome bundleId is NOT one-shot | **PASS** `[executed]` |

**New hole from this fold:** item 8/DoD 6 win-path identity (Q2).

WAVE-1 still `NEVER default to host_computer for browser-DOM` + `ALWAYS pops a confirm` (`adapter.ts:440,449,478,488`) `[executed]`.

powershell / 1Password / Terminal still STRUCTURAL with the one-shot flag `[executed]`. Workers `WORKER_HARD_DENY` not re-opened (pregate tests still pass; not re-probed beyond that).

---

## Findings

| ID | Sev | File:line | Claim |
|----|-----|-----------|--------|
| **T-N1** | **P1 blocker** | `computer/policy.ts:92–108,145–156` · `apps/types.ts:295–314` · `apps/handlers.ts:449–456` · hwnd `policy.ts:260–262` · `darwin-adapters.ts:264` | Win-path identity is a **string shape**, applied **before** bundleId, on **darwin**. Chrome/Safari + any non-vault `*.exe` / `C:\...` path → persist `coordinateAllowed`, `isVaultBrowser=false`, hwnd still binds Chrome, unattended/G1/三旗 skip L2. `normalizeAppEntry` / handler / sanitize all follow `canEverCoordinate`. **New in this fold.** `[executed]` |
| T-N2 | latent | `l2-admission.ts:613–614,668–669` | Unattended skip still hardcodes `coordinateAllowed: true` after `assertCoordinateAllowed`. Harmless for stock one-shot (algebra closed); **load-bearing** for T-N1. `[inspected]` |
| T-N3 | nit | tests | No hybrid `bundleId` + win-looking `exe.path` case. 82/0 does not pin DoD 6. `[executed]` |
| T-N4 | nit | `tool-pregate.ts:157–176` | HOST_CHROME needles are still substrings of `params.app` (fail-closed: `not_chrome` matches). Task-text spoof closed. `[executed]` tests |

Named residuals from Claude 20260822 items 1–5, 7 **as stated** are gone on **stock** identities. The fold's identity function re-opens persist/skip on the shipping macOS shape with a one-line config plant.

Confirmed-safe (stock vault browsers, this fold):

- Unattended / 三旗 / G1 cannot skip initial L2 or re-L2 `[inspected]` + forceConfirm/algebra `[executed]`
- Canary / lowercase / `chromium.exe` cannot persist `[executed]`
- notepad + fake Chrome bundleId is not a one-shot `[executed]`
- hwnd Chrome → powershell → `HWND_NOT_OWNED` `[executed]`
- powershell / 1Password / Terminal cannot use the flag `[executed]`
- G1 checkbox not offered; `addToSessionTrust` stripped if `relevantApps=[]` `[executed]` / `[inspected]`
- `critical_api_waived` not logged when `vaultBrowserOneShot` `[inspected]`
- WAVE-1 does not default DOM to CU `[executed]`
- Catalog / ADR-017 D3 / user-guide checklist text updated `[inspected]`

P1 watchlist (2026-07-29): P1-1 god-mode — stock Chrome CU not skipped `[inspected]` + `[executed]` algebra; **broken if T-N1**; P1-2 originWs — no regression `[inspected]`; P1-3 evaluate / P1-4 shell — untouched.

---

## Must-fix before MERGE (do not waive)

| ID | Fix |
|----|-----|
| **M1** | **Platform-native identity, not path-shape identity.** `canEverCoordinate` / `isVaultBrowserEntry`: on darwin (or whenever `bundleId` is present **and** we are not on win32), **bundleId wins**. On win32, exe path wins (keep notepad+pasted bundleId as notepad). A Windows-looking path must **not** un-vault `com.google.Chrome` / Safari / Canary. Fail-closed alternative for persist: if **either** identity is vault/LOLBIN → `canEverCoordinate === false`. |
| **M2** | Tests that would have caught T-N1: darwin/host-agnostic `bundleId: com.google.Chrome` + `exe.path: "dummy.exe"` / `C:\\...\\notepad.exe` → `canEverCoordinate false`, `isVaultBrowser true`, handler `COORDINATE_STRUCTURAL_DENY`, `normalizeAppEntry` clears bit, one-shot still admits. Keep win32 notepad+fake bundleId as **not** one-shot. |
| **M3** | After M1: hybrid hwnd probe must still be Chrome-owned only via **one-shot** (never via persist bit). |

Recommended (non-blocking if M1–M2 land): pass `entry.coordinateAllowed === true` into unattended skip instead of hardcoded `true` (T-N2).

---

## Residual (named, after must-fix)

- Still no `runL2ToolAdmission` integration test with unattended armed + stock Chrome asserting the dialog path (Claude residual 6). Structural lock is real on stock entries; unpinned end-to-end.
- Compact Side Panel `MinimalConfirm` never renders preview (explicitly out of this fold).
- HOST_CHROME substring-of-`app` (fail-closed).
- Darwin enumerator `exePath = bundleId` contract is pre-existing; re-proven here only as the bind that makes T-N1 injectable.

---

## DoD scorecard

| # | Requirement | Result |
|---|-------------|--------|
| 1 | Named residuals (Claude items 1–5, 7: HOST_CHROME / Canary / chromium / notepad tamper) gone in tree | **PASS** on those named shapes `[executed]` / `[inspected]` |
| 2 | Unattended still cannot skip Chrome one-shot L2 | **PASS** stock `[inspected]`+algebra `[executed]`; **FAIL** if T-N1 poisons classification |
| 3 | Persist bit still denied on Canary and chromium.exe | **PASS** `[executed]` |
| 4 | powershell / 1Password still STRUCTURAL with one-shot flag | **PASS** `[executed]` |
| 5 | WAVE-1 still NEVER default `host_computer` for DOM | **PASS** `[executed]` |
| 6 | No new skip/persist hole from the fold (especially `canEverCoordinate` win-path identity) | **FAIL** `[executed]` T-N1 |

---

VERDICT: REJECT
