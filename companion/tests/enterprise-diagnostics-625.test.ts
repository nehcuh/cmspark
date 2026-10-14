import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { buildSync } from "esbuild"
import { createRequire } from "node:module"
import { generateKeyPairSync } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { registerEnterpriseInstance } from "../src/outbound-mcp/enterprise-policy"
import { issueOutboundGrant } from "../src/outbound-mcp/outbound-grants"
import { checkEnterprisePermit, claimEnterpriseDispatch } from "../src/outbound-mcp/enterprise-permit"
import { EnterpriseBrowserService } from "../src/outbound-mcp/enterprise-service"
import { handleEnterpriseHttp } from "../src/outbound-mcp/enterprise-http"

test("actual extension producer→JSON→service→HTTP preserves only fixed internal diagnostics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cmspark-diagnostic-625-")), previous = (globalThis as any).chrome
  const instance = registerEnterpriseInstance("00000000-0000-4000-8000-000000000625", "subject-a")
  const key = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString()
  const policy = { ...instance, revision: "r1", expires_at: new Date(Date.now() + 60_000).toISOString(), authority_public_key: key, tools: ["create_tab"],
    navigation: [{ origin: "https://business.test", path: "/app" }], evidence: [], login: [], ready: [{ selector: "#ready" }], login_markers: [{ selector: "#login" }], actions: [] }
  const grant = issueOutboundGrant({ caller_id: "fixture", label: "fixture", profile: "outbound_l1_interact", enterprise_policy: policy })
  let frameCount = 1, missingFrame = false, nativeError: string | undefined
  const frame = (id: number) => ({ frameId: id, documentId: missingFrame && id === 1 ? undefined : "doc-" + id, result: { url: "https://business.test/app?ticket=PRIVATE_FRAME_TICKET", state: "ready" } })
  ;(globalThis as any).chrome = {
    debugger: { onDetach: { addListener() {} } },
    storage: { local: { get: async () => ({ enterprise_profile_id: instance.profile_id }), set: async () => {} } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} }, create: async () => ({ id: 7 }), query: async () => [] },
    scripting: { executeScript: async (request: any) => { assert.equal(request.args[1], null); if (nativeError) throw new Error(nativeError); return Array.from({ length: frameCount }, (_, id) => frame(id)) } },
  }
  const output = join(directory, "bridge.cjs"), load = createRequire(__filename)
  let api: EnterpriseBrowserService | undefined, server: http.Server | undefined
  try {
    buildSync({ entryPoints: [resolve(process.cwd(), "../chrome-extension/src/background/browser-bridge.ts")], outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" })
    const bridge = new (load(output).BrowserBridge)(), peer = { peer: {}, epoch: "fixture-peer" }
    api = new EnterpriseBrowserService({ path: join(directory, "state.json"), monitor: false, peer: () => peer, runner: () => async (_id, tool, params, options) => {
      assert.equal(checkEnterprisePermit(options?.enterprisePermit, tool, params, peer.peer), true)
      claimEnterpriseDispatch(options!.enterprisePermit!, tool, params, peer.peer)
      return JSON.parse(JSON.stringify(await bridge.execute(tool, JSON.parse(JSON.stringify({ ...params, __enterprise_guard: options!.enterprisePermit!.guard })))))
    } })
    const session = await api.open(grant.id, { subject: "subject-a", change_id: "change", request_key: "open", url: "https://business.test/app" }) as any
    server = http.createServer((req, res) => { void handleEnterpriseHttp(req, res, api) })
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve))
    const url = `http://127.0.0.1:${(server.address() as any).port}/outbound-mcp/v1/enterprise/sessions/${session.session_handle}?subject=subject-a`
    const call = async () => {
      const response = await fetch(url, { headers: { Authorization: "Bearer " + grant.token } })
      return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() as any }
    }
    const ready = await call(); assert.equal(ready.status, 200); assert.equal(ready.body.data.state, "ready")
    assert.ok(!JSON.stringify(ready).includes("PRIVATE_FRAME_TICKET"))
    frameCount = 129
    assert.deepEqual(await call(), { status: 409, cache: "no-store", body: { ok: false, error_code: "FRAME_UNAVAILABLE" } })
    frameCount = 2; missingFrame = true
    assert.deepEqual(await call(), { status: 409, cache: "no-store", body: { ok: false, error_code: "FRAME_UNAVAILABLE" } })
    missingFrame = false
    for (const error of ["FRAME_UNAVAILABLE", "TAB_HISTORY_CAPACITY", "PRIVATE_FRAME_TICKET https://business.test/app?ticket=PRIVATE_FRAME_TICKET"]) {
      nativeError = error
      assert.deepEqual(await call(), { status: 409, cache: "no-store", body: { ok: false, error_code: "ENTERPRISE_BROWSER_UNAVAILABLE" } })
    }
    nativeError = undefined; frameCount = 1
    assert.equal((await call()).body.data.state, "ready")
  } finally {
    api?.close(); if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()))
    if (previous === undefined) delete (globalThis as any).chrome; else (globalThis as any).chrome = previous
    rmSync(directory, { recursive: true, force: true })
  }
})
