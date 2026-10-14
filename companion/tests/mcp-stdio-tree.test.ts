import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { PassThrough } from "node:stream"
import { McpClient } from "../src/mcp/client"
import { McpManager } from "../src/mcp/manager"
import type { McpStdioServerConfig } from "../src/mcp/types"
import { createTransport } from "../src/mcp/transport"
import { OwnedStdioTransport, McpStdioTeardownError } from "../src/mcp/stdio-transport"

test("MCP stdio closes its owned wrapper tree, including Windows cmd, without stopping another process", { timeout: 25000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark stdio & owned-"))
  const marker = path.join(root, "descendant.pid"), script = path.join(root, "wrapper.cjs")
  fs.writeFileSync(script, `
    const fs=require('node:fs'), {spawn}=require('node:child_process');
    const c=spawn(process.execPath,['-e','setTimeout(()=>{},18000)'],{stdio:'ignore',windowsHide:true});
    fs.writeFileSync(${JSON.stringify(marker)},String(c.pid));
    const r=require('node:readline').createInterface({input:process.stdin});
    r.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
      const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'owned',version:'1'}}
        :m.method==='tools/list'?{tools:[{name:'read_value',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'owned'}]};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
    });
    r.on('close',()=>process.exit(0));setTimeout(()=>process.exit(0),18000);
  `)
  let command = process.execPath, args = [script]
  if (process.platform === "win32") {
    command = path.join(root, "owned.cmd"); args = []
    fs.writeFileSync(command, `@echo off\r\n"${process.execPath}" "%~dp0wrapper.cjs"\r\n`)
  }
  const sentinel = spawn(process.execPath, ["-e", "setTimeout(()=>{},20000)"], { stdio: "ignore", windowsHide: true })
  const client = new McpClient("owned", { transport: "stdio", command, args, enabled: true, trust_level: "manual" })
  try {
    await client.connect()
    assert.equal((await client.callTool("read_value", {})).content[0].text, "owned")
    const descendant = Number(fs.readFileSync(marker, "utf8")), parent = client.connection.pid!
    assert.ok(descendant > 0 && parent > 0)
    await Promise.all([client.close(), client.close()])
    for (const pid of [parent, descendant]) {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        try { process.kill(pid, 0) } catch { break }
        await new Promise(r => setTimeout(r, 20))
      }
      assert.throws(() => process.kill(pid, 0), /ESRCH/)
    }
    assert.doesNotThrow(() => process.kill(sentinel.pid!, 0))
    assert.equal(client.connection.status, "disconnected")
  } finally { await client.close(); sentinel.kill(); fs.rmSync(root, { recursive: true, force: true }) }
})

test("MCP owned stdio startup failure and repeated close settle without unhandled process errors", async () => {
  const transport = createTransport({ transport: "stdio", command: path.join(os.tmpdir(), "cmspark-nonexistent-owned-executable"), enabled: true, trust_level: "manual" })
  let closed = 0
  const errors: Error[] = []
  transport.onerror = error => { errors.push(error) }
  const didClose = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("startup failure did not close")), 5000)
    transport.onclose = () => { closed++; clearTimeout(timer); resolve() }
  })
  // Windows can spawn cmd.exe successfully before reporting the missing command.
  await transport.start().catch(error => { errors.push(error) })
  await didClose
  assert.ok(errors.some(error => /ENOENT/.test(error.message)))
  await Promise.all([transport.close(), transport.close()])
  assert.equal(closed, 1)
})

test("MCP stdio close before start is safe when onclose reenters close", async () => {
  const transport = createTransport({ transport: "stdio", command: "unused-owned-fixture", enabled: true, trust_level: "manual" })
  let closed = 0
  transport.onclose = () => { closed++; void transport.close() }
  const closing = transport.close()
  await assert.rejects(transport.start(), /already started or closed/)
  await closing
  await transport.close()
  assert.equal(closed, 1)
})

// Model the observed Windows boundary without an OS timing race: the launcher
// has exited while the target still owns its inherited stdio. The fake has no
// PID, so this fixture can never signal a real process.
function heldStdioFixture() {
  const child = Object.assign(new EventEmitter(), {
    pid: undefined, exitCode: 0, signalCode: null,
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    unref: () => { unrefs++ },
  }) as unknown as ChildProcess
  let unrefs = 0
  const transport = new OwnedStdioTransport({ command: "owned-no-spawn-fixture" })
  Object.assign(transport, { child, childClose: new Promise<void>(resolve => child.once("close", resolve)) })
  return { child, transport, unrefs: () => unrefs }
}

