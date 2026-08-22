# Independent adversary (Runtime / Correctness) — Chrome CU one-shot residual nits fold

**Batch**: `chrome-cu-oneshot-nits-20260822`  
**Role**: independent Runtime / Correctness adversary (did **not** implement)  
**Lane**: Runtime dual-write, HOST_CHROME, tests, hwnd  
**Worktree**: `/tmp/cmspark-chrome-cu` branch `feat/chrome-cu-oneshot-l2` HEAD `f4a743e`  
**Nits fold**: `9a2a0f3..f4a743e` (`f4a743e fix(computer): fold Chrome CU one-shot residual nits`)  
**Feature vs**: `origin/main` `56a5973`  
**Patch**: `docs/audit/reviews/chrome-cu-oneshot-nits-diff-20260822.patch`  
**Prior runtime** (APPROVE_WITH_NITS @ `85cd7a5`): `docs/audit/reviews/chrome-cu-oneshot-adversary-runtime-20260822.md`  
**Second judge residual list**: `docs/audit/reviews/chrome-cu-oneshot-claude-20260822.md`

```text
Surface:      L2 host_computer (vault-browser one-shot)
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        forceConfirm L2; NEVER skipped by unattended / cruise / G1;
              does NOT persist Apps coordinateAllowed; LOLBIN/PM/terminal/wallet STRUCTURAL
Channel:      community
```

This lane tries to **falsify** the nits fold. It is not a rubber stamp.

---

## Machine `[executed]`

Host: Darwin (`uname -s`), Node v24.16.0. `companion/node_modules` present. HEAD `f4a743e`.

| Command | Result |
|---------|--------|
| `./node_modules/.bin/tsc -p tsconfig.test.json --noEmit` | exit 0 |
| `npx tsx --test` `orchestrator-tool-pregate` + `computer-policy` + `l2-admission-pure` + `web-act-loop-wave1` | **73 pass / 0 fail** |
| Private throwaway `npx tsx` probes against live `src/` (stdin; no worktree mutation) | see attacks 1–6 |

Suite claimed in the spawn prompt (197 pass) includes extra files this lane was not asked to re-run. The four named files are green.

---

## Attack 1 — HOST_CHROME still JSON-substring of whole params?

**Claim to falsify**: matcher still scans `JSON.stringify(finalParams)` so task `"click chrome"` / `"knowledge"` trips Edge; Safari/Edge/Brave app tokens are not blocked when tab leases are held; TextEdit is still blocked.

### Production `[inspected]`

`JSON.stringify(finalParams)` is **gone** from `companion/src` (repo-wide grep: no matches). Pregate now:

```253:264:companion/src/orchestrator/tool-pregate.ts
    // host_computer vs any tab lease (Q4): block vault-browser window ops while tabs leased
    if (toolName === "host_computer" && anyHeld()) {
      if (hostComputerAppHintsVaultBrowser(finalParams)) {
        const result = {
          success: false as const,
          error:
            "host_computer blocked on a browser window while tab leases are held — force-release tab leases first (ADR-015 Q4)",
          data: { error_code: "HOST_CHROME_TAB_LEASE" },
        }
```

Helper reads **`params.app` only**:

```83:89:companion/src/orchestrator/tool-pregate.ts
export function hostComputerAppHintsVaultBrowser(params: Record<string, unknown> | null | undefined): boolean {
  const app = String(params?.app ?? "").toLowerCase()
  if (!app) return false
  if (VAULT_BROWSER_APP_NEEDLES.some((n) => app.includes(n))) return true
  if (/(^|[._\s-])arc($|[._\s-])/.test(app)) return true
  if (/(^|[._\s-])edge($|[._\s-])/.test(app)) return true
  return false
}
```

Bare `"edge"` is **not** in the includes-needles (would have matched `"knowledge"`). Delimited regex is what trips `win.app.edge` / `microsoft_edge`.

### Probe `[executed]`

