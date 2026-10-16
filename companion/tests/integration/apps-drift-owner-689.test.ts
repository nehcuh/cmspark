/** Actual HMAC→lifecycle→validator→router→handler/current-socket fence.
 * Existing measurement and Hello seams are inert; no native/App/provider/token. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import net from "node:net"
import { fork } from "node:child_process"
import { createHmac } from "node:crypto"
import { WebSocket } from "ws"
const root = path.resolve(__dirname, "../../.."), token = "win.app.drift689", A = "a".repeat(64), B = "b".repeat(64)
test("689 actual HMAC owner socket is mandatory through Check and late D2", { timeout: 30000 }, async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-drift689-ws-")); fs.chmodSync(data, 0o700)
  const reserve = net.createServer(); await new Promise<void>(r => reserve.listen(0, "127.0.0.1", r))
  const port = (reserve.address() as net.AddressInfo).port; await new Promise<void>(r => reserve.close(() => r()))
  const fd = fs.openSync(path.join(data, "server.log"), "wx", 0o600), sockets: WebSocket[] = []
  const child = fork(path.join(root, "tests/fixtures/apps-drift-server-689.cjs"), [], { execArgv: [],
    env: { PATH: process.env.PATH, CMSPARK_SKIP_LOGIN_ENV: "1", CMSPARK_DATA_DIR: data, CMSPARK_689_COMPILED_ROOT: path.join(root, ".test-dist/src"), CMSPARK_689_PORT: String(port) }, stdio: ["ignore", fd, fd, "ipc"] }); fs.closeSync(fd)
  let serial = 0
  const ipc = (type: string, id?: string) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { child.off("message", listener); reject(Error("OWNED_IPC_TIMEOUT")) }, 7000)
    const listener = (m: any) => { if (m.type === type && (!id || m.id === id)) { clearTimeout(timer); child.off("message", listener); resolve(m) } }; child.on("message", listener)
  })
  const command = (type: string, extra = {}) => { const id = `ipc-${serial++}`, wait = ipc(type, id); child.send({ type, id, ...extra }); return wait }
  const connect = (auth = true) => new Promise<{ ws: WebSocket; send: (payload: any) => Promise<any> }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: "chrome-extension://owned689" }); sockets.push(ws)
    const waiting = new Map<string, (m: any) => void>()
    const send = (payload: any) => new Promise<any>((r, j) => { const timer = setTimeout(() => { waiting.delete(payload.id); j(Error("OWNED_REPLY_TIMEOUT")) }, 7000); waiting.set(payload.id, m => { clearTimeout(timer); r(m) }); ws.send(JSON.stringify(payload)) })
    ws.once("error", reject); ws.on("message", raw => {
      const m = JSON.parse(raw.toString())
      if (m.type === "auth.challenge") { if (!auth) { resolve({ ws, send }); return }
        const secret = fs.readFileSync(path.join(data, "ws_secret"), "utf8").trim(); ws.send(JSON.stringify({ type: "auth.handshake", proof: createHmac("sha256", secret).update(m.nonce).digest("hex") })); return }
      if (m.type === "auth.ok") { resolve({ ws, send }); return }
      if (m.id) { const done = waiting.get(m.id); if (done) { waiting.delete(m.id); done(m) } }
    })
  })
  try {
    await ipc("ready")
    const unauthed = await connect(false), closed = new Promise<void>(r => unauthed.ws.once("close", () => r()))
    unauthed.ws.send(JSON.stringify({ type: "apps.check_drift", token, id: "preauth" })); await closed
    assert.equal((await command("stats")).measures, 0)
    const owner = await connect()
    assert.equal((await owner.send({ type: "apps.drift_status", token, id: "status" })).status, "not_checked")
    assert.equal((await command("stats")).measures, 0)
    assert.equal((await owner.send({ type: "apps.check_drift", token, id: "check" })).status, "suspended")
    await command("hold", { active: true }); const entered = ipc("gate-entered")
    // The originating peer closes while the actual handler awaits the inert D2.
    owner.ws.send(JSON.stringify({ type: "apps.reapprove", token, id: "late", expected_old_sha256: A, expected_observed_sha256: B })); await entered
    const ownerClosed = new Promise<void>(r => owner.ws.once("close", () => r())); owner.ws.close(); await ownerClosed
    await command("release"); const stranger = await connect()
    const kept = await stranger.send({ type: "apps.drift_status", token, id: "after-close" }); assert.equal(kept.status, "suspended")
    const stats = await command("stats"); assert.equal(stats.policy, "manual"); assert.equal(stats.pin, A)
    assert.equal((await stranger.send({ type: "apps.reapprove", token, id: "current", expected_old_sha256: A, expected_observed_sha256: B })).status, "reapproved")
    const final = await command("stats"); assert.equal(final.pin, B); assert.equal(final.policy, "auto"); assert.equal(final.record, false); assert.equal(final.effects, 0)
    t.diagnostic("DRIFT689 HMAC=true preauth_measure0=true readonly_measure0=true late_closed_owner_denied=true current_owner_fresh_D2=true native_effects0=true software_Hello_only=true")
  } finally {
    for (const ws of sockets) ws.close()
    child.kill("SIGTERM"); await new Promise<void>(resolve => { if (child.exitCode !== null) return resolve(); const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL") }, 8000); child.once("close", () => { clearTimeout(timer); resolve() }) })
    fs.rmSync(data, { recursive: true, force: true })
  }
})
