import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

test("daemon logs reads the selected profile even when default logs exist", t => {
  const home = mkdtempSync(path.join(tmpdir(), "cmspark-log-profile-"))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const selected = path.join(home, "selected")
  const saveLog = (root: string, message: string, date: string) => {
    const dir = path.join(root, "logs")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, `companion-${date}.log`), message)
  }
  const read = () => {
    const result = spawnSync(process.execPath, [require.resolve("../src/index"), "daemon", "logs"], {
      env: { ...process.env, HOME: home, USERPROFILE: home, CMSPARK_DATA_DIR: selected },
      windowsHide: true, timeout: 30_000, encoding: "utf8",
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stdout, /DEFAULT_MARKER/)
    return result.stdout
  }
  saveLog(path.join(home, ".cmspark-agent"), "DEFAULT_MARKER", "2026-01-01")
  assert.match(read(), /No log files found/)
  saveLog(selected, "OLDER_LOG", "2000-01-01")
  const lines = Array.from({ length: 51 }, (_, i) => `selected-line-${i}`)
  saveLog(selected, lines.join("\n"), "9999-12-31")
  const latest = read()
  assert.match(latest, /companion-9999-12-31\.log/)
  assert.doesNotMatch(latest, /OLDER_LOG|selected-line-0\b/)
  assert.match(latest, /selected-line-1\b/)
  assert.match(latest, /selected-line-50\b/)
})
