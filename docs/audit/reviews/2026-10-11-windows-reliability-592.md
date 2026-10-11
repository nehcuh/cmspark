# Windows batch validation (#592)

Scope: R3 launcher/installer quoting, R4 PTY cleanup, R11 redirected Known Folders.
Follow-up #593 closes the ZIP uninstall image-wide termination and drive/share-root
authorization gaps identified by the initial Pi review. The original review reports
are preserved as historical evidence; the subsequent review covers these additions.
Specification: `docs/superpowers/specs/2026-10-11-windows-reliability-592.md`.

Executed locally on macOS:

- Node 22 `npm run build`: passed.
- Targeted compiled suites (`windows-reliability`, `host-use-win-adapter`,
  `pty-terminal`, `acp-win-spawn`): passed; native Windows tests are skipped here.
- Fresh linux/arm64 container (`cmspark-cooperation-validation:590`, independent
  container dependencies, current source/tests copied into the container): passed.
- Packaging gates: 156 passed. The fixture's macOS `/var` path was normalized to
  its physical `/private/var` spelling; production release rules are unchanged.
- NSIS compilation against a temporary minimal payload: passed. This validates
  macro/plugin syntax and emits a disposable test installer, not a release build.

Windows-native checks are wired into `smoke (windows-latest)`:

- Existing nine launcher states plus bundled/system Node VBS paths and BAT with /
  without VBS under one path containing spaces, Chinese, `&`, `'`, `!`, and `()`.
- Installer's complete production stop macro compiled into a disposable silent
  NSIS harness and executed against a copied owned Node process, with an identically
  prefixed sibling installation surviving. Global PID/image stop calls are rejected.
- Complete shipped ZIP uninstall BAT under the same special-character path, with
  owned Node/SEA fixtures and sibling Node/SEA processes. The whole script runs
  against an isolated user profile; scheduled-task and browser executables alone
  are no-op fixtures. Declined data deletion and final log cleanup are asserted.
  This script is intended only for a disposable Windows CI runner and was not
  executed on the developer host. Its temporary profile isolates fixture data;
  PATH injection does not certify browser isolation on a developer machine because
  Windows App Paths may still resolve `start chrome` to an installed browser.
- Fixed-GUID Known Folder API resolution, without changing registry/user settings.
- A real owned Node parent/child process tree terminated through production PTY
  tree cleanup. Unit tests separately cover taskkill asynchronous error and once-only
  handle fallback.

Independent adversarial review also required the closing PTY to reserve the single
slot until cleanup completion and natural exits to avoid numeric PID termination.
Regressions cover input/data rejection while closing, no early closed frame, no
duplicate cleanup, and late completion not clearing a new session.

Kimi's first pass approved the worktree with suggestions; the suggested Known
Folder cache was deliberately not retained, to avoid stale authorization roots.
PowerShell startup latency remains a Windows-native measurement item.

These CI checks must pass before merge. They do not claim an interactive ConPTY,
desktop/UIA, Office, full NSIS upgrade/uninstall, or OneDrive policy mutation test.
Known Folder redirected-path and junction containment behavior is exercised with
injected filesystem fixtures; the native API check is read-only.

After #593, host and fresh arm64 evidence is 111 tests / 106 pass / 5 skip / 0 fail.
Windows CI now includes all four targeted suites, including ACP Windows spawning.
Drive roots, UNC share roots and normalization to either root fail closed. Closing
audits are synchronous while the closed frame remains deferred until completion.
Remaining follow-ups: natural-exit ConPTY resource teardown evidence, PowerShell
startup latency, and the pre-existing capability shell taskkill helper. CIM PID
lookup and filesystem TOCTOU remain path-based confinement limitations.

The incremental adversary also found that a normal Known Folder junction could
resolve to a canonical volume/share root. `rootPaths` now excludes those roots,
with list/read/move regression coverage and zero rename assertions. Ordinary
folder redirection remains supported.

Final ordered gates: incremental adversary APPROVE → Pi final APPROVE; Kimi final
APPROVE independently reproduced the four-suite host run, packaging gates and NSIS
compile. Archived reports identify the exact reviewed code-only hash. Remaining
review nits include a deliberately selected installer volume-root path broadening
its process scope, stronger NSIS SEA sibling coverage, and conditional NSIS version
pinning. System-Node launches outside the installation remain outside scoped stop.
None of these approvals substitutes for native Windows CI.
