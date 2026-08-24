/**
 * C-thin summoner-web: loopback HTML shell (settings-web token/Host/Origin).
 * Browser never talks WS — Origin allowlist stays chrome-extension + cmspark-tray.
 */
import test, { after, describe } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as http from "node:http"
import * as path from "node:path"
import {
  startSummonerWebServer,
  stopSummonerWebServer,
  summonerWebPageUrl,
  SUMMONER_WEB_DISPATCH_ALLOW,
} from "../src/summoner-web"
import { isAllowedWsOrigin } from "../src/ws/lifecycle"

const ROOT = path.resolve(__dirname, "..", "..")

function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

function request(opts: {
  method: string
  path: string
  port: number
  headers?: http.OutgoingHttpHeaders
  body?: string
}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: opts.method,
        host: "127.0.0.1",
        port: opts.port,
        path: opts.path,
        headers: opts.headers || {},
      },
      (res) => {
        let body = ""
        res.on("data", (c) => (body += c.toString()))
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body, headers: res.headers }),
        )
      },
    )
    req.on("error", reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

describe("summoner-web server", { concurrency: 1 }, () => {
  const dispatched: Record<string, unknown>[] = []
  let port = 0
  let token = ""

  test("start with dispatch", async () => {
    dispatched.length = 0
    const started = await startSummonerWebServer({
      preferredPort: 23510,
      dispatch: async (msg) => {
        dispatched.push(msg)
        if (msg.type === "thread.list") return { type: "thread.list", threads: [{ id: "t1", title: "One" }] }
        if (msg.type === "file.upload") return { type: "file.uploaded", thread_id: msg.thread_id, files: ["a.txt"] }
        if (msg.type === "pack.apply") return { type: "pack.applied", pack_id: msg.pack_id }
        if (msg.type === "composer.lease.get") {
          return { type: "composer.lease", thread_id: msg.thread_id, holder: "panel", rev: 3 }
        }
        if (msg.type === "composer.lease.claim") {
          return { type: "composer.lease", thread_id: msg.thread_id, holder: msg.holder, rev: 4 }
        }
        if (msg.type === "chat.create" || msg.type === "chat.steer") {
          return { type: "chat.started", thread_id: msg.thread_id }
        }
        return { type: "ok", echo: msg.type }
      },
    })
    port = started.port
    token = started.token
    assert.ok(port >= 23510)
    assert.equal(token.length, 64)
    assert.match(summonerWebPageUrl(port, token), new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=`))
  })

  test("GET / with no token → 403", async () => {
    const r = await request({ method: "GET", port, path: "/" })
    assert.equal(r.status, 403)
  })

  test("GET / with wrong token → 403", async () => {
    const r = await request({ method: "GET", port, path: "/?token=" + "ab".repeat(32) })
    assert.equal(r.status, 403)
  })

  test("GET / with token → 200 HTML workbench", async () => {
    const r = await request({ method: "GET", port, path: `/?token=${token}` })
    assert.equal(r.status, 200)
    assert.match(r.headers["content-type"] || "", /text\/html/)
    assert.match(r.body, /CMspark 召唤器（实验）/)
    assert.doesNotMatch(r.body, /主界面/)
    assert.match(r.body, /type="file"/)
    assert.match(r.body, /回车发送\/纠偏/)
    assert.match(r.body, /Shift\+Enter 排队/)
    assert.match(r.body, /去侧栏处理/)
    assert.doesNotMatch(r.body, /允许|拒绝|Allow|Deny|确认/)
    assert.doesNotMatch(r.body, /ws:\/\//)
  })

  test("POST with bad Origin → 403", async () => {
    const r = await request({
      method: "POST",
      port,
      path: `/api/chat?token=${token}`,
      headers: { "Content-Type": "application/json", Origin: "http://evil.com" },
      body: JSON.stringify({ thread_id: "t1", message: "hi", mode: "create" }),
    })
    assert.equal(r.status, 403)
  })

  test("POST with bad Host → 403", async () => {
    const r = await request({
      method: "POST",
      port,
      path: `/api/chat?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
        Host: "evil.example",
      },
      body: JSON.stringify({ thread_id: "t1", message: "hi", mode: "create" }),
    })
    assert.equal(r.status, 403)
  })

  test("GET /api/threads dispatches thread.list only", async () => {
    dispatched.length = 0
    const r = await request({ method: "GET", port, path: `/api/threads?token=${token}` })
    assert.equal(r.status, 200, r.body)
    const data = JSON.parse(r.body)
    assert.equal(data.type, "thread.list")
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "thread.list")
  })

  test("POST /api/chat create strips hostname and does not enqueue", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/chat?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        thread_id: "t1",
        message: "hello",
        mode: "create",
        hostname: "evil.example",
        url: "https://evil.example/",
      }),
    })
    assert.equal(r.status, 200, r.body)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "chat.create")
    assert.equal(dispatched[0].thread_id, "t1")
    assert.equal(dispatched[0].message, "hello")
    assert.equal(dispatched[0].hostname, undefined)
    assert.equal(dispatched[0].url, undefined)
    assert.equal(dispatched[0].enqueue, undefined)
  })

  test("POST /api/chat steer and enqueue map correctly", async () => {
    dispatched.length = 0
    const steer = await request({
      method: "POST",
      port,
      path: `/api/chat?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ thread_id: "t1", message: "steer me", mode: "steer" }),
    })
    assert.equal(steer.status, 200, steer.body)
    const enq = await request({
      method: "POST",
      port,
      path: `/api/chat?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ thread_id: "t1", message: "later", mode: "enqueue" }),
    })
    assert.equal(enq.status, 200, enq.body)
    assert.equal(dispatched[0].type, "chat.steer")
    assert.equal(dispatched[1].type, "chat.create")
    assert.equal(dispatched[1].enqueue, true)
  })

  test("POST /api/files dispatches file.upload and drops hostname", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/files?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        thread_id: "t1",
        hostname: "intranet.local",
        files: [{ name: "a.txt", type: "text/plain", content: "aGVsbG8=" }],
      }),
    })
    assert.equal(r.status, 200, r.body)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "file.upload")
    assert.equal(dispatched[0].hostname, undefined)
    assert.equal(dispatched[0].url, undefined)
    const files = dispatched[0].files as Array<{ name: string }>
    assert.equal(files[0].name, "a.txt")
  })

  test("POST /api/lease claims overlay holder from get rev", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/lease?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ thread_id: "t1" }),
    })
    assert.equal(r.status, 200, r.body)
    const types = dispatched.map((d) => d.type)
    assert.deepEqual(types, ["composer.lease.get", "composer.lease.claim"])
    assert.equal(dispatched[1].holder, "overlay")
    assert.equal(dispatched[1].rev, 3)
    const data = JSON.parse(r.body)
    assert.equal(data.holder, "overlay")
  })

  test("POST /api/packs/apply forces user_gesture and strips allowTrust", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/packs/apply?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        pack_id: "meeting-minutes",
        thread_id: "t1",
        allowTrust: true,
        workspace_path: "/tmp/x",
        force_takeover: true,
      }),
    })
    assert.equal(r.status, 200, r.body)
    assert.equal(dispatched[0].type, "pack.apply")
    assert.equal(dispatched[0].user_gesture, true)
    assert.equal(dispatched[0].allowTrust, undefined)
    assert.equal(dispatched[0].workspace_path, undefined)
    assert.equal(dispatched[0].force_takeover, undefined)
  })

  test("unknown / config.set is not dispatched", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/config?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ type: "config.set" }),
    })
    assert.equal(r.status, 404)
    assert.equal(dispatched.length, 0)
  })

  test("dispatch allowlist is summoner-safe", () => {
    assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("file.upload"))
    assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("chat.create"))
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("config.set"), false)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("mcp.add"), false)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("security.confirmation.response"), false)
  })

  after(() => {
    stopSummonerWebServer()
  })
})

