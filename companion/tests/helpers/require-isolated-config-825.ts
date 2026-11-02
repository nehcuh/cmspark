import path from 'node:path'

// This file must be the first import in tests that write the global config.
const root = process.env.CMSPARK_TEST_RUN_DIR, directory = process.env.CMSPARK_DATA_DIR
const relative = root && directory ? path.relative(root, directory) : '..'
if (!root || !path.isAbsolute(root) || !directory || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
  throw new Error('This config-writing test requires the isolated test runner: node scripts/run-tests.mjs <compiled-test>')
}
