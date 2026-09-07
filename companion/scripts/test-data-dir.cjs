// Preload before any application import. Each Node test process gets its own
// data directory, even when the invoking shell points at a real installation.
// Descendants inherit that safe directory unless a test explicitly supplies one.
const fs = require('node:fs')
const path = require('node:path')
const root = process.env.CMSPARK_TEST_RUN_DIR
if (!root || !path.isAbsolute(root)) {
  throw new Error('test-data-dir preload requires an absolute CMSPARK_TEST_RUN_DIR')
}
process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(path.join(root, 'process-'))
