# Independent adversary — Chrome CU one-shot nits R2 (Trust / platform-native identity)

> **Lane**: Security / Trust (ADR-020)
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-22
> **Worktree**: `/tmp/cmspark-chrome-cu`
> **Branch**: `feat/chrome-cu-oneshot-l2` HEAD `ec65d92` (`fix(computer): platform-native vault identity (Trust nits REJECT)`)
> **Prior REJECT**: `docs/audit/reviews/chrome-cu-oneshot-nits-adversary-trust-20260822.md` at `f4a743e` (T-N1 darwin win-path shape un-vaulted Chrome)
> **Diff**: `docs/audit/reviews/chrome-cu-oneshot-nits-r2-diff-20260822.patch`

```text
Surface:      L2 host_computer (vault-browser one-shot)
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        forceConfirm L2; NEVER skipped by unattended / cruise / G1;
              does NOT persist Apps coordinateAllowed; LOLBIN/PM/terminal/wallet STRUCTURAL
Channel:      community
```

This re-attack is **only** whether R2 closed T-N1 without re-opening notepad one-shot smuggle or stock persist. Skip-algebra / G1 checkbox / waived-log / hwnd powershell were already closed at `f4a743e` and are not re-litigated except where identity would poison them.

---

## MACHINE

Commands (cwd `companion/`) `[executed]`:

```text
npx tsx --test tests/computer-policy.test.ts     # 46 pass / 0 fail
npx tsx --test tests/apps-coordinate.test.ts     # 28 pass / 0 fail
```

Throwaway probes (`/tmp/cmspark-cu-r2-probe.mts` + matching-key sanitize one-liner). DATA_DIR pinned to a temp dir. **No worktree mutation.** Host `os.platform() === "darwin"`. Production classifiers were called **without** a stubbed platform (default `os.platform()`), plus explicit `"darwin"` / `"win32"` where the must-falsify names a platform.

| Probe | Result |
|-------|--------|
| Chrome `bundleId` + `dummy.exe` (default darwin) | `canEverCoordinate=false`, `isVaultBrowserEntry=true` |
| Chrome + `C:\Windows\System32\notepad.exe` (default darwin) | same |
| Chrome + `C:\Applications\Google Chrome` (default darwin) | same |
| `normalizeAppEntry` / `sanitizeAppEntries` (key === token) hybrid + bit true | **force-clears** `coordinateAllowed` |
| `assertCoordinateAllowed` no flag | `APP_COORDINATE_STRUCTURAL` |
| `assertCoordinateAllowed` + one-shot | admits (L2 path; persist still false) |
| `apps.set_coordinate_allowed(true)` hybrid dummy.exe | `COORDINATE_STRUCTURAL_DENY`, **gateCalls=0**, not persisted |
| same + notepad path | `COORDINATE_STRUCTURAL_DENY`, gate=0 |
| darwin hwnd hybrid vs `exePath: "com.google.Chrome"` + one-shot | OWNED (pixel surface is one-shot, not persist) |
| `isVaultBrowserEntry(notepad+Chrome bundleId, "win32")` | **false** |
| `canEverCoordinate(..., "win32")` notepad hybrid | **true** (native notepad, not browser) |
| stock `chrome.exe` / `chromium.exe` persist both platforms | `canEverCoordinate=false` |
| Canary / lowercase canary persist on darwin | `canEverCoordinate=false` |
| handler `chrome.exe` | `COORDINATE_STRUCTURAL_DENY`, gate=0 |

First sanitize probe used map key `"t"` ≠ `entry.token` — `sanitizeAppEntries` **disabled** the entry and skipped `normalizeAppEntry`. Re-run with matching key: bit cleared. Not a hole. `[executed]`

---

## Must-falsify

### 1. On darwin, Chrome bundleId + dummy.exe / notepad.exe still `canEverCoordinate===true` or persist?

**Could not falsify. T-N1 is closed on the production darwin path.** `[executed]`

