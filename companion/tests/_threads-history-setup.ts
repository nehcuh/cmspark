// Test-isolation setup — MUST be the first import in threads-history.test.ts.
//
// Same root cause as security-gates.test.ts (fixed in P1-1): src/config.ts computes
// `DATA_DIR = process.env.CMSPARK_DATA_DIR || os.homedir()/.cmspark-agent` at module-load time
// (when src/threads/thread-manager.ts and src/history/store.ts are imported statically). The
// test's `before()` sets process.env.HOME to a temp dir, but that runs AFTER the static imports
// — too late. So DATA_DIR locked to the developer's REAL ~/.cmspark-agent, and ThreadManager /
// HistoryStore read the user's REAL threads + history.db (e.g. 5 real threads → "list length 5
// not 2"). Setting CMSPARK_DATA_DIR here, before any src import, isolates the file.
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-threads-history-data-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp

process.on("exit", () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best-effort */ }
})
