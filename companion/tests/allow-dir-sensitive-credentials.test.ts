/**
 * L3 (post-merge-198-201 adversary): common credential paths under home must be
 * refused as MCP allow-dirs too — SENSITIVE_HOME_PREFIXES is shared with the
 * file-open cage (tool/file-url-admission.ts), keep both surfaces aligned.
 * Isolates HOME so the test does not depend on the developer machine.
 */
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-allow-dir-creds-"))
process.env.HOME = tempHome
process.env.USERPROFILE = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
process.on("exit", () => {
  try {
    fs.rmSync(tempHome, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

import test from "node:test"
import assert from "node:assert/strict"
import { resolveAllowDirToOffer, SENSITIVE_HOME_PREFIXES } from "../src/mcp/allow-dir-expand"

test("SENSITIVE_HOME_PREFIXES covers common credential files/dirs (L3)", () => {
  for (const p of [".git-credentials", ".npmrc", ".netrc", ".docker"]) {
    assert.ok(SENSITIVE_HOME_PREFIXES.includes(p), `missing ${p}`)
  }
})

test("resolveAllowDirToOffer refuses ~/.docker as an allow-dir (L3)", () => {
  const docker = path.join(tempHome, ".docker")
  fs.mkdirSync(docker, { recursive: true })
  const r = resolveAllowDirToOffer(docker, tempHome)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /sensitive/i)
})

test("resolveAllowDirToOffer refuses a file under ~/.npmrc parent walk-up stays refused (L3)", () => {
  // .npmrc is a file: offering its parent would be home itself (already refused),
  // but a same-named directory must hit the sensitive-prefix cage.
  const npmrcDir = path.join(tempHome, ".npmrc")
  fs.mkdirSync(npmrcDir, { recursive: true })
  const r = resolveAllowDirToOffer(path.join(npmrcDir, "x"), tempHome)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /sensitive/i)
})
