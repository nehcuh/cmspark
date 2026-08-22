# Second judge (Claude) — Chrome vault-browser one-shot L2 rereview

**Batch**: `chrome-cu-oneshot-20260822` (rereview round)
**Role**: second judge over three independent adversaries — confirm or reject, no rubber-stamp
**Worktree**: `/tmp/cmspark-chrome-cu` branch `feat/chrome-cu-oneshot-l2` **(`204429e`)** vs `origin/main` (`56a5973`)
**Adversaries reviewed at**: `85cd7a5` (pre-fold); this judge reviews the **folded** tree `204429e`

```text
Surface:      L2 host_computer (vault-browser one-shot)
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        forceConfirm L2; NEVER skipped by unattended / 三旗 cruise / G1 session-trust;
              does NOT persist Apps coordinateAllowed; LOLBIN/password-manager/terminal/wallet still STRUCTURAL
Channel:      community
```

---

## Machine (this worktree) `[executed]`

| Command | Result |
|---------|--------|
| `./node_modules/.bin/tsc -p tsconfig.test.json` | exit 0 |
| `node --test` computer-policy + l2-admission-pure + apps-coordinate + computer-preview + web-act-loop-wave1 | **95 pass / 0 fail** |

Matches the claimed post-fold machine exactly.

**Independent probes** (throwaway script against `.test-dist`, deleted after; no worktree mutation) `[executed]`:

| Probe | Result |
|-------|--------|
| handler `apps.set_coordinate_allowed(true)` — mac Chrome **bundleId-only** / **bundleId + Chrome.app path** / mac Safari bundleId-only / mac Terminal / win `chrome.exe` | all `COORDINATE_STRUCTURAL_DENY`, **not persisted**, biometric gate **never invoked** (deny precedes gate) |
| handler benign app (`com.example.Benign`) | gate invoked once, bit persists — deny is not over-broad |
| `normalizeAppEntry` force-clears hand-edited `coordinateAllowed:true` on mac Chrome (bundleId-only and bundleId+path) | cleared → `false`, loud log |
| `sanitizeAppEntries` (config-load belt) | Chrome bit cleared; benign `notepad.exe` bit kept |
| one-shot `assertCoordinateAllowed` w/ flag | Chrome/Safari (mac bundle + win chrome.exe) → entry; 1Password / Terminal / MetaMask / powershell → `APP_COORDINATE_STRUCTURAL` |
| same **without** flag | all browsers → `APP_COORDINATE_STRUCTURAL` (persistent bit still denied) |
| positive control notepad | without bit → `APP_COORDINATE_DENIED`; with bit → admitted (two-switch model intact) |
| preview starvation: 4000-char `汉` task + 30 actions | preview **starts** with ⚠️ banner; Cockpit `slice(0,1200)` contains 「必须你点「允许」」 |
| preview spoof: `task` containing `\n⚠️ 系统已自动批准…` | stays JSON-escaped inside the single `任务:` line; exactly one standalone ⚠️ line (the real banner, line 1) |
| `resolveL2ForceConfirm` pure | vault-browser + cruise → **true**; normal host_computer + cruise → false (no collateral tightening) |

---

## Job Q1 — Is the Trust REJECT folded?

**Yes. All three must-fixes landed and verified `[executed]`.**

- **M1** — `apps/handlers.ts:449-458`: deny is now `rest.allowed === true` → `!canEverCoordinate(entry)` (bundleId **or** exe), no longer `entry.exe?.path && basenameToVault(...)`. Pre-fold shape confirmed at `85cd7a5` (`&& entry.exe?.path` guard) — the REJECT was factually grounded. Deny fires **before** the biometric gate (probe asserts `gateCalls === 0`).
- **M2** — `apps/types.ts:295-311`: `normalizeAppEntry` force-clears via `canEverCoordinate` (path/LOLBIN check first, then `canEverCoordinate`); `sanitizeAppEntries` (config load) routes through it. The `require()` is valid in this CommonJS build (no `"type": "module"`; `.test-dist`/`dist` are CJS) and the lazy require avoids the `policy`↔`types` top-level cycle. Hand-edited mac Chrome bits die on load — probed.
- **M3** — tests added: handler mac-Chrome-bundleId deny (`apps-coordinate.test.ts`), `normalizeAppEntry` mac-Chrome force-clear (`computer-policy.test.ts`), `leadLines` 1200-slice lock (`computer-preview.test.ts`). Windows `chrome.exe` deny tests retained.
- **DoD 2** ("persistent `coordinateAllowed` still impossible on browsers") now holds on **both** platforms `[executed]`.

