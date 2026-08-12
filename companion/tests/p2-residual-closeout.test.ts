/**
 * P2 residual closeout: integrity long-lived resolve + MCP family extract smoke.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { resolveIntegrityHostBin, checkHostIntegrity } from "../src/host-use/darwin/host-integrity"
import { redactMcpServersForBroadcast } from "../src/message-router/handlers/mcp"

test("residual: resolveIntegrityHostBin fails closed on missing binary", () => {
  const missing = path.join(os.tmpdir(), `cmspark-host-missing-${Date.now()}`)
  assert.throws(() => resolveIntegrityHostBin(missing), /integrity|FAILED|ENOENT|no such/i)
})

test("residual: resolveIntegrityHostBin respects CMSPARK_SKIP_HOST_INTEGRITY", () => {
  const prev = process.env.CMSPARK_SKIP_HOST_INTEGRITY
  process.env.CMSPARK_SKIP_HOST_INTEGRITY = "1"
  try {
    const f = path.join(os.tmpdir(), `cmspark-skip-bin-${Date.now()}`)
    fs.writeFileSync(f, "not-a-real-host")
    const r = resolveIntegrityHostBin(f)
    assert.ok(typeof r === "string" && r.length > 0)
    fs.unlinkSync(f)
  } finally {
    if (prev === undefined) delete process.env.CMSPARK_SKIP_HOST_INTEGRITY
    else process.env.CMSPARK_SKIP_HOST_INTEGRITY = prev
  }
})

test("residual: checkHostIntegrity still ok:false on hash mismatch path", () => {
  const f = path.join(os.tmpdir(), `cmspark-bad-hash-${Date.now()}`)
  fs.writeFileSync(f, "definitely-not-cmspark-host-binary")
  const r = checkHostIntegrity(f)
  assert.equal(r.ok, false)
  fs.unlinkSync(f)
})

test("residual: redactMcpServersForBroadcast masks env/headers", () => {
  const out = redactMcpServersForBroadcast([
    {
      name: "demo",
      config: {
        transport: "stdio",
        command: "npx",
        env: { SECRET: "s3cr3t" },
        headers: { Authorization: "Bearer x" },
      },
    } as any,
  ])
  assert.equal(out[0].config.env.SECRET, "***")
  assert.equal(out[0].config.headers.Authorization, "***")
})
