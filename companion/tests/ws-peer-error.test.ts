import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { createHmac } from "node:crypto"
import { spawn } from "node:child_process"
import { WebSocket } from "ws"

test("one malformed peer cannot exit Companion or disconnect its healthy concurrent peer", { timeout: 25_000 }, async t => {
  const probe = http.createServer()
  await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-peer-error-"))
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ port,
    llm: { api_key: "", base_url: "http://127.0.0.1:1/v1", model_name: "fixture" }, mcp: { servers: [] } }))
  const serverPath = path.resolve(__dirname, "../src/server.js")
  const child = spawn(process.execPath, ["-e", `require(${JSON.stringify(serverPath)}).startServer().catch(e=>{console.error(e);process.exit(1)})`], {
    env: { ...process.env, CMSPARK_DATA_DIR: dir, DEEPSEEK_API_KEY: "", OPENAI_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  child.stdout.on("data", bytes => { output = (output + bytes).slice(-10_000) })
  child.stderr.on("data", bytes => { output = (output + bytes).slice(-10_000) })
  const peers: WebSocket[] = []
  t.after(async () => {
    for (const peer of peers) peer.terminate()
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve))
      child.kill("SIGKILL"); await exited
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const health = () => new Promise<number>((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/healthz`, res => { res.resume(); resolve(res.statusCode || 0) })
    req.on("error", reject); req.setTimeout(1000, () => req.destroy())
  })
  let ready = false
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) break
    try { if (await health() === 200) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(ready, output)
  async function connect(authenticate = false) {
    const peer = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "chrome-extension://fixture" })
    peers.push(peer); peer.on("error", () => {})
    const authenticated = authenticate ? new Promise<void>((resolve, reject) => {
      peer.on("message", raw => {
        const message = JSON.parse(raw.toString())
        if (message.type === "auth.challenge") {
          const secret = fs.readFileSync(path.join(dir, "ws_secret"), "utf8").trim()
          peer.send(JSON.stringify({ type: "auth.handshake", protocol_version: 1,
            proof: createHmac("sha256", secret).update(message.nonce).digest("hex") }))
        } else if (message.type === "auth.ok") resolve()
        else if (message.type === "auth.failed") reject(new Error("fixture auth failed"))
      })
      peer.once("error", reject)
    }) : null
    await new Promise<void>((resolve, reject) => { peer.once("open", resolve); peer.once("error", reject) })
    if (authenticated) await authenticated
    return peer
  }
  const healthy = await connect(true), bad = await connect()
  const closed = new Promise(resolve => bad.once("close", resolve))
  // RFC6455 requires masked client frames. This triggers ws Receiver error
  // on the server's individual socket, not the WebSocketServer instance.
  ;(bad as any)._socket.write(Buffer.from([0x81, 0x01, 0x41]))
  await closed
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(child.exitCode, null, output)
  assert.equal(healthy.readyState, WebSocket.OPEN, output)
  const pong = new Promise<void>(resolve => {
    healthy.on("message", raw => { if (JSON.parse(raw.toString()).type === "system.pong") resolve() })
  })
  healthy.send(JSON.stringify({ type: "system.ping" }))
  await pong
  assert.equal(await health(), 200)
  const logs = fs.readdirSync(path.join(dir, "logs")).map(name => fs.readFileSync(path.join(dir, "logs", name), "utf8")).join("\n")
  assert.match(logs, /ws\.peer_error/)
})
