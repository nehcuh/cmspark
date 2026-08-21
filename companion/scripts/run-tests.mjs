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

function nodeMajor() {
  return Number.parseInt(String(process.versions.node).split(".")[0], 10) || 0
}

/** Node 22+ only. Node 20 rejects the flag (exit 9) after a green main suite. */
function settingsWebIsolationArgs() {
  if (nodeMajor() < 22) return []
  // Node 22 child-process test IPC intermittently V8-deserializes stdout
  // ("Unable to deserialize cloned data…", nodejs/node#64061 / camunda/c8ctl#182;
  // same English error as the older structuredClone ticket #49844, different stack).
  // A lone in-process file has no IPC channel. Unflagged --test-isolation exists
  // only on Node >= 23; Node 22 rejects it; 22 and 24 accept the experimental name.
  return ["--experimental-test-isolation=none"]
}

let code = runNodeTest(main)
if (code === 0) code = runNodeTest(settings, settingsWebIsolationArgs())
process.exit(code)
