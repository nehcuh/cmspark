// This must be the first import. Static imports run before the test body, and
// config.DATA_DIR captures the directory at module initialization.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const runDir = process.env.CMSPARK_TEST_RUN_DIR
const preloaded = process.env.CMSPARK_DATA_DIR

function dataDirForMeetingTests(): string {
  if (runDir && preloaded && path.dirname(preloaded) === runDir) return preloaded

  // Direct node --test has no runner preload. Never use the operator's data.
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-meeting-"))
  process.on("exit", () => {
    try { fs.rmSync(owned, { recursive: true, force: true }) } catch { /* best effort on exit */ }
  })
  return owned
}

export const MEETING_TEST_DATA_DIR = dataDirForMeetingTests()
process.env.CMSPARK_DATA_DIR = MEETING_TEST_DATA_DIR
