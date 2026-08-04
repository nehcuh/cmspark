// Must be first import in outbound-mcp-grants.test.ts — locks CMSPARK_DATA_DIR
// before config/outbound-grants compute DATA_DIR / GRANTS_PATH.
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-grants-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp

process.on("exit", () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})
