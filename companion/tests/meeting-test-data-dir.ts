/**
 * Must be imported *before* any module that reads config.DATA_DIR.
 * ESM evaluates static imports before the importer body, so assigning
 * process.env.CMSPARK_DATA_DIR at the top of a test file is too late.
 */
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

if (!process.env.CMSPARK_DATA_DIR) {
  process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "cmspark-meeting-"),
  )
}

export const MEETING_TEST_DATA_DIR = process.env.CMSPARK_DATA_DIR
