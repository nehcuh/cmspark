# Independent adversary — Chrome vault-browser one-shot L2

You did **not** write this code. Do not rubber-stamp. Read real diff and source.

Worktree: `/tmp/cmspark-chrome-cu` branch `feat/chrome-cu-oneshot-l2` (`85cd7a5`) vs `origin/main` (`56a5973`).

## Blast
**T3 Trust.** Browser pixel CU was structurally denied (ADR-017 A10.3). This change lets Chrome/Safari reach existing `host_computer` task L2 as a **one-shot**; persistent `coordinateAllowed` stays false.

```text
Surface:      L2 host_computer (vault-browser one-shot)
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        forceConfirm L2; NEVER skipped by unattended / 三旗 cruise / G1 session-trust;
              does NOT persist Apps coordinateAllowed; LOLBIN/password-manager/terminal/wallet still STRUCTURAL
Channel:      community
```

## Product lock (user 2026-08-22)
Popup; user must click allow; then Chrome pixel inject. Unattended must NOT silence this dialog.

## Claimed implementation
- `isVaultBrowserEntry` / `allowVaultBrowserOneShot` on `assertCoordinateAllowed` + hwnd recheck
- `canEverCoordinate` still false for browsers (persistent bit)
- `apps.set_coordinate_allowed` still STRUCTURAL on Chrome
- l2-admission: never `hostComputerTrustSkip` for vault browser; preview banner; `resolveL2ForceConfirm` never waives under cruise
- executor: unattended/cruise/G1 re-L2 skip disabled for vault browser
- Rule 12: never *default* CU for DOM; after CDP freeze/volume cap or explicit 模拟点击, MAY call Chrome `host_computer` (always confirm)

## Machine
Run: `companion` `tsc -p tsconfig.test.json`; `node --test` computer-policy + l2-admission-pure (+ wave1 source lock if deps present).

Diff: `docs/audit/reviews/chrome-cu-oneshot-diff-20260822.patch`

## DoD
1. Chrome `host_computer` no longer throws STRUCTURAL before L2 when `allowVaultBrowserOneShot`.
2. Chrome `coordinateAllowed` cannot be persisted (`set_coordinate_allowed` still deny).
3. Unattended armed + 三旗 + G1 cannot skip initial L2 or mid-task re-L2 for vault browser.
4. powershell / 1Password / Terminal still STRUCTURAL even with one-shot flag.
5. hwnd swap from Chrome to LOLBIN/password-manager still STRUCTURAL.
6. WAVE-1 still does not *default* host_computer for DOM.

## Job
Your lane is in the spawn prompt. Outcome / trajectory / component. file:line. [executed]/[inspected]/[assumed].
Final line exactly:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
