import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { McpManager } from "../../src/mcp/manager"
import { McpClient } from "../../src/mcp/client"
import { initDataDir, getConfig, saveConfig, replaceMcpServers, clearConfigCache } from "../../src/config"
import { canOfferAllowDirExpand, addFilesystemAllowDir } from "../../src/mcp/allow-dir-expand"
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


test("URI, service-home tilde and literal spaced CLI roots reach the actual filesystem server", { timeout: 30000 }, async () => {
  const root = await fs.promises.realpath(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-607-cli-")))
  const home = path.join(root, "service home"), literal = path.join(root, "literal space 百分 root")
  fs.mkdirSync(home); fs.mkdirSync(path.join(home, "project")); fs.mkdirSync(literal)
  const project = path.join(home, "project")
  for (const dir of [project, literal]) fs.writeFileSync(path.join(dir, "owned.txt"), "owned")
  try {
    for (const [operand, dir] of [[pathToFileURL(project).href, project], ["~\\project", project], [literal, literal]]) {
      const cfg: McpStdioServerConfig = { transport: "stdio", command: process.execPath, args: [entry, operand],
        env: { HOME: home, USERPROFILE: home }, cwd: root, enabled: true, trust_level: "trusted", startup_timeout_ms: 20000 }
      const client = new McpClient("owned", cfg)
      try {
        await client.connect()
        const result = await client.callTool("read_text_file", { path: path.join(dir, "owned.txt") })
        assert.equal(result.isError, false, JSON.stringify(result)); assert.equal(result.content[0].text, "owned")
        assert.deepEqual(cfg.args, [entry, operand], "launch normalization must not rewrite caller-owned config")
      } finally { await client.close() }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test("filesystem admission protects service HOME and companion HOME before offering or persisting", async () => {
  await initDataDir()
  const root = await fs.promises.realpath(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-607-home-")))
  const serviceHome = path.join(root, "service home"), companionHome = os.homedir()
  fs.mkdirSync(serviceHome); fs.mkdirSync(path.join(serviceHome, ".config")); fs.mkdirSync(path.join(serviceHome, ".config", "gcloud"))
  const original = getConfig().mcp
  try {
    saveConfig({ mcp: { enabled: true, servers: {} } })
    replaceMcpServers({ owned: { transport: "stdio", command: process.execPath, args: [entry, root],
      env: { HOME: serviceHome, USERPROFILE: serviceHome }, enabled: true, trust_level: "trusted" } })
    const before = JSON.stringify(getConfig().mcp)
    for (const candidate of [serviceHome, path.join(serviceHome, ".config", "gcloud"), companionHome]) {
      assert.equal(canOfferAllowDirExpand({ serverName: "owned", rawErr: "Access denied - path outside allowed directories", params: { path: candidate } }).offer, false)
      assert.equal((await addFilesystemAllowDir("owned", candidate)).ok, false)
      clearConfigCache(); assert.equal(JSON.stringify(getConfig().mcp), before)
    }
    const project = path.join(serviceHome, "project"); fs.mkdirSync(project)
    assert.equal(canOfferAllowDirExpand({ serverName: "owned", rawErr: "Access denied - path outside allowed directories", params: { path: project } }).offer, true)
  } finally { saveConfig({ mcp: original }); fs.rmSync(root, { recursive: true, force: true }) }
})