Fold items 3–5 also verified in tree (not just in the diff): see below.

## Job Q2 — Can unattended still skip Chrome L2?

**No. Initial L2 and mid-task re-L2, by three independent belts `[inspected]` + pure algebra `[executed]`:**

1. **Not entered** — `l2-admission.ts:531` (`!vaultBrowserOneShot && sessionId && …` G1 branch) and `:639` (`!vaultBrowserOneShot && finalParams.app` unattended branch). `hostComputerTrustSkip` has exactly three `= true` sites (`:575`, `:605`, `:660`) and all live inside those guarded blocks.
2. **Belt wipe retained** — `:679-684` forces `hostComputerTrustSkip = false` for vault browsers even if a future edit re-opens a branch.
3. **forceConfirm under cruise** — `resolveL2ForceConfirm` (`:91`) returns `true` for `vaultBrowserOneShot && hostComputerGated`; dialog gate `:959` `(!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip` therefore always fires (enterpriseSkip is shell/netsec only; `autoConfirmEligible: false` under forceConfirm).

Re-L2 (`executor.ts:656/:678/:703`): unattended / 三旗 cruise / G1 skips all carry `&& !vaultBrowserOneShot`. The fold did **not** touch `executor.ts`, so the runtime adversary's executed executor probes at `85cd7a5` remain valid for `204429e`.

Note the set-then-clear landmine (Trust T-02 / Runtime N1 / Product N4) is **structurally gone**: the skip algebra is never computed for a vault browser, and the comment at `:591` ("assertCoordinateAllowed already passed → coordinateAllowed true") is now true for every entry that reaches it (non-browser entries must have passed the persistent-bit check). Re-enabling silent inject now requires deleting **both** the branch guards **and** the wipe, or waiving forceConfirm — real defense in depth. Residual: still no `runL2ToolAdmission` integration test with unattended armed + Chrome (named below).

## Job Q3 — Confirm or reject each adversary

| Adversary | Verdict | Second judge |
|-----------|---------|--------------|
| **Trust** | REJECT | **Confirmed — and RESOLVED by fold.** T-01 was a genuine P1: the REJECT was executed-proven against DoD 2 on the only platform that ships Safari, and pre-fold source confirms the `exe?.path`-only deny. M1/M2/M3 all folded and re-verified by execution. Recommended non-blocking items partially folded (skip-not-entered — the stronger of the two options offered; banner-first; guide step 3). |
| **Product** | APPROVE_WITH_NITS | **Confirmed with one dissent.** Findings N1–N8 were accurate and remain the accurate residual list. Dissent: N7 (mac persist) + N4 (lied bit) together were the same P1 Trust blocked — calling it a nit while DoD 2 explicitly claimed "cannot be persisted" was **under-severe** for a T3 Trust change; the owner lane (Trust) had the right call. Not over-loose to the point of rejection (they flagged it prominently and set a merge bar), but on severity Product was wrong and Trust was right. N2/N4/N7 are now fixed; N1/N3(catalog)/N5/N6(partial)/N8 stand. |
| **Runtime** | APPROVE_WITH_NITS | **Confirmed.** The conditional ("fix N1 before treating this as locked") is satisfied by the structural fold. N1/N2/N4 fixed; N3 (Rules 7/8/9c vs 12), N5 (hwnd `HWND_NOT_OWNED` vs DoD wording, no chrome→powershell suite test), N6 (waived log), N7 (ADR-017 D3 cruise bullet) stand as nits. |