| Input | `hostComputerAppHintsVaultBrowser` | `runMultiAgentToolPregate` (lease held) |
|-------|--------------------------------------|------------------------------------------|
| `{ app: "TextEdit", task: "click the chrome button in knowledge" }` | false | **PASS** (not HOST_CHROME) |
| `{ app: "win.app.knowledge" }` | false | — |
| `{ app: "win.app.notepad", task: "open chrome" }` | false | — |
| `{ task: "click chrome" }` (no app) | false | — |
| `{ actions: [{ app: "Google Chrome" }], task: "chrome" }` | false | — |
| `{ app: "Safari" }` / `{ app: "mac.app.safari" }` | true | **HOST_CHROME_TAB_LEASE** |
| `{ app: "Microsoft Edge" }` / `{ app: "mac.app.microsoft_edge" }` / `{ app: "win.app.edge" }` | true | (suite + helper) |
| `{ app: "Brave Browser" }` / `{ app: "win.app.brave" }` | true | **HOST_CHROME_TAB_LEASE** |
| `{ app: "Google Chrome" }` | true | **HOST_CHROME_TAB_LEASE** |
| `{ app: "TextEdit" }` | false | PASS (suite) |

**Named falsification failed.** JSON-blob scan is dead. `"knowledge"` does not trip Edge. Safari/Edge/Brave **tokens and display names** block. TextEdit is **not** blocked by chrome/knowledge task text.

Substring over-match on the **app field** still exists (`win.app.operator` / `win.app.not_chrome` → true). Fail-closed for Q4, not a skip.

See Attack 2 for tokens that **are** vault browsers but miss the needle list.

**Outcome**: claim 1 as stated does **not** hold.

---

## Attack 2 — `hostComputerAppHintsVaultBrowser` vs `isVaultBrowserEntry` drift

**Claim to falsify**: a token not in needles is still a vault browser (Q4 fail-open), or a needle hit is not a vault browser (Q4 over-block).

This is the real dual-write. Pregate never loads `AppEntry`. Admission/executor classify via `isVaultBrowserEntry(entry)` (`policy.ts:98-119`) on bundleId / win exe basename. Needles guess from the **string** `params.app`.

### Default-path tokens (enumerate display names) `[assumed]` + helper `[executed]`

Apps panel enumerate passes `display_name: picked.name` (`AppsPanel.tsx:133`). `CFBundleDisplayName ?? CFBundleName ?? .app name` (`enumerate.ts:105-107`). Typical:

| Bundle | Typical display → token | Needle | `isVaultBrowserEntry` |
|--------|-------------------------|--------|------------------------|
| `com.google.Chrome` | Google Chrome → `mac.app.google_chrome` | hit (`chrome`) | true |
| `com.google.Chrome.canary` | Chrome Canary → `mac.app.chrome_canary` | hit (`chrome`) | true |
| `com.brave.Browser` | Brave Browser → `mac.app.brave_browser` | hit (`brave`) | true |
| `company.thebrowser.Browser` | Arc → `mac.app.arc` | hit (arc regex) | true |
| `com.apple.Safari` | Safari → `mac.app.safari` | hit | true |
| win `chrome.exe` / `chromium.exe` / `msedge.exe` / `brave.exe` | slug from **exe basename** (`add-flow.ts:320`) | hit | true |

Default UI path for named Chrome/Safari/Edge/Brave/Canary is aligned.

### Last-segment / API tokens `[executed]` — **drift is real**

Add-flow mac bundleId with **empty** `displayName` uses `bundleId.split(".").pop()` (`add-flow.ts:170-172`). Probe of every `MAC_BROWSER_VAULT_BUNDLE_IDS` last-segment token:

| Last-seg token | Needle | Vault browser? |
|----------------|--------|----------------|
| `mac.app.safari` / `mac.app.chrome` / `mac.app.firefox` / `mac.app.edgemac` / `mac.app.opera` / `mac.app.vivaldi` / `mac.app.chromium` | hit | yes |
| **`mac.app.canary`** (Chrome.canary) | **false** | **yes** (`isVault=true`, one-shot OK) |
| **`mac.app.dev`** (Chrome.dev) | **false** | **yes** |
| **`mac.app.beta`** (Chrome.beta **and** Edge.beta) | **false** | **yes** |
| **`mac.app.browser`** (Brave **and** Arc last seg) | **false** | **yes** |
| `mac.app.web` (custom display) | false | depends on the entry, not the slug |

Live pregate with leases held `[executed]`:

- `app: "mac.app.canary"` → **PASS** (Q4 does not fire)
- `app: "mac.app.browser"` → **PASS**
- same entries via `isVaultBrowserEntry` → one-shot **OK**, `canEverCoordinate=false`

So: L2 one-shot **will** inject into Canary/Brave/Arc whose token was minted from last-segment or a display name without needles, **while tab leases are held**. That is ADR-015 Q4 fail-open, not an unattended L2 skip.

Not the default enumerate path (display names contain `chrome`/`brave`/`Arc`). It **is** a supported `apps.add { bundleId }` branch when `display_name` is omitted, and any user-chosen display like `"网页"` / `"Web"` (`mac.app.web`).

Inverse drift (needle hit, not vault): `win.app.vivaldi` needles-hit, but `vivaldi.exe` is **still unmapped** in `BASENAME_TO_VAULT_TOKEN` → `isVault=false`, `canEver=true` → persist-capable. HOST_CHROME over-blocks (fail-closed). Pre-existing Windows Vivaldi gap; fold added `chromium` only.

**Outcome**: named Safari/Edge/Brave **display / typical tokens** block. Classifier dual-write remains for last-seg / custom-slug vault browsers. Nit on Q4, not Trust skip.

---

## Attack 3 — hwnd Chrome-entry + powershell hwnd is not actually `HWND_NOT_OWNED`?

**Claim to falsify**: one-shot waiver lets Chrome-approved tasks inject into a LOLBIN hwnd; or the new unit test lies / is not the executor path.

### Code `[inspected]`

Path equality runs **before** the vault recheck (`policy.ts:267-273`). Waiver is three conjuncts (`policy.ts:285-288`):

```
opts.allowVaultBrowserOneShot === true
  && isVaultBrowserEntry(entry)
  && isBrowserVaultExePath(info.exePath)
```

`isLolbinPath` is never waived (`policy.ts:278-284`).

Executor call sites (`executor.ts:500`, `:825`) pass `{ allowVaultBrowserOneShot: vaultBrowserOneShot }` where `vaultBrowserOneShot = isVaultBrowserEntry(entry)` (`:454-455`). The unit test hardcodes `true`. For a Chrome GUI entry those are the **same boolean**.

### Probe `[executed]` (Darwin, Windows-shaped paths, live `assertHwndOwnedByEntry`)

| Setup | `errorCode` |
|-------|-------------|
| Chrome entry + Chrome hwnd, flag true | **OK** |
| Chrome entry + Chrome hwnd, flag omitted | `APP_COORDINATE_STRUCTURAL` |
| Chrome entry + powershell hwnd, flag true | **`HWND_NOT_OWNED`** |
| Chrome entry + powershell hwnd, flag=`isVaultBrowserEntry(chrome)` (executor shape) | **`HWND_NOT_OWNED`** |
| Chrome entry + 1Password hwnd, one-shot | `HWND_NOT_OWNED` |
| Chrome entry + notepad hwnd, one-shot | `HWND_NOT_OWNED` |
| Chrome entry + Edge hwnd, one-shot | `HWND_NOT_OWNED` |
| chromium.exe entry + chromium hwnd, one-shot | OK |
| chromium.exe entry + chrome.exe hwnd | `HWND_NOT_OWNED` |
| Canary bundleId + `exePath=com.google.Chrome.canary` | OK |
| Canary bundleId + powershell hwnd | `HWND_NOT_OWNED` |

