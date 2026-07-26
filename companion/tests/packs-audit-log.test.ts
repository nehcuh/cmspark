import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { appendCapabilityAudit } from "../src/packs/audit-log"

test("append creates restricted file with one json line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"))
  const p = path.join(dir, "capability-audit.jsonl")
  appendCapabilityAudit(
    { type: "pack.apply", pack_id: "x", thread_id: "t1", at: new Date().toISOString() },
    p,
  )
  assert.ok(fs.existsSync(p))
  const st = fs.statSync(p)
  // not world/group writable
  assert.equal(st.mode & 0o022, 0)
  const line = fs.readFileSync(p, "utf8").trim()
  assert.equal(JSON.parse(line).type, "pack.apply")
})

test("oversized line does not throw", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"))
  const p = path.join(dir, "capability-audit.jsonl")
  const huge = "x".repeat(300_000)
  appendCapabilityAudit({ type: "pack.apply", pack_id: huge, at: new Date().toISOString() }, p)
  // may create empty file or no content for that event
  assert.ok(true)
})
