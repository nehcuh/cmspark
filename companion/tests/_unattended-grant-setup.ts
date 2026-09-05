// Test-isolation setup — MUST be the first import in computer-unattended-grant.test.ts.
//
// Mirrors tests/_config-router-setup.ts: src/config.ts captures DATA_DIR from
// process.env.CMSPARK_DATA_DIR at module-load time. unattended-grant.ts imports
// DATA_DIR from config.ts transitively, and (issue #347) now writes the
// capability-audit.jsonl lifecycle events via packs/audit-log (which resolves the
// log path from getConfigDir()). Pinning CMSPARK_DATA_DIR before any module import
// keeps those writes inside this throwaway temp dir instead of the developer's
// real ~/.cmspark-agent/logs/capability-audit.jsonl.
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-unattended-grant-data-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp

process.on("exit", () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})
