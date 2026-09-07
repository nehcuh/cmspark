import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"

test("test preload isolates each process before config imports and leaves caller data untouched", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-isolation-contract-"))
  const callerDir = path.join(root, "caller")
  fs.mkdirSync(callerDir)
  const sentinel = '{"security":{"auto_approve_dangerous":true}}'
  fs.writeFileSync(path.join(callerDir, "config.json"), sentinel)
  const preload = path.resolve(__dirname, "../../scripts/test-data-dir.cjs")
  const configModule = path.resolve(__dirname, "../src/config.js")
  try {
    const dirs = [0, 1].map(() => {
      const child = spawnSync(process.execPath, ["--require", preload, "-e", `
        const { DATA_DIR, getConfig, saveConfig } = require(${JSON.stringify(configModule)});
        if (getConfig().security.auto_approve_dangerous === true) throw new Error('inherited caller policy');
        saveConfig({security: {...getConfig().security, auto_approve_dangerous: true}});
        process.stdout.write('DATA_DIR=' + DATA_DIR);
      `], {
        encoding: "utf8",
        env: { ...process.env, CMSPARK_TEST_RUN_DIR: root, CMSPARK_DATA_DIR: callerDir },
      })
      assert.equal(child.status, 0, child.stderr)
      const dir = child.stdout.split("DATA_DIR=").at(-1)!
      assert.equal(path.dirname(dir), root)
      assert.notEqual(dir, callerDir)
      return dir
    })
    assert.notEqual(dirs[0], dirs[1], "test workers must not share mutable config")
    assert.equal(fs.readFileSync(path.join(callerDir, "config.json"), "utf8"), sentinel)
    assert.deepEqual(fs.readdirSync(callerDir), ["config.json"])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("test runner isolates workers, supports targeted runs, and cleans data after a failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-worker-contract-"))
  const scripts = path.join(root, "scripts")
  const fixtures = path.join(root, ".test-dist", "tests")
  fs.mkdirSync(scripts, { recursive: true })
  fs.mkdirSync(fixtures, { recursive: true })
  const caller = path.join(root, "caller")
  fs.mkdirSync(caller)
  fs.writeFileSync(path.join(caller, "sentinel"), "untouched")
  fs.writeFileSync(path.join(fixtures, "unselected.test.js"), `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, "unselected-ran"))}, 'bad')`)
  for (const name of ["run-tests.mjs", "test-data-dir.cjs"]) {
    fs.copyFileSync(path.resolve(__dirname, "../../scripts", name), path.join(scripts, name))
  }
  try {
    const files = ["a", "b"].map(name => {
      const filename = path.join(fixtures, `${name}.test.js`)
      fs.writeFileSync(filename, `
        const fs = require('node:fs');
        const { spawnSync } = require('node:child_process');
        const dir = process.env.CMSPARK_DATA_DIR;
        const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.CMSPARK_DATA_DIR)'], { encoding: 'utf8' });
        if (child.status !== 0 || child.stdout !== dir) throw new Error('unsafe child inheritance');
        fs.writeFileSync(${JSON.stringify(path.join(root, name + ".json"))}, JSON.stringify({dir}));
        require('node:test')('worker fixture', () => {
          if (${JSON.stringify(name)} === "b") throw new Error('intentional test failure');
        });
      `)
      return filename
    })
    const env = { ...process.env, CMSPARK_TEST_RUN_DIR: root, CMSPARK_DATA_DIR: path.join(root, "caller") }
    // Start a new test runner, not a child impersonating this runner's IPC worker.
    delete (env as NodeJS.ProcessEnv).NODE_TEST_CONTEXT
    const run = spawnSync(process.execPath, [path.join(scripts, "run-tests.mjs"), ...files], {
      encoding: "utf8",
      env,
    })
    assert.equal(run.status, 1, "failing test must propagate failure: " + run.stdout + run.stderr)
    assert.ok(fs.existsSync(path.join(root, "a.json")), run.stdout + run.stderr)
    const dirs = ["a", "b"].map(name => JSON.parse(fs.readFileSync(path.join(root, name + ".json"), "utf8")).dir)
    assert.notEqual(dirs[0], dirs[1])
    assert.equal(path.dirname(dirs[0]), path.dirname(dirs[1]))
    for (const dir of dirs) assert.equal(fs.existsSync(dir), false, "runner cleans worker data on failure")
    assert.equal(fs.readFileSync(path.join(caller, "sentinel"), "utf8"), "untouched")
    assert.deepEqual(fs.readdirSync(caller), ["sentinel"])
    assert.equal(fs.existsSync(path.join(root, "unselected-ran")), false, "targeted runner must skip other discovered files")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
