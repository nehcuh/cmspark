/**
 * C-thin summoner shell: loopback HTML + token (settings-web pattern).
 *
 * The page never upgrades companion WS — Origin allowlist stays
 * chrome-extension:// and cmspark-tray://local. Tray dispatch uses the
 * existing summoner-stamped CompanionClient.
 */
import * as http from "http"
import * as crypto from "crypto"
import * as child_process from "child_process"
import {
  planSummonerShellOpen,
  resolveSummonerBrowserPath,
} from "./summoner/shell-open"
import { applySummonerPayloadPolicy } from "./ws/summoner-acl"

export type SummonerWebDispatch = (msg: Record<string, unknown>) => Promise<unknown>

export const SUMMONER_WEB_DISPATCH_ALLOW = new Set([
  "system.ping",
  "chat.create",
  "chat.abort",
  "chat.steer",
  "thread.list",
  "thread.select",
  "thread.create",
  "thread.delete",
  "thread.update",
  "mcp.list",
  "mcp.toggle_server",
  "pack.list",
  "pack.apply",
  "skill.list",
  "skill.activate",
  "skill.deactivate",
  "knowledge.list",
  "knowledge.set_active",
  "file.upload",
  "composer.lease.get",
  "composer.lease.claim",
  "composer.lease.release",
])

/** Fan-out to HTML EventSource. Confirm / Trust / config frames stay off this list. */
export const SUMMONER_WEB_EVENT_ALLOW = new Set([
  "chat.token",
  "chat.done",
  "chat.error",
  "chat.user",
  "chat.steered",
  "chat.enqueued",
  "chat.aborted",
  "error",
  "file.upload_status",
  "file.upload_error",
  "file.uploaded",
  "run_status",
  "composer.lease",
  "tool.start",
  "mcp.confirm.pending",
])

const MAX_SSE_CLIENTS = 4
const sseClients = new Set<http.ServerResponse>()

const FILE_BODY_MAX = 15 * 1024 * 1024
const JSON_BODY_MAX = 64 * 1024

let activeServer: http.Server | null = null
let activePort: number | null = null
let sessionToken: string | null = null
let activeDispatch: SummonerWebDispatch | null = null
let lastAccessTime = Date.now()
let autoCloseTimer: ReturnType<typeof setInterval> | null = null

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 10; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const probe = http.createServer()
        probe.on("error", reject)
        probe.listen(port, "127.0.0.1", () => {
          probe.close(() => resolve())
        })
      })
      return port
    } catch {
      continue
    }
  }
  throw new Error("No available port for summoner web server")
}

function parseQuery(qs: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!qs) return out
  for (const pair of qs.split("&")) {
    if (!pair) continue
    const eq = pair.indexOf("=")
    const k = eq < 0 ? decodeURIComponent(pair) : decodeURIComponent(pair.slice(0, eq))
    const v = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1))
    out.set(k, v)
  }
  return out
}

function tokenOk(req: http.IncomingMessage, expected: string): boolean {
  const raw = req.url || ""
  const qIdx = raw.indexOf("?")
  if (qIdx < 0) return false
  const query = parseQuery(raw.slice(qIdx + 1))
  const provided = query.get("token")
  if (!provided) return false
  if (provided.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

function hostOk(req: http.IncomingMessage, port: number): boolean {
  const host = (req.headers.host || "").toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

function originOk(req: http.IncomingMessage, port: number): boolean {
  const origin = (req.headers.origin || "").toLowerCase()
  if (!origin) return true
  return (
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}` ||
    origin === `http://[::1]:${port}`
  )
}

function forbidden(res: http.ServerResponse, reason: string) {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" })
  res.end(`Forbidden: ${reason}`)
}

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200) {
  if (!res.headersSent) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  }
  res.end(JSON.stringify(data))
}

function readBody(req: http.IncomingMessage, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > maxSize) {
        reject(new Error("Request body too large"))
        req.destroy()
        return
      }
      body += chunk.toString()
    })
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

async function dispatchAllowed(type: string, payload: Record<string, unknown>): Promise<unknown> {
  if (!SUMMONER_WEB_DISPATCH_ALLOW.has(type)) {
    throw Object.assign(new Error(`not allowed: ${type}`), { status: 403 })
  }
  const msg: Record<string, unknown> = { ...payload, type }
  const gate = applySummonerPayloadPolicy("summoner", msg)
  if (!gate.ok) {
    throw Object.assign(new Error(gate.error), { status: 403, error_code: gate.error_code })
  }
  if (!activeDispatch) throw Object.assign(new Error("summoner dispatch unavailable"), { status: 503 })
  return activeDispatch(msg)
}

