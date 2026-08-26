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
  pushSummonerWebEvent,
  summonerWebEventStatus,
  SUMMONER_WEB_DISPATCH_ALLOW,
  SUMMONER_WEB_EVENT_ALLOW,
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

  const attachCalls: Array<{ foreground?: boolean }> = []

  test("start with dispatch", async () => {
    dispatched.length = 0
    attachCalls.length = 0
    const started = await startSummonerWebServer({
      preferredPort: 23510,
      attachChrome: (opts) => {
        attachCalls.push({ foreground: opts?.foreground })
        return opts?.foreground
          ? "已打开并前置浏览器。我们不能替你打开侧栏。要盯着页面，请点工具栏的 CMspark。"
          : "已在后台打开浏览器。我们不能替你打开侧栏。要盯着页面，请点工具栏的 CMspark。"
      },
      dispatch: async (msg) => {
        dispatched.push(msg)
        if (msg.type === "thread.list") return { type: "thread.list", threads: [{ id: "t1", title: "One" }] }
        if (msg.type === "thread.update") return { type: "thread.updated", thread: { id: msg.thread_id, alias: (msg.updates as any)?.alias } }
        if (msg.type === "thread.delete") return { type: "thread.trashed", thread_id: msg.thread_id, mode: msg.mode }
        if (msg.type === "file.upload") return { type: "file.uploaded", thread_id: msg.thread_id, files: ["a.txt"] }
        if (msg.type === "pack.apply") return { type: "pack.applied", pack_id: msg.pack_id }
        if (msg.type === "composer.lease.get") {
          return { type: "composer.lease", thread_id: msg.thread_id, holder: "panel", rev: 3 }
        }
        if (msg.type === "composer.lease.claim") {
          return { type: "composer.lease", thread_id: msg.thread_id, holder: msg.holder, rev: 4 }
        }
        if (msg.type === "composer.lease.release") {
          return { type: "composer.lease", thread_id: msg.thread_id, holder: "panel", rev: 5 }
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
    assert.match(r.body, /--paper:#fff/)
    assert.match(r.body, /--indigo:#4f46e5/)
    assert.match(r.body, /class="rail-btn"/)
    assert.match(r.body, /data-sec="threads"[^>]*aria-current="true"/)
    assert.match(r.body, /data-sec="mcp"[^>]*\bhidden\b/)
    assert.doesNotMatch(r.body, /＋ 添加 MCP|＋ 导入知识/)
    assert.match(r.body, /html,body\{height:100%;width:100%;overflow:hidden\}/)
    assert.match(r.body, /class="list-scroll"/)
    assert.match(r.body, /\.composer\{[^}]*flex-shrink:0/)
    assert.doesNotMatch(r.body, /#12141c/)
    assert.doesNotMatch(r.body, /class="hud expanded"/)
    assert.match(r.body, /placeWindow\(false\)/)
    assert.match(r.body, /var w=720,h=expanded\?520:120/)
    assert.doesNotMatch(r.body, /max-width:720px/)
    assert.match(r.body, /type="file"/)
    assert.match(r.body, /📎/)
    assert.match(r.body, /for="files"/)
    assert.match(r.body, /听写在侧栏/)
    assert.doesNotMatch(r.body, /去侧栏处理/)
    assert.match(r.body, /展开对话/)
    assert.doesNotMatch(r.body, /展开工作台|收起工作台/)
    assert.match(r.body, /打开浏览器/)
    assert.match(r.body, /打开并前置浏览器/)
    assert.match(r.body, /打开确认台/)
    assert.match(r.body, /需要确认才能继续/)
    assert.match(r.body, /id="openConfirm"/)
    assert.match(r.body, /可以继续聊。要操作网页，需要打开浏览器。/)
    assert.match(r.body, /网页操作需要浏览器（扩展已配对的 Chrome）。/)
    assert.match(r.body, /编程助手要看你的页面，但浏览器没在。/)
    assert.match(r.body, /我们不能替你打开侧栏。要盯着页面，请点工具栏的 CMspark。/)
    assert.match(r.body, /\/api\/attach/)
    assert.match(r.body, /id="attachSilent"|id="attachFront"/)
    assert.match(r.body, /回车发送 · Shift\+Enter 排队/)
    assert.match(r.body, /点击右上角 ⋮ 设置快捷键/)
    assert.match(r.body, /id="settings"/)
    assert.match(r.body, /快捷提问/)
    assert.match(r.body, /重命名/)
    assert.match(r.body, /移到回收站/)
    assert.doesNotMatch(r.body, /Raycast|uTools|启动器|第二大脑|图谱|双链/)
    assert.match(r.body, /pagehide|visibilitychange/)
    assert.match(r.body, /\/api\/lease\/release/)
    assert.match(r.body, /EventSource/)
    assert.match(r.body, /\/api\/events/)
    assert.match(r.body, /已提交/)
    assert.match(r.body, /侧栏占用了输入/)
    assert.match(r.body, /data\.error_code/)
    assert.match(r.body, /statusFromEvent/)
    assert.doesNotMatch(r.body, /mode==="enqueue"\?"已排队"/)
    assert.doesNotMatch(r.body, /允许|拒绝|Allow|Deny/)
    assert.match(r.body, /确认台/)
    assert.doesNotMatch(r.body, /confirmation_id/)
    assert.doesNotMatch(r.body, /ws:\/\//)
    assert.equal(r.headers["referrer-policy"], "no-referrer")
  })

  test("GET / with malformed token percent → 403 not hang", async () => {
    const r = await request({ method: "GET", port, path: "/?token=%" })
    assert.equal(r.status, 403)
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

  test("PATCH /api/thread renames via alias-only thread.update", async () => {
    dispatched.length = 0
    const r = await request({
      method: "PATCH",
      port,
      path: `/api/thread?token=${token}&id=t1`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ alias: "周报", tool_whitelist: null }),
    })
    assert.equal(r.status, 200, r.body)
    const data = JSON.parse(r.body)
    assert.equal(data.type, "thread.updated")
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "thread.update")
    assert.equal(dispatched[0].thread_id, "t1")
    assert.deepEqual(dispatched[0].updates, { alias: "周报" })
  })

  test("DELETE /api/thread always trashes and ignores hard", async () => {
    dispatched.length = 0
    const body = JSON.stringify({ mode: "hard", thread_id: "other" })
    const r = await request({
      method: "DELETE",
      port,
      path: `/api/thread?token=${token}&id=t1&mode=hard`,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Origin: `http://127.0.0.1:${port}`,
      },
      body,
    })
    assert.equal(r.status, 200, r.body)
    const data = JSON.parse(r.body)
    assert.equal(data.type, "thread.trashed")
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "thread.delete")
    assert.equal(dispatched[0].thread_id, "t1")
    assert.equal(dispatched[0].mode, "trash")
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

  test("POST /api/lease/release returns holder to panel from get rev", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/lease/release?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ thread_id: "t1" }),
    })
    assert.equal(r.status, 200, r.body)
    const types = dispatched.map((d) => d.type)
    assert.deepEqual(types, ["composer.lease.get", "composer.lease.release"])
    assert.equal(dispatched[1].rev, 3)
    const data = JSON.parse(r.body)
    assert.equal(data.holder, "panel")
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

  test("POST /api/attach silent uses attachChromeOnly path, never openSidePanel", async () => {
    attachCalls.length = 0
    const silent = await request({
      method: "POST",
      port,
      path: `/api/attach?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ foreground: false }),
    })
    assert.equal(silent.status, 200, silent.body)
    const silentData = JSON.parse(silent.body)
    assert.match(String(silentData.message || silentData.copy || ""), /我们不能替你打开侧栏/)
    assert.deepEqual(attachCalls, [{ foreground: false }])
    assert.doesNotMatch(silent.body, /openSidePanel|sidePanel\.open/)

    attachCalls.length = 0
    const front = await request({
      method: "POST",
      port,
      path: `/api/attach?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ foreground: true }),
    })
    assert.equal(front.status, 200, front.body)
    const frontData = JSON.parse(front.body)
    assert.match(String(frontData.message || frontData.copy || ""), /我们不能替你打开侧栏/)
    assert.deepEqual(attachCalls, [{ foreground: true }])
    assert.doesNotMatch(front.body, /openSidePanel|sidePanel\.open/)
    assert.equal(dispatched.some((d) => String(d.type).includes("sidePanel")), false)
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
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.import"), false)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.preview"), false)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.related"), false)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.get"), false)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.update"), false)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.export"), false)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("thread.distill_preview"), false)
    assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.list"))
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("voice.stt.start"), false)
  })

  test("GET /api/events without token → 403", async () => {
    const r = await request({ method: "GET", port, path: "/api/events" })
    assert.equal(r.status, 403)
  })

  test("SSE forwards run_active and drops confirmation chrome", async () => {
    assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("error"), true)
    assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("security.confirmation.request"), false)
    const buf = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          method: "GET",
          host: "127.0.0.1",
          port,
          path: `/api/events?token=${token}`,
        },
        (res) => {
          assert.equal(res.statusCode, 200)
          assert.match(String(res.headers["content-type"] || ""), /text\/event-stream/)
          let acc = ""
          const timer = setTimeout(() => {
            req.destroy()
            reject(new Error("sse timeout: " + acc))
          }, 2000)
          res.on("data", (c) => {
            acc += c.toString()
            if (acc.includes("run_active")) {
              clearTimeout(timer)
              req.destroy()
              resolve(acc)
            }
          })
        },
      )
      req.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).message === "socket hang up") return
      })
      req.end()
      setTimeout(() => {
        assert.equal(
          pushSummonerWebEvent({
            type: "security.confirmation.request",
            toolName: "evaluate",
            summary: "Allow this?",
          }),
          false,
        )
        assert.equal(
          pushSummonerWebEvent({ type: "error", error: "run_active", thread_id: "t1" }),
          true,
        )
      }, 40)
    })
    assert.match(buf, /run_active/)
    assert.doesNotMatch(buf, /security.confirmation.request/)
    assert.doesNotMatch(buf, /Allow this/)
  })

  after(() => {
    stopSummonerWebServer()
  })
})

