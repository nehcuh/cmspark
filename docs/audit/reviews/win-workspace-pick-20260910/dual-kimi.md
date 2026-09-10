• # Independent Review — Windows native folder-picker fix

  ## Findings

  ### BLOCK
  None found in the diff itself.

  ### MAJOR

  **M1 — `pickFolderNativeImpl` is not defined anywhere in the diff** (`companion/src/message-router.ts:5148`).
  The old code called the imported `pickFolderNative()`; the new code calls `pickFolderNativeImpl(WORKSPACE_FOLDER_PROMPT)`. The import hunk keeps `pickFolderNative` and adds `WORKSPACE_FOLDER_PROMPT`, but no `pickFolderNativeImpl` is introduced or shown. The retained `pickFolderNative` import strongly suggests an existing DI binding (`let pickFolderNativeImpl = pickFolderNative`) elsewhere in the 5000-line router — but the 9 author tests only import `capability/workspace` and `obsidian/folder-picker`, so **a missing/typo'd symbol in `message-router.ts` would not be caught by the reported test run**. This needs one `tsc` / build pass on the whole companion before merge. If the symbol does not exist, this is a BLOCK (route throws at first `workspace.pick`).

  **M2 — The `cancelled: true` response shape is a new wire contract, unverified on the consumer side** (`message-router.ts:5149-5151`).
  Previously, cancel flowed through `{ error: "cancelled" }`. Now the sidepanel/relay receives `{ type: "workspace.pick_result", cancelled: true }` with no `error` field. Any consumer that only checks `result.error` will silently treat a cancel as success-with-no-path (or as an unhandled result). The file is outside the stated fix scope, so I can't verify the renderer handles `cancelled`. Confirm the extension's pick-result handler branches on `cancelled` before shipping.

  ### NIT

  - **N1 — `pathsEqualForBind` platform injection is half-real** (`workspace.ts:31-41`): the `platform` param controls only the case-fold; `path.normalize` still uses the *host* path module. On POSIX, win32 inputs with forward slashes or `.` segments won't normalize the win32 way, so cross-platform tests of win32 semantics are weaker than they look. Use `path.win32.normalize` when `platform === "win32"` if you want the injected path to be faithful. Current tests pass anyway because the inputs need no normalization.
  - **N2 — Drive-case flip test is vacuous on POSIX** (`workspace-native-pick.test.ts:48-58`): on macOS/Linux `real[0]` is `/`, so `flipped === real` and the test only exercises the single-use check, not the case-fold. It does the real work on Windows (where the author ran 9/9), so acceptable — but a future regression could hide behind a green POSIX CI. Consider skipping with a note when `real[0]` is not a letter.
  - **N3 — `stripWinLongPathPrefix` mangles `\\?\UNC\…` form** (`workspace.ts:22`): stripping yields `UNC\server\share`, which will never equal a realpathed `\\server\share`. Only reachable if the *recorded* path carried the `\\?\UNC\` prefix (picker never emits it), so it's latent, not live.
  - **N4 — Error messages from PS stderr will be mojibake** (`folder-picker.ts` `runWindowsFormsDialog`): stderr is decoded utf8 while PowerShell 5.1 writes CP936; only the stdout path was fixed. Failure text shown to the user may be garbled Chinese. Cosmetic.
  - **N5 — `parsePickerStdout` uses `.trim()`**: strips leading/trailing whitespace from legitimate paths. Windows forbids trailing spaces via normal creation APIs, so near-zero risk; a slice of only `\r\n` would be tighter.
  - **N6 — "选择超时" is returned for any killed process** (`killed || e.signal`), not only the 120 s timeout. Acceptable heuristic.
  - **N7 — `resolveWindowsPowerShell` falls back to bare `powershell.exe`**, re-exposing the PATH-hijack/missing-PATH class the absolute path was meant to kill. Reasonable last resort, but consider returning an explicit error instead of the fallback.

  ## What I confirmed vs assumed

  **Confirmed by reading the diff (no execution):**
  - Quoting is sound: `psSingleQuote` doubles `'`, which is the *complete* escape rule for PowerShell single-quoted strings; backticks/`$` are inert there. Newlines are flattened. The whole script is passed as one argv element via `execFile` — no shell, so no shell-injection surface.
  - `-STA` is explicit and correct for WinForms on PS 5.1; `UTF8Encoding $false` is BOM-less; `[Console]::Out.Write` + BOM-strip + trim is a consistent encode/decode pair.
  - Owner-form pattern (1×1 TopMost at −32000,−32000, `ShowDialog($f)`, `Close`/`Dispose` after) is the standard fix for ownerless `FolderBrowserDialog` from a hidden process.
  - Cancel vs error vs timeout are correctly distinguished (exit 0 + empty stdout → `cancelled`; killed → timeout message; else labelled error).
  - `consumeNativePick` still enforces TTL + single-use + realpath on both sides; the fix only relaxes the final string compare. TOCTOU posture unchanged.
  - Tests genuinely lock the string contract (UTF-8 markers, `ShowDialog($f)`, no `Write-Output`, quote doubling) and include a real-executable UTF-8 Chinese-path round-trip plus single-use and bind-after-realpath tests. Test count matches the claimed 9.
  - The file-picker sibling (`buildWindowsFilePickScript`) got the same UTF-8/owner treatment — the "residual" listed in the prompt is in fact covered in this diff.
  - Junction/symlink bind: both sides pass through `realpathSync`, which resolves junctions on Windows symmetrically — no new gap.

  **Assumed (from the prompt's executed evidence; I ran nothing):**
  - The UTF-8 round-trip and TopMost-owner behavior on the real CP936 machine; the 9/9×3 runs.
  - That `pickFolderNativeImpl` exists in `message-router.ts` (M1).
  - That the extension UI handles `cancelled: true` (M2).
  - That remaining z-order fights (vs. always-on-top windows) are acceptable.

  M1 and M2 are one command each to clear (`tsc --noEmit` on companion; grep the pick-result handler). Both are verification gaps, not demonstrated defects.

  VERDICT: APPROVE_WITH_NITS

