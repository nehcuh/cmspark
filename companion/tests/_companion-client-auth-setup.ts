// MUST be imported FIRST in the test file. Pins CMSPARK_DATA_DIR to an isolated
// temp dir and writes a KNOWN ws_secret there BEFORE ws-auth/config load — so the
// real CompanionClient (which calls getOrCreateSharedSecret()) reads our test
// secret, never the user's real ~/.cmspark-agent/ws_secret.
//
// node --test runs each file in its own worker, so this state is file-scoped.

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as crypto from "crypto"

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-cc-auth-"))
process.env.CMSPARK_DATA_DIR = tmpDir

export const TEST_DATA_DIR = tmpDir
/** The secret written to <tmpDir>/ws_secret — what the client must HMAC over. */
export const TEST_SECRET = crypto.randomBytes(32).toString("hex")

fs.writeFileSync(path.join(tmpDir, "ws_secret"), TEST_SECRET + "\n", { mode: 0o600 })
