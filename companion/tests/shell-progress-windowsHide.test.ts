/**
 * #au4dch SH-A: windowsHide spawn options + progress tails + tailChars.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  shellSpawnOptions,
  shellSpawnArgvOptions,
  tryParseSimpleArgv,
  shouldUseArgvSpawn,
  hasShellAllowlistMetachar,
  tailChars,
  PROGRESS_TAIL_CHARS,
  buildChildEnv,
} from "../src/capability/shell"

describe("shellSpawnOptions", () => {
  it("always sets windowsHide true (win console flash fix)", () => {
    const o = shellSpawnOptions("/tmp", buildChildEnv())
    assert.equal(o.shell, true)
    assert.equal(o.windowsHide, true)
    assert.equal(o.cwd, "/tmp")
    // POSIX: detached so killProcessTree can SIGKILL the process group
    if (process.platform !== "win32") {
      assert.equal(o.detached, true)
    } else {
      assert.equal(o.detached, false)
    }
  })
})

describe("tryParseSimpleArgv (P1b)", () => {
  it("parses simple tokens", () => {
    assert.deepEqual(tryParseSimpleArgv("echo hello"), ["echo", "hello"])
  })
  it("parses double-quoted args", () => {
    assert.deepEqual(tryParseSimpleArgv('python "my script.py" --flag'), [
      "python",
      "my script.py",
      "--flag",
    ])
  })
  it("preserves Windows path backslashes inside quotes (B2)", () => {
    assert.deepEqual(tryParseSimpleArgv('python "C:\\Users\\t\\script.py" --flag'), [
      "python",
      "C:\\Users\\t\\script.py",
      "--flag",
    ])
  })
  it("rejects metacharacters", () => {
    assert.equal(tryParseSimpleArgv("echo ok; rm -rf /"), null)
    assert.equal(hasShellAllowlistMetachar("echo ok; rm"), true)
  })
  it("rejects env expansion and globs", () => {
    assert.equal(tryParseSimpleArgv("echo $HOME"), null)
    assert.equal(tryParseSimpleArgv("ls *.txt"), null)
  })
  it("rejects ENV=value prefixes and unquoted ~ (S41 P0 — stay shell:true)", () => {
    assert.equal(tryParseSimpleArgv("FOO=1 ls"), null)
    assert.equal(tryParseSimpleArgv("A=b B=c echo hi"), null)
    assert.equal(tryParseSimpleArgv("ls ~"), null)
    assert.equal(tryParseSimpleArgv("cat ~/Downloads/x"), null)
    // Still parses plain commands
    assert.deepEqual(tryParseSimpleArgv("ls /tmp"), ["ls", "/tmp"])
  })
  it("shellSpawnArgvOptions uses shell:false + detached on POSIX", () => {
    const o = shellSpawnArgvOptions("/tmp", buildChildEnv())
    assert.equal(o.shell, false)
    assert.equal(o.windowsHide, true)
    assert.equal(o.detached, process.platform !== "win32")
  })
  it("win32: only .exe/.com use argv; bare names, .bat/.cmd stay shell:true (B1/N1b)", () => {
    const npm = tryParseSimpleArgv("npm run build")
    assert.ok(npm)
    assert.equal(shouldUseArgvSpawn(npm, { platform: "win32", policy: "confirm_per_command" }), false)
    assert.equal(shouldUseArgvSpawn(npm, { platform: "win32", policy: "allowlist" }), false)
    assert.equal(shouldUseArgvSpawn(npm, { platform: "linux", policy: "confirm_per_command" }), true)
    const bat = tryParseSimpleArgv("C:\\\\setup.bat --silent")
    assert.ok(bat)
    assert.equal(shouldUseArgvSpawn(bat, { platform: "win32" }), false)
    const exe = tryParseSimpleArgv("C:\\\\Tools\\\\bin.exe --help")
    assert.ok(exe)
    assert.equal(shouldUseArgvSpawn(exe, { platform: "win32", policy: "confirm_per_command" }), true)
    const com = tryParseSimpleArgv("more.com")
    assert.ok(com)
    assert.equal(shouldUseArgvSpawn(com, { platform: "win32" }), true)
  })
})

describe("tailChars", () => {
  it("returns full string when short", () => {
    assert.equal(tailChars("abc", 10), "abc")
  })
  it("returns last N chars when long", () => {
    const s = "x".repeat(100)
    assert.equal(tailChars(s, 10), "x".repeat(10))
    const long = "y".repeat(PROGRESS_TAIL_CHARS + 50)
    assert.equal(tailChars(long).length, PROGRESS_TAIL_CHARS)
  })
})
