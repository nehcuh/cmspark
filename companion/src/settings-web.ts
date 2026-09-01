// Local Web settings server for CMspark Companion
// Spawns a temporary HTTP server on 127.0.0.1, opens browser to settings page.
//
// Security model:
// - Loopback-only bind (127.0.0.1)
// - Per-session random token in query string. Printed to the terminal once and
//   embedded in the URL the browser opens. Every request MUST include the
//   correct `?token=<hex>` — otherwise 403. Because the token is unguessable
//   and not exposed anywhere except the local terminal, this doubles as CSRF
//   defense (a malicious page cannot know the token).
// - Host header must equal `127.0.0.1:<port>` or `localhost:<port>`.
// - Origin header (on POSTs) must equal one of those loopback origins.
// - `/api/test` and `/api/testVision` enforce an SSRF guard: RFC1918 /
//   loopback intranet LLM hosts are allowed; cloud-metadata and link-local
//   addresses (incl. AWS metadata 169.254.169.254) stay blocked. DNS
//   resolution failure is fail-closed (treated as blocked).

import * as http from "http"
import * as crypto from "crypto"
import * as net from "net"
import { getConfig, saveConfig, isMaskedApiKey } from "./config"
import { probeLlmConnection } from "./llm/connection-test"
import {
  LLM_ENDPOINT_DNS_ERROR,
  LLM_ENDPOINT_IMDS_ERROR,
  assertLlmEndpointAllowedAsync,
  canonicalizeLlmHostname,
  classifyLlmHostnameDns,
  normalizeIpLiteral,
} from "./security"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return key ? "***" : ""
  return key.slice(0, 4) + "****" + key.slice(-4)
}

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
  throw new Error("No available port for settings server")
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

function jsonResponse(res: http.ServerResponse, data: any, status = 200) {
  if (!res.headersSent) {
    res.writeHead(status, { "Content-Type": "application/json" })
  }
  res.end(JSON.stringify(data))
}

function forbidden(res: http.ServerResponse, reason: string) {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" })
  res.end(`Forbidden: ${reason}`)
}

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

// Known LLM / vision provider hostnames. Skip DNS for these names.
// RFC1918 / loopback literals are allowed for LAN OpenAI-compatible servers;
// only cloud-metadata / link-local stay blocked.
const LLM_HOST_ALLOWLIST = new Set<string>([
  "api.openai.com",
  "api.anthropic.com",
  "api.deepseek.com",
  "api.moonshot.cn",
  "api.siliconflow.cn",
  "dashscope.aliyuncs.com",
  "api.languagemodel.googleapis.com",
  "generativelanguage.googleapis.com",
  "api.together.xyz",
  "api.groq.com",
  "open.bigmodel.cn",
  "api.mistral.ai",
  "api.x.ai",
  "api.cohere.ai",
  "api.endpoints.anyscale.com",
  "api.fireworks.ai",
  "api.novita.ai",
  "api.perplexity.ai",
  // local model servers — loopback, but allowlisted for the vision test
  "localhost",
  "127.0.0.1",
])

/** Cloud metadata + 169.254/16 + IPv6 link-local — RFC1918/loopback are valid LAN LLM hosts. */
function isMetadataOrLinkLocalIp(ip: string): boolean {
  // Brackets, `::` compression and v4-mapped forms (dotted + hex) are all
  // canonicalized by normalizeIpLiteral before range matching.
  const n = normalizeIpLiteral(ip)
  if (!n) return true // unreachable for net.isIP / DNS results — fail closed
  if (net.isIPv4(n)) {
    const [a, b] = n.split(".").map((p) => parseInt(p, 10))
    return a === 169 && b === 254
  }
  if (n === "fd00:0ec2:0000:0000:0000:0000:0000:0254") return true // AWS IMDS v6
  const first = parseInt(n.split(":")[0], 16)
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  return false
}

/**
 * LLM / vision test proxy: allow intranet + loopback, block IMDS / link-local.
 * DNS names that resolve onto 169.254/16 are still blocked (rebinding).
 * Returns a distinct IMDS vs DNS-failure string (N1); null if allowed.
 */
async function llmHostBlockReason(hostname: string): Promise<string | null> {
  const lowerHost = canonicalizeLlmHostname(hostname)
  if (lowerHost === "metadata.google.internal") return LLM_ENDPOINT_IMDS_ERROR
  if (LLM_HOST_ALLOWLIST.has(lowerHost)) return null
  if (net.isIP(lowerHost)) {
    return isMetadataOrLinkLocalIp(lowerHost) ? LLM_ENDPOINT_IMDS_ERROR : null
  }
  const kind = await classifyLlmHostnameDns(lowerHost)
  if (kind === "imds") return LLM_ENDPOINT_IMDS_ERROR
  if (kind === "unresolved") return LLM_ENDPOINT_DNS_ERROR
  return null
}

