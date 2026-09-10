You are an independent reviewer. Do not call tools. The complete frozen diff is at the end of this prompt.

Repo: nehcuh/cmspark (CMspark companion). HEAD `cd7bf31a` (v0.6.7). Uncommitted Windows bugfix, not yet on a PR.

Bug (Windows only; macOS osascript OK): 编程接力 / 场景「选择工作区」fails.
Executed evidence on this machine:
1. PowerShell 5.1 stdout is system ANSI (CP936); Node decoded utf8 → Chinese path mojibake → realpath ENOENT. Forcing UTF-8 round-trips.
2. FolderBrowserDialog.ShowDialog() with no owner from a hidden companion: dialog behind Chrome / hung. TopMost 1×1 owner form completes.
3. `fs.realpathSync` preserves input drive-letter case (`c:\` !== `C:\`); `consumeNativePick` used `!==` and could reject a valid pick.

Fix scope (only these files):
- companion/src/obsidian/folder-picker.ts
- companion/src/capability/workspace.ts
- companion/src/message-router.ts
- companion/tests/folder-picker.test.ts (new)
- companion/tests/workspace-native-pick.test.ts (new)

Author tests: 9/9 × 3 on Windows, including Chinese-path UTF-8 round-trip (no GUI).

Review axes:
- Correctness of the Windows picker (STA, UTF-8, owner form, absolute powershell.exe, timeout, cancel vs error)
- Command-injection / quoting in the generated PowerShell (`psSingleQuote`, `-Command` script)
- `consumeNativePick` / `pathsEqualForBind` (case fold, `\\?\` prefix, TOCTOU, still requiring a recent native pick)
- `workspace.pick` using `pickFolderNativeImpl` + `cancelled: true` vs error
- Tests: do they actually lock the contract? Gaps?
- Residual: dialog z-order, junction/symlink bind, file picker sibling

Do NOT demand unrelated refactors. Do NOT invent files outside the diff.

Output:
1. Findings ranked BLOCK / MAJOR / NIT with file:line if possible
2. What you independently confirmed vs assumed
3. Final line exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REQUEST CHANGES

--- FROZEN DIFF ---