test("summonerWebEventStatus maps router OVERLAY_STANDBY and claim mismatch", () => {
  assert.equal(
    summonerWebEventStatus({
      type: "chat.error",
      error: "OVERLAY_STANDBY: composer is on the other surface",
      data: { error_code: "OVERLAY_STANDBY", holder: "panel" },
    }),
    "侧栏占用了输入",
  )
  assert.equal(
    summonerWebEventStatus({
      type: "composer.lease.error",
      error: "LEASE_REV_MISMATCH",
      error_code: "LEASE_REV_MISMATCH",
    }),
    "侧栏占用了输入",
  )
  assert.equal(
    summonerWebEventStatus({ type: "error", error: "run_active" }),
    "本轮还在跑 · 回车纠偏或排队",
  )
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
  assert.equal(assertSummonerAllowed("summoner", "knowledge.related").ok, false)
  assert.equal(assertSummonerAllowed("summoner", "thread.distill_preview").ok, false)
  assert.equal(assertSummonerAllowed("summoner", "knowledge.import").ok, false)
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
  assert.match(src, /pushSummonerWebEvent/)
})

test("C-thin HTML skills toggle and knowledge attach are not activate-only / replace-all", () => {
  const src = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(src, /skill_name:s\.name,on:!on/)
  assert.match(src, /ids:next/)
  assert.doesNotMatch(src, /skill_name:s\.name,on:true/)
  assert.doesNotMatch(src, /ids:\[id\]/)
})

test("HTML mcp.toggle rides tray companionClient (no overlay L2 stall)", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /type === "mcp\.toggle_server" && companionClient/)
})