export function summonerWebPageUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/?token=${token}`
}

const STATUS_LABELS: Record<string, string> = {
  run_active: "本轮还在跑 · 回车纠偏或排队",
  queue_full: "排队已满（最多 8 条）",
  steer_queue_full: "纠偏队列已满",
  idle_enqueue: "空闲时直接发送，不必排队",
  OVERLAY_STANDBY: "侧栏占用了输入",
  LEASE_REV_MISMATCH: "侧栏占用了输入",
  LEASE_HOLDER_SURFACE_MISMATCH: "侧栏占用了输入",
}

/** Map router/SSE errors to overlay copy. Keys `data.error_code`, not the English `error` sentence. */
export function summonerWebEventStatus(msg: unknown): string {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return "出错了"
  const m = msg as Record<string, unknown>
  const data = m.data && typeof m.data === "object" && !Array.isArray(m.data)
    ? (m.data as Record<string, unknown>)
    : {}
  const raw = String(m.error_code || data.error_code || m.error || "")
  const code = raw.includes("OVERLAY_STANDBY")
    ? "OVERLAY_STANDBY"
    : raw.includes("LEASE_REV_MISMATCH")
      ? "LEASE_REV_MISMATCH"
      : raw
  if (STATUS_LABELS[code]) return STATUS_LABELS[code]
  if (typeof m.error === "string" && m.error.trim()) return m.error
  if (typeof m.message === "string" && m.message.trim()) return m.message
  return "出错了"
}

export function pushSummonerWebEvent(msg: unknown): boolean {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return false
  const type = (msg as { type?: unknown }).type
  if (typeof type !== "string" || !SUMMONER_WEB_EVENT_ALLOW.has(type)) return false
  if (/confirm/i.test(type) && type !== "mcp.confirm.pending") return false
  const line = `data: ${JSON.stringify(msg)}\n\n`
  for (const res of sseClients) {
    try {
      res.write(line)
    } catch {
      sseClients.delete(res)
    }
  }
  return true
}

function closeSseClients(): void {
  for (const res of sseClients) {
    try {
      res.end()
    } catch {
      /* ignore */
    }
  }
  sseClients.clear()
}

export type OpenLoopbackPageDeps = {
  platform?: NodeJS.Platform
  browserPath?: string | null
  spawn?: (
    command: string,
    args: string[],
    options: { detached?: boolean; stdio?: "ignore"; windowsHide?: boolean; shell?: boolean },
  ) => { unref: () => void }
}

/** Returns false when the URL is rejected (no spawn). */
export function openLoopbackPage(url: string, deps: OpenLoopbackPageDeps = {}): boolean {
  const platform = deps.platform ?? process.platform
  const browserPath =
    deps.browserPath !== undefined ? deps.browserPath : resolveSummonerBrowserPath(platform)
  const plan = planSummonerShellOpen(url, { platform, browserPath })
  if ("error" in plan) {
    console.error(`[summoner-web] ${plan.error}`)
    return false
  }
  const spawn = deps.spawn ?? ((cmd, args, opts) => child_process.spawn(cmd, args, opts))
  spawn(plan.command, plan.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref()
  return true
}

export async function startSummonerWebServer(opts: {
  preferredPort?: number
  dispatch: SummonerWebDispatch
}): Promise<{ port: number; token: string }> {
  activeDispatch = opts.dispatch
  if (activeServer && activePort && sessionToken) {
    lastAccessTime = Date.now()
    return { port: activePort, token: sessionToken }
  }

  const port = await findAvailablePort(opts.preferredPort ?? 23403)
  lastAccessTime = Date.now()
  const token = crypto.randomBytes(32).toString("hex")

  const server = http.createServer((req, res) => {
    lastAccessTime = Date.now()
    void handleRequest(req, res, port, token)
  })

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject)
    server.listen(port, "127.0.0.1", resolve)
  })

  activeServer = server
  activePort = port
  sessionToken = token

  autoCloseTimer = setInterval(() => {
    if (Date.now() - lastAccessTime > 30 * 60 * 1000) {
      stopSummonerWebServer()
    }
  }, 60 * 1000)

  return { port, token }
}

export function stopSummonerWebServer(): void {
  if (autoCloseTimer) {
    clearInterval(autoCloseTimer)
    autoCloseTimer = null
  }
  if (activeServer) {
    closeSseClients()
    activeServer.close()
    activeServer = null
    activePort = null
    sessionToken = null
    activeDispatch = null
  }
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  port: number,
  token: string,
): Promise<void> {
  let pathOnly = "/"
  let query = new Map<string, string>()
  try {
    const raw = req.url || "/"
    const qIdx = raw.indexOf("?")
    pathOnly = (qIdx < 0 ? raw : raw.slice(0, qIdx)) || "/"
    query = qIdx < 0 ? new Map<string, string>() : parseQuery(raw.slice(qIdx + 1))
    if (!tokenOk(req, token)) {
      forbidden(res, "missing or invalid session token")
      return
    }
  } catch {
    forbidden(res, "missing or invalid session token")
    return
  }
  if (!hostOk(req, port)) {
    forbidden(res, `unexpected Host header "${req.headers.host || ""}"`)
    return
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": `http://127.0.0.1:${port}`,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    })
    res.end()
    return
  }

  if (
    (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") &&
    !originOk(req, port)
  ) {
    forbidden(res, `unexpected Origin header "${req.headers.origin || ""}"`)
    return
  }

  try {
    if ((pathOnly === "/" || pathOnly === "/summoner") && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'",
      })
      res.end(SUMMONER_HTML)
      return
    }

    if (pathOnly === "/api/health" && req.method === "GET") {
      jsonResponse(res, { status: "ok", uptime: process.uptime() })
      return
    }

    if (pathOnly === "/api/events" && req.method === "GET") {
      if (sseClients.size >= MAX_SSE_CLIENTS) {
        jsonResponse(res, { type: "error", error: "too many listeners" }, 429)
        return
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      })
      res.write(":\n\n")
      sseClients.add(res)
      req.on("close", () => {
        sseClients.delete(res)
      })
      return
    }

    if (pathOnly === "/api/threads" && req.method === "GET") {
      jsonResponse(res, await dispatchAllowed("thread.list", {}))
      return
    }

    if (pathOnly === "/api/threads" && req.method === "POST") {
      jsonResponse(res, await dispatchAllowed("thread.create", {}))
      return
    }

    if (pathOnly === "/api/thread" && req.method === "GET") {
      const id = query.get("id") || ""
      if (!id) {
        jsonResponse(res, { type: "error", error: "id required" }, 400)
        return
      }
      jsonResponse(res, await dispatchAllowed("thread.select", { thread_id: id }))
      return
    }

    if (pathOnly === "/api/thread" && req.method === "PATCH") {
      const id = query.get("id") || ""
      if (!id) {
        jsonResponse(res, { type: "error", error: "id required" }, 400)
        return
      }
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const alias = typeof body.alias === "string" ? body.alias : ""
      jsonResponse(res, await dispatchAllowed("thread.update", { thread_id: id, updates: { alias } }))
      return
    }

    if (pathOnly === "/api/thread" && req.method === "DELETE") {
      const id = query.get("id") || ""
      if (!id) {
        jsonResponse(res, { type: "error", error: "id required" }, 400)
        return
      }
      jsonResponse(res, await dispatchAllowed("thread.delete", { thread_id: id, mode: "trash" }))
      return
    }

    if (pathOnly === "/api/packs" && req.method === "GET") {
      jsonResponse(res, await dispatchAllowed("pack.list", {}))
      return
    }

    if (pathOnly === "/api/mcp" && req.method === "GET") {
      jsonResponse(res, await dispatchAllowed("mcp.list", {}))
      return
    }

    if (pathOnly === "/api/mcp/toggle" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const name = typeof body.name === "string" ? body.name : ""
      if (!name || typeof body.enabled !== "boolean") {
        jsonResponse(res, { type: "error", error: "name and enabled required" }, 400)
        return
      }
      jsonResponse(res, await dispatchAllowed("mcp.toggle_server", { name, enabled: body.enabled }))
      return
    }

    if (pathOnly === "/api/skills" && req.method === "GET") {
      jsonResponse(res, await dispatchAllowed("skill.list", {}))
      return
    }

    if (pathOnly === "/api/skills/toggle" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      const skill_name = typeof body.skill_name === "string" ? body.skill_name : ""
      const on = body.on !== false
      if (!thread_id || !skill_name) {
        jsonResponse(res, { type: "error", error: "thread_id and skill_name required" }, 400)
        return
      }
      jsonResponse(
        res,
        await dispatchAllowed(on ? "skill.activate" : "skill.deactivate", { thread_id, skill_name }),
      )
      return
    }

    if (pathOnly === "/api/knowledge" && req.method === "GET") {
      jsonResponse(res, await dispatchAllowed("knowledge.list", {}))
      return
    }

    if (pathOnly === "/api/knowledge/active" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      const ids = Array.isArray(body.ids) ? body.ids : []
      if (!thread_id) {
        jsonResponse(res, { type: "error", error: "thread_id required" }, 400)
        return
      }
      jsonResponse(res, await dispatchAllowed("knowledge.set_active", { thread_id, ids }))
      return
    }

    if (pathOnly === "/api/chat" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      const message = typeof body.message === "string" ? body.message : ""
      if (!thread_id || !message.trim()) {
        jsonResponse(res, { type: "error", error: "thread_id and message required" }, 400)
        return
      }
      const mode = body.mode === "steer" || body.mode === "enqueue" ? body.mode : "create"
      if (mode === "steer") {
        jsonResponse(res, await dispatchAllowed("chat.steer", { thread_id, message }))
        return
      }
      jsonResponse(
        res,
        await dispatchAllowed("chat.create", {
          thread_id,
          message,
          ...(mode === "enqueue" ? { enqueue: true } : {}),
        }),
      )
      return
    }

    if (pathOnly === "/api/files" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, FILE_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      if (!thread_id || !Array.isArray(body.files)) {
        jsonResponse(res, { type: "error", error: "thread_id and files required" }, 400)
        return
      }
      const payload: Record<string, unknown> = { thread_id, files: body.files }
      if (typeof body.message === "string" && body.message.trim()) payload.message = body.message
      jsonResponse(res, await dispatchAllowed("file.upload", payload))
      return
    }

    if (pathOnly === "/api/packs/apply" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const pack_id = typeof body.pack_id === "string" ? body.pack_id : ""
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      if (!pack_id || !thread_id) {
        jsonResponse(res, { type: "error", error: "pack_id and thread_id required" }, 400)
        return
      }
      jsonResponse(
        res,
        await dispatchAllowed("pack.apply", { pack_id, thread_id, user_gesture: true }),
      )
      return
    }

    if (pathOnly === "/api/lease/release" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      if (!thread_id) {
        jsonResponse(res, { type: "error", error: "thread_id required" }, 400)
        return
      }
      const got = (await dispatchAllowed("composer.lease.get", { thread_id })) as {
        rev?: number
      }
      const rev = typeof got?.rev === "number" ? got.rev : 0
      jsonResponse(res, await dispatchAllowed("composer.lease.release", { thread_id, rev }))
      return
    }

    if (pathOnly === "/api/lease" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      if (!thread_id) {
        jsonResponse(res, { type: "error", error: "thread_id required" }, 400)
        return
      }
      const got = (await dispatchAllowed("composer.lease.get", { thread_id })) as {
        rev?: number
      }
      const rev = typeof got?.rev === "number" ? got.rev : 0
      jsonResponse(
        res,
        await dispatchAllowed("composer.lease.claim", {
          thread_id,
          holder: "overlay",
          rev,
        }),
      )
      return
    }

    if (pathOnly === "/api/abort" && req.method === "POST") {
      const body = JSON.parse(await readBody(req, JSON_BODY_MAX))
      const thread_id = typeof body.thread_id === "string" ? body.thread_id : ""
      if (!thread_id) {
        jsonResponse(res, { type: "error", error: "thread_id required" }, 400)
        return
      }
      jsonResponse(res, await dispatchAllowed("chat.abort", { thread_id }))
      return
    }

    res.writeHead(404)
    res.end("Not found")
  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500
    jsonResponse(res, { type: "error", error: e?.message || String(e) }, status)
  }
}