R2 replaced path-shape identity (`looksLikeWinExePath` short-circuit) with **platform-native** identity (`policy.ts:112–171`):

- `win32` → exe path only (bundleId ignored)
- **not** win32 (darwin / others) → **bundleId wins when present**, then exe basename

```112:171:companion/src/computer/policy.ts
export function isVaultBrowserEntry(entry: AppEntry, platform: string = os.platform()): boolean {
  if (platform === "win32") {
    return entry.exe?.path ? vaultPathIsBrowser(entry.exe.path) : false
  }
  if (bundleIdInSet(entry.bundleId, MAC_BROWSER_VAULT_BUNDLE_IDS)) return true
  return entry.exe?.path ? vaultPathIsBrowser(entry.exe.path) : false
}

export function canEverCoordinate(entry: AppEntry, platform: string = os.platform()): boolean {
  if (platform === "win32") {
    // Exe path is the identity — ignore a pasted mac bundleId.
    ...
    return true
  }
  if (bundleIdInSet(entry.bundleId, MAC_VAULT_BUNDLE_IDS)) {
    return false
  }
  ...
}
```

Production callers do **not** pass `platform` (`handlers.ts:451`, `types.ts:303`, `l2-admission.ts:519`, `executor.ts:455`, `assertCoordinateAllowed` `:219–220`). They use `os.platform()`. On this Mac that is `"darwin"`. A dummy / `C:\...` path **cannot** skip the Chrome bundleId check.

Handler belt: `canEverCoordinate(entry)` false → `COORDINATE_STRUCTURAL_DENY` **before** biometric (`handlers.ts:449–456`). Probe: `gateCalls=0`. `[executed]`

Load belt: `normalizeAppEntry` → `canEverCoordinate` → force-clear. Matching-key `sanitizeAppEntries` keeps `enabled: true` and `coordinateAllowed: false`. `[executed]`

One-shot still admits (`allowVaultBrowserOneShot`); hwnd on darwin still binds `bundleId` (`policy.ts` darwin `entryPath`, `darwin-adapters.ts:264`). That is the **intended** one-shot L2 surface, not persist. Unattended/G1 skip remains keyed off `isVaultBrowserEntry` → `vaultBrowserOneShot=true` → algebra closed (prior fold). `[inspected]` + identity `[executed]`

**Verdict Q1:** persist denied. Prior REJECT does not still hold.

---

### 2. On win32, notepad.exe + pasted `com.google.Chrome` still one-shot (`isVaultBrowserEntry(..., "win32")===true`)?

**Could not falsify.** `[executed]`

| Call | Result |
|------|--------|
| `isVaultBrowserEntry(tampered, "win32")` | **false** |
| `canEverCoordinate(tampered, "win32")` | **true** (notepad may persist as a native app) |

Win32 branch never reads bundleId. One-shot requires `isVaultBrowserEntry`. Notepad stays `APP_COORDINATE_DENIED` unless `coordinateAllowed` is set on **notepad**. Hwnd on win32 uses `entry.exe.path` — Chrome windows would be `HWND_NOT_OWNED`. `[inspected]` `policy.ts:113–115,145–155` and hwnd `entryPath` win32 arm.

On **this darwin host**, the same entry **without** a platform stub is a Chrome one-shot (`isVault=true`, persist denied). That is darwin-native identity, not a win32 smuggle.

**Verdict Q2:** notepad cannot take the browser one-shot on win32.

---

### 3. Stock `chrome.exe` / Canary / `chromium.exe` still persistable?

**Could not falsify for the named stock binaries / darwin Canary.** `[executed]`

| Identity | darwin `canEver` / `isVault` | win32 `canEver` / `isVault` |
|----------|------------------------------|-----------------------------|
| `chrome.exe` | false / true | false / true |
| `chromium.exe` (`guards.ts` `chromium` → `win.chrome`) | false / true | false / true |
| `com.google.Chrome.canary` | false / true | true / false *(no exe path — see nits)* |
| `com.google.chrome.canary` | false / true | true / false *(same)* |
| mac `com.google.Chrome` bundleId-only | false / true | true / false *(same)* |

