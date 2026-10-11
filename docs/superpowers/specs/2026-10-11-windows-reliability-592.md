# Windows reliability follow-up (#592)

Tracking issue: #592. Review findings R3, R4 and R11. Existing behavior fixes plus
Windows Known Folder compatibility; outbound permission profiles remain unchanged.

## Design and acceptance

- VBS sets `NODE_PATH` on the child process environment and launches the runtime
  directly. BAT disables delayed expansion and launches its fallback directly.
  Bundled Node retains priority over system Node and legacy SEA. Native launcher
  smoke covers spaces, Chinese, ampersand, apostrophe, exclamation and parentheses.
- Installer stop obtains its root from an inherited environment variable. Runtime
  processes must be inside the exact installation directory boundary and have the
  Node/SEA image name. A sibling installation must survive. The installer never
  invokes the user's shared `daemon.pid` stop command or an image-wide taskkill.
- PTY tree cleanup uses the pinned System32 taskkill executable, handles both sync
  and async startup failures, and releases the PTY handle once cleanup completes
  (or its bounded timeout expires). Keeping the root alive lets taskkill enumerate
  descendants. Fallback releases the existing handle, never retries a bare PID.
  Closing disables input immediately, reserves the PTY slot until cleanup ends,
  and emits `terminal.closed` once afterward. Natural exit never kills its old PID.
- File access resolves only the three fixed Known Folder GUIDs through
  `SHGetKnownFolderPath`, including redirected Documents/Desktop/Downloads. A
  resolver failure is surfaced; it never silently falls back to guessed paths.
  Every operation resolves current OS settings; authorization roots are not cached.
  Native helper startup latency remains a Windows measurement item.
  One operation uses one root snapshot, with lexical checks plus canonical
  filesystem checks. Missing/offline roots cannot authorize operations. File
  listing and metadata reads reject symlink targets outside the allowed roots.

## Validation boundaries

Host and linux/arm64 unit tests exercise injected filesystem/process boundaries;
they do not prove Windows-native behavior. Windows CI runs the real launcher
matrix, the installer stop command against owned fixture processes, native Known
Folder resolution without modifying user settings, and cleanup of an owned Node
parent/child tree. Existing ConPTY unit coverage remains injected; an interactive
desktop/Office/UIA acceptance session is outside these automated checks.

## Additional same-class fixes (#593)

Issue #593 authorizes the follow-up identified by Pi. ZIP `uninstall.bat` uses
the installation directory environment variable and the same bounded CIM filter
as NSIS, with delayed expansion disabled. A native smoke executes the complete
BAT under a special-character directory; both owned Node/SEA images stop, sibling
images survive, fixture startup/log cleanup runs, and declining data deletion is
honored. Scheduled-task and browser no-op fixtures are prepended to PATH and
the user profile is isolated. The script is only intended for disposable Windows
CI; App Paths browser resolution on developer machines is not certified, and the
script has not been run locally. Known Folder drive roots and UNC share roots are
rejected after normalization, including paths whose `..` collapses to a root.
The close audit is recorded immediately; the closed frame still waits for cleanup.
Windows CI also executes the ACP spawn suite.

Follow-ups deliberately outside this batch: native natural-exit ConPTY resource
teardown evidence; real-time Known Folder helper latency; the legacy capability
shell taskkill path/error handling. Installation process matching remains based
on executable path, so system Node outside the installation, short-path spelling,
and the CIM lookup-to-kill PID race are not newly certified here.

## Rollback

Revert this batch as one unit if compatibility regresses. It changes no persisted
configuration or target ID format and writes no Known Folder registry values.
Root resolution intentionally follows Windows settings anew on each operation.

Canonical roots are also checked after realpath resolution: a Known Folder
junction to an entire volume or share is unavailable, even when its lexical path
looks like a normal user folder. The same per-operation root snapshot applies.
