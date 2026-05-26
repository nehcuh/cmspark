// Patch vfile's Subpath imports (#minpath, #minproc, #minurl) to browser variants.
// Parcel 2.9 (used by Plasmo) cannot resolve Node.js package.json "imports" field.
import { readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const vfileIndex = join(__dirname, "..", "node_modules", "vfile", "lib", "index.js")

let content = readFileSync(vfileIndex, "utf8")
content = content
  .replace("from '#minpath'", "from './minpath.browser.js'")
  .replace("from '#minproc'", "from './minproc.browser.js'")
  .replace("from '#minurl'", "from './minurl.browser.js'")

writeFileSync(vfileIndex, content)
console.log("vfile subpath imports patched to browser variants.")