test("WS origin allowlist is not weakened for loopback HTML", () => {
  assert.equal(isAllowedWsOrigin("http://127.0.0.1:23403"), false)
  assert.equal(isAllowedWsOrigin("http://localhost:23403"), false)
  assert.equal(isAllowedWsOrigin("cmspark-tray://local"), true)
})

test("summoner ACL allows file.upload after HTML client exists", async () => {
  const { assertSummonerAllowed } = await import("../src/ws/summoner-acl")
  assert.equal(assertSummonerAllowed("summoner", "file.upload").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "mcp.add").ok, false)
  for (const t of SUMMONER_WEB_DISPATCH_ALLOW) {
    assert.equal(assertSummonerAllowed("summoner", t).ok, true, t)
  }
})

test("systray2 and readline expose 召唤器 menu and openSummoner emits summoner", () => {
  const systray = fs.readFileSync(srcFile("tray", "systray2-bridge.ts"), "utf8")
  const readline = fs.readFileSync(srcFile("tray", "readline-tray.ts"), "utf8")
  const adapter = fs.readFileSync(srcFile("tray", "tray-adapter.ts"), "utf8")
  assert.match(adapter, /"summoner"/)
  assert.match(systray, /召唤器（实验）/)
  assert.match(systray, /type:\s*"summoner"/)
  assert.match(systray, /openSummoner[\s\S]{0,400}type:\s*"summoner"/)
  assert.match(readline, /召唤器（实验）/)
  assert.doesNotMatch(systray, /跨平台召唤窗开发中/)
})

test("menu-bar-agent opens summoner-web from summoner action", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /startSummonerWebServer/)
  assert.match(src, /case "summoner"/)
  assert.match(src, /surface:\s*"summoner"/)
})
