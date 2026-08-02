import test from "node:test"
import assert from "node:assert/strict"
import { sanitizePythonPackages } from "../src/computer/python-runtime"

test("sanitizePythonPackages drops flags and urls", () => {
  const pkgs = sanitizePythonPackages([
    "torch",
    "--index-url",
    "https://evil.example/simple",
    "-e",
    "/tmp/evil",
    "git+https://x",
    "modelscope",
    "not-a-real-pkg-xyz",
  ])
  assert.deepEqual(pkgs.sort(), ["modelscope", "torch"].sort())
})

test("sanitizePythonPackages empty → default set", () => {
  const pkgs = sanitizePythonPackages([])
  assert.ok(pkgs.includes("torch"))
  assert.ok(pkgs.includes("modelscope"))
})
