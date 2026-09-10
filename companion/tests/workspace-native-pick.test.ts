import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  consumeNativePick,
  pathsEqualForBind,
  recordNativePick,
  setWorkspaceRoot,
  stripWinLongPathPrefix,
} from "../src/capability/workspace"

test("pathsEqualForBind is case-insensitive on win32 only", () => {
  assert.equal(
    pathsEqualForBind("C:\\Users\\HuChen\\proj", "c:\\Users\\HuChen\\proj", "win32"),
    true,
  )
  assert.equal(
    pathsEqualForBind("/Users/a", "/Users/A", "darwin"),
    false,
  )
  assert.equal(
    pathsEqualForBind("/Users/a", "/Users/a", "darwin"),
    true,
  )
})

test("pathsEqualForBind strips Windows long-path prefix", () => {
  assert.equal(stripWinLongPathPrefix("\\\\?\\C:\\Users\\x"), "C:\\Users\\x")
  assert.equal(
    pathsEqualForBind("\\\\?\\C:\\Users\\x", "C:\\Users\\x", "win32"),
    true,
  )
})

test("consumeNativePick accepts drive-letter case variants after realpath", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-pick-case-"))
  try {
    const real = fs.realpathSync(dir)
    const flipped = real[0] === real[0].toUpperCase()
      ? real[0].toLowerCase() + real.slice(1)
      : real[0].toUpperCase() + real.slice(1)
    recordNativePick(real)
    assert.equal(consumeNativePick(flipped), true)
    assert.equal(consumeNativePick(flipped), false, "pick is single-use")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("setWorkspaceRoot binds when recorded path differs only by drive-letter case", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-pick-bind-"))
  try {
    const real = fs.realpathSync(dir)
    const flipped = real[0] === real[0].toUpperCase()
      ? real[0].toLowerCase() + real.slice(1)
      : real[0].toUpperCase() + real.slice(1)
    recordNativePick(real)
    const bound = setWorkspaceRoot(flipped)
    assert.equal(bound.ok, true, bound.ok ? "" : bound.error)
    if (bound.ok) {
      assert.equal(path.normalize(bound.path).toLowerCase(), path.normalize(real).toLowerCase())
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
