/**
 * Cross-platform companion test runner (MAINT-7 / P2).
 * Replaces Unix find in package.json so Windows CI/dev works.
 *
 * Runs all compiled tests under .test-dist/tests matching *.test.js except:
 *  - files starting with underscore
 *  - settings-web.test.js (run last, serial — port contention)
 * For targeted debugging, compile then pass compiled test paths as arguments:
 * node scripts/run-tests.mjs .test-dist/tests/example.test.js
 * Direct node --test bypasses data-dir isolation. This is config-data isolation,
 * not a filesystem sandbox; tests must still mock host/filesystem tool effects.
 */
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
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

const discovered = walk(testsRoot).map(f => fs.realpathSync(f))
const requested = process.argv.slice(2).map(f => {
  const resolved = path.resolve(root, f)
  // macOS /var -> /private/var and symlinked working directories must compare
  // by the same physical path as the runner's import URL.
  return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved
})
if (requested.some(f => !discovered.includes(f))) {
  console.error("Requested test is not a compiled test under", testsRoot)
  process.exit(1)
}
const all = requested.length ? [...new Set(requested)] : discovered
const settings = all.filter((f) => path.basename(f) === "settings-web.test.js")
const main = all.filter((f) => path.basename(f) !== "settings-web.test.js")

if (main.length === 0 && settings.length === 0) {
  console.error("No tests found under", testsRoot)
  process.exit(1)
}

// Windows CreateProcess caps the command line at 32767 chars. Passing every
// compiled test path in a single spawn overflows it once the suite is large
// enough: spawnSync then fails with r.error.code === "ENAMETOOLONG", r.status
// is null, and (before #546) `return r.status ?? 1` silently swallowed the
// error — exit 1 with zero output, indistinguishable from "every test failed".
// Batch the file list so no single command line can approach the cap, and
// surface r.error explicitly so a spawn failure is never mistaken for a
// test failure. POSIX has no such cap, so batching is a no-op safety net there.
const MAX_ARGV_CHARS = 32000 // stay clear of the 32767 hard limit
function argvChars(execPath, fixedArgs, batch) {
  let n = execPath.length + 2 // quoting slack
  for (const a of fixedArgs) n += a.length + 1
  for (const f of batch) n += f.length + 1
  return n
}
function chunkByArgv(execPath, fixedArgs, files) {
  const batches = []
  let cur = []
  for (const f of files) {
    if (cur.length > 0 && argvChars(execPath, fixedArgs, [...cur, f]) > MAX_ARGV_CHARS) {
      batches.push(cur)
      cur = []
    }
    cur.push(f)
  }
  if (cur.length > 0) batches.push(cur)
  return batches
}

function runNodeTest(files, extraArgs = []) {
  if (files.length === 0) return 0
  const preload = path.join(root, "scripts", "test-data-dir.cjs")
  const fixedArgs = ["--require", preload, "--test", ...extraArgs]
  const batches = chunkByArgv(process.execPath, fixedArgs, files)
  let worst = 0
  for (const batch of batches) {
    const r = spawnSync(process.execPath, [...fixedArgs, ...batch], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, CMSPARK_TEST_RUN_DIR: testRunDir },
    })
    // A spawn failure is NOT a test failure — report it loudly and fail closed.
    if (r.error) {
      console.error(
        `[run-tests] failed to spawn node for a batch of ${batch.length} test file(s): ` +
          `${r.error.code || ""} ${r.error.message}`,
      )
      console.error(`[run-tests] argv chars were ~${argvChars(process.execPath, fixedArgs, batch)}; first file: ${batch[0]}`)
      return 1
    }
    if (r.status !== 0) worst = r.status ?? 1
    if (r.signal) {
      console.error(`[run-tests] test batch terminated by signal ${r.signal}`)
      worst = worst || 1
    }
  }
  return worst
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

const testRunDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-test-run-"))
let code = 1
try {
  code = runNodeTest(main)
  if (code === 0) code = runNodeTest(settings, settingsWebIsolationArgs())
} finally {
  // SIGKILL/host shutdown may leave a temp root; no production data lives here.
  try {
    fs.rmSync(testRunDir, { recursive: true, force: true })
  } catch (error) {
    console.error("Test data cleanup failed (test exit code:", code, "):", error)
    code = code || 1
  }
}
process.exit(code)