Suite test `policy: hwnd chrome entry + powershell hwnd is HWND_NOT_OWNED even on one-shot` **pass** `[executed]`. Deny is path mismatch, not the waiver. Deleting the three conjuncts would still deny powershell; the test does **not** pin `isBrowserVaultExePath`. It does pin “no inject into powershell.”

No `computer-executor.test.ts` case for Chrome one-shot + powershell hwnd. Mid-task recheck (`executor.ts:825`) uses the same function. Fail-closed.

**Outcome**: claim 3 does **not** hold. Code is `HWND_NOT_OWNED` (DoD wording “STRUCTURAL” still wrong). Test does not lie about the deny. Not an executor-vs-policy split.

---

## Attack 4 — Exported skip helper dead; set-then-wipe still the lock?

**Claim to falsify**: `hostComputerTrustSkipAlgebraOpen` is unused at real `runL2ToolAdmission` sites; G1/unattended still set-then-clear; tests cannot kill a wiring revert.

### Helper is live `[inspected]`

```126:128:companion/src/tool/l2-admission.ts
export function hostComputerTrustSkipAlgebraOpen(vaultBrowserOneShot: boolean): boolean {
  return vaultBrowserOneShot !== true
}
```

Used at **both** skip-algebra entries, not only in tests:

- `l2-admission.ts:548` — `hostComputerTrustSkipAlgebraOpen(vaultBrowserOneShot) && sessionId && finalParams.app` (G1 then unattended)
- `l2-admission.ts:656` — `else if (hostComputerTrustSkipAlgebraOpen(vaultBrowserOneShot) && finalParams.app` (no-session unattended)

`hostComputerConfirmRelevantApps` is used at the confirm payload (`:1314-1315`), not a dead export. Empty `relevantApps` for one-shot → no G1 checkbox.

All three `hostComputerTrustSkip = true` assignments (`:592`, `:622`, `:677`) sit **inside** those guarded blocks. `runL2ToolAdmission` is still **imported by no test file** (only `server.ts:606`). `l2-admission-pure` pins the helper in isolation (`hostComputerTrustSkipAlgebraOpen(true) === false`). Deleting the two call-site uses and restoring `!vaultBrowserOneShot` would keep CI green **if** the helper tests stay. Restoring the old unguarded algebra (enter skip for browsers) would **also** stay green — the suite never executes `runL2ToolAdmission`.

### Wipe is still there `[inspected]`

```696:701:companion/src/tool/l2-admission.ts
        if (vaultBrowserOneShot) {
          // Do not compute skip then wipe — never pass coordinateAllowed:true for
          // a one-shot browser (Trust REJECT + runtime P1).
          hostComputerTrustSkip = false
          hostComputerTrustSkipReason = null
        }
```

Comment claims they no longer compute-then-wipe. Control flow: helper **prevents enter**, wipe is a no-op belt if the helper holds. The inner unattended calls still pass `coordinateAllowed: true` (`:614`, `:669`) — but those lines are **not reached** for `vaultBrowserOneShot === true`.

Prior P1 (unattended skip from a lying `coordinateAllowed: true` plus a six-line veto as the only lock) is **structurally weaker now**: skip is not entered. The wipe is defense-in-depth, not the sole lock. I could not find a path that sets `hostComputerTrustSkip === true` for a vault-browser one-shot if `:548/:656` run.

`security.critical_api_waived` now excludes `vaultBrowserOneShot` (`:909`) — prior runtime N6 folded.

Executor re-L2 still uses raw `!vaultBrowserOneShot` (`executor.ts:656/:678/:703`), **not** the helper. Semantically equal today (`!== true` on a boolean). Dual-write of the predicate.

**Outcome**: helper is **not** dead. Set-then-wipe is residual belt, not the live skip. Tests still do not pin `runL2ToolAdmission` wiring. Not a live silence of Chrome L2.

---

## Attack 5 — chromium.exe / Canary tests pass, production classifiers miss case or path form?

**Claim to falsify**: suite fixtures are the only shapes that work; `Chromium.EXE`, Canary SxS `chrome.exe`, `com.google.chrome.canary` lowercase miss in production.

