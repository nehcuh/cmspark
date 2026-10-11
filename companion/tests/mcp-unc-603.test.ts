import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { McpClient } from "../src/mcp/client"
import { pathToFileUri, extractPathCandidate } from "../src/mcp/allow-dir-expand"
import { ensureFilesystemAllowlist, mcpHomeFileUri, resolveFilesystemAllowPathForExists } from "../src/mcp/filesystem-home"

for (const [platform, input, uri] of [
  ["win32", "\\\\nas\\team\\project space #百分%", "file://nas/team/project%20space%20%23%E7%99%BE%E5%88%86%25"],
  ["win32", "C:\\team\\project space #百分%", "file:///C:/team/project%20space%20%23%E7%99%BE%E5%88%86%25"],
  ["linux", "/team/project space #百分%", "file:///team/project%20space%20%23%E7%99%BE%E5%88%86%25"],
] as const) test(`${platform} filesystem file URL round trip: ${input}`, () => {
  assert.equal(pathToFileUri(input, platform), uri)
  assert.equal(mcpHomeFileUri(platform, input), uri)
  assert.equal(resolveFilesystemAllowPathForExists(uri, platform), input)
})

test("valid UNC root is retained; malformed authoritative roots never widen to home", () => {
  const config = { transport: "stdio" as const, command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], enabled: true, trust_level: "trusted" as const,
    roots: [{ uri: "file://nas/team/project" }] }
  const observed: string[] = []
  const fixed = ensureFilesystemAllowlist("filesystem", config, "win32", "C:\\Users\\fixture", { pathExists(p) { observed.push(p); return p === "\\\\nas\\team\\project" } })
  assert.deepEqual(observed, ["\\\\nas\\team\\project"])
  assert.equal(fixed, config)
  assert.equal(resolveFilesystemAllowPathForExists("file:////nas/team/project", "win32"), "")
  assert.equal(resolveFilesystemAllowPathForExists("file:///C:/bad%2Fsegment", "win32"), "")
  const invalid = { ...config, roots: [{ uri: "file:////nas/team/project" }] }
  const preserved = ensureFilesystemAllowlist("filesystem", invalid, "win32", "C:\\Users\\fixture", { pathExists: () => true })
  assert.equal(preserved, invalid)
  assert.deepEqual(preserved.args, config.args)
})

test("native Windows owned SMB root survives actual stat, config sanitization and URI extraction", { skip: process.platform !== "win32", timeout: 15000 }, async () => {
  const share = process.env.CMSPARK_TEST_UNC_SHARE
  assert.ok(share, "Windows CI must provision an owned SMB fixture")
  const owned = path.join(share, "project space #百分%")
  const unapproved = path.join(share, "unapproved")
  fs.mkdirSync(owned); fs.mkdirSync(unapproved)
  fs.writeFileSync(path.join(owned, "file.txt"), "owned UNC content")
  fs.writeFileSync(path.join(unapproved, "file.txt"), "must remain denied")
  let client: McpClient | undefined
  try {
    assert.ok(fs.statSync(owned).isDirectory())
    const uri = pathToFileUri(owned)
    assert.match(uri, /^file:\/\/127\.0\.0\.1\//)
    assert.equal(resolveFilesystemAllowPathForExists(uri), owned)
    assert.equal(extractPathCandidate("", { uri }), owned)
    const config = { transport: "stdio" as const, command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], enabled: true, trust_level: "trusted" as const, roots: [{ uri }] }
    assert.equal(ensureFilesystemAllowlist("filesystem", config), config)
    client = new McpClient("filesystem", { ...config, command: process.execPath,
      args: [require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js"), owned] })
    await client.connect()
    const read = await client.callTool("read_text_file", { path: path.join(owned, "file.txt") })
    assert.ok(!read.isError, JSON.stringify(read))
    assert.equal(read.content[0].text, "owned UNC content")
    assert.equal((await client.callTool("read_text_file", { path: path.join(unapproved, "file.txt") })).isError, true)
  } finally {
    await client?.close()
    fs.rmSync(owned, { recursive: true, force: true })
    fs.rmSync(unapproved, { recursive: true, force: true })
  }
})
