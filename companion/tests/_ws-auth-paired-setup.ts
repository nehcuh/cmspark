// Test setup: pin CMSPARK_DATA_DIR to a temp dir BEFORE ws-auth.ts evaluates, so
// markPaired() writes its marker into an isolated directory. This file MUST be
// imported first by any test that imports ../src/ws-auth — ES imports are hoisted
// and evaluated in source order, so this side effect runs before ws-auth captures
// DATA_DIR. Mirrors the _config-router-setup.ts / _threads-history-setup.ts pattern.

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-wsauth-paired-"))
process.env.CMSPARK_DATA_DIR = tmp

export const DATA_DIR = tmp