`exeBasename` lowercases and takes the prefix before the first dot (`guards.ts:107-115`). `bundleIdInSet` is case-insensitive (`policy.ts:81-88`). `chromium` was added to `BASENAME_TO_VAULT_TOKEN` (`guards.ts:60`) → `win.chrome` ∈ `WIN_BROWSER_VAULT_TOKENS`. Canary/beta/dev bundle IDs were added to `MAC_BROWSER_VAULT_BUNDLE_IDS` (`policy.ts:26-41`).

### Probe `[executed]`

| Entry | `isVaultBrowserEntry` | `canEverCoordinate` | one-shot `assertCoordinateAllowed` |
|-------|------------------------|---------------------|-------------------------------------|
| `C:\...\chromium.exe` | true | false | OK |
| `C:\Chromium\Chromium.EXE` | true | false | OK |
| `C:/Chromium/Application/Chromium.EXE` | vault `win.chrome`, `looksLikeWinExePath` true | — | — |
| `/tmp/chromium.exe` (posix + `.exe`) | treated as **win** identity (`looksLikeWinExePath` via `/\.exe$/i`) | vault | — |
| Canary SxS `...\Chrome SxS\Application\chrome.exe` | true (basename `chrome`) | false | OK |
| `com.google.chrome.canary` (all lower) | true | false | OK |
| `com.google.Chrome.Canary` mixed | true | false | OK |
| `com.google.Chrome.dev` / `.beta` | true | false | OK |
| `C:\Google\chrome_canary.exe` | **false** | **true** | `APP_COORDINATE_DENIED` |
| `vivaldi.exe` | **false** | **true** | `APP_COORDINATE_DENIED` |

Windows Canary **in the wild** is `chrome.exe` under `Chrome SxS`, not `chrome_canary.exe`. The unmapped `chrome_canary.exe` / `vivaldi.exe` names are persist-capable if someone copies/renames the binary. Pre-existing naming gap; fold did not claim `chrome_canary.exe`.

Persist deny rides `canEverCoordinate` in `apps/handlers.ts:449-457` and `normalizeAppEntry` (`types.ts:300-303`). Handler tests cover mac Chrome bundle + `chrome.exe`, not chromium/Canary by name. Policy `canEver=false` is the same function the handler calls — persist hold `[inspected]` + classifier `[executed]`.

**Outcome**: claim 5 does **not** hold for the production classifiers the fold added. Tests are not the only passing shape.

---

## Attack 6 — Dual-write: admission vs executor still disagree on `allowVaultBrowserOneShot` / hwnd opts?

**Claim to falsify**: L2 can approve a vault-browser task then executor STRUCTURAL-fail, or admission treats it as one-shot while executor treats it as persist `coordinateAllowed` (unattended skip).

| Site | Flag |
|------|------|
| Admission `assertCoordinateAllowed` (`l2-admission.ts:516-518`) | `{ allowVaultBrowserOneShot: true }` **hardcoded** |
| Executor `assertCoordinateAllowed` (`executor.ts:454`) | `{ allowVaultBrowserOneShot: true }` **hardcoded** |
| Executor hwnd start (`executor.ts:500`) | `{ allowVaultBrowserOneShot: vaultBrowserOneShot }` **computed** |
| Executor hwnd per-action (`executor.ts:825`) | same computed |
| Policy hwnd test | hardcoded `true` |

Both layers always pass `true` into `assertCoordinateAllowed`. One-shot admit requires `!canEverCoordinate && isVaultBrowserEntry` (`policy.ts:218-220`). After a successful one-shot admit, `isVaultBrowserEntry(entry)` is true, so executor hwnd flag is true. **No live L2-approve-then-`assertCoordinateAllowed`-STRUCTURAL** for Chrome unless `getConfig()` vs `deps.config` diverges (pre-existing).

