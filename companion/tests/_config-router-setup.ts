// Test-isolation setup — MUST be the first import in message-router-config-security.test.ts.
//
// Mirrors tests/integration/_security-gates-setup.ts: src/config.ts captures DATA_DIR from
// process.env.CMSPARK_DATA_DIR at module-load time. message-router.ts imports config.ts
// transitively, so DATA_DIR is locked the moment we statically import handleMessage — which
// happens BEFORE any before() hook. Setting CMSPARK_DATA_DIR here (this file is imported first)
// pins both modules to this throwaway temp dir, isolating the config.set nesting assertions
// from the developer's real ~/.cmspark-agent.
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-cfg-router-data-"))
process.env.CMSPARK_DATA_DIR = tmp
process.env.HOME = tmp

process.on("exit", () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best-effort */ }
})
