import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { captureLocalPageResult, executeDraftTool } from "../src/business-evidence/executor"
import { EvidenceStore } from "../src/business-evidence/store"
import { evidenceScopeHash } from "../src/business-evidence/content"

for (const tool of ["get_page_text", "get_page_html"]) {
test(`${tool}: local capture preserves content on skip/error and never forwards caller-authored Observation IDs`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-capture-exec-"))
  const scope = { kind: "chat" as const, threadId: "capture" }
  const contentKey = tool === "get_page_text" ? "text" : "html"
  const wire = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures", tool === "get_page_text" ? "page-read-v1.json" : "page-read-html-v1.json"), "utf8"))
  assert.equal(typeof wire.data[contentKey], "string")
  wire.data.observation_id = "forged"
  wire.data.evidence_capture = { capture_status: "captured", observation_id: "forged" }
  try {
    const controller = new AbortController(); controller.abort()
    for (const [signal, allowed, channel, reason] of [[controller.signal, true, "cdp", "INTERRUPTED"], [undefined, false, "cdp", "PLAN_READONLY"], [undefined, true, "dom", "NON_ATOMIC_DOM_READ"]] as const) {
      const input = structuredClone(wire); input.data.provenance.channel = channel
      const result = captureLocalPageResult(root, scope, "call", tool, input, signal, allowed)
      assert.equal(result.data[contentKey], wire.data[contentKey])
      assert.equal(result.data.evidence_capture.reason, reason)
      assert.equal(result.data.observation_id, undefined)
    }
    assert.equal(new EvidenceStore(root, scope).read().observations.length, 0)
    assert.equal(captureLocalPageResult(root, undefined, "call", tool, wire).data.observation_id, undefined)
    const captured = captureLocalPageResult(root, scope, "call", tool, wire)
    assert.notEqual(captured.data.observation_id, "forged")
    assert.equal(captured.data.evidence_capture.capture_status, "captured")
    const file = path.join(root, "business-evidence-v1", evidenceScopeHash(scope) + ".json")
    fs.writeFileSync(file, "CORRUPT")
    const failed = captureLocalPageResult(root, scope, "next", tool, wire)
    assert.equal(failed.success, true)
    assert.equal(failed.data.evidence_capture.reason, "EVIDENCE_STORE_ERROR")
    assert.equal(fs.readFileSync(file, "utf8"), "CORRUPT")
    assert.equal(executeDraftTool(root, { kind: "mcp", grantId: "g", sessionId: "s" }, "draft_read", { draft_id: "x" }).error, "DRAFT_CHAT_SCOPE_REQUIRED")
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
}