Hwnd computed vs hardcoded-true: equivalent for vault browsers; **stricter** for non-browsers (waiver also requires `isVaultBrowserEntry` + `isBrowserVaultExePath`). Fail-closed.

Skip dual-write: admission helper vs executor `!vaultBrowserOneShot`. Equal on booleans.

**Outcome**: no live admission/executor disagreement on Chrome one-shot admit or hwnd waive. Residual: two hardcoded `true`s plus a third computed hwnd flag — a future “only pass the flag for browsers” refactor that misses one site re-opens L2-approve-then-STRUCTURAL (same fuse as the prior runtime review).

---

## DoD vs evidence

| # | DoD | Result |
|---|-----|--------|
| 1 | Claude 20260822 residuals 1–5, 7 (HOST_CHROME / Canary / chromium / notepad tamper) gone in tree, not just claimed | **Mostly hold.** HOST_CHROME JSON-blob gone `[executed]`. Safari/Edge/Brave typical tokens block `[executed]`. Canary/chromium vault-mapped `[executed]`. Notepad+pasted Chrome bundleId is **not** one-shot (`APP_COORDINATE_DENIED`) `[executed]`. Residual: HOST_CHROME still a **parallel needle list**, not `isVaultBrowserEntry` (Attack 2). |
| 2 | Unattended still cannot skip Chrome one-shot L2 | **Hold by inspection** of helper-not-entered + wipe belt + `resolveL2ForceConfirm`. Executor re-L2 `!vaultBrowserOneShot` `[inspected]`. **Still no `runL2ToolAdmission` test.** |
| 3 | Persist bit still denied on Canary and chromium.exe | **Hold** `canEverCoordinate=false` `[executed]`. Handler uses that function `[inspected]`. No named handler test for those two identities. |
| 4 | powershell / 1Password still STRUCTURAL with one-shot flag | **Hold** `[executed]` policy suite + probe. |
| 5 | WAVE-1 still NEVER default `host_computer` for DOM | **Hold** `[executed]` `web-act-loop-wave1` source lock (`NEVER default to host_computer for browser-DOM`). Rules 7/8/9c now defer to Rule 12 instead of forbidding it. |
| 6 | No new skip/persist hole from the fold (`canEverCoordinate` win-path identity) | **Hold for the fold's win-path change.** Notepad+bundleId is persist-denied-without-bit, not one-shot. **Pre-existing** mac **path-only** Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, no bundleId): `isVault=false`, `canEver=true` `[executed]` — persist + unattended skip if the bit is set. Not introduced by `looksLikeWinExePath`. |

---

## Findings

### N1 — HOST_CHROME is a second, weaker classifier (Q4 fail-open on last-seg / custom slugs)

`VAULT_BROWSER_APP_NEEDLES` + includes/regex is not `isVaultBrowserEntry`. `mac.app.canary` / `mac.app.browser` / `mac.app.dev` / `mac.app.beta` / `mac.app.web` pass pregate with leases held while policy will one-shot-inject `[executed]`.

Code judo: resolve `params.app` against `apps.entries` and call `isVaultBrowserEntry`. Unknown token → existing L2 `APP_NOT_WHITELISTED`, not a needle guess. Deletes the needle table and the drift.

Not a Trust skip. ADR-015 Q4 race if someone mints those tokens.

### N2 — Skip helper is live but unpinned at `runL2ToolAdmission`; wipe remains

Helper **is** used at `:548/:656`. Pure tests cannot fail if those guards are deleted. `runL2ToolAdmission` still has zero test importers. Wipe `:696-701` is belt (good) sitting on a comment that pretends it is gone.

Fix: one integration test (unattended armed + Chrome → confirm path / `hostComputerTrustSkip` false). Optional: executor imports the same helper.

### N3 — Hwnd Chrome→powershell is real `HWND_NOT_OWNED`; suite does not pin the waiver conjuncts