test("MCP close waits for inherited stdio close after launcher exit", async () => {
  const { child, transport, unrefs } = heldStdioFixture()
  let settled = false, notified = 0
  transport.onclose = () => { notified++ }
  const closing = transport.close().then(() => { settled = true })
  child.emit("exit", 0, null)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false, "exit alone cannot release the owned transport")
  assert.equal(child.stdout!.destroyed, false, "do not manufacture the missing close receipt")
  assert.equal(unrefs(), 0)
  assert.equal(notified, 0)
  child.emit("close", 0, null)
  await closing
  assert.equal(child.stdout!.destroyed, true)
  assert.equal(unrefs(), 1)
  assert.equal(notified, 1)
  await transport.close()
  assert.equal(notified, 1)
})

test("MCP stdio teardown deadline fails instead of reporting successful client close", async () => {
  const { transport } = heldStdioFixture()
  const errors: Error[] = []
  let notified = 0
  transport.onclose = () => { notified++ }
  transport.onerror = error => errors.push(error)
  const client = new McpClient("held-owned-fixture", {
    transport: "stdio", command: "owned-no-spawn-fixture", enabled: true, trust_level: "manual",
  })
  Object.assign(client, { transport })
  await assert.rejects(client.close(), /subprocess teardown timed out/)
  assert.equal(client.connection.status, "error")
  assert.equal(errors.length, 1)
  assert.equal(notified, 1, "closed protocol does not certify the rejected process receipt")
  await assert.rejects(client.close(), /subprocess teardown timed out/)
  assert.equal(notified, 1)
})

