import test from "node:test"
import assert from "node:assert/strict"
import { windowsTargetEnvironment } from "../src/process/windows-env"

const decode = (env: NodeJS.ProcessEnv, host: NodeJS.ProcessEnv = {}) => windowsTargetEnvironment(env, host).toString("utf16le").split("\0").filter(Boolean)
test("Windows explicit target environment preserves values without host secrets", () => {
  const env = { EMPTY: "", VALUE: "中文=x&y", Path: "configured", UNSET: undefined }
  assert.deepEqual(decode(env, { PATH: "host", SystemRoot: "C:\\Windows", SECRET: "never forward" }), ["EMPTY=", "Path=configured", "VALUE=中文=x&y", "SystemRoot=C:\\Windows"])
  assert.equal(windowsTargetEnvironment({}, {}).length, 4)
  assert.equal(windowsTargetEnvironment(env, {}).subarray(-4).equals(Buffer.alloc(4)), true)
})
test("Windows env case collisions match Node's sorted-first rule and libuv defaults", () => {
  assert.deepEqual(decode({ Path: "first", path: "second", TEMP: "", TEMPORARY: "custom" }, { PATH: "host", TEMP: "host" }), ["Path=first", "TEMP=", "TEMPORARY=custom"])
  assert.deepEqual(decode({ PATH: undefined, Path: "discarded" }, { Path: "host" }), ["Path=host"])
})
test("Windows target environment rejects malformed entries without exposing values", () => {
  for (const env of [{ BAD: "secret\0value" }, { "bad\0name": "secret" }, { "bad=name": "secret" }, { "": "secret" }]) {
    assert.throws(() => windowsTargetEnvironment(env, {}), { message: "Invalid Windows environment entry" })
  }
  assert.deepEqual(decode({ "=C:": "C:\\owned" }), ["=C:=C:\\owned"])
})
