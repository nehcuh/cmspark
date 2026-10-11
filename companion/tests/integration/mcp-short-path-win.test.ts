import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { WebSocket } from "ws"
import { McpClient } from "../../src/mcp/client"
import { resolveAllowDirToOffer, pathToFileUri } from "../../src/mcp/allow-dir-expand"
import { initDataDir, getConfig, saveConfig, replaceMcpServers, clearConfigCache } from "../../src/config"
import { getMcpManager } from "../../src/mcp/manager"
import { bindMcpDispatchRuntime, executeMcpTool } from "../../src/mcp/dispatch"
import { SecurityConfirmationManager } from "../../src/security-confirmation"

const native = { skip: process.platform !== "win32", timeout: 30000 }
function fixture(name: string) {
  assert.ok(process.env.CMSPARK_TEST_LONG_ROOT && process.env.CMSPARK_TEST_SHORT_ROOT, "run win-mcp-short-path-smoke.ps1 to provide mandatory native 8.3 fixture")
  const root = path.join(process.env.CMSPARK_TEST_LONG_ROOT!, name)
  const shortRoot = path.join(process.env.CMSPARK_TEST_SHORT_ROOT!, name)
  fs.mkdirSync(root)
  assert.match(shortRoot, /~\d/i)
  assert.equal(fs.realpathSync.native(shortRoot), root)
  const [a, b, c] = ["allowed space #百分%", "approval needed", "unapproved"].map(p => path.join(root, p))
  for (const dir of [a, b, c]) { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "file.txt"), path.basename(dir)) }
  const short = (p: string) => path.join(shortRoot, path.relative(root, p))
  return { root, shortRoot, a, b, c, short }
}
const config = (a: string, c: string, roots = a) => ({ transport: "stdio" as const, command: process.execPath,
  args: [require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js"), a, c],
  enabled: true, trust_level: "trusted" as const, security_capabilities: ["read-only" as const], roots: [{ uri: pathToFileUri(roots) }] })
const denied = (r: any) => r.isError === true && r.content.some((i: any) => i.type === "text" && /Access denied - path outside allowed directories/.test(i.text))
const text = (r: any) => r.content.filter((i: any) => i.type === "text").map((i: any) => i.text).join("\n")
async function waitExcluded(read: () => Promise<any>) {
  const until = Date.now() + 4000
  for (;;) {
    const result = await read()
    if (denied(result)) return
    assert.ok(Date.now() < until, JSON.stringify(result))
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

test("native 8.3: raw SDK rejection versus public client read/write and junction boundaries", native, async () => {
  const f = fixture("client"), cfg = config(f.a, f.c), client = new McpClient("filesystem", cfg)
  const call = (name: string, args: any) => client.callTool(name, args)
  try {
    await client.connect()
    await waitExcluded(() => call("read_text_file", { path: path.join(f.c, "file.txt") }))
    const before = JSON.stringify(cfg)
    const args = { path: f.short(path.join(f.a, "file.txt")) }
    const raw = await (client as any).client.callTool({ name: "read_text_file", arguments: args })
    assert.ok(denied(raw), `negative control must reproduce upstream 8.3 denial: ${JSON.stringify(raw)}`)
    assert.equal(text(await call("read_text_file", args)), path.basename(f.a))
    assert.equal((await call("read_media_file", args)).isError, false)
    assert.match(args.path, /~\d/i)
    for (const name of ["read_file", "get_file_info", "list_directory", "list_directory_with_sizes", "directory_tree", "search_files"]) {
      const result = await call(name, { path: f.short(name === "read_file" || name === "get_file_info" ? path.join(f.a, "file.txt") : f.a), pattern: "file.txt" })
      assert.equal(result.isError, false, `${name}: ${text(result)}`)
    }
    const multiple = await call("read_multiple_files", { paths: [args.path, f.short(path.join(f.c, "file.txt"))] })
    assert.match(text(multiple), /allowed space/)
    assert.match(text(multiple), /Access denied/)
    assert.ok(!text(multiple).includes("file.txt:\nunapproved"), "denied content cannot leak")
    const newDir = f.short(path.join(f.a, "new directory")), newFile = path.join(newDir, "draft~1.txt")
    assert.equal((await call("create_directory", { path: newDir })).isError, false)
    assert.equal((await call("write_file", { path: newFile, content: args.path })).isError, false)
    assert.equal(fs.readFileSync(path.join(f.a, "new directory", "draft~1.txt"), "utf8"), args.path, "content retains alias text")
    assert.equal((await call("edit_file", { path: newFile, edits: [{ oldText: args.path, newText: "edited" }] })).isError, false)
    const moved = path.join(newDir, "moved.txt")
    assert.equal((await call("move_file", { source: newFile, destination: moved })).isError, false)
    assert.equal(text(await call("read_text_file", { path: moved })), "edited")
    assert.ok(denied(await call("read_text_file", { path: f.short(path.join(f.c, "file.txt")) })))
    // Both lexical and real-target cages remain enforced after alias expansion.
    fs.symlinkSync(f.a, path.join(f.c, "link"), "junction")
    fs.symlinkSync(f.c, path.join(f.a, "link"), "junction")
    assert.ok(denied(await call("read_text_file", { path: f.short(path.join(f.c, "link", "file.txt")) })))
    assert.equal((await call("read_text_file", { path: f.short(path.join(f.a, "link", "file.txt")) })).isError, true)
    assert.equal(JSON.stringify(cfg), before, "compatibility must not grant roots")
  } finally {
    await client.close()
    for (const dir of [f.a, f.c]) { const link = path.join(dir, "link"); if (fs.existsSync(link)) fs.unlinkSync(link) }
    fs.rmSync(f.root, { recursive: true, force: true })
  }
})

test("native 8.3: cancelled approval, canonical grant, short roots and reconnect", native, async () => {
  await initDataDir()
  const f = fixture("dispatch"), manager = getMcpManager(), confirmations = new SecurityConfirmationManager()
  let prompts = 0, approve = false
  const abort = new AbortController()
  let cancelledId: string | undefined
  const ws = { readyState: WebSocket.OPEN, send(raw: string) {
    const frame = JSON.parse(raw)
    if (frame.type === "security.confirmation.request") {
      prompts++
      if (!approve) { cancelledId = frame.confirmation_id; queueMicrotask(() => abort.abort()) }
      else queueMicrotask(() => confirmations.respondFrom(frame.confirmation_id, true, ws))
    }
  } } as WebSocket
  const read = (dir: string) => manager.callTool({ serverName: "filesystem", toolName: "read_text_file" }, { path: f.short(path.join(dir, "file.txt")) })
  try {
    saveConfig({ security: { ...getConfig().security, allow_all_schemes: false, auto_approve_dangerous: false, auto_approve_enterprise_tools: false }, mcp: { enabled: true, servers: {} } })
    replaceMcpServers({ filesystem: config(f.a, f.c, f.short(f.a)) })
    clearConfigCache(); await manager.applyConfig(getConfig().mcp); await manager.waitForServerReady("filesystem")
    await waitExcluded(() => read(f.c))
    assert.equal((await read(f.a)).isError, false)
    bindMcpDispatchRuntime({ getThreadManager: () => null, securityConfirmations: confirmations, broadcastToClients() {} })
    const before = JSON.stringify(getConfig().mcp)
    const execute = (signal?: AbortSignal) => executeMcpTool("mcp__filesystem__read_text_file", { path: f.short(path.join(f.b, "file.txt")) }, "owned", ws, Date.now(), signal)
    assert.equal((await execute(abort.signal)).success, false)
    clearConfigCache(); assert.equal(JSON.stringify(getConfig().mcp), before)
    assert.equal(prompts, 1); assert.equal(confirmations.pendingCount(), 0)
    assert.equal(confirmations.respondFrom(cancelledId!, true, ws).outcome, "unknown", "late approval after cancellation is rejected")
    approve = true
    const allowed = await execute()
    assert.equal(allowed.success, true, allowed.error)
    assert.equal(prompts, 2)
    clearConfigCache()
    assert.ok(getConfig().mcp!.servers.filesystem.roots?.some(r => r.uri === pathToFileUri(f.b)), "grant must persist long native directory")
    await manager.applyConfig({ enabled: false, servers: {} })
    await manager.applyConfig(getConfig().mcp); await manager.waitForServerReady("filesystem")
    assert.equal((await read(f.a)).isError, false)
    assert.equal((await read(f.b)).isError, false)
    await waitExcluded(() => read(f.c))
    assert.equal(confirmations.pendingCount(), 0)
  } finally {
    confirmations.rejectAll(); bindMcpDispatchRuntime(null)
    await manager.applyConfig({ enabled: false, servers: {} })
    fs.rmSync(f.root, { recursive: true, force: true })
  }
})

test("native 8.3: home and credential-directory grant refusals use native names", native, () => {
  const f = fixture("sensitive")
  try {
    fs.mkdirSync(path.join(f.root, ".ssh")); fs.writeFileSync(path.join(f.root, ".ssh", "key"), "owned fake credential")
    assert.equal(resolveAllowDirToOffer(f.shortRoot, f.root, "win32").ok, false)
    assert.equal(resolveAllowDirToOffer(path.join(f.shortRoot, ".ssh", "key"), f.root, "win32").ok, false)
    assert.deepEqual(resolveAllowDirToOffer(f.short(path.join(f.b, "file.txt")), f.root, "win32"), { ok: true, dir: f.b })
  } finally { fs.rmSync(f.root, { recursive: true, force: true }) }
})