Deny holds `[executed]`. Test would still pass if `isBrowserVaultExePath(info.exePath)` were dropped (path equality is sufficient vs powershell). Pin an extra case: Chrome hwnd + one-shot **without** the hwnd-exe browser conjunct should still allow Chrome hwnd (the waiver's load-bearing job).

No executor-level Chrome one-shot inject test (pre-existing gap; private probes from the prior review still apply — this fold did not touch `executor.ts` skip/hwnd wiring except it was already one-shot).

### N4 — Windows `vivaldi.exe` / `chrome_canary.exe` still not vault-mapped

`chromium.exe` is. Canary-as-`chrome.exe` is. Renamed Canary / Vivaldi GUI remain `canEver=true`. Inverse of N1 for Vivaldi (HOST_CHROME blocks `win.app.vivaldi`, policy does not one-shot). Out of the named fold list; still a browser persist surface.

### N5 — Pre-existing mac path-only Chrome persist (not this fold)

Manual paste in `AppsPanel` sends `path` without `bundleId`. Path-only Google Chrome binary: not a vault browser, `canEverCoordinate true` `[executed]`. Enumerate path is bundleId-first (safe). Mentioned so DoD 6 is not over-claimed as “all Chrome identities.”

---

## Trajectory / component

Diff matches the nits list: `tool-pregate.ts` app-only HOST_CHROME, `policy.ts` Canary/chromium/win-path identity, `l2-admission.ts` exported skip helper + relevantApps, catalog/Rules 7/8/9c, ADRs/guides, tests. No drive-by in this lane's files.

Hotspots:

- `companion/src/orchestrator/tool-pregate.ts:68-90,253-264`
- `companion/src/computer/policy.ts:26-50,81-119,145-171,218-220,267-295`
- `companion/src/tool/l2-admission.ts:126-137,516-519,548,656,696-701,902-909,1314-1315`
- `companion/src/computer/executor.ts:452-455,500,656,678,703,825`
- `companion/src/apps/guards.ts:59-60` (`chromium`)
- `companion/src/apps/add-flow.ts:169-172,320` (token mint vs needles)

Trust monotonicity: one-shot still stricter than Notepad on skip **if** N2's helper stays at the call sites. Q4 (N1) is Compose/multi-agent, slightly **weaker** than looking at the same `AppEntry` the CU path uses.

---

## Residual risks

- Needle vs `isVaultBrowserEntry` dual classifier (N1).
- Dual hardcoded `allowVaultBrowserOneShot: true` on every `host_computer` `assertCoordinateAllowed` (admission + executor).
- Skip predicate dual-write (admission helper vs executor `!vaultBrowserOneShot`).
- No `runL2ToolAdmission` integration test (N2).
- Windows Vivaldi / renamed Canary persist (N4).
- Mac path-only Chrome persist (N5, pre-existing).
- Companion UI is still Chrome (`self-ui.ts`); one-shot CU targets the same exe as the side panel. Not a new skip.

---

## Verdict rationale

I could **not** falsify the named live holes this lane was asked to kill:

1. HOST_CHROME is no longer a JSON-blob substring. Task `"click chrome"` / `"knowledge"` does not block TextEdit. Safari/Edge/Brave typical tokens **are** blocked `[executed]`.
2. hwnd Chrome → powershell is `HWND_NOT_OWNED` on the same function the executor calls `[executed]`.
3. Skip helper is used at both `runL2ToolAdmission` algebra sites `[inspected]`; set-then-wipe is belt, not the sole lock.
4. `chromium.exe` / Canary (case, SxS `chrome.exe`, lowercase bundleId) classify as vault-browser one-shot in production, not only in fixtures `[executed]`.
5. Admission and executor agree on `allowVaultBrowserOneShot: true` for `assertCoordinateAllowed`; hwnd computed flag matches Chrome `[inspected]` + hwnd probe `[executed]`.

I will not APPROVE clean: HOST_CHROME is still a parallel heuristic (N1), and the product lock for initial L2 under unattended is still unpinned at `runL2ToolAdmission` (N2). Neither is a live default-path skip of the Chrome dialog.

VERDICT: APPROVE_WITH_NITS