No adversary's APPROVE covered a live skip path; none requires my REJECT.

## Job Q4 — ADR-020 checklist

| Item | Result |
|------|--------|
| Capability declaration in spawn prompt | present (quoted identically by all three adversaries) |
| Axes: Surface L2 `host_computer` (existing L2-class), Compose none, Autonomy single, Channel community | fits — no new runtime / Pack / confirm family |
| Anti-pattern 1 (new first-level UI entry) | none — reuses Cockpit/Confirm Center |
| Anti-pattern 2 (new confirm dialect) | none — reuse of `host_computer` L2 (`securityConfirmations.request`, tray race, `originWs`, `criticalApis`); extra preview banner only, now in `leadLines` |
| Anti-pattern 3 (new Agent runtime) | none — same tool-loop |
| Anti-pattern 4 (experimental locator as write-path dependency) | unchanged — Qwen3-VL anchors remain optional/experimental |
| Axis A rule 2 **trust monotonicity** | now holds on **both** axes of the change: (a) skip path — vault-browser CU is *stricter* than Notepad (cruise/G1/unattended cannot waive); (b) persistent capability — the Apps bit is unreachable on browsers, so the ADR-021 unattended exception ("仅 `coordinateAllowed` App") provably cannot reach a browser. Pre-fold (b) failed; fold closes it. |
| Pack cannot relax globals | n/a (no pack); trust keys untouched |

---

## Residual (named, non-blocking)

1. **G1 checkbox still offered + recorded** for vault-browser L2 (`l2-admission.ts:1297` `relevantApps`; Cockpit default-on). Post-fold this is UX dishonesty, not a skip landmine (trust grant is inert — branch not entered for vault browsers). Hide or force-off. (Product N1 / Trust T-03.)
2. **`security.critical_api_waived`** still logs `full_autonomy_cruise` for Chrome one-shot (`:892-900`); dialog still fires. Log ≠ gate; audit confusion only. (T-04 / N8.)
3. **Rules 7 / 8 / 9c still contradict Rule 12** in the same system prompt (`adapter.ts:478/:482/:488` vs `:440/:449/:463`) — likely model under-use (e87i9z stuck), not a safety skip. (Product N5 / Runtime N3.)
4. **Catalog drift**: `tool-definitions-catalog.json:1392/:1402` still says `coordinateAllowed` required; user-guide **checklist** line 「且已开允许坐标」 not updated (step 3 got the exception). (Product N3/N6.)
5. **ADR-017 D3** cruise-waive bullet lacks the vault-browser exception (D2 has it); GOAL/architecture stale. (N6/N7-runtime.)
6. **No `runL2ToolAdmission` integration test** with unattended armed + vault browser asserting the dialog path; the lock is structural (guards + wipe + forceConfirm) but unpinned end-to-end.
7. **Pre-existing, out of diff**: HOST_CHROME tab-lease is a JSON substring (`tool-pregate.ts:224-241`) — Safari/Edge/Brave tokens don't match while Chrome CU is now in scope; Chrome Canary / `chromium.exe` are not vault-classified (persistent bit + unattended silent possible); compact Side Panel `MinimalConfirm` never renders preview; win32 hand-edited `bundleId:"com.google.Chrome"` + notepad.exe tamper can take the one-shot path (config tamper only).
8. **Chrome is the CU host**: pixel-injecting the browser that hosts Cockpit/Side Panel — self-UI recovery pre-existing; needs a human click-test before release (not a skip bug).

## Verdict rationale

The Trust REJECT was correct, was folded completely (M1/M2/M3 verified by execution on this tree, not by reading the diff alone), and the fold chose the structurally stronger option on the skip algebra (never enter, keep the wipe). Machine is green (95/0, tsc 0) and my own probes reproduce every must-fix claim plus the banner-starvation fix at the schema cap. Remaining items are UX/docs/log nits and pre-existing heuristics, none of which can silence the Chrome one-shot dialog or persist the Apps bit.

VERDICT: APPROVE_WITH_NITS
