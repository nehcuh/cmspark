// Atomic file-write helpers.
//
// Used for config.json and per-thread JSON: a direct fs.writeFileSync overwrite leaves a
// TRUNCATED file if the process crashes / loses power mid-write, and the load side then
// silently falls back to defaults — wiping the user's api_key, trusted_domains, MCP servers,
// or an entire conversation with no signal (audit H3). Writing to a temp file and renaming
// is atomic on POSIX (rename(2) is atomic) and on Windows (MoveFileEx with REPLACE_EXISTING
// is atomic for same-volume renames), so a crash can leave either the OLD good file or the
// NEW complete file, never a torn one.
//
// Mode defaults to 0o600 (owner-only): these files hold secrets (llm.api_key) and private
// conversation history.

import * as fs from "fs"

export function atomicWriteJSON(filePath: string, data: unknown, mode: number = 0o600): void {
  const tmp = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode })
  try {
    fs.renameSync(tmp, filePath)
  } catch (err) {
    // rename failed (e.g. cross-device — shouldn't happen since tmp is same dir, but be safe) —
    // don't leak the tmp file; clean up and rethrow so the caller sees the write failed.
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    throw err
  }
  // rename may inherit the tmp file's mode on some filesystems; enforce explicitly. Best-effort
  // (some platforms/fs don't support chmod) — the tmp was already created with `mode`.
  try { fs.chmodSync(filePath, mode) } catch { /* ignore */ }
}

export function atomicWriteText(filePath: string, contents: string, mode: number = 0o600): void {
  const tmp = `${filePath}.tmp-${process.pid}`
  fs.writeFileSync(tmp, contents, { mode })
  try {
    fs.renameSync(tmp, filePath)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    throw err
  }
  try { fs.chmodSync(filePath, mode) } catch { /* ignore */ }
}
