// Isolate ACP gate tests from ~/.cmspark-agent (must be first import).
// config.ts captures CMSPARK_DATA_DIR at module load.
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-acp-gates-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp

process.on("exit", () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})