test("native MCP close releases the target cwd before returning", { timeout: 25000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-stdio-close-cwd-"))
  const script = path.join(root, "owned.cjs")
  fs.writeFileSync(script, `process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'owned/ready',params:{pid:process.pid}})+'\\n');process.stdin.resume();setTimeout(()=>{},18000);`)
  const transport = new OwnedStdioTransport({ command: process.execPath, args: [script], cwd: root })
  let targetPid = 0, childClosed = false
  const ready = new Promise<void>(resolve => {
    transport.onmessage = message => {
      if ("method" in message && message.method === "owned/ready") {
        targetPid = (message.params as { pid: number }).pid; resolve()
      }
    }
  })
  try {
    await transport.start()
    const child = (transport as unknown as { child: ChildProcess }).child
    child.once("close", () => { childClosed = true })
    await ready
    assert.ok(targetPid > 0)
    await transport.close()
    assert.equal(childClosed, true, "actual ChildProcess close must precede the promise")
    assert.throws(() => process.kill(targetPid, 0), /ESRCH/, "no post-close PID polling")
    fs.rmSync(root, { recursive: true, force: true }) // no cleanup retries
    assert.equal(fs.existsSync(root), false)
  } finally {
    await transport.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("stalled native stdio closure settles real SDK requests without a restart signal", { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-stdio-sdk-close-"))
  const script = path.join(root, "owned.cjs")
  fs.writeFileSync(script, `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
    const m=JSON.parse(line);if(m.id===undefined)return;
    const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'owned',version:'1'}}
      :m.method==='tools/list'?{tools:[{name:'owned_wait',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'queued final response'}]};
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n',()=>{if(m.method==='tools/call')process.exit(0)});
  });setTimeout(()=>process.exit(2),18000);`)
  const client = new McpClient("owned", {
    transport: "stdio", command: process.execPath, args: [script], cwd: root,
    enabled: true, trust_level: "manual", startup_timeout_ms: 20000, call_timeout_ms: 5000,
  })
  let disconnects = 0, closed = 0
  const statuses: string[] = []
  client.on("disconnected", () => { disconnects++ })
  client.on("status_changed", status => statuses.push(status))
  try {
    await client.connect()
    const transport = (client as any).transport as OwnedStdioTransport
    const sdk = (client as any).client
    const child = (transport as any).child as ChildProcess
    const onclose = transport.onclose!
    transport.onclose = () => {
      closed++; onclose()
      // A callback may close again, but must not duplicate notification or turn
      // an unconfirmed process receipt into a successful client close.
      void client.close().catch(() => {})
    }
    t.mock.method(child.stdout!, "resume", () => child.stdout)
    child.stdout!.pause()
    const exited = once(child, "exit")
    const pending = assert.rejects(client.callTool("owned_wait", {}), /Connection closed/)
    await exited
    await pending
    assert.equal(sdk._responseHandlers.size, 0, "actual SDK pending requests are cleared by onclose")
    assert.equal(sdk._timeoutInfo.size, 0)
    assert.equal(sdk.transport, undefined)
    assert.equal(closed, 1)
    assert.equal(disconnects, 0, "unknown process reclamation cannot admit a replacement")
    assert.equal(client.connection.status, "error")
    assert.equal(statuses.includes("disconnected"), false)
    await assert.rejects(client.close(), /subprocess teardown timed out/)
    assert.equal(client.connection.status, "error")
    assert.equal(closed, 1)
  } finally {
    await client.close().catch(() => {})
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function managerWithHeldReceipt() {
  const cfg: McpStdioServerConfig = { enabled: true, transport: "stdio", command: "owned-no-spawn-fixture", trust_level: "manual" }
  const { child, transport } = heldStdioFixture()
  const prior = new McpClient("held", cfg)
  Object.assign(prior, { transport, _connection: { status: "connected", restart_count: 0 },
    _capabilities: { tools: true, resources: false, prompts: false },
    _toolsCache: [{ name: "owned_read", inputSchema: { type: "object" } }],
  })
  const manager = new McpManager()
  Object.assign(manager, { currentConfig: { enabled: true, servers: { held: cfg } } })
  ;(manager as any).clients.set("held", prior)
  ;(manager as any).reaggregate()
  return { cfg, prior, manager, child }
}

test("reconnect cannot replace or forget a real rejected owned stdio receipt", async t => {
  const { cfg, prior, manager } = managerWithHeldReceipt()
  let connects = 0
  t.mock.method(McpClient.prototype, "connect", async () => { connects++ })
  assert.ok(manager.getAggregatedTools().length > 0)
  const identity = manager.getAuthorizationIdentity("held")
  assert.ok(identity)
  const reconnect = assert.rejects(manager.startClient("held", cfg), /subprocess teardown timed out/)
  assert.equal(manager.getAggregatedTools().length, 0, "retiring revokes capabilities before awaiting teardown")
  assert.equal(manager.getAuthorizationIdentity("held"), undefined)
  await reconnect
  assert.equal(connects, 0)
  assert.equal((manager as any).clients.get("held"), prior)
  assert.equal((manager as any).retiringClients.get("held").client, prior)
  assert.equal(prior.connection.status, "error")
  await assert.rejects(manager.startClient("held", cfg), /subprocess teardown timed out/)
  await assert.rejects(manager.waitForServerReady("held"), /owned teardown is unconfirmed/)
  assert.equal(connects, 0)
  await manager.shutdown()
  assert.equal((manager as any).clients.get("held"), prior, "shutdown retains failed owned receipt")
  assert.equal(manager.listServers()[0].connection.status, "error")
})

for (const mode of ["disable", "remove", "command", "global-disable"] as const) {
  test(`config ${mode} revokes immediately and blocks failed-receipt name reuse`, async t => {
    const { cfg, prior, manager } = managerWithHeldReceipt()
    let connects = 0
    t.mock.method(McpClient.prototype, "connect", async () => { connects++ })
    const servers: Record<string, McpStdioServerConfig> = mode === "remove" ? {} : { held: { ...cfg,
      ...(mode === "disable" ? { enabled: false } : {}),
      ...(mode === "command" ? { command: "another-owned-command" } : {}),
    } }
    const update = assert.rejects(manager.applyConfig({ enabled: mode !== "global-disable", servers }), /subprocess teardown timed out/)
    assert.equal(manager.getAggregatedTools().length, 0)
    assert.equal(manager.getAuthorizationIdentity("held"), undefined)
    await update
    assert.equal((manager as any).retiringClients.get("held").client, prior)
    const meta = manager.listServers().find(server => server.name === "held")!
    assert.equal(meta.connection.status, "error")
    assert.deepEqual(meta.tools, [])
    if (mode !== "command") assert.equal(meta.enabled, false)
    // Re-add/re-enable cannot discard the original failure or spawn another.
    await manager.applyConfig({ enabled: true, servers: { held: cfg } }).catch(() => {})
    await assert.rejects(manager.startClient("held", cfg), /subprocess teardown timed out/)
    await assert.rejects(manager.callTool({ serverName: "held", toolName: "owned_read" }, {}), /disabled or unavailable/)
    assert.equal(connects, 0)
    assert.equal((manager as any).clients.get("held"), prior)
    assert.equal((manager as any).restartTimers.size, 0)
    await manager.shutdown()
    assert.equal((manager as any).retiringClients.get("held").client, prior)
  })
}

test("confirmed owned close permits exactly one serialized replacement", async t => {
  const { cfg, manager, child } = managerWithHeldReceipt()
  let connects = 0
  t.mock.method(McpClient.prototype, "connect", async function(this: McpClient) {
    connects++; (this as any).setStatus("connected")
  })
  const starts = [manager.startClient("held", cfg), manager.startClient("held", cfg)]
  const ready = manager.waitForServerReady("held")
  assert.equal(connects, 0)
  child.emit("close", 0, null)
  await Promise.all(starts)
  assert.ok(await ready, "pending successful retirement is waited for, not misclassified as a failed tombstone")
  assert.equal(connects, 1)
  assert.equal((manager as any).retiringClients.size, 0)
  await manager.shutdown()
  assert.equal((manager as any).clients.size, 0)
})

test("startup teardown failure is retained without scheduling a restart", async t => {
  const cfg: McpStdioServerConfig = { enabled: true, transport: "stdio", command: "owned-no-spawn-fixture", trust_level: "manual" }
  const manager = new McpManager()
  let connects = 0
  t.mock.method(McpClient.prototype, "connect", async function(this: McpClient) {
    connects++
    Object.assign(this, { transport: heldStdioFixture().transport })
    await this.close() // Actual rejected producer receipt, not a fabricated error.
  })
  await manager.start({ enabled: true, servers: { held: cfg } })
  const client = (manager as any).clients.get("held") as McpClient
  assert.equal(client.connection.status, "error")
  assert.equal((manager as any).retiringClients.get("held").client, client)
  assert.equal((manager as any).restartTimers.size, 0)
  await assert.rejects(manager.startClient("held", cfg), /subprocess teardown timed out/)
  assert.equal(connects, 1)
  await manager.shutdown()
  assert.equal((manager as any).clients.get("held"), client)
})

test("disable during startup retains a rejected ghost receipt without admitting another child", async t => {
  const cfg: McpStdioServerConfig = { enabled: true, transport: "stdio", command: "owned-no-spawn-fixture", trust_level: "manual" }
  const manager = new McpManager()
  let ready!: () => void, connects = 0
  const handshake = new Promise<void>(resolve => { ready = resolve })
  t.mock.method(McpClient.prototype, "connect", async function(this: McpClient) {
    connects++
    Object.assign(this, { transport: heldStdioFixture().transport })
    await handshake
    ;(this as any).setStatus("connected")
  })
  const starting = manager.start({ enabled: true, servers: { held: cfg } })
  await new Promise(resolve => setImmediate(resolve))
  const client = (manager as any).clients.get("held") as McpClient
  const stopping = assert.rejects(manager.applyConfig({ enabled: true, servers: {} }), /subprocess teardown timed out/)
  assert.equal(manager.getAuthorizationIdentity("held"), undefined)
  ready()
  await Promise.all([starting, stopping])
  assert.equal((manager as any).retiringClients.get("held").client, client)
  assert.equal((manager as any).clients.get("held"), client)
  assert.equal((manager as any).restartTimers.size, 0)
  await manager.applyConfig({ enabled: true, servers: { held: cfg } }).catch(() => {})
  await assert.rejects(manager.startClient("held", cfg), /subprocess teardown timed out/)
  assert.equal(connects, 1)
  await manager.shutdown()
})

test("global disable still closes healthy clients when another receipt fails", async () => {
  const { cfg, manager, prior } = managerWithHeldReceipt()
  const healthy = new McpClient("healthy", cfg)
  ;(manager as any).clients.set("healthy", healthy)
  await assert.rejects(manager.applyConfig({ enabled: false, servers: {} }), /subprocess teardown timed out/)
  assert.equal((manager as any).clients.has("healthy"), false)
  assert.equal((manager as any).clients.get("held"), prior)
  assert.deepEqual(manager.getAggregatedTools(), [])
  await manager.shutdown()
})

test("startup cleanup keeps typed teardown primary and original cause without retaining a closed SDK", async t => {
  const { transport } = heldStdioFixture()
  const original = new Error("owned startup refusal")
  t.mock.method(transport, "start", async () => { throw original })
  const client = new McpClient("held", {
    enabled: true, transport: "stdio", command: "owned-no-spawn-fixture", trust_level: "manual",
  })
  await assert.rejects(client.connect(transport), error => {
    assert.ok(error instanceof McpStdioTeardownError)
    assert.equal(error.cause, original)
    return true
  })
  assert.equal((client as any).client, null, "actual SDK onclose already settled its requests")
  assert.equal((client as any).transport, transport, "the failed owned receipt remains tracked")
  await assert.rejects(client.close(), /subprocess teardown timed out/)
  assert.equal(client.connection.status, "error")
})
