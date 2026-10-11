import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { McpManager } from "../../src/mcp/manager"
import { McpClient } from "../../src/mcp/client"
import type { McpStdioServerConfig } from "../../src/mcp/types"

const entry = require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js")

test("invalid nonempty roots never publish tools or restore cwd/CLI/home access", { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-607-roots-")), project = path.join(root, "project")
  fs.mkdirSync(project); fs.writeFileSync(path.join(root, "outside.txt"), "OWNED_FAKE_SECRET")
  const invalid = [[{ uri: "   " }], [{ uri: "." }], [{ uri: root }], [{ uri: "" }], [null], [{}], [""], [{ uri: "file:///invalid/%2F" }]]
  try {
    for (const roots of invalid) {
      const cfg: McpStdioServerConfig = { transport: "stdio", command: process.execPath, args: [entry, project], cwd: root,
        enabled: true, trust_level: "trusted", roots: roots as any, restart_policy: { max_restarts: 0 } }
      const manager = new McpManager()
      try {
        await manager.start({ enabled: true, servers: { owned: cfg } })
        assert.equal(manager.getAggregatedTools().length, 0, `invalid roots ${JSON.stringify(roots)} must fail before exposing tools`)
        assert.match(manager.listServers()[0].connection.last_error ?? "", /valid configured roots/)
        assert.equal(manager.listServers()[0].connection.pid, undefined)
        await assert.rejects(manager.callTool({ serverName: "owned", toolName: "read_text_file" }, { path: path.join(root, "outside.txt") }), /not connected/)
        assert.deepEqual(cfg.args, [entry, project]); assert.deepEqual(cfg.roots, roots)
      } finally { await manager.shutdown() }
    }
    const client = new McpClient("positive", { transport: "stdio", command: process.execPath, args: [entry, root], cwd: root,
      enabled: true, trust_level: "trusted", roots: [{ uri: pathToFileURL(project).href }], startup_timeout_ms: 20000 })
    try {
      fs.writeFileSync(path.join(project, "approved.txt"), "approved")
      await client.connect()
      assert.equal((await client.callTool("read_text_file", { path: path.join(project, "approved.txt") })).isError, false)
      assert.equal((await client.callTool("read_text_file", { path: path.join(root, "outside.txt") })).isError, true)
    } finally { await client.close() }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
