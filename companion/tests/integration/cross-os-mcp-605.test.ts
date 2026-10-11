import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { WebSocket } from "ws"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpClient } from "../../src/mcp/client"
import { McpManager, getMcpManager } from "../../src/mcp/manager"
import { bindMcpDispatchRuntime, executeMcpTool, confirmChannel } from "../../src/mcp/dispatch"
import { SecurityConfirmationManager } from "../../src/security-confirmation"
import { initDataDir, getConfig, saveConfig } from "../../src/config"
import { ensureFilesystemAllowlist, filesystemStartupConfig } from "../../src/mcp/filesystem-home"
import { extractPathCandidate } from "../../src/mcp/allow-dir-expand"
import * as short from "../../src/mcp/filesystem-short-path"
import { bindExtensionPeerPicker, bindOverlayConfirmPeerForTests, resetExtensionPeerWaitersForTests } from "../../src/ws/extension-peer"
import type { McpStdioServerConfig } from "../../src/mcp/types"
import { ThreadManager } from "../../src/threads/thread-manager"
import { armLoop } from "../../src/loop/loop-kernel"
import { peekDenyStorm, _resetUnattendedOverlayForTests } from "../../src/loop/unattended-overlay"
import { runL2ToolAdmission } from "../../src/tool/l2-admission"

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const entry = require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js")
function fixture() {
  const root = fs.mkdtempSync(path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "cmspark-605-owned-"))
  const a = path.join(root, "MixedCaseOwned"), c = path.join(root, "excluded folder #百分%")
  for (const dir of [a, c]) { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "file.txt"), dir === a ? "approved" : "EXCLUDED_SECRET") }
  const cfg: McpStdioServerConfig = { transport: "stdio", command: process.execPath, args: [entry, a, c],
    roots: [{ uri: pathToFileURL(a).href }], enabled: true, trust_level: "trusted", startup_timeout_ms: 20000, restart_policy: { max_restarts: 0 } }
  return { root, a, c, cfg }
}

test("authoritative roots exclude CLI directories even at the connected event", { timeout: 30000 }, async () => {
  const f = fixture(), client = new McpClient("owned", f.cfg)
  let early: Promise<any> | undefined
  client.on("status_changed", () => { if (client.connection.status === "connected") early = client.callTool("read_text_file", { path: path.join(f.c, "file.txt") }) })
  try {
    // Check our transport admission, independently of an upstream roots barrier.
    const launch = filesystemStartupConfig(f.cfg) as McpStdioServerConfig
    assert.deepEqual(launch.args, [entry, f.a])
    assert.deepEqual(f.cfg.args, [entry, f.a, f.c], "configuration is not mutated")
    await client.connect()
    assert.ok(early)
    assert.equal((await early).isError, true, "excluded CLI directory must never become readable before roots synchronization")
    assert.equal((await client.callTool("read_text_file", { path: path.join(f.a, "file.txt") })).isError, false)
  } finally { await client.close(); fs.rmSync(f.root, { recursive: true, force: true }) }
})

test("last configured root disappearing fails closed on startup and reconnect", { timeout: 30000 }, async () => {
  const f = fixture(), manager = new McpManager()
  try {
    await manager.start({ enabled: true, servers: { owned: f.cfg } })
    assert.equal((await manager.callTool({ serverName: "owned", toolName: "read_text_file" }, { path: path.join(f.a, "file.txt") })).isError, false)
    fs.rmSync(f.a, { recursive: true })
    assert.equal(ensureFilesystemAllowlist("owned", f.cfg), f.cfg, "do not erase authoritative invalid roots")
    await manager.applyConfig({ enabled: false, servers: { owned: f.cfg } })
    await manager.applyConfig({ enabled: true, servers: { owned: f.cfg } })
    assert.equal(manager.getAggregatedTools().length, 0)
    await assert.rejects(manager.callTool({ serverName: "owned", toolName: "read_text_file" }, { path: path.join(f.c, "file.txt") }), /not connected/)
    assert.match(manager.listServers()[0].connection.last_error ?? "", /valid configured roots/)
    const client = new McpClient("direct", f.cfg)
    try { await assert.rejects(client.connect(), /valid configured roots/) } finally { await client.close() }
  } finally { await manager.shutdown(); fs.rmSync(f.root, { recursive: true, force: true }) }
})

