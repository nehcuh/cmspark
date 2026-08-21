/**
 * Cross-platform companion test runner (MAINT-7 / P2).
 * Replaces Unix find in package.json so Windows CI/dev works.
 *
 * Runs all compiled tests under .test-dist/tests matching *.test.js except:
 *  - files starting with underscore
 *  - settings-web.test.js (run last, serial — port contention)
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const testsRoot = path.join(root, ".test-dist", "tests")

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.isFile() && ent.name.endsWith(".test.js") && !ent.name.startsWith("_")) {
      out.push(p)
    }
  }
  return out
}

const all = walk(testsRoot)
const settings = all.filter((f) => path.basename(f) === "settings-web.test.js")
const main = all.filter((f) => path.basename(f) !== "settings-web.test.js")

if (main.length === 0 && settings.length === 0) {
  console.error("No tests found under", testsRoot)
  process.exit(1)
}

function runNodeTest(files, extraArgs = []) {
  if (files.length === 0) return 0
  const r = spawnSync(process.execPath, ["--test", ...extraArgs, ...files], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  })
  return r.status ?? 1
}

let code = runNodeTest(main)
// settings-web is a single file run last; execute it in-process
// (--experimental-test-isolation=none). Node 22's child-process test IPC has
// an intermittent V8 deserialization crash ("Unable to deserialize cloned
// data due to invalid or unsupported version", nodejs/node#49844) that fails
// the file after all its tests pass. A lone in-process file has no IPC
// channel, so the flake class is eliminated; isolation semantics are
// unchanged (there are no sibling files to share state with). The
// experimental flag name is used because the unflagged --test-isolation only
// exists on Node >= 23 — Node 22 (CI + shipped runtime) rejects it, while
// both 22 and 24 accept the experimental spelling.
if (code === 0) code = runNodeTest(settings, ["--experimental-test-isolation=none"])
process.exit(code)
