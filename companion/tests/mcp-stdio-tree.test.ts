import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { McpClient } from "../src/mcp/client"
import { createTransport } from "../src/mcp/transport"

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
