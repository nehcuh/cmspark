import test, { before, after, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { buildSync } from "esbuild"
import { classifyError } from "../src/security"
import { getOriginFailCount, peekSiteOpBan, recordSiteOpFailure, resetSiteOpMemoryForTests } from "../src/tool/site-op-memory"

// Actual extension producer crosses JSON into the real Companion consumers.
// Chrome is a declared transport seam; no fabricated ToolResult or page text.
let Bridge: any, temporary: string
before(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark567-owner-contract-"))
  const output = path.join(temporary, "bridge.cjs")
  buildSync({ entryPoints: [path.resolve("../chrome-extension/src/background/browser-bridge.ts")], outfile: output,
    bundle: true, platform: "node", format: "cjs", logLevel: "silent" })
  Bridge = require(output).BrowserBridge
})
afterEach(resetSiteOpMemoryForTests)
after(() => fs.rmSync(temporary, { recursive: true, force: true }))

async function producer(tool: string, options: { targets?: any; queryError?: boolean; proof?: any; proofError?: boolean }, params?: any) {
  const previous = (globalThis as any).chrome
  const counts = { attach: 0, detach: 0, proof: 0, enable: 0, evaluate: 0 }
  ;(globalThis as any).chrome = {
    tabs: { get: async () => ({ id: 7, url: "https://synthetic.example/owner" }) },
    debugger: {
      onDetach: { addListener() {} },
      getTargets: async () => { if (options.queryError) throw new Error("PRIVATE_TARGET_security block_timeout"); return options.targets },
      attach: async () => { counts.attach++; throw new Error("UNEXPECTED_ATTACH") },
      detach: async () => { counts.detach++; throw new Error("FORBIDDEN_DETACH") },
      sendCommand: async (_target: any, method: string) => {
        if (method === "Page.getFrameTree") { counts.proof++; if (options.proofError) throw new Error("PRIVATE_PROOF_security block_timeout"); return options.proof }
        if (method === "Page.enable") { counts.enable++; return {} }
        counts.evaluate++; throw new Error("FORBIDDEN_PAGE_EXECUTION")
      },
    },
  }
  try {
    const wire = JSON.parse(JSON.stringify(await new Bridge().execute(tool, { tabId: 7, selector: "#owned-fixture", ...params })))
    return { wire, counts }
  } finally {
    if (previous === undefined) delete (globalThis as any).chrome
    else (globalThis as any).chrome = previous
  }
}

async function checkRefusal(options: Parameters<typeof producer>[1], subtype: string, proofs: number) {
  const direct = await producer("analyze_image", options)
  assert.equal(direct.wire.success, false)
  // Assert the actual consumer first: the unfixed fixed-reason producer is fatal.
  assert.equal(classifyError(direct.wire.error, { toolName: "analyze_image", error_code: direct.wire.data?.error_code }), "recoverable")
  assert.equal(direct.wire.data.error_code, "CDP_ATTACH_FAILED")
  assert.equal(direct.wire.data.refusal_code, subtype)
  assert.match(direct.wire.error, new RegExp(subtype + ":"))
  assert.equal(JSON.stringify(direct.wire).includes("PRIVATE_"), false)
  assert.equal(Object.hasOwn(direct.wire.data, "page_text_untrusted"), false)
  assert.deepEqual(direct.counts, { attach: 0, detach: 0, proof: proofs, enable: 0, evaluate: 0 })
  // Interactive callers already normalize to CDP_ATTACH_FAILED. Their real
  // envelope must still freeze that tab rather than reset bans/health budgets.
  const interactive = await producer("click", options)
  assert.equal(interactive.wire.success, false)
  assert.equal(interactive.wire.data.error_code, "CDP_ATTACH_FAILED")
  assert.equal(classifyError(interactive.wire.error, { toolName: "click", error_code: interactive.wire.data.error_code }), "recoverable")
  assert.equal(JSON.stringify(interactive.wire).includes("PRIVATE_"), false)
  recordSiteOpFailure("owner-contract", "click", { tabId: 7, selector: "#owned-fixture" }, interactive.wire.data.error_code, "https://synthetic.example/owner")
  const ban = peekSiteOpBan("owner-contract", "evaluate", { tabId: 7, code: "1+1" }, "https://synthetic.example/owner")
  assert.equal(ban.banned, true)
  if (ban.banned) assert.equal(ban.error_code, "TAB_ATTACH_FROZEN")
  assert.equal(getOriginFailCount("owner-contract", "https://synthetic.example/owner"), 0)
  assert.deepEqual(interactive.counts, direct.counts)
}

test("#567 real analyze_image foreign owner refusal stays recoverable and interactive tab stays frozen", async () => {
  await checkRefusal({ targets: [{ tabId: 7, attached: true }], proofError: true }, "DEBUGGER_OWNER_UNVERIFIED", 1)
})
test("#567 unavailable target metadata stays a fixed recoverable refusal with no native attach", async () => {
  await checkRefusal({ queryError: true }, "DEBUGGER_TARGET_UNAVAILABLE", 0)
})
test("#567 missing or ambiguous native targets produce recoverable refusal without owner proof", async () => {
  for (const targets of [[], null, [{ tabId: 8, attached: false }], [{ tabId: 7 }], [{ tabId: 7, attached: true }, { tabId: 7, attached: false }]]) {
    await checkRefusal({ targets }, "DEBUGGER_TARGET_UNAVAILABLE", 0)
  }
})
test("#567 malformed native frame proof remains refused with safe fixed text and no page execution", async () => {
  for (const proof of [undefined, {}, { frameTree: { frame: { id: "" } } }, { frameTree: { frame: { id: 7 } } }]) {
    await checkRefusal({ targets: [{ tabId: 7, attached: true }], proof }, "DEBUGGER_OWNER_UNVERIFIED", 1)
  }
})
test("#567 owner recovery does not grant a missing evaluate token or alter UNKNOWN health", async () => {
  for (const security_token of [undefined, null, "", "   "]) {
    const refusal = await producer("evaluate", { targets: [{ tabId: 7, attached: true }], proof: { frameTree: { frame: { id: "fixture" } } } }, { code: "1+1", security_token })
    assert.equal(refusal.wire.data.error_code, "EVALUATE_AUTH_REQUIRED")
    assert.deepEqual(refusal.counts, { attach: 0, detach: 0, proof: 0, enable: 0, evaluate: 0 })
  }
  assert.equal(classifyError("fixed neutral unknown", { error_code: "UNKNOWN_OWNER_CODE" }), "non_recoverable")
  for (let i = 0; i < 4; i++) recordSiteOpFailure("unknown", "click", { tabId: 8 }, undefined, "https://synthetic.example")
  assert.equal(getOriginFailCount("unknown", "https://synthetic.example"), 4)
})
