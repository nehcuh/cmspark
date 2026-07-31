import test from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import {
  extractPathCandidate,
  resolveAllowDirToOffer,
  isAccessDeniedMcpError,
  isParentMissingMcpError,
} from "../src/mcp/allow-dir-expand"

test("extractPathCandidate from params and error text", () => {
  assert.equal(
    extractPathCandidate("x", { path: "/Users/huchen/foo/bar.md" }),
    "/Users/huchen/foo/bar.md",
  )
  const fromErr = extractPathCandidate(
    "Access denied - path outside allowed directories: /Users/huchen/secret",
    {},
  )
  assert.ok(fromErr && fromErr.includes("secret"))
})

test("resolveAllowDirToOffer only under home", () => {
  const home = os.homedir()
  const ok = resolveAllowDirToOffer(path.join(home, "Documents", "x"), home)
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.ok(ok.dir.includes(home) || ok.dir.startsWith(home))
  }
  const bad = resolveAllowDirToOffer("/etc/passwd", home)
  assert.equal(bad.ok, false)
})

test("error classifiers", () => {
  assert.equal(isParentMissingMcpError("Parent directory does not exist: /a/b"), true)
  assert.equal(isAccessDeniedMcpError("Access denied - path outside allowed directories: /x"), true)
  assert.equal(isAccessDeniedMcpError("Parent directory does not exist"), false)
})