Handler `chrome.exe` on this host: `COORDINATE_STRUCTURAL_DENY`, gate=0. `[executed]`

Windows Canary/Dev still ship as `chrome.exe` (basename already vault-mapped). Mac Canary is the bundleId path — persist denied on darwin.

**Verdict Q3:** named stock persist closed. Win32 **bundleId-only** browsers are not a live hwnd inject (nit below).

---

## Findings

| ID | Sev | File:line | Claim |
|----|-----|-----------|--------|
| T-R2-1 | nit | `handlers.ts:451` · `types.ts:303` · tests | `canEverCoordinate(entry)` always uses **host** `os.platform()`, not `deps.platform`. Correct in production. The new handler test (`apps-coordinate.test.ts` hybrid + `deps.platform: "darwin"`) does **not** stub policy OS — it only passes on darwin (or would **allow** persist on a win32 CI host for a mac Chrome+dummy.exe entry, hwnd-bound to dummy.exe). Pin `canEverCoordinate(hybrid)` / `canEverCoordinate(hybrid, "darwin")` in unit tests already; handler test is host-sensitive. `[executed]` on darwin; `[assumed]` fail on win32 CI |
| T-R2-2 | nit | `policy.ts:145–155,113–115` | Win32 entry with Chrome/Canary **bundleId and no `exe.path`**: `canEverCoordinate===true`, `isVaultBrowserEntry===false`. Bit can persist; hwnd has empty `entry.exe.path` → `HWND_NOT_OWNED`. Add-flow on win32 does not emit bundleId-only GUI entries. Config-tamper only; fail-closed at hwnd. `[executed]` classifiers |
| T-R2-3 | nit | `policy.ts:92–95` | `looksLikeWinExePath` is unused by classifiers after R2 (tests still import it). Dead helper, not a skip. `[inspected]` |

No new skip/persist inject path vs `f4a743e` T-N1. Stock one-shot still cannot be skipped by unattended/G1/三旗 unless identity is poisoned — identity is no longer poisoned on darwin hybrid. `[inspected]` prior belts + `[executed]` identity.

Confirmed-safe this R2:

- darwin Chrome + dummy.exe / notepad path / `C:\...` cannot persist `[executed]`
- handler deny precedes biometric `[executed]`
- sanitize/normalize clear hybrid bit `[executed]`
- win32 notepad + pasted bundleId is not a vault-browser one-shot `[executed]`
- `chrome.exe` / `chromium.exe` persist denied both platforms `[executed]`
- Canary bundle persist denied on darwin `[executed]`
- powershell hwnd / one-shot LOLBIN tests still green (suite) `[executed]`

---

## Must-fix before MERGE

None for T-N1 / the three must-falsify items.

Optional (non-blocking):

- Handler hybrid test: assert `canEverCoordinate(entry, "darwin")` (already in `computer-policy`) or skip on `win32` host; do not pretend `deps.platform` feeds policy.
- Win32: if bundleId ∈ mac vault **and** no exe path, fail-closed persist (`canEverCoordinate false`) — defense in depth for hand-edits; hwnd already dead.
- Drop or stop exporting `looksLikeWinExePath` if unused.

---

## DoD scorecard

| # | Requirement | Result |
|---|-------------|--------|
| 1 | darwin Chrome + dummy.exe / notepad.exe cannot persist (`canEverCoordinate===false`, handler STRUCTURAL) | **PASS** `[executed]` |
| 2 | win32 notepad + pasted `com.google.Chrome` is not one-shot | **PASS** `[executed]` |
| 3 | stock `chrome.exe` / Canary / `chromium.exe` not persistable (named shapes) | **PASS** `[executed]` |
| 4 | No new skip/persist inject from R2 identity | **PASS** on production `os.platform()` `[executed]` / `[inspected]` |

---

VERDICT: APPROVE_WITH_NITS
