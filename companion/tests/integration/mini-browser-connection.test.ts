import assert from "node:assert/strict"
import { fork } from "node:child_process"
import { createHmac } from "node:crypto"
import { once } from "node:events"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { WebSocket } from "ws"
import { startSummonerWebServer, stopSummonerWebServer } from "../../src/summoner-web"
import { CompanionClient } from "../../src/tray/companion-client"

test("Mini reads browser availability from its authenticated daemon across process and socket changes", { timeout: 30000 }, async t => {
  const host = "127.0.0.1"
  const root = path.resolve(__dirname, "../../..")
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mini-connection-"))
  async function availablePort(): Promise<number> {
    const reserve = net.createServer().listen(0, host)
    await once(reserve, "listening")
    const port = (reserve.address() as net.AddressInfo).port
    await new Promise<void>(resolve => reserve.close(() => resolve()))
    return port
  }
  const port = await availablePort()

  // The existing isolated daemon fixture uses the production WS listener, auth and router.
  const daemon = fork(path.join(root, "tests/fixtures/site-counter-533-server.cjs"), [], {
    execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { PATH: process.env.PATH, CMSPARK_SKIP_LOGIN_ENV: "1", CMSPARK_DATA_DIR: data,
      CMSPARK_533_COMPILED_ROOT: path.join(root, ".test-dist/src"), CMSPARK_533_PORT: String(port) },
  })
  const sockets: WebSocket[] = []
  const clients: CompanionClient[] = []
  t.after(async () => {
    stopSummonerWebServer()
    for (const client of clients) client.disconnect()
    for (const ws of sockets) ws.terminate()
    if (daemon.exitCode === null && daemon.signalCode === null) {
      const exited = once(daemon, "exit")
      daemon.kill("SIGKILL")
      await exited
    }
    fs.rmSync(data, { recursive: true, force: true })
  })
  const [ready] = await once(daemon, "message")
  assert.equal(ready.type, "ready")
  const secretLoader = () => fs.readFileSync(path.join(data, "ws_secret"), "utf8").trim()
  async function connectTray(surface: "tray" | "summoner") {
    const client = new CompanionClient({ host, port, surface, secretLoader, reconnectInterval: 0, maxReconnectAttempts: 0 })
    clients.push(client)
    await client.connect()
    assert.equal(client.connectionState, "connected")
    return client
  }
  async function challenge() {
    const ws = new WebSocket(`ws://${host}:${port}`, { origin: "chrome-extension://mini-test" })
    sockets.push(ws)
    const [raw] = await once(ws, "message")
    const frame = JSON.parse(raw.toString())
    assert.equal(frame.type, "auth.challenge")
    return { ws, nonce: frame.nonce }
  }
  async function authenticate({ ws, nonce }: Awaited<ReturnType<typeof challenge>>) {
    const reply = once(ws, "message")
    ws.send(JSON.stringify({ type: "auth.handshake", proof: createHmac("sha256", secretLoader()).update(nonce).digest("hex") }))
    const [raw] = await reply
    assert.equal(JSON.parse(raw.toString()).type, "auth.ok")
  }

  const tray = await connectTray("tray")
  const mini = await startSummonerWebServer({ preferredPort: await availablePort(), dispatch: async () => ({}), hasExtensionPeer: () => tray.hasExtensionPeer })
  async function checkMini(expected: boolean) {
    const url = `http://${host}:${mini.port}/api/browser-status`
    for (let attempt = 0; attempt < 100 && tray.hasExtensionPeer !== expected; attempt++) await delay(10)
    const response = await fetch(url, { headers: { "X-CMspark-Overlay-Token": mini.token } })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { connected: expected })
  }
  const first = await challenge()
  await checkMini(false)
  await authenticate(first)
  await checkMini(true)
  const overlay = await connectTray("summoner")
  assert.equal(overlay.hasExtensionPeer, true) // auth.ok snapshot on a late join
  const second = await challenge()
  await authenticate(second)
  first.ws.close()
  await once(first.ws, "close")
  await checkMini(true)
  second.ws.close()
  await once(second.ws, "close")
  await checkMini(false)
  await authenticate(await challenge())
  await checkMini(true)
  tray.disconnect()
  assert.equal(tray.hasExtensionPeer, false)
  await tray.connect()
  await checkMini(true)
})