test("approved root aliases and real case equivalence work without granting outside links", { timeout: 30000 }, async () => {
  const f = fixture(), client = new McpClient("owned", f.cfg)
  try {
    await client.connect()
    const read = (file: string) => client.callTool("read_text_file", { path: file })
    assert.equal((await read(path.join(f.a, "file.txt"))).isError, false)
    assert.equal((await read(path.join(await fs.promises.realpath(f.a), "file.txt"))).isError, false)
    const casePath = path.join(f.root, "mixedcaseowned", "file.txt")
    if (process.platform === "win32" || process.platform === "darwin") {
      assert.ok(fs.existsSync(casePath), "native runner must exercise a case-insensitive fixture")
      assert.equal((await read(casePath)).isError, false)
    } else {
      fs.mkdirSync(path.dirname(casePath)); fs.writeFileSync(casePath, "EXCLUDED_CASE_SECRET")
      assert.equal((await read(casePath)).isError, true)
    }
    const outsideLink = path.join(f.c, "link-to-approved"), insideLink = path.join(f.a, "link-to-excluded")
    fs.symlinkSync(f.a, outsideLink, process.platform === "win32" ? "junction" : "dir")
    fs.symlinkSync(f.c, insideLink, process.platform === "win32" ? "junction" : "dir")
    assert.equal((await read(path.join(outsideLink, "file.txt"))).isError, true)
    assert.equal((await read(path.join(insideLink, "file.txt"))).isError, true)
    const original = { path: path.join(f.a, "new folder", "new.txt"), content: casePath }
    await client.callTool("create_directory", { path: path.dirname(original.path) })
    assert.equal((await client.callTool("write_file", original)).isError, false)
    assert.equal(fs.readFileSync(original.path, "utf8"), casePath)
    assert.equal((await client.callTool("move_file", { source: original.path, destination: path.join(f.c, "new.txt") })).isError, true)
  } finally { await client.close(); fs.rmSync(f.root, { recursive: true, force: true }) }
})

test("real move denial preserves the exact spaced destination, rather than its prefix sibling", { timeout: 30000 }, async () => {
  const f = fixture(), client = new McpClient("owned", f.cfg)
  try {
    await client.connect()
    const params = { source: path.join(f.a, "file.txt"), destination: path.join(f.c, "new.txt") }
    const result = await client.callTool("move_file", params)
    assert.equal(result.isError, true)
    const error = result.content.map((item: any) => item.text ?? "").join("\n")
    assert.equal(extractPathCandidate(error, params), params.destination)
    const sourceDenied = await client.callTool("move_file", { source: params.destination, destination: params.source })
    assert.equal(extractPathCandidate(sourceDenied.content.map((item: any) => item.text ?? "").join("\n"), { source: params.destination, destination: params.source }), params.destination)
    assert.equal(extractPathCandidate("ambiguous Access denied", params), null)
  } finally { await client.close(); fs.rmSync(f.root, { recursive: true, force: true }) }
})

