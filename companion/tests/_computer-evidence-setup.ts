// Test-isolation setup — MUST be the first import in computer-evidence.test.ts.
//
// Same root cause as _threads-history-setup.ts: src/config.ts computes
// `DATA_DIR = process.env.CMSPARK_DATA_DIR || os.homedir()/.cmspark-agent` at
// module-load time. This file's HistoryStore redaction tests must never touch
// the developer's REAL ~/.cmspark-agent/history.db, so the env override has to
// land before ANY src import (static or dynamic).
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-computer-evidence-data-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp

process.on("exit", () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best-effort */ }
})
