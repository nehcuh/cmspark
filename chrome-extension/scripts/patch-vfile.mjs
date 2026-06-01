// Patch vfile's Subpath imports (#minpath, #minproc, #minurl) to browser variants.
// Parcel 2.9 (used by Plasmo) cannot resolve Node.js package.json "imports" field.
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

function findVfileIndex() {
  // 1. Standard npm/pnpm resolution
  try {
    const resolved = fileURLToPath(
      import.meta.resolve("vfile/lib/index.js", import.meta.url)
    )
    if (existsSync(resolved)) return resolved
  } catch {}

  // 2. cnpm / npminstall fallback (.store/node_modules)
  const cnpmPath = join(
    __dirname, "..", "node_modules", ".store", "node_modules", "vfile", "lib", "index.js"
  )
  if (existsSync(cnpmPath)) return cnpmPath

  return null
}

const vfileIndex = findVfileIndex()

if (!vfileIndex) {
  console.log("vfile not found, skipping patch.")
  process.exit(0)
}

let content = readFileSync(vfileIndex, "utf8")

// Avoid double-patching
if (content.includes("minpath.browser.js")) {
  console.log("vfile already patched, skipping.")
  process.exit(0)
}

content = content
  .replace("from '#minpath'", "from './minpath.browser.js'")
  .replace("from '#minproc'", "from './minproc.browser.js'")
  .replace("from '#minurl'", "from './minurl.browser.js'")

writeFileSync(vfileIndex, content)
console.log("vfile subpath imports patched to browser variants.")