for (const change of ["trust", "capabilities", "off-on", "unchanged"] as const) {
  test(`real SDK admission after deferred normalization: ${change}`, async t => {
    await initDataDir()
    saveConfig({ security: { ...getConfig().security, auto_approve_dangerous: false, auto_approve_enterprise_tools: false, allow_all_schemes: false } })
    const manager = getMcpManager(), servers: Server[] = [], originalConnect = McpClient.prototype.connect
    let wire = 0, release!: () => void, enter!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    t.mock.method(McpClient.prototype, "connect", async function(this: McpClient) {
      const server = new Server({ name: "owned", version: "1" }, { capabilities: { tools: {} } }); servers.push(server)
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "read_text_file", inputSchema: { type: "object", properties: { path: { type: "string" } } } }] }))
      server.setRequestHandler(CallToolRequestSchema, async () => { wire++; return { content: [{ type: "text", text: "owned" }] } })
      const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await originalConnect.call(this, ct)
    })
    const cfg: McpStdioServerConfig = { transport: "stdio", command: "mcp-server-filesystem", enabled: true, trust_level: "trusted", security_capabilities: ["read-only"] }
    const snapshot = { enabled: true, servers: { owned: cfg } }, confirmations = new SecurityConfirmationManager()
    const ws = { readyState: WebSocket.OPEN, send() { throw new Error("unexpected new-policy confirmation") } } as any
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!
    try {
      await manager.applyConfig(snapshot); await manager.waitForServerReady("owned")
      bindMcpDispatchRuntime({ getThreadManager: () => null, securityConfirmations: confirmations, broadcastToClients() {} })
      t.mock.method(short, "normalizeFilesystemToolArgs", (_tool: string, args: any) => new Promise(resolve => { release = () => resolve(args); enter() }))
      Object.defineProperty(process, "platform", { value: "win32" })
      const pending = executeMcpTool("mcp__owned__read_text_file", { path: "C:\\Users\\RUNNER~1\\owned.txt" }, "owned", ws, Date.now())
      await entered
      if (change === "trust") await manager.applyConfig({ enabled: true, servers: { owned: { ...cfg, trust_level: "manual" } } })
      if (change === "capabilities") await manager.applyConfig({ enabled: true, servers: { owned: { ...cfg, security_capabilities: ["exec"] } } })
      if (change === "off-on") await Promise.all([manager.applyConfig({ ...snapshot, enabled: false }), manager.applyConfig(snapshot)])
      if (change === "unchanged") await manager.applyConfig(snapshot)
      release(); const result = await pending
      assert.equal(wire, change === "unchanged" ? 1 : 0)
      assert.equal(result.success, change === "unchanged", result.error)
    } finally {
      Object.defineProperty(process, "platform", platform); release?.(); confirmations.rejectAll(); bindMcpDispatchRuntime(null)
      await manager.applyConfig({ enabled: false, servers: {} }); for (const server of servers) await server.close()
    }
  })
}

test("cancelled overlay peer wait settles immediately without sending a confirmation", async () => {
  const controller = new AbortController(), ws = { readyState: WebSocket.OPEN } as WebSocket
  const confirmations = new SecurityConfirmationManager(); let attached = 0
  bindExtensionPeerPicker(() => null); bindOverlayConfirmPeerForTests({ attach: () => { attached++ }, waitMs: 15000 })
  bindMcpDispatchRuntime({ getThreadManager: () => null, securityConfirmations: confirmations, broadcastToClients() {}, getWsSurface: () => "summoner", pickExtensionWs: () => null })
  try {
    const pending = confirmChannel(ws, controller.signal); controller.abort()
    const result = await Promise.race([pending, pause(100).then(() => { throw new Error("cancel did not release peer wait") })])
    assert.match((result as any).error, /cancelled/); assert.equal(attached, 1)
    await confirmChannel(ws, controller.signal); assert.equal(attached, 1)
  } finally { resetExtensionPeerWaitersForTests(); bindMcpDispatchRuntime(null); confirmations.rejectAll() }
})