// Validate and normalize a base_url for the /api/test* SSRF proxy.
// Throws on violation. Returns the validated URL string.
async function validateTestBaseUrl(rawBaseUrl: string): Promise<string> {
  if (!rawBaseUrl || typeof rawBaseUrl !== "string") {
    throw new Error("base_url is required")
  }
  let parsed: URL
  try {
    parsed = new URL(rawBaseUrl)
  } catch {
    throw new Error("base_url is not a valid URL")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`base_url protocol must be http or https (got ${parsed.protocol})`)
  }
  const blocked = await llmHostBlockReason(parsed.hostname)
  if (blocked) {
    throw new Error(`base_url host "${parsed.hostname}": ${blocked}`)
  }
  return parsed.toString()
}

// ---------------------------------------------------------------------------
// Singleton server
// ---------------------------------------------------------------------------

let activeServer: http.Server | null = null
let activePort: number | null = null
let sessionToken: string | null = null
let lastAccessTime = Date.now()
let autoCloseTimer: ReturnType<typeof setInterval> | null = null

export async function startSettingsServer(preferredPort = 23402): Promise<{ port: number; token: string }> {
  if (activeServer && activePort && sessionToken) {
    lastAccessTime = Date.now()
    return { port: activePort, token: sessionToken }
  }

  const port = await findAvailablePort(preferredPort)
  lastAccessTime = Date.now()
  const token = crypto.randomBytes(32).toString("hex")

  const server = http.createServer((req, res) => {
    lastAccessTime = Date.now()
    handleRequest(req, res, port, token)
  })

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject)
    server.listen(port, "127.0.0.1", resolve)
  })

  activeServer = server
  activePort = port
  sessionToken = token

  autoCloseTimer = setInterval(() => {
    if (Date.now() - lastAccessTime > 5 * 60 * 1000) {
      stopSettingsServer()
    }
  }, 60 * 1000)

  return { port, token }
}

export function stopSettingsServer(): void {
  if (autoCloseTimer) {
    clearInterval(autoCloseTimer)
    autoCloseTimer = null
  }
  if (activeServer) {
    activeServer.close()
    activeServer = null
    activePort = null
    sessionToken = null
  }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

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
  // constant-time compare
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

function hostOk(req: http.IncomingMessage, port: number): boolean {
  const host = (req.headers.host || "").toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

function originOk(req: http.IncomingMessage, port: number): boolean {
  const origin = (req.headers.origin || "").toLowerCase()
  if (!origin) return true // same-origin request — browsers omit Origin
  return (
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}` ||
    origin === `http://[::1]:${port}`
  )
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, port: number, token: string) {
  const raw = req.url || "/"
  const pathOnly = raw.split("?")[0]

  // Token gate — every request, including GET /, must carry the right token.
  // The terminal-printed URL contains the token; a malicious page cannot guess it.
  if (!tokenOk(req, token)) {
    forbidden(res, "missing or invalid session token (open the settings URL printed by the CLI)")
    return
  }

  // Host header check — defends against DNS-rebinding.
  if (!hostOk(req, port)) {
    forbidden(res, `unexpected Host header "${req.headers.host || ""}"`)
    return
  }

  // CORS preflight (after token + host checks; only same-origin is allowed)
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": `http://127.0.0.1:${port}`,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    })
    res.end()
    return
  }

  try {
    if (pathOnly === "/" || pathOnly === "/settings") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(SETTINGS_HTML)
      return
    }

    if (pathOnly === "/api/health") {
      jsonResponse(res, { status: "ok", uptime: process.uptime() })
      return
    }

    if (pathOnly === "/api/config" && req.method === "GET") {
      const config = getConfig()
      const vision = config.vision
      const llmPublic: Record<string, unknown> = {
        ...config.llm,
        api_key: maskApiKey(config.llm.api_key),
      }
      if (config.llm.extra_headers && typeof config.llm.extra_headers === "object") {
        llmPublic.extra_headers = Object.fromEntries(
          Object.keys(config.llm.extra_headers).map((k) => [k, "***"]),
        )
      }
      jsonResponse(res, {
        llm: llmPublic,
        vision: vision
          ? { ...vision, api_key: maskApiKey(vision.api_key) }
          : { enabled: false, base_url: "http://localhost:11434/v1", api_key: "", model_name: "llava:7b", timeout_ms: 30000, max_tokens: 1024, fallback: "metadata", cache_ttl_seconds: 300 },
      })
      return
    }

    if (pathOnly === "/api/config" && req.method === "POST") {
      // CSRF: token-in-URL + Host check + Origin check
      if (!originOk(req, port)) {
        forbidden(res, `unexpected Origin header "${req.headers.origin || ""}"`)
        return
      }
      readBody(req, 10 * 1024)
        .then((body) => {
          if (res.writableEnded) return
          const data = JSON.parse(body)
          const update: any = {}
          const current = getConfig()

          // LLM config
          if (data.llm) {
            const llm = { ...data.llm }
            // Skip masked/empty API keys to keep the existing value
            if (isMaskedApiKey(llm.api_key) || llm.api_key === "") {
              delete llm.api_key
            }
            update.llm = { ...current.llm, ...llm }
          }
          // Vision config
          if (data.vision) {
            const vision = { ...data.vision }
            // Skip masked/empty API keys to keep the existing value
            if (isMaskedApiKey(vision.api_key) || vision.api_key === "") {
              delete vision.api_key
            }
            update.vision = { ...(current.vision || {}), ...vision }
          }
          const updated = saveConfig(update)
          jsonResponse(res, {
            ok: true,
            llm: { ...updated.llm, api_key: maskApiKey(updated.llm.api_key) },
            vision: updated.vision
              ? { ...updated.vision, api_key: maskApiKey(updated.vision.api_key) }
              : undefined,
          })
        })
        .catch((e: any) => {
          if (!res.writableEnded) jsonResponse(res, { error: e.message }, 400)
        })
      return
    }

    if (pathOnly === "/api/test" && req.method === "POST") {
      if (!originOk(req, port)) {
        forbidden(res, `unexpected Origin header "${req.headers.origin || ""}"`)
        return
      }
      handleTestProxy(req, res, "llm")
      return
    }

    if (pathOnly === "/api/testVision" && req.method === "POST") {
      if (!originOk(req, port)) {
        forbidden(res, `unexpected Origin header "${req.headers.origin || ""}"`)
        return
      }
      handleTestProxy(req, res, "vision")
      return
    }

    res.writeHead(404)
    res.end("Not found")
  } catch (e: any) {
    jsonResponse(res, { error: e.message }, 500)
  }
}

