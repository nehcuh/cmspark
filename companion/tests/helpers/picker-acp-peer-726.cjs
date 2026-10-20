// Synthetic ACP transport only, never an external provider. Record actual cwd
// before executing the existing protocol fixture; no task/repository reads.
const fs = require('node:fs');
const target = process.env.FIXTURE_CWD_FILE;
fs.writeFileSync(target + '.pending', JSON.stringify({ schema: 1, cwd: fs.realpathSync(process.cwd()) }), { flag: 'wx', mode: 0o600 });
fs.renameSync(target + '.pending', target);
require('../fixtures/acp-lifecycle.cjs');