test("naturally exited/dead server withdraws its tools and re-enabled server restores them", { timeout: 30000 }, async () => {
  const manager = new McpManager()
  const script = `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
    const m=JSON.parse(line);if(m.id===undefined)return;
    const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'owned',version:'1'}}
      :m.method==='tools/list'?{tools:[{name:'read_value',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'final'}]};
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n',()=>{if(m.method==='tools/call')process.exit(0)});
  });setTimeout(()=>process.exit(2),20000);`
  const cfg: McpStdioServerConfig = { transport: "stdio", command: process.execPath, args: ["-e", script], enabled: true,
    trust_level: "trusted", startup_timeout_ms: 20000, restart_policy: { max_restarts: 0 } }
  let withdrawn = false
  manager.on("tools_changed", () => { if (!manager.resolveToolName("mcp__owned__read_value")) withdrawn = true })
  try {
    await manager.start({ enabled: true, servers: { owned: cfg } })
    assert.equal(manager.getAggregatedTools().length, 1)
    await manager.callTool({ serverName: "owned", toolName: "read_value" }, {})
    const end = Date.now() + 5000
    while (manager.listServers()[0].connection.status !== "dead") { assert.ok(Date.now() < end); await pause(20) }
    assert.equal(manager.getAggregatedTools().length, 0); assert.ok(withdrawn)
    assert.equal(manager.resolveToolName("mcp__owned__read_value"), undefined)
    assert.equal(manager.getToolInputSchema("mcp__owned__read_value"), undefined)
    assert.equal(manager.getAuthorizationIdentity("owned"), undefined)
    await manager.applyConfig({ enabled: false, servers: { owned: cfg } })
    await manager.applyConfig({ enabled: true, servers: { owned: cfg } })
    await manager.waitForServerReady("owned")
    assert.equal(manager.getAggregatedTools().length, 1)
  } finally { await manager.shutdown() }
})


test("per-server HOME keeps tilde grants scoped to the child project", { timeout: 30000 }, async () => {
  const f = fixture(), manager = new McpManager(), childHome = path.join(f.root, "child home")
  fs.mkdirSync(childHome); const project = path.join(childHome, "project");fs.mkdirSync(project)
  fs.writeFileSync(path.join(project, "file.txt"), "CHILD_PROJECT")
  const cfg: McpStdioServerConfig = { ...f.cfg, roots: undefined, args: [entry, "~/project"], env: { [process.platform === "win32" ? "USERPROFILE" : "HOME"]: childHome } }
  try {
    assert.equal(ensureFilesystemAllowlist("owned", cfg), cfg)
    await manager.start({ enabled: true, servers: { owned: cfg } })
    assert.equal((await manager.callTool({ serverName: "owned", toolName: "read_text_file" }, { path: path.join(project, "file.txt") })).isError, false)
    assert.equal((await manager.callTool({ serverName: "owned", toolName: "read_text_file" }, { path: path.join(f.a, "file.txt") })).isError, true)
    const bare = ensureFilesystemAllowlist("owned", { ...cfg, args: [entry] }) as McpStdioServerConfig
    assert.deepEqual(bare.args, [entry, childHome.replace(/\\/g, process.platform === "win32" ? "/" : "\\")])
  } finally { await manager.shutdown(); fs.rmSync(f.root, { recursive: true, force: true }) }
})

test("denial paths and roots containing the literal separator never grant a prefix", { timeout: 30000 }, async () => {
  const f = fixture(), denied = path.join(f.c, "denied not in sibling"), client = new McpClient("owned", f.cfg)
  fs.mkdirSync(denied); fs.mkdirSync(path.join(f.c, "denied")); fs.writeFileSync(path.join(denied, "file.txt"), "excluded")
  try {
    await client.connect()
    const target = path.join(denied, "new.txt"), source = path.join(f.a, "file.txt")
    for (const params of [{ source, destination: target }, { source: path.join(denied, "file.txt"), destination: path.join(f.a, "new.txt") }, { path: path.join(denied, "file.txt") }]) {
      const result = await client.callTool("path" in params ? "read_text_file" : "move_file", params)
      assert.equal(result.isError, true)
      const expected = "path" in params ? params.path : params.source.startsWith(denied) ? params.source : params.destination
      assert.equal(extractPathCandidate(result.content.map((v: any) => v.text ?? "").join("\n"), params), expected)
    }
    assert.equal(extractPathCandidate(`Access denied - path outside allowed directories: ${target} not in ${source} not in root`, { source, destination: target }), target)
    assert.equal(extractPathCandidate("Access denied - path outside allowed directories: /expanded not in sibling/file not in /allowed not in root", { source: "/alias/file", destination: "/other/file" }), null)
  } finally { await client.close(); fs.rmSync(f.root, { recursive: true, force: true }) }
})


