# Second-judge ruling — Chrome CU one-shot nits fold (`ec65d92`)

All evidence below is from my own execution against this worktree unless tagged `[inspected]`. Machine: `tsc -p tsconfig.test.json --noEmit` exit 0; suites I ran — policy + admission-pure + apps-coordinate + apps-guards **118/0**, pregate + wave1 + tool-schemas + preview **81/0** (199/0 total). Plus an independent probe calling the **production default-platform** classifiers on this darwin host.

## 1. Trust REJECT (`dummy.exe` un-vault) — folded `[executed]`

My probe on the exact hybrids from the REJECT (Chrome bundleId + `dummy.exe` / `C:\...\notepad.exe` / `C:\Applications\Google Chrome`, and lowercase canary + `dUmmy.EXE`):

- `canEverCoordinate(entry)` (host darwin, no stub) = **false** for all → persist impossible
- `isVaultBrowserEntry(entry)` = **true** → one-shot classification holds
- `assertCoordinateAllowed` no-flag → `APP_COORDINATE_STRUCTURAL`; one-shot flag → ADMIT with `isVault=true`
- handler belt denies **before** biometric (`handlers.ts:449-457`); `normalizeAppEntry` force-clears (`types.ts:295-316`) — both call `canEverCoordinate` with default `os.platform()`, which is the correct production semantics
- hwnd: hybrid binds a Chrome window only **with** the one-shot flag — the L2 surface, never the persist bit

The pre-fold code (read from the r2 diff) confirms T-N1 was real: `looksLikeWinExePath` short-circuited **before** the bundleId check on any platform. `ec65d92` keys identity off `platform` (win32→exe path, else→bundleId first). M1/M2/M3 from the REJECT are all satisfied.

## 2. Unattended / 三旗 / G1 skip on stock vault-browser entry — impossible `[executed]`+`[inspected]`

- `resolveL2ForceConfirm({vaultBrowserOneShot:true, hostComputerGated:true, userFullAutonomy:true})` = **true** (`l2-admission.ts:91`) — 三旗 cruise cannot waive
- `hostComputerTrustSkipAlgebraOpen(true)` = **false** gates both G1 and unattended entries (`:548`, `:656`); all three `hostComputerTrustSkip=true` sites live inside; wipe at `:696-701` is belt
- dialog gate (`:976`): `forceConfirm=true`, `hostComputerTrustSkip=false`, `enterpriseSkip` impossible — `familyOfTool` covers only shell/netsec, never `host_computer`
- executor re-L2: all three skip sites carry `!vaultBrowserOneShot` (`executor.ts:656/678/703`); hwnd rechecks pass the computed flag (`:500/:825`)
- `critical_api_waived` log suppressed for one-shot (`:909`); `relevantApps=[]` → no G1 checkbox

## 3. Adversary verdicts — all four confirmed, none over-loose

| Adversary | Verdict | My ruling |
|---|---|---|
| Trust nits (REJECT @ `f4a743e`) | REJECT | **Correct then** — T-N1 verified in pre-fold code; now closed `[executed]` |
| Trust r2 (@ `ec65d92`) | APPROVE_WITH_NITS | **Confirm** — T-R2-1/2/3 verified as non-blocking (win32 bundleId-only persists but hwnd throws `HWND_NOT_OWNED` on empty entryPath; handler test is darwin-host-sensitive; `looksLikeWinExePath` now test-only) |
| Product | APPROVE_WITH_NITS | **Confirm** — phantom `TAB_ATTACH_FROZEN` verified (`adapter.ts:478/:482` only; runtime emits `CDP_ATTACH_FAILED` / `DOM_SCRIPT_VOLUME_CAPPED` / `DOM_SCRIPT_LOOP_CAPPED`); ADR-021 §4 still says "`executor.reL2` 全部静默通过" with no browser exception; architecture 9.3 still "结构排除" |
| Runtime | APPROVE_WITH_NITS | **Confirm** — HOST_CHROME matches `params.app` only (`tool-pregate.ts:83-90`); needle-vs-`isVaultBrowserEntry` drift real for last-segment tokens (`mac.app.canary`/`mac.app.browser`) — Q4 race, fail-direction is "pregate passes, L2 still fires"; skip helper live at both sites; no `runL2ToolAdmission` integration test |

## 4. Named prior residuals

**Gone** `[executed]`/`[inspected]`: catalog one-shot description (dumped from JSON), user-guide checklist, ADR-017 D3, ADR-021 §2, GOAL:70, architecture 9.1, Canary/chromium (incl. lowercase + `.EXE`), HOST_CHROME app-field, hwnd chrome→powershell (`HWND_NOT_OWNED` — path equality precedes waiver), notepad tamper (win32 `isVault=false`; suite green), skip-algebra pin.
**Still live (nits)**: Rule 7/8 phantom `TAB_ATTACH_FROZEN`; ADR-021 §4/§6 re-L2 skip-teaching SoT; architecture 9.3; user-guide §1/§5 generic skip copy; needle classifier drift; win32 `vivaldi.exe`/`chrome_canary.exe` unmapped (pre-existing); mac path-only Chrome (pre-existing, hwnd-dead).

## 5. ADR-020 checklist

- **Surface**: reuses existing L2 `host_computer`; no new tool/class ✓
- **Compose**: HOST_CHROME_TAB_LEASE blocks browser CU under tab leases (needle nit noted); workers `WORKER_HARD_DENY` ✓
- **Autonomy**: single — one-shot never persists; G1/unattended structurally excluded ✓
- **Trust monotonic**: browsers strictly stricter than native apps; no native-app bar lowered (`algebraOpen` only closes for browsers) ✓
- **Channel**: community; existing confirm dialect, browser-specific lead line only ✓

## 6. `TAB_ATTACH_FROZEN` — prompt nit, not a blocking skip hole

Worst trajectories are availability failures (model waits for a code that never fires, or CUs too early on first `CDP_ATTACH_FAILED`). Either way the one-shot L2 dialog **always** fires — there is no path from this nit to silent injection or persist. Same for the volume-cap wording (`DOM_SCRIPT_VOLUME_CAPPED` prose-matched; `LOOP_CAPPED` unnamed). Real product debt worth the fold's successor, but T3 Trust is intact.

## Basis for nits retained

Verified non-blocking residuals: phantom error code + unpinned WAVE-1 boundary, ADR-021 §4 skip-teaching SoT vs executor's `!vaultBrowserOneShot`, architecture 9.3 stale invariant, HOST_CHROME needle-vs-entry drift, zero `runL2ToolAdmission` integration coverage, host-sensitive handler test.

VERDICT: APPROVE_WITH_NITS
