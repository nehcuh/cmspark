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
  requestSummonerWebClose,
  summonerWebHasPage,
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
    assert.match(r.body, /class="hud expanded"/)
    assert.match(r.body, /setExpanded\(true\)/)
    assert.doesNotMatch(r.body, /placeWindow\(false\);/)
    assert.match(r.body, /var w=360,h=420/)
    assert.match(r.body, /id="empty"/)
    assert.match(r.body, /class="mark"/)
    assert.match(r.body, /#chev\{[^}]*display:none|#chev\[hidden\]/)
    assert.match(r.body, /#newThreadBar\{[^}]*display:none/)
    assert.match(r.body, /id="historyOpen"/)
    assert.match(r.body, /id="newChat"/)
    assert.match(r.body, />历史</)
    assert.match(r.body, /id="newChat">新对话/)
    assert.match(r.body, /id="historyClose"/)
    assert.match(r.body, /\.hud\.history \.list\{[^}]*display:flex/)
    assert.match(r.body, /function showHistory/)
    assert.match(r.body, /id="hud"[\s\S]*id="meetingDesk"/)
    assert.match(r.body, /id="meetingDesk"/)
    assert.match(r.body, /id="meetingRec"/)
    assert.match(r.body, />开始录制</)
    assert.match(r.body, /结束录制/)
    assert.match(r.body, /生成会议纪要/)
    assert.match(r.body, /历史会议/)
    assert.match(r.body, /自动标说话人/)
    assert.match(r.body, /id="meetingHistToggle"/)
    assert.match(r.body, /STT_MEETING_MS=8000/)
    assert.match(r.body, /\/api\/stt\/partial/)
    assert.match(r.body, /\/api\/meetings/)
    assert.match(r.body, /\/api\/meeting\/diarize/)
    assert.match(r.body, /\/api\/voice-settings/)
    assert.match(r.body, /voiceSettings\.localModelId/)
    assert.match(r.body, /\/api\/meeting\/append/)
    assert.match(r.body, /\/api\/meeting\/minutes/)
    assert.match(r.body, /function showMeetingDesk/)
    assert.match(r.body, /\.privacy-sheet\{[^}]*position:absolute/)
    assert.match(r.body, /\.status:empty\{[^}]*display:none/)
    assert.match(r.body, /正在打开侧栏/)
    assert.match(r.body, /已请浏览器打开侧栏/)
    assert.match(r.body, /shell\.close/)
    assert.match(r.body, /window\.close\(\)/)
    assert.match(r.body, /id="sendGo"/)
    assert.match(r.body, /发送中/)
    assert.match(r.body, /function ensureThread/)
    assert.match(r.body, /keyCode===229/)
    assert.match(r.body, /min-width:0/)
    assert.match(r.body, /sendShortcut==="Cmd\+Enter"/)
    assert.match(r.body, /\/api\/send-shortcut/)
    const csp = String(r.headers["content-security-policy"] || "")
    assert.match(csp, /script-src 'nonce-[A-Za-z0-9+/=]+'/)
    assert.doesNotMatch(csp, /script-src 'unsafe-inline'/)
    const nonce = (csp.match(/script-src 'nonce-([^']+)'/) || [])[1]
    assert.ok(nonce)
    assert.match(r.body, new RegExp(`<script nonce="${nonce.replace(/[+/]/g, "\\$&")}">`))
    assert.equal((r.body.match(/<script\b/g) || []).length, 1)
    const script = r.body.match(/<script[^>]*>([\s\S]*)<\/script>/)
    assert.ok(script, "inline script missing")
    new Function(script[1])
    assert.match(r.body, /function renderMd/)
    assert.match(r.body, /\.msg\.assistant\{[^}]*white-space:normal/)
    assert.match(r.body, /d\.innerHTML=renderMd/)
    assert.match(r.body, /\.hint\{[^}]*display:none/)
    assert.doesNotMatch(r.body, /grid-template-columns:var\(--rail\) var\(--list\)/)
    assert.match(r.body, /\.rail,\.list\{[^}]*display:none/)
    assert.match(r.body, /id="operateOpen"/)
    assert.match(r.body, /打开浏览器并打开侧栏/)
    assert.match(r.body, /\/api\/operate/)
    assert.match(r.body, /请点工具栏 C/)
    assert.doesNotMatch(r.body, /ui\.open_sidepanel/)
    assert.match(r.body, /id="meetingStart"/)
    assert.doesNotMatch(r.body, /要对这页做什么|当前页：|听写在侧栏|召唤器（实验）/)
    assert.match(r.body, /问 CMspark/)
    assert.match(r.body, /附件和听写不用开浏览器/)
    assert.match(r.body, /<title>CMspark</)
    assert.match(r.body, /\.hud\.expanded \.ghosts\{[^}]*display:none/)
    assert.match(r.body, /\.hud\.expanded \.hint\{[^}]*display:none/)
    assert.doesNotMatch(r.body, /max-width:720px/)
    assert.match(r.body, /type="file"/)
    assert.match(r.body, /📎/)
    assert.match(r.body, /for="files"/)
    assert.doesNotMatch(r.body, /去侧栏处理/)
    assert.match(r.body, /收起对话/)
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

  test("GET /api/send-shortcut returns Enter|Cmd+Enter|Ctrl+Enter", async () => {
    const r = await request({ method: "GET", port, path: `/api/send-shortcut?token=${token}` })
    assert.equal(r.status, 200, r.body)
    const data = JSON.parse(r.body)
    assert.ok(["Enter", "Cmd+Enter", "Ctrl+Enter"].includes(data.send_shortcut))
  })

  test("GET /api/voice-settings returns extension SoT engine/model/lang", async () => {
    const r = await request({ method: "GET", port, path: `/api/voice-settings?token=${token}` })
    assert.equal(r.status, 200, r.body)
    const data = JSON.parse(r.body)
    assert.ok(data.sttEngine === "browser" || data.sttEngine === "local")
    assert.ok(["small", "medium", "large-v3-turbo"].includes(data.localModelId))
    assert.equal(data.lang, "zh-CN")
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

  test("HTML mic is enabled with hidden v2 privacy sheet; no generic dispatch", async () => {
    const r = await request({ method: "GET", port, path: `/?token=${token}` })
    assert.equal(r.status, 200)
    assert.match(r.body, /id="mic"/)
    assert.doesNotMatch(r.body, /id="mic"[^>]*\bdisabled\b/)
    assert.match(r.body, /privacy_ack_v2/)
    assert.match(r.body, /音频经本机 Companion 写入临时文件/)
    assert.match(r.body, /id="voicePrivacy"/)
    assert.match(r.body, /id="voicePrivacy"[^>]*\bhidden\b/)
    assert.doesNotMatch(r.body, /\/api\/dispatch/)
  })

  test("HTML meeting start is hidden privacy + five clauses; v2 present if unacked", async () => {
    const r = await request({ method: "GET", port, path: `/?token=${token}` })
    assert.equal(r.status, 200)
    assert.match(r.body, /id="meetingStart"/)
    assert.match(r.body, />开始会议</)
    assert.match(r.body, /id="meetingPrivacy"/)
    assert.match(r.body, /id="meetingPrivacy"[^>]*\bhidden\b/)
    assert.match(r.body, /会创建本地会话产物/)
    assert.match(r.body, /默认结束录制后删除会议目录下音频/)
    assert.match(r.body, /生成纪要将把转写文本发给你已配置的 LLM/)
    assert.match(r.body, /长会 STT 仅本机/)
    assert.match(r.body, /多方录音法律合规由你负责/)
    assert.match(r.body, /生成会议纪要/)
    assert.match(r.body, /id="meetingVoiceSection"/)
    assert.match(r.body, /id="meetingVoiceSection"[\s\S]*音频经本机 Companion/)
    assert.match(r.body, /if\(!voiceAck\)/)
    assert.match(r.body, /开始录制/)
    assert.match(r.body, /结束录制/)
    assert.match(r.body, /id="meetingRec"/)
    assert.doesNotMatch(r.body, /\/api\/dispatch/)
  })

  test("POST /api/stt/start with token dispatches voice.stt.start", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/stt/start?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ sessionId: "s1", modelId: "medium" }),
    })
    assert.equal(r.status, 200, r.body)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "voice.stt.start")
    assert.equal(dispatched[0].v, 1)
    assert.equal(dispatched[0].privacy_ack_v2, true)
    assert.equal(dispatched[0].sessionId, "s1")
    assert.equal(dispatched[0].modelId, "medium")
    assert.equal(dispatched[0].lang, "zh")
    assert.equal(dispatched[0].format, "pcm_s16le")
    assert.equal(dispatched[0].sampleRate, 16000)
    assert.equal(dispatched[0].channels, 1)
  })

  test("POST /api/stt/chunk with token dispatches voice.stt.chunk quickly", async () => {
    dispatched.length = 0
    const t0 = Date.now()
    const r = await request({
      method: "POST",
      port,
      path: `/api/stt/chunk?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ sessionId: "s1", seq: 0, data: "AA==", type: "list_tabs" }),
    })
    const ms = Date.now() - t0
    assert.equal(r.status, 200, r.body)
    assert.ok(ms < 1500, `chunk HTTP hung ${ms}ms`)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "voice.stt.chunk")
    assert.equal(dispatched[0].sessionId, "s1")
    assert.equal(dispatched[0].seq, 0)
    assert.equal(dispatched[0].v, 1)
  })

  test("POST /api/meeting/start server fills type meeting.start and audio_retained false", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/meeting/start?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        type: "generate_minutes",
        audio_retained: true,
        retain_days: 7,
        title: "overlay meet",
      }),
    })
    assert.equal(r.status, 200, r.body)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "meeting.start")
    assert.equal(dispatched[0].v, 1)
    assert.equal(dispatched[0].privacy_ack_v1, true)
    assert.equal(dispatched[0].audio_retained, false)
    assert.equal(dispatched[0].retain_days, undefined)
    assert.equal(dispatched[0].title, "overlay meet")
    assert.equal(dispatched.some((d) => String(d.type).includes("generate_minutes")), false)
  })

  test("GET /api/meetings dispatches meeting.list", async () => {
    dispatched.length = 0
    const r = await request({
      method: "GET",
      port,
      path: `/api/meetings?token=${token}`,
      headers: { Origin: `http://127.0.0.1:${port}` },
    })
    assert.equal(r.status, 200, r.body)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "meeting.list")
    assert.equal(dispatched[0].v, 1)
  })

  test("POST /api/stt/partial dispatches voice.stt.partial_request", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/stt/partial?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ sessionId: "s1" }),
    })
    assert.equal(r.status, 200, r.body)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "voice.stt.partial_request")
    assert.equal(dispatched[0].sessionId, "s1")
    assert.equal(dispatched[0].v, 1)
  })

  test("POST /api/meeting/diarize fills auto_diarize and privacy_ack", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/meeting/diarize?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        id: "mtg_abc",
        mode: "audio_cluster",
        k: 2,
        features: [[1, 0, 0], [0, 1, 0]],
      }),
    })
    assert.equal(r.status, 200, r.body)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "meeting.auto_diarize")
    assert.equal(dispatched[0].v, 1)
    assert.equal(dispatched[0].privacy_ack_v1, true)
    assert.equal(dispatched[0].id, "mtg_abc")
    assert.equal(dispatched[0].mode, "audio_cluster")
  })

  test("POST /api/meeting/end server fills type meeting.end", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/meeting/end?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ type: "generate_minutes", id: "m1" }),
    })
    assert.equal(r.status, 200, r.body)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "meeting.end")
    assert.equal(dispatched[0].v, 1)
    assert.equal(dispatched[0].id, "m1")
  })

  test("POST /api/stt/start with type=generate_minutes still dispatches voice.stt.start", async () => {
    dispatched.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/stt/start?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        type: "generate_minutes",
        sessionId: "s-min",
        modelId: "medium",
      }),
    })
    assert.equal(r.status, 200, r.body)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "voice.stt.start")
    assert.equal(dispatched.some((d) => String(d.type).includes("generate_minutes")), false)
  })

  test("POST /api/stt with type=list_tabs in body still cannot set type", async () => {
    dispatched.length = 0
    const start = await request({
      method: "POST",
      port,
      path: `/api/stt/start?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({
        type: "list_tabs",
        sessionId: "s-tab",
        modelId: "medium",
      }),
    })
    assert.equal(start.status, 200, start.body)
    assert.equal(dispatched.length, 1)
    assert.equal(dispatched[0].type, "voice.stt.start")
    assert.equal(dispatched.some((d) => d.type === "list_tabs"), false)

    dispatched.length = 0
    const raw = await request({
      method: "POST",
      port,
      path: `/api/stt?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ type: "list_tabs" }),
    })
    assert.notEqual(raw.status, 200)
    assert.equal(dispatched.some((d) => d.type === "list_tabs"), false)
  })

  test("POST unknown path and /api/dispatch are 404", async () => {
    dispatched.length = 0
    const unknown = await request({
      method: "POST",
      port,
      path: `/api/nope?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ type: "list_tabs" }),
    })
    assert.equal(unknown.status, 404)
    const dispatch = await request({
      method: "POST",
      port,
      path: `/api/dispatch?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
      body: JSON.stringify({ type: "voice.stt.start" }),
    })
    assert.equal(dispatch.status, 404)
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
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("voice.stt.start"), true)
    assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("voice.stt.chunk"))
    assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("voice.stt.end"))
    assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("voice.stt.abort"))
    assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("voice.stt.partial_request"))
    assert.ok(SUMMONER_WEB_EVENT_ALLOW.has("voice.stt.partial"))
    assert.ok(SUMMONER_WEB_EVENT_ALLOW.has("voice.stt.result"))
    assert.ok(SUMMONER_WEB_EVENT_ALLOW.has("voice.stt.error"))
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.start"), true)
    assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.create"))
    assert.ok(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.end"))
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.generate_minutes"), true)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.append_transcript"), true)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.list"), true)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.get"), true)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.auto_diarize"), true)
    assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.minutes_result"), true)
    assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.list_result"), true)
    assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("meeting.diarized"), true)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("ui.open_sidepanel"), false)
    assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("ui.open_sidepanel"), false)
    assert.ok(SUMMONER_WEB_EVENT_ALLOW.has("meeting.started"))
    assert.ok(SUMMONER_WEB_EVENT_ALLOW.has("meeting.ended"))
    assert.ok(SUMMONER_WEB_EVENT_ALLOW.has("meeting.error"))
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

  test("requestSummonerWebClose pushes shell.close; hasPage tracks SSE", async () => {
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
          let acc = ""
          const timer = setTimeout(() => {
            req.destroy()
            reject(new Error("sse close timeout: " + acc))
          }, 2000)
          res.on("data", (c) => {
            acc += c.toString()
            if (acc.includes("shell.close")) {
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
        assert.equal(summonerWebHasPage(), true)
        assert.equal(requestSummonerWebClose(), true)
      }, 40)
    })
    assert.match(buf, /shell\.close/)
    assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("shell.close"), false)
  })

  test("POST /api/operate without opener is 503 请点工具栏 C", async () => {
    attachCalls.length = 0
    const r = await request({
      method: "POST",
      port,
      path: `/api/operate?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
    })
    assert.equal(r.status, 503, r.body)
    const data = JSON.parse(r.body)
    assert.equal(data.type, "error")
    assert.equal(data.error, "请点工具栏 C")
    assert.equal(data.error_code, "OPERATE_SIDEPANEL_UNAVAILABLE")
    assert.doesNotMatch(r.body, /ui\.open_sidepanel/)
    assert.doesNotMatch(r.body, /允许/)
    assert.deepEqual(attachCalls, [{ foreground: true }])
  })

  test("POST /api/operate no extension peer is 503 not ok", async () => {
    attachCalls.length = 0
    let opened = 0
    await startSummonerWebServer({
      preferredPort: 23510,
      attachChrome: (opts) => {
        attachCalls.push({ foreground: opts?.foreground })
        return "attached"
      },
      dispatch: async (msg) => ({ type: "ok", echo: msg.type }),
      requestOpenSidePanel: async () => {
        opened += 1
        return {}
      },
      hasExtensionPeer: () => false,
    })
    const r = await request({
      method: "POST",
      port,
      path: `/api/operate?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
    })
    assert.equal(r.status, 503, r.body)
    const data = JSON.parse(r.body)
    assert.notEqual(data.type, "ok")
    assert.equal(data.error, "请点工具栏 C")
    assert.equal(data.error_code, "OPERATE_SIDEPANEL_UNAVAILABLE")
    assert.equal(opened, 0)
    assert.deepEqual(attachCalls, [{ foreground: true }])
  })

  test("POST /api/operate sendAppRequest reject maps to 请点工具栏 C", async () => {
    attachCalls.length = 0
    await startSummonerWebServer({
      preferredPort: 23510,
      attachChrome: (opts) => {
        attachCalls.push({ foreground: opts?.foreground })
        return "attached"
      },
      dispatch: async (msg) => ({ type: "ok", echo: msg.type }),
      requestOpenSidePanel: async () => {
        throw new Error("side panel refused")
      },
      hasExtensionPeer: () => true,
    })
    const r = await request({
      method: "POST",
      port,
      path: `/api/operate?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
    })
    assert.equal(r.status, 503, r.body)
    const data = JSON.parse(r.body)
    assert.equal(data.error, "请点工具栏 C")
    assert.equal(data.error_code, "OPERATE_SIDEPANEL_UNAVAILABLE")
    assert.doesNotMatch(r.body, /ui\.open_sidepanel/)
  })

  test("POST /api/operate rebind opener succeeds after attachChrome foreground", async () => {
    attachCalls.length = 0
    let opened = 0
    await startSummonerWebServer({
      preferredPort: 23510,
      attachChrome: (opts) => {
        attachCalls.push({ foreground: opts?.foreground })
        return "attached"
      },
      dispatch: async (msg) => ({ type: "ok", echo: msg.type }),
      requestOpenSidePanel: async () => {
        opened += 1
        return {}
      },
      hasExtensionPeer: () => true,
    })
    const r = await request({
      method: "POST",
      port,
      path: `/api/operate?token=${token}`,
      headers: {
        "Content-Type": "application/json",
        Origin: `http://127.0.0.1:${port}`,
      },
    })
    assert.equal(r.status, 200, r.body)
    const data = JSON.parse(r.body)
    assert.equal(data.type, "ok")
    assert.equal(data.message, "attached")
    assert.equal(opened, 1)
    assert.deepEqual(attachCalls, [{ foreground: true }])
    assert.doesNotMatch(r.body, /ui\.open_sidepanel/)
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
  assert.match(src, /case "summoner-toggle"/)
  assert.match(src, /toggleSummonerWebShell/)
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

test("HTML empty uses ChatShell NO-PAGE title", () => {
  const html = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(html, /CHAT_SHELL_TITLE_NONE/)
  assert.doesNotMatch(html, /要对这页做什么/)
  assert.doesNotMatch(html, /当前页：/)
  assert.doesNotMatch(html, /正在看/)
  assert.doesNotMatch(html, /正在分享/)
  assert.match(html, /SUMMONER_ATTACH_FOOTNOTE/)
  assert.match(html, /SUMMONER_OPEN_CONFIRM/)
})

test("HTML default expands the face (not 120px bar)", () => {
  const html = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(html, /setExpanded\(true\)/)
  assert.doesNotMatch(html, /placeWindow\(false\);/)
})

test("MCP rail stays hide-not-delete", () => {
  const html = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(html, /data-sec="mcp"[^>]*\bhidden\b|hidden[^>]*data-sec="mcp"/)
  assert.match(html, /mcp.toggle_server/)
})

test("HTML mcp.toggle rides tray companionClient (no overlay L2 stall)", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /type === "mcp\.toggle_server" && companionClient/)
})