test("POSIX denial with a newline directory cannot authorize its prefix sibling", { skip: process.platform === "win32", timeout: 30000 }, async () => {
  const f = fixture(), denied = path.join(f.c, "denied\nsibling"), client = new McpClient("owned", f.cfg)
  fs.mkdirSync(denied); fs.mkdirSync(path.join(f.c, "denied"))
  try {
    await client.connect()
    const params = { source: path.join(f.a, "file.txt"), destination: path.join(denied, "new.txt") }
    const result = await client.callTool("move_file", params)
    assert.equal(result.isError, true)
    assert.equal(extractPathCandidate(result.content.map((v: any) => v.text ?? "").join("\n"), params), params.destination)
  } finally { await client.close(); fs.rmSync(f.root, { recursive: true, force: true }) }
})


test("three cancelled L2 peer waits do not count as user denials or pause an unattended loop", { timeout: 15000 }, async () => {
  await initDataDir()
  saveConfig({ security: { ...getConfig().security, auto_approve_dangerous: false, auto_approve_enterprise_tools: false, allow_all_schemes: false } })
  const f = fixture(), tm = new ThreadManager(), thread = tm.create("owned cancelled confirmations"), confirms = new SecurityConfirmationManager()
  armLoop(tm, thread.id, "unattended_arm", { unattended: true, audit: () => {} })
  let sent = 0, finished = 0, attached = 0
  const ws = { readyState: WebSocket.OPEN, send() { sent++ } } as unknown as WebSocket
  bindExtensionPeerPicker(() => null)
  try {
    for (let i = 0; i < 3; i++) {
      const controller = new AbortController()
      bindOverlayConfirmPeerForTests({ attach: () => { attached++; controller.abort() }, waitMs: 15000 })
      const pending = runL2ToolAdmission({
        toolName: "acp_propose_session", finalParams: { agent_id: "kimi", goal: "Read owned file", workspace_root: f.root },
        toolCallId: "owned-cancel-" + i, startedAt: Date.now(), ws, sessionId: thread.id, actingThreadId: thread.id,
        isOutboundMcpCall: false, signal: controller.signal, getThreadManager: () => tm, securityConfirmations: confirms,
        logToolFinish() { finished++ }, getCachedTabUrl: () => undefined, getDomainFromUrl: () => "",
        computerRateLimiter: async () => { throw Error("unexpected computer admission") },
        activeTrayConfirmsByWs: new WeakMap(), clients: new Set([ws]), wsAuthGet: () => ({ surface: "summoner" }),
      })
      let deadline: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await Promise.race([pending, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(Error("cancelled L2 admission did not finish")), 2000) })])
        assert.equal(result.ok, false)
        assert.match(JSON.stringify(result), /Tool confirmation cancelled/)
      } finally { clearTimeout(deadline) }
      assert.equal(peekDenyStorm(thread.id), 0)
      assert.equal(tm.get(thread.id)?.loop_state?.status, "active")
      assert.equal(finished, i + 1)
    }
    assert.equal(sent, 0); assert.equal(attached, 3)
  } finally {
    confirms.rejectAll(); resetExtensionPeerWaitersForTests(); bindExtensionPeerPicker(() => null)
    _resetUnattendedOverlayForTests(); fs.rmSync(f.root, { recursive: true, force: true })
  }
})