const SUMMONER_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CMspark 召唤器（实验）</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#12141c;color:#e8e8ef;height:100vh;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #2a2d3a;background:#1a1d27}
header h1{font-size:14px;font-weight:600}
.badge{font-size:11px;color:#9aa0b4;margin-left:auto}
.shell{flex:1;display:flex;min-height:0}
.rail{width:220px;border-right:1px solid #2a2d3a;display:flex;flex-direction:column;background:#161822;overflow:auto}
.rail h2{font-size:11px;letter-spacing:.04em;color:#8b90a5;padding:10px 12px 4px;text-transform:uppercase}
.item{display:block;width:calc(100% - 16px);margin:2px 8px;padding:7px 8px;border:0;border-radius:6px;background:transparent;color:#d5d7e2;text-align:left;font:inherit;cursor:pointer}
.trow{display:flex;align-items:center;gap:0;width:calc(100% - 8px);margin:0 4px}
.trow .item{flex:1;width:auto;margin:2px 0}
.trow .mini{flex:0 0 auto;width:auto;margin:2px 0;padding:7px 6px;font-size:11px;color:#8b90a5}
.item:hover{background:#252836}
.item.active{background:#2f3650;color:#fff}
.item.muted{opacity:.45;cursor:not-allowed}
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.log{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:92%;padding:8px 10px;border-radius:8px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.msg.user{align-self:flex-end;background:#2b4a7a}
.msg.assistant{align-self:flex-start;background:#222533}
.composer{border-top:1px solid #2a2d3a;padding:10px 12px;background:#1a1d27}
.hint{font-size:11px;color:#8b90a5;margin-bottom:6px}
textarea{width:100%;min-height:72px;resize:vertical;border:1px solid #33384a;border-radius:8px;background:#12141c;color:#e8e8ef;padding:8px;font:inherit}
.row{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
.btn{padding:6px 12px;border-radius:7px;border:0;background:#3d6df2;color:#fff;font-size:12px;cursor:pointer}
.btn.ghost{background:#2a2d3a;color:#d5d7e2}
.btn:disabled{opacity:.4;cursor:not-allowed}
.status{font-size:12px;color:#c9a227;min-height:16px}
input[type=file]{font-size:12px;color:#9aa0b4}
</style>
</head>
<body>
<header>
  <h1>CMspark 召唤器（实验）</h1>
  <span class="badge" id="badge">快捷提问 · 批准在侧栏</span>
</header>
<div class="shell">
  <aside class="rail">
    <div class="trow" id="secs">
      <button class="item mini active" data-sec="threads">对话</button>
      <button class="item mini" data-sec="packs">场景</button>
      <button class="item mini" data-sec="knowledge">知识</button>
      <button class="item mini" data-sec="skills">技能</button>
      <button class="item mini" data-sec="mcp">MCP</button>
    </div>
    <h2 id="secHead">对话</h2>
    <button class="item" id="newThread">＋ 新建对话</button>
    <div id="threads"></div>
    <div id="composeList"></div>
  </aside>
  <section class="main">
    <div class="log" id="log"></div>
    <div class="composer">
      <div class="hint" id="hint">回车发送/纠偏 · Shift+Enter 排队 · # 搜标题 · 听写/知识配置/批准去侧栏处理</div>
      <textarea id="text" placeholder="说一句，或 # 搜标题"></textarea>
      <div class="row">
        <label class="btn ghost" for="files" title="添加附件">📎</label>
        <input type="file" id="files" multiple hidden>
        <button class="btn" id="send">发送</button>
        <button class="btn ghost" id="steer">纠偏</button>
        <button class="btn ghost" id="queue">排队</button>
        <button class="btn ghost" id="stop">停止</button>
      </div>
      <div class="status" id="status"></div>
    </div>
  </section>
</div>
<script>
(function(){
  var token=(location.search.match(/[?&]token=([^&]+)/)||[])[1]||"";
  function url(path){return path+(path.indexOf("?")>=0?"&":"?")+"token="+encodeURIComponent(token)}
  var threadId="";
  var busy=false;
  var threads=[];
  var poll=null;
  function $(id){return document.getElementById(id)}
  function setStatus(t){$("status").textContent=t||""}
  function api(path, opts){
    return fetch(url(path), opts).then(function(r){return r.json().catch(function(){return {error:r.statusText}})})
  }
  function renderThreads(filter){
    var q=(filter||"").trim();
    var box=$("threads");
    box.innerHTML="";
    threads.forEach(function(t){
      var title=(t.title||t.alias||t.id||"").trim()||t.id;
      if(q && title.indexOf(q)<0 && String(t.alias||"").indexOf(q)<0) return;
      var row=document.createElement("div");
      row.className="trow";
      var b=document.createElement("button");
      b.className="item"+(t.id===threadId?" active":"");
      b.textContent=title;
      b.onclick=function(){selectThread(t.id)};
      var rn=document.createElement("button");
      rn.className="item mini";
      rn.textContent="重命名";
      rn.onclick=function(ev){
        ev.stopPropagation();
        var alias=window.prompt("重命名", title);
        if(!alias||!String(alias).trim()) return;
        api("/api/thread?id="+encodeURIComponent(t.id),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({alias:String(alias).trim()})}).then(function(d){
          if(d&&(d.error||d.type==="error")){setStatus(d.error||"无法重命名");return}
          return refresh();
        });
      };
      var tr=document.createElement("button");
      tr.className="item mini";
      tr.textContent="移到回收站";
      tr.onclick=function(ev){
        ev.stopPropagation();
        if(!window.confirm("把「"+title+"」移到回收站？")) return;
        api("/api/thread?id="+encodeURIComponent(t.id),{method:"DELETE"}).then(function(d){
          if(d&&(d.error||d.type==="error")){setStatus(d.error||"无法移到回收站");return}
          var gone=threadId===t.id;
          return refresh().then(function(){
            if(!gone) return;
            if(threads[0]) return selectThread(threads[0].id);
            $("newThread").click();
          });
        });
      };
      row.appendChild(b);
      row.appendChild(rn);
      row.appendChild(tr);
      box.appendChild(row);
    });
  }
  function renderMsgs(messages){
    var log=$("log");
    log.innerHTML="";
    (messages||[]).forEach(function(m){
      if(!m||(m.role!=="user"&&m.role!=="assistant")) return;
      var d=document.createElement("div");
      d.className="msg "+m.role;
      d.textContent=typeof m.content==="string"?m.content:(m.content&&m.content[0]&&m.content[0].text)||"";
      log.appendChild(d);
    });
    log.scrollTop=log.scrollHeight;
  }
  function syncBusyUi(){
    $("hint").textContent=busy
      ?"回车发送/纠偏 · Shift+Enter 排队 · 忙时附件请等本轮结束 · 听写/知识配置/批准去侧栏处理"
      :"回车发送/纠偏 · Shift+Enter 排队 · # 搜标题 · 听写/知识配置/批准去侧栏处理";
  }
  function selectThread(id){
    threadId=id;
    renderThreads($("text").value.charAt(0)==="#"?$("text").value.slice(1):"");
    return api("/api/lease",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:id})})
      .then(function(d){
        if(d && (d.error || d.error_code || (d.data&&d.data.error_code) || d.type==="error" || d.type==="chat.error" || d.type==="composer.lease.error")){
          setStatus(statusFromEvent(d));
        }
        return api("/api/thread?id="+encodeURIComponent(id));
      })
      .then(function(d){
        renderMsgs(d.messages||[]);
        busy=d.run_status==="llm";
        syncBusyUi();
        if(busy) startPoll(); else stopPoll();
      });
  }
  function startPoll(){
    if(poll) return;
    poll=setInterval(function(){
      if(!threadId) return;
      api("/api/thread?id="+encodeURIComponent(threadId)).then(function(d){
        renderMsgs(d.messages||[]);
        var next=d.run_status==="llm";
        if(next!==busy){busy=next;syncBusyUi()}
        if(!busy) stopPoll();
      });
    },1200);
  }
  function stopPoll(){if(poll){clearInterval(poll);poll=null}}
  function filesToPayload(list){
    var arr=[].slice.call(list||[]);
    return Promise.all(arr.map(function(f){
      return new Promise(function(resolve,reject){
        var r=new FileReader();
        r.onload=function(){
          var s=String(r.result||"");
          var i=s.indexOf(",");
          resolve({name:f.name,type:f.type||"application/octet-stream",content:i>=0?s.slice(i+1):s});
        };
        r.onerror=reject;
        r.readAsDataURL(f);
      });
    }));
  }
  function send(mode){
    var text=$("text").value;
    if(text.trim().charAt(0)==="#"){
      renderThreads(text.trim().slice(1));
      return;
    }
    if(!threadId){setStatus("没有当前对话");return}
    var fileEl=$("files");
    var hasFiles=fileEl.files&&fileEl.files.length;
    if(hasFiles && (busy || mode==="steer" || mode==="enqueue")){
      setStatus("忙时不能上传附件（run_active）");
      return;
    }
    var go=hasFiles
      ? filesToPayload(fileEl.files).then(function(files){
          return api("/api/files",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId,files:files,message:text})});
        })
      : api("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId,message:text,mode:mode|| (busy?"steer":"create")})});
    go.then(function(d){
      if(d.error||d.type==="error"){setStatus(d.error||"发送失败");return}
      setStatus("已提交");
    }).catch(function(e){setStatus(String(e&&e.message||e))});
  }
  $("send").onclick=function(){send(busy?"steer":"create")};
  $("steer").onclick=function(){send("steer")};
  $("queue").onclick=function(){send("enqueue")};
  $("stop").onclick=function(){
    if(!threadId) return;
    api("/api/abort",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId})});
  };
  $("newThread").onclick=function(){
    api("/api/threads",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(function(d){
      var id=d.thread&&d.thread.id;
      if(!id){setStatus("新建失败");return}
      return refresh().then(function(){return selectThread(id)});
    });
  };
  $("text").addEventListener("keydown",function(e){
    if(e.key!=="Enter" || e.isComposing) return;
    if(e.shiftKey){
      if(busy){e.preventDefault();send("enqueue")}
      return;
    }
    e.preventDefault();
    send(busy?"steer":"create");
  });
  $("text").addEventListener("input",function(){
    var v=$("text").value;
    if(v.trim().charAt(0)==="#") renderThreads(v.trim().slice(1));
  });
  function refresh(){
    return api("/api/threads").then(function(d){
      threads=(d.threads||[]).slice().sort(function(a,b){
        return String(b.updated_at||b.created_at||"").localeCompare(String(a.updated_at||a.created_at||""));
      });
      renderThreads();
    });
  }
  var sec="threads";
  function showSec(name){
    sec=name;
    document.querySelectorAll("#secs [data-sec]").forEach(function(b){
      b.className="item mini"+(b.getAttribute("data-sec")===name?" active":"");
    });
    var heads={threads:"对话",packs:"场景",knowledge:"知识",skills:"技能",mcp:"MCP"};
    $("secHead").textContent=heads[name]||name;
    $("newThread").style.display=name==="threads"?"":"none";
    $("threads").style.display=name==="threads"?"":"none";
    $("composeList").style.display=name==="threads"?"none":"";
    if(name==="threads") return refresh();
    loadCompose(name);
  }
  function loadCompose(name){
    var box=$("composeList");
    box.innerHTML="";
    if(name==="packs"){
      return api("/api/packs").then(function(d){
        (d.packs||[]).forEach(function(p){
          var b=document.createElement("button");
          b.className="item"+(p.overlay_eligible?"":" muted");
          b.textContent=p.name||p.id;
          b.onclick=function(){
            if(!threadId){setStatus("没有当前对话");return}
            if(!p.overlay_eligible){setStatus("这个场景不能在召唤器套用");return}
            api("/api/packs/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pack_id:p.id,thread_id:threadId})}).then(function(r){
              setStatus((r&&r.error)||"已套到当前对话");
            });
          };
          box.appendChild(b);
        });
      });
    }
    if(name==="mcp"){
      return api("/api/mcp").then(function(d){
        (d.servers||[]).forEach(function(s){
          var b=document.createElement("button");
          var on=s.enabled!==false;
          b.className="item";
          b.textContent=(on?"● ":"○ ")+(s.name||"");
          b.onclick=function(){
            api("/api/mcp/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:s.name,enabled:!on})}).then(function(){loadCompose("mcp")});
          };
          box.appendChild(b);
        });
      });
    }
    if(name==="skills"){
      return Promise.all([api("/api/skills"), threadId?api("/api/thread?id="+encodeURIComponent(threadId)):Promise.resolve({})]).then(function(pair){
        var ids=pair[1].active_skill_ids||[];
        (pair[0].skills||[]).forEach(function(s){
          var on=ids.indexOf(s.name)>=0;
          var b=document.createElement("button");
          b.className="item";
          b.textContent=(on?"● ":"○ ")+(s.title||s.name);
          b.onclick=function(){
            if(!threadId){setStatus("没有当前对话");return}
            api("/api/skills/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId,skill_name:s.name,on:!on})}).then(function(){loadCompose("skills")});
          };
          box.appendChild(b);
        });
      });
    }
    if(name==="knowledge"){
      return Promise.all([api("/api/knowledge"), threadId?api("/api/thread?id="+encodeURIComponent(threadId)):Promise.resolve({})]).then(function(pair){
        var cur=pair[1].active_knowledge_ids||[];
        (pair[0].docs||[]).forEach(function(k){
          var id=k.name||k.id;
          var on=cur.indexOf(id)>=0;
          var b=document.createElement("button");
          b.className="item";
          b.textContent=(on?"● ":"○ ")+(k.title||id);
          b.onclick=function(){
            if(!threadId){setStatus("没有当前对话");return}
            var next=on?cur.filter(function(x){return x!==id}):cur.concat([id]);
            api("/api/knowledge/active",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId,ids:next})}).then(function(){loadCompose("knowledge")});
          };
          box.appendChild(b);
        });
      });
    }
  }
  document.querySelectorAll("#secs [data-sec]").forEach(function(b){
    b.onclick=function(){showSec(b.getAttribute("data-sec"))};
  });
  $("composeList").style.display="none";
  function releaseLease(){
    if(!threadId) return;
    try{
      var body=new Blob([JSON.stringify({thread_id:threadId})],{type:"application/json"});
      navigator.sendBeacon(url("/api/lease/release"), body);
    }catch(e){}
  }
  window.addEventListener("pagehide", releaseLease);
  function statusFromEvent(d){
    if(!d||typeof d!=="object") return "出错了";
    var data=d.data&&typeof d.data==="object"?d.data:{};
    var raw=String(d.error_code||data.error_code||d.error||"");
    var code=raw.indexOf("OVERLAY_STANDBY")>=0?"OVERLAY_STANDBY": raw.indexOf("LEASE_REV_MISMATCH")>=0?"LEASE_REV_MISMATCH": raw;
    var labels={
      run_active:"本轮还在跑 · 回车纠偏或排队",
      queue_full:"排队已满（最多 8 条）",
      steer_queue_full:"纠偏队列已满",
      idle_enqueue:"空闲时直接发送，不必排队",
      OVERLAY_STANDBY:"侧栏占用了输入",
      LEASE_REV_MISMATCH:"侧栏占用了输入",
      LEASE_HOLDER_SURFACE_MISMATCH:"侧栏占用了输入"
    };
    return labels[code]||d.error||d.message||"出错了";
  }
  try{
    var es=new EventSource(url("/api/events"));
    es.onmessage=function(ev){
      var d; try{d=JSON.parse(ev.data)}catch(e){return}
      var t=d&&d.type;
      if(t==="error"||t==="chat.error"){
        setStatus(statusFromEvent(d));
        return;
      }
      if(t==="chat.user"||t==="chat.steered"||t==="chat.enqueued"){
        $("text").value="";
        $("files").value="";
        setStatus(t==="chat.enqueued"?"已排队": t==="chat.steered"?"已纠偏":"已发送");
        busy=t!=="chat.enqueued"?true:busy;
        syncBusyUi();
        startPoll();
        return;
      }
      if(t==="mcp.confirm.pending"){
        setStatus(d.message||"MCP 工具需在 Chrome 侧栏批准");
        return;
      }
      if(t==="run_status"){
        busy=d.status==="llm";
        syncBusyUi();
        if(!busy) stopPoll(); else startPoll();
      }
      if(t==="chat.done"||t==="chat.aborted"){
        busy=false;
        syncBusyUi();
        stopPoll();
      }
      if(threadId && (t==="chat.token"||t==="chat.done"||t==="chat.user"||t==="file.uploaded")){
        api("/api/thread?id="+encodeURIComponent(threadId)).then(function(x){renderMsgs(x.messages||[])});
      }
    };
  }catch(e){}
  refresh().then(function(){
    if(threads[0]) return selectThread(threads[0].id);
  }).catch(function(e){setStatus(String(e&&e.message||e))});
})();
</script>
</body>
</html>`
