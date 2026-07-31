import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  ensureProjectDir,
  sanitizeProjectName,
  cmsparkProjectsRoot,
} from "../src/capability/project-dir"

test("sanitizeProjectName strips path separators and keeps CJK", () => {
  assert.equal(sanitizeProjectName("中国量子计算_report"), "中国量子计算_report")
  assert.ok(!sanitizeProjectName("a/b\\c").includes("/"))
  assert.ok(!sanitizeProjectName("a/b\\c").includes("\\"))
})

test("ensureProjectDir creates under ~/CMspark-projects when no workspace", () => {
  const name = `test-proj-${Date.now().toString(36)}`
  const r = ensureProjectDir({ name, workspaceRoot: null, prefer: "home" })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.source, "home")
  assert.ok(r.path.startsWith(cmsparkProjectsRoot()))
  assert.ok(fs.existsSync(r.path) && fs.statSync(r.path).isDirectory())
  // cleanup
  fs.rmSync(r.path, { recursive: true, force: true })
})

test("ensureProjectDir uses workspace when set", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-ws-"))
  const name = "report-x"
  const r = ensureProjectDir({ name, workspaceRoot: ws, prefer: "auto" })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.source, "workspace")
  assert.equal(r.path, path.join(fs.realpathSync(ws), "report-x"))
  assert.ok(fs.existsSync(r.path))
  fs.rmSync(ws, { recursive: true, force: true })
})
