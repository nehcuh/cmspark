// Test-isolation setup — MUST be the first import in security-gates.test.ts.
//
// src/config.ts computes `DATA_DIR = process.env.CMSPARK_DATA_DIR || os.homedir()/.cmspark-agent`
// at module-load time (when src/server.ts is imported transitively). The test's `before()` hook
// sets process.env.HOME to a temp dir, but that runs AFTER the static imports — too late: DATA_DIR
// is already locked to the developer's REAL ~/.cmspark-agent. The test then reads the real config
// (which may have auto_approve_dangerous / trusted_domains set for the user's own workflows),
// breaking the security-gate assertions (evaluate/navigate confirmations get auto-approved).
//
// Setting CMSPARK_DATA_DIR here — before src/server.ts is imported — makes config.ts compute
// DATA_DIR against this throwaway temp dir, isolating the test. (config.test.ts / history.test.ts
// achieve the same via dynamic import inside `before`; this file does it via import ordering so the
// rest of security-gates.test.ts can keep its static imports.)
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-secg-data-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp

process.on("exit", () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best-effort */ }
})
