import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const owned = mkdtempSync(path.join(tmpdir(), "cmspark-mcp-atomic-476-"))
const previous = process.env.CMSPARK_DATA_DIR
let config: typeof import("../src/config")
before(async () => { process.env.CMSPARK_DATA_DIR = owned; config = await import("../src/config") })
after(() => {
  if (previous === undefined) delete process.env.CMSPARK_DATA_DIR
  else process.env.CMSPARK_DATA_DIR = previous
  rmSync(owned, { recursive: true, force: true })
})
const servers = { owned: { transport: "stdio" as const, command: "owned_inert_never_run", args: [], trust_level: "manual" as const, enabled: true } }
const disk = () => JSON.parse(readFileSync(path.join(owned, "config.json"), "utf8"))
// Keep the exact old production writer callable for the red counterfactual.
const commit = (...args: unknown[]) => (config.replaceMcpServers as (...values: any[]) => ReturnType<typeof config.getConfig>)(...args)

for (const enabled of [true, false]) {
  test(`#476 servers and enabled=${enabled} are persisted before exactly one event`, () => {
    config.setMcpEnabled(!enabled)
    const before = structuredClone(config.getConfig())
    let events = 0
    const listener = () => {
      events++
      assert.equal(disk().mcp.enabled, enabled)
      assert.deepEqual(disk().mcp.servers, servers)
      assert.deepEqual(config.getConfig(), disk())
    }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, listener)
    try {
      const result = commit(servers, { enabled })
      assert.equal(result.mcp!.enabled, enabled)
      assert.equal(events, 1)
      const { mcp: _old, ...restBefore } = before
      const { mcp: _new, ...restAfter } = result
      assert.deepEqual(restAfter, restBefore)
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, listener) }
  })
}
test("#476 original callers retain the existing enabled flag and map replacement", () => {
  config.replaceMcpServers(servers)
  config.setMcpEnabled(false)
  const result = config.replaceMcpServers({})
  assert.equal(result.mcp!.enabled, false)
  assert.deepEqual(result.mcp!.servers, {})
  assert.deepEqual(result, disk())
})
test("#476 a real owned temporary-file write failure leaves disk/cache unchanged and emits no event", () => {
  config.replaceMcpServers(servers)
  config.setMcpEnabled(false)
  const bytes = readFileSync(path.join(owned, "config.json"))
  const before = structuredClone(config.getConfig())
  const blocked = path.join(owned, `config.json.tmp-${process.pid}`)
  mkdirSync(blocked)
  let events = 0
  const listener = () => { events++ }
  config.configEvents.on(config.CONFIG_CHANGE_EVENT, listener)
  try {
    assert.throws(() => commit({}, { enabled: true }))
    assert.deepEqual(readFileSync(path.join(owned, "config.json")), bytes)
    assert.deepEqual(config.getConfig(), before)
    assert.equal(events, 0)
  } finally {
    config.configEvents.off(config.CONFIG_CHANGE_EVENT, listener)
    rmSync(blocked, { recursive: true })
  }
})
for (const option of [null, {}, { enabled: "true" }, { enabled: true, extra: true }, [true]]) {
  test(`#476 invalid internal commit options are rejected before write or event: ${JSON.stringify(option)}`, () => {
    config.replaceMcpServers(servers)
    const bytes = readFileSync(path.join(owned, "config.json"))
    let events = 0
    const listener = () => { events++ }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, listener)
    try {
      assert.throws(() => commit({}, option), /MCP_COMMIT_OPTIONS_INVALID/)
      assert.deepEqual(readFileSync(path.join(owned, "config.json")), bytes)
      assert.equal(events, 0)
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, listener) }
  })
}