// Unified handler for /api/test and /api/testVision — enforces SSRF guard
// and avoids reflecting the upstream response body (only status + short msg).
async function handleTestProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  kind: "llm" | "vision",
): Promise<void> {
  let parsed: any
  try {
    const body = await readBody(req, 10 * 1024)
    parsed = JSON.parse(body)
  } catch (e: any) {
    jsonResponse(res, { ok: false, error: `Bad request: ${e.message}` })
    return
  }
  if (res.writableEnded) return

  const { base_url, api_key, model_name } = parsed
  const config = getConfig()

  let validatedBaseUrl: string
  try {
    validatedBaseUrl = await validateTestBaseUrl(base_url)
  } catch (e: any) {
    jsonResponse(res, { ok: false, error: e.message })
    return
  }
  if (res.writableEnded) return

  // Resolve the key against saved config if the user-submitted value is masked/empty.
  const savedKey = kind === "vision" ? config.vision?.api_key || "" : config.llm.api_key
  const key = (!api_key || (typeof api_key === "string" && api_key.includes("*"))) ? savedKey : api_key

  try {
    if (kind === "llm") {
      if (!key) throw new Error("API Key is empty")
      // P1: same protocol + profile as chat (probeLlmConnection)
      const protocol =
        (typeof parsed.protocol === "string" && parsed.protocol) ||
        config.llm.protocol ||
        "openai"
      const client_header_profile =
        (typeof parsed.client_header_profile === "string" && parsed.client_header_profile) ||
        config.llm.client_header_profile ||
        "none"
      const auth_style =
        (typeof parsed.auth_style === "string" && parsed.auth_style) ||
        config.llm.auth_style ||
        "auto"
      const probe = await probeLlmConnection({
        base_url: validatedBaseUrl,
        api_key: key,
        model_name: typeof model_name === "string" ? model_name : config.llm.model_name,
        protocol,
        client_header_profile,
        auth_style,
        claude_code_compat_version: config.llm.claude_code_compat_version,
        anthropic_version: config.llm.anthropic_version,
        extra_headers: config.llm.extra_headers,
      })
      if (probe.ok) {
        jsonResponse(res, { ok: true, message: probe.message || `success: ${probe.status ?? 200}` })
      } else {
        jsonResponse(res, { ok: false, error: probe.error || "Connection failed" })
      }
    } else {
      // vision — probe /models (always OpenAI-compatible, L10).
      // Allowlist skip in validateTestBaseUrl must not bypass DNS-to-IMDS
      // (P2-A1: /api/test re-gates via probeLlmConnection; this branch did not).
      const blocked = await assertLlmEndpointAllowedAsync(validatedBaseUrl)
      if (blocked) {
        jsonResponse(res, { ok: false, error: blocked })
        return
      }
      const url = validatedBaseUrl.endsWith("/models")
        ? validatedBaseUrl
        : validatedBaseUrl.replace(/\/+$/, "") + "/models"
      const response = await fetch(url, {
        method: "GET",
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok) {
        jsonResponse(res, { ok: true, message: `success: ${response.status} (${model_name || "default"})` })
      } else {
        jsonResponse(res, { ok: false, error: `error: upstream returned ${response.status}` })
      }
    }
  } catch (e: any) {
    jsonResponse(res, { ok: false, error: `Connection failed: ${e.message}` })
  }
}

// ---------------------------------------------------------------------------
// Inline HTML settings page
// ---------------------------------------------------------------------------

const SETTINGS_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CMspark Settings</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1a1a2e;color:#e0e0e0;min-height:100vh;display:flex;justify-content:center;padding:24px 16px}
.container{max-width:600px;width:100%}
.card{background:#16213e;border-radius:12px;padding:28px 32px;box-shadow:0 4px 24px rgba(0,0,0,0.3)}
h1{font-size:20px;font-weight:600;margin-bottom:4px;display:flex;align-items:center;gap:8px}
.status-dot{width:8px;height:8px;border-radius:50%;background:#4CAF50;margin-left:auto;flex-shrink:0}
.status-dot.offline{background:#F44336}
.subtitle{font-size:12px;color:#888;margin-bottom:24px}
.divider{height:1px;background:rgba(255,255,255,0.08);margin:20px 0}
.section-title{font-size:14px;font-weight:600;color:#ccc;margin-bottom:16px}
.field{margin-bottom:18px}
label{display:block;font-size:12px;font-weight:500;color:#aaa;margin-bottom:6px}
input[type=text],input[type=password],input[type=number]{width:100%;padding:8px 12px;background:#0f3460;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e0e0e0;font-size:14px;font-family:inherit;outline:none;transition:border-color 0.2s}
input:focus{border-color:#4A90D9}
.range-row{display:flex;align-items:center;gap:12px}
.range-row input[type=range]{flex:1;-webkit-appearance:none;height:6px;background:#0f3460;border-radius:3px;outline:none}
.range-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;background:#4A90D9;border-radius:50%;cursor:pointer}
.range-val{font-size:14px;color:#e0e0e0;min-width:32px;text-align:right}
.actions{display:flex;gap:10px;margin-top:24px;flex-wrap:wrap}
.btn{padding:8px 20px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;border:none;font-family:inherit;transition:opacity 0.2s}
.btn:hover{opacity:0.85}
.btn-primary{background:#4A90D9;color:#fff}
.btn-outline{background:transparent;border:1px solid #4A90D9;color:#4A90D9}
.btn-ghost{background:transparent;border:1px solid rgba(255,255,255,0.15);color:#888}
.result{margin-top:12px;padding:10px 14px;border-radius:8px;font-size:13px;display:none}
.result.success{display:block;background:rgba(76,175,80,0.15);color:#4CAF50;border:1px solid rgba(76,175,80,0.3)}
.result.error{display:block;background:rgba(244,67,54,0.15);color:#EF5350;border:1px solid rgba(244,67,54,0.3)}
.input-row{display:flex;gap:6px}
.input-row input{flex:1}
.btn-icon{padding:8px 10px;background:#0f3460;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#aaa;cursor:pointer;font-size:14px;line-height:1}
.btn-icon:hover{color:#e0e0e0;border-color:#4A90D9}
.hint{font-size:11px;color:#666;margin-top:4px}
.presets{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.preset{padding:3px 10px;background:#0f3460;border:1px solid rgba(255,255,255,0.08);border-radius:12px;font-size:11px;color:#888;cursor:pointer;transition:all 0.2s}
.preset:hover{color:#e0e0e0;border-color:#4A90D9}
.env-banner{display:none;margin-top:16px;padding:10px 14px;background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.2);border-radius:8px;font-size:12px;color:#FFC107;line-height:1.5}
.saved-flash{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#4CAF50;color:#fff;padding:8px 20px;border-radius:8px;font-size:13px;opacity:0;transition:opacity 0.3s;pointer-events:none}
.saved-flash.show{opacity:1}
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <h1>&#9881; CMspark Global Settings <span class="status-dot" id="statusDot"></span></h1>
    <div class="subtitle">Companion global LLM config &mdash; fallback for threads without override</div>

    <div class="divider"></div>
    <div class="section-title">LLM Config</div>

    <div class="field">
      <label>API Key</label>
      <div class="input-row">
        <input type="password" id="apiKey" placeholder="sk-...">
        <button class="btn-icon" id="toggleKey" title="Show/Hide">&#128065;</button>
        <button class="btn-icon" id="copyKey" title="Copy">&#128203;</button>
      </div>
    </div>

    <div class="field">
      <label>API 协议</label>
      <select id="protocol" style="width:100%;padding:8px 12px;background:#0f3460;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e0e0e0;font-size:14px;font-family:inherit;outline:none">
        <option value="openai">OpenAI-compatible（默认）</option>
        <option value="anthropic">Anthropic Messages</option>
      </select>
      <div class="hint" id="protocolHint">默认 OpenAI Chat Completions。Anthropic 协议走 /messages。</div>
    </div>

    <div class="field">
      <label>Base URL</label>
      <input type="text" id="baseUrl" placeholder="https://api.openai.com/v1">
      <div class="hint" id="baseUrlHint">OpenAI-compatible 端点，例如 https://api.deepseek.com/v1</div>
    </div>

    <div class="field" id="compatField" style="display:none">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="clientHeaderCompat" style="width:auto">
        Coding Plan 网关兼容头
      </label>
      <div class="hint">部分第三方「Coding Plan」中继只接受类似 Claude Code 的 User-Agent / 应用头。开启后，CMspark 会在 Anthropic 协议请求上附加这些兼容头。<strong>不会</strong>登录或盗用 Anthropic 官方订阅；请只用于你有权使用的 API / 中继。官方 Anthropic 主机请保持关闭。</div>
    </div>

    <div class="field">
      <label>快速配置</label>
      <div class="presets" id="protocolPresets">
        <span class="preset" data-proto="openai" data-profile="none" data-url="https://api.deepseek.com/v1">OpenAI 兼容</span>
        <span class="preset" data-proto="anthropic" data-profile="none" data-url="https://api.anthropic.com">Anthropic Messages</span>
        <span class="preset" data-proto="anthropic" data-profile="claude_code_compat" data-url="">Coding Plan 中继</span>
      </div>
    </div>

    <div class="field">
      <label>Model</label>
      <input type="text" id="modelName" list="modelList" placeholder="Type or select">
      <datalist id="modelList">
        <option value="deepseek-v4-flash">
        <option value="deepseek-v4-pro">
        <option value="deepseek-chat">
        <option value="deepseek-reasoner">
        <option value="gpt-4o">
        <option value="gpt-4-turbo">
        <option value="claude-sonnet-4-6">
        <option value="claude-opus-4-7">
      </datalist>
      <div class="presets">
        <span class="preset" data-model="deepseek-v4-flash">deepseek-v4-flash</span>
        <span class="preset" data-model="deepseek-chat">deepseek-chat</span>
        <span class="preset" data-model="gpt-4o">gpt-4o</span>
        <span class="preset" data-model="claude-sonnet-4-6">claude-sonnet-4-6</span>
      </div>
    </div>

    <div class="field">
      <label>Temperature</label>
      <div class="range-row">
        <input type="range" id="temperature" min="0" max="2" step="0.1" value="0.7">
        <span class="range-val" id="tempVal">0.7</span>
      </div>
    </div>

    <div class="field">
      <label>Context Window</label>
      <input type="number" id="contextWindow" min="1024" max="10000000" step="1024">
    </div>

    <div class="actions">
      <button class="btn btn-outline" id="testBtn">Test Connection</button>
      <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
      <button class="btn btn-primary" id="saveBtn">Save</button>
    </div>

    <div class="divider"></div>
    <div class="section-title">Vision Model</div>

    <div class="field">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="visionEnabled" style="width:auto">
        Enable Vision Analysis
      </label>
      <div class="hint">This section only covers tool screenshots / analyze_image: they are pre-analyzed by the vision rail into text before the main chat. Images you paste, pick, or drop in the composer are separate — if the main model can see images they go to it natively; otherwise they use this vision rail. Use a local VLM (e.g. Ollama llava) or any OpenAI-compatible cloud multimodal endpoint — may match your main LLM. Not the same as experimental Qwen3-VL locate.</div>
    </div>

    <div id="visionFields" style="opacity:0.4;pointer-events:none">
      <div class="field" id="visionReuseBar" style="display:none">
        <div class="hint" id="visionReuseHint" style="margin-bottom:8px"></div>
        <button class="btn btn-outline" type="button" id="useMainForVisionBtn">Use main LLM for vision</button>
        <div class="hint" style="margin-top:6px">Copies Base URL / Model / Key from the main LLM above. Screenshots go to that host (OpenAI-compatible only). Save inherits key when endpoints match.</div>
      </div>
      <div class="field" id="visionAnthropicWarn" style="display:none">
        <div class="hint">Main chat uses Anthropic Messages protocol. Vision rail is OpenAI-compatible only — configure a separate multimodal endpoint (or OpenAI-compat gateway). One-click reuse is disabled.</div>
      </div>
      <div class="field">
        <label>API Key</label>
        <div class="input-row">
          <input type="password" id="visionApiKey" placeholder="sk-... (loopback Ollama can leave empty)">
          <button class="btn-icon" id="toggleVisionKey" title="Show/Hide">&#128065;</button>
        </div>
        <div class="hint">Loopback Ollama can leave empty. Cloud endpoints need a real key; when URL/Model match main LLM, Save inherits the main key.</div>
      </div>

      <div class="field">
        <label>Base URL</label>
        <input type="text" id="visionBaseUrl" placeholder="http://localhost:11434/v1 or cloud OpenAI-compat">
        <div class="hint">OpenAI-compatible vision endpoint (local or cloud). Destination receives screenshot bytes.</div>
      </div>

      <div class="field">
        <label>Model</label>
        <input type="text" id="visionModel" list="visionModelList" placeholder="Type or select">
        <datalist id="visionModelList">
          <option value="llava:7b">
          <option value="llava:13b">
          <option value="minicpm-v">
          <option value="qwen2.5vl:3b">
          <option value="moondream2">
          <option value="gpt-4o">
          <option value="glm-4.6v">
        </datalist>
      </div>

      <div class="field">
        <label>Timeout</label>
        <div class="range-row">
          <input type="range" id="visionTimeout" min="10" max="60" step="5" value="30">
          <span class="range-val" id="visionTimeoutVal">30s</span>
        </div>
      </div>

      <div class="field">
        <label>Fallback Strategy</label>
        <select id="visionFallback" style="width:100%;padding:8px 12px;background:#0f3460;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e0e0e0;font-size:14px;font-family:inherit;outline:none">
          <option value="metadata">Metadata only (recommended)</option>
          <option value="passthrough">Vision-rail fallback: stuff truncated base64 into the description (pixels only if the main model uses native vision)</option>
          <option value="error">Fail with error</option>
        </select>
        <div class="hint">What to do when vision model is unavailable</div>
      </div>

      <div class="actions">
        <button class="btn btn-outline" id="testVisionBtn">Test Vision Model</button>
      </div>
    </div>

    <div class="result" id="visionResult"></div>

    <div class="result" id="result"></div>

    <div class="env-banner" id="envBanner">
      &#9888; Environment variable DEEPSEEK_API_KEY is set. Env var takes priority over file config.
    </div>
  </div>
</div>
<div class="saved-flash" id="savedFlash">Saved</div>

<script>
(function(){
  // The page was loaded with ?token=<hex> in the URL. Reuse it for every fetch.
  var token=(location.search.match(/[?&]token=([^&]+)/)||[])[1]||"";
  function url(path){return path+(path.indexOf("?")>=0?"&":"?")+"token="+encodeURIComponent(token)}

  var $=function(id){return document.getElementById(id)};
  var apiKeyEl=$("apiKey"),baseUrlEl=$("baseUrl"),modelNameEl=$("modelName"),
      tempEl=$("temperature"),tempValEl=$("tempVal"),ctxWinEl=$("contextWindow"),
      protocolEl=$("protocol"),compatEl=$("clientHeaderCompat"),compatField=$("compatField"),
      baseUrlHint=$("baseUrlHint"),
      resultEl=$("result"),savedFlash=$("savedFlash"),statusDot=$("statusDot"),
      visionEnabledEl=$("visionEnabled"),visionFields=$("visionFields"),
      visionApiKeyEl=$("visionApiKey"),visionBaseUrlEl=$("visionBaseUrl"),
      visionModelEl=$("visionModel"),visionTimeoutEl=$("visionTimeout"),
      visionTimeoutValEl=$("visionTimeoutVal"),visionFallbackEl=$("visionFallback"),
      visionResultEl=$("visionResult");

  function hostnameFromUrl(u){
    try{
      var s=(u||"").trim();
      if(!s)return"(unset)";
      var x=new URL(s.indexOf("://")>=0?s:"https://"+s);
      return x.hostname||s
    }catch(e){return (u||"").trim()||"(unset)"}
  }
  function isMaskedKey(k){
    k=(k||"").trim();
    return !k||k==="***"||/^\*+$/.test(k)||k.indexOf("****")>=0
  }
  function syncVisionReuseUi(){
    var on=visionEnabledEl.checked;
    var anth=protocolEl.value==="anthropic";
    var bar=$("visionReuseBar"),warn=$("visionAnthropicWarn"),hint=$("visionReuseHint");
    if(!on){
      if(bar)bar.style.display="none";
      if(warn)warn.style.display="none";
      return
    }
    if(anth){
      if(bar)bar.style.display="none";
      if(warn)warn.style.display="block"
    }else{
      if(warn)warn.style.display="none";
      if(bar){
        bar.style.display="block";
        if(hint)hint.textContent="Screenshots will be sent to "+hostnameFromUrl(baseUrlEl.value)+" when you reuse main LLM (pre-analyze → text for main chat)."
      }
    }
  }
  function toggleVisionFields(){
    var on=visionEnabledEl.checked;
    visionFields.style.opacity=on?"1":"0.4";
    visionFields.style.pointerEvents=on?"auto":"none";
    syncVisionReuseUi()
  }

  function syncProtocolUi(){
    var isAnth=protocolEl.value==="anthropic";
    compatField.style.display=isAnth?"block":"none";
    if(!isAnth){compatEl.checked=false}
    baseUrlHint.textContent=isAnth
      ?"Anthropic Messages 端点（拼到 /messages）。示例：https://api.anthropic.com 或中继 https://host/v1。勿混 /chat/completions"
      :"OpenAI-compatible 端点，例如 https://api.deepseek.com/v1";
    syncVisionReuseUi()
  }

  visionEnabledEl.onchange=toggleVisionFields;
  protocolEl.onchange=syncProtocolUi;
  baseUrlEl.oninput=syncVisionReuseUi;

  document.querySelectorAll("#protocolPresets .preset").forEach(function(el){
    el.onclick=function(){
      protocolEl.value=el.getAttribute("data-proto")||"openai";
      compatEl.checked=(el.getAttribute("data-profile")==="claude_code_compat");
      var u=el.getAttribute("data-url");
      if(u!==null&&u!==""){baseUrlEl.value=u}
      if(u===""){baseUrlEl.focus();baseUrlEl.placeholder="粘贴 Coding Plan 中继 Base URL"}
      syncProtocolUi();
    };
  });

  function load(){
    fetch(url("/api/config")).then(function(r){return r.json()}).then(function(d){
      var llm=d.llm||{};
      apiKeyEl.value=llm.api_key||"";
      baseUrlEl.value=llm.base_url||"";
      modelNameEl.value=llm.model_name||"";
      tempEl.value=llm.temperature!=null?llm.temperature:0.7;
      tempValEl.textContent=tempEl.value;
      ctxWinEl.value=llm.context_window||512000;
      protocolEl.value=llm.protocol==="anthropic"?"anthropic":"openai";
      compatEl.checked=llm.client_header_profile==="claude_code_compat";
      syncProtocolUi();
      // Vision fields
      var vision=d.vision||{};
      visionEnabledEl.checked=!!vision.enabled;
      visionApiKeyEl.value=vision.api_key||"";
      visionBaseUrlEl.value=vision.base_url||"http://localhost:11434/v1";
      visionModelEl.value=vision.model_name||"";
      visionTimeoutEl.value=(vision.timeout_ms||30000)/1000;
      visionTimeoutValEl.textContent=visionTimeoutEl.value+"s";
      visionFallbackEl.value=vision.fallback||"metadata";
      toggleVisionFields();
      statusDot.classList.remove("offline");
    }).catch(function(){
      statusDot.classList.add("offline");
    });
    if(process&&process.env&&process.env.DEEPSEEK_API_KEY){$("envBanner").style.display="block"}
  }

  function collect(){
    var data={llm:{
      api_key:apiKeyEl.value,
      base_url:baseUrlEl.value,
      model_name:modelNameEl.value,
      temperature:parseFloat(tempEl.value),
      context_window:parseInt(ctxWinEl.value,10),
      protocol:protocolEl.value==="anthropic"?"anthropic":"openai",
      client_header_profile:(protocolEl.value==="anthropic"&&compatEl.checked)?"claude_code_compat":"none"
    }};
    if(visionEnabledEl.checked){
      data.vision={
        enabled:true,
        api_key:visionApiKeyEl.value,
        base_url:visionBaseUrlEl.value||"http://localhost:11434/v1",
        model_name:visionModelEl.value||"llava:7b",
        timeout_ms:parseInt(visionTimeoutEl.value,10)*1000,
        fallback:visionFallbackEl.value||"metadata",
      }
    } else {
      data.vision={enabled:false}
    }
    return data
  }

  function showResult(msg,ok){
    resultEl.textContent=msg;
    resultEl.className="result "+(ok?"success":"error");
  }

  $("saveBtn").onclick=function(){
    resultEl.className="result";
    fetch(url("/api/config"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(collect())})
    .then(function(r){return r.json()}).then(function(d){
      if(d.ok){
        savedFlash.classList.add("show");
        setTimeout(function(){savedFlash.classList.remove("show")},1500);
        // Do NOT replace the api_key input with the masked value — that would
        // overwrite the user's plaintext key with '****', making it look lost.
        // The key is safely stored; the field retains what the user typed.
      }else{showResult(d.error||"Save failed",false)}
    }).catch(function(e){showResult("Save failed: "+e.message,false)});
  };

  $("testBtn").onclick=function(){
    var data=collect();
    resultEl.className="result";
    $("testBtn").textContent="Testing...";
    $("testBtn").disabled=true;
    fetch(url("/api/test"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data.llm)})
    .then(function(r){return r.json()}).then(function(d){
      showResult(d.ok?d.message:d.error,d.ok);
      $("testBtn").textContent="Test Connection";
      $("testBtn").disabled=false;
    }).catch(function(e){
      showResult("Test failed: "+e.message,false);
      $("testBtn").textContent="Test Connection";
      $("testBtn").disabled=false;
    });
  };

  $("cancelBtn").onclick=function(){window.close();setTimeout(function(){resultEl.textContent="You can close this tab.";resultEl.className="result success"},200)};

  $("toggleKey").onclick=function(){
    apiKeyEl.type=apiKeyEl.type==="password"?"text":"password";
  };

  $("toggleVisionKey").onclick=function(){
    visionApiKeyEl.type=visionApiKeyEl.type==="password"?"text":"password";
  };

  $("copyKey").onclick=function(){
    if(apiKeyEl.value){navigator.clipboard.writeText(apiKeyEl.value).catch(function(){})}
  };

  tempEl.oninput=function(){tempValEl.textContent=tempEl.value};

  visionTimeoutEl.oninput=function(){visionTimeoutValEl.textContent=visionTimeoutEl.value+"s"};

  $("testVisionBtn").onclick=function(){
    visionResultEl.className="result";
    $("testVisionBtn").textContent="Testing...";
    $("testVisionBtn").disabled=true;
    fetch(url("/api/testVision"),{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({base_url:visionBaseUrlEl.value,api_key:visionApiKeyEl.value,model_name:visionModelEl.value})
    }).then(function(r){return r.json()}).then(function(d){
      visionResultEl.textContent=d.ok?d.message:d.error;
      visionResultEl.className="result "+(d.ok?"success":"error");
      $("testVisionBtn").textContent="Test Vision Model";
      $("testVisionBtn").disabled=false;
    }).catch(function(e){
      visionResultEl.textContent="Test failed: "+e.message;
      visionResultEl.className="result error";
      $("testVisionBtn").textContent="Test Vision Model";
      $("testVisionBtn").disabled=false;
    });
  };

  var useMainBtn=$("useMainForVisionBtn");
  if(useMainBtn){
    useMainBtn.onclick=function(){
      if(protocolEl.value==="anthropic"){
        visionResultEl.textContent="Cannot reuse: main protocol is Anthropic Messages; vision needs OpenAI-compatible endpoint.";
        visionResultEl.className="result error";
        return
      }
      visionEnabledEl.checked=true;
      toggleVisionFields();
      visionBaseUrlEl.value=baseUrlEl.value||"";
      visionModelEl.value=modelNameEl.value||"";
      if(!isMaskedKey(apiKeyEl.value)){
        visionApiKeyEl.value=apiKeyEl.value
      }
      visionResultEl.textContent="Vision filled from main LLM → "+hostnameFromUrl(baseUrlEl.value)+". Save to persist (key inherits when endpoints match). Then Test Vision.";
      visionResultEl.className="result success";
      syncVisionReuseUi()
    }
  }

  var presets=document.querySelectorAll(".preset");
  for(var i=0;i<presets.length;i++){
    presets[i].onclick=function(){modelNameEl.value=this.getAttribute("data-model")};
  }

  load();
})();
</script>
</body>
</html>`
