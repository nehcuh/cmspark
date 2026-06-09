// Quick Action result display — lightweight HTTP server for showing results in browser
// Same pattern as settings-web.ts: singleton server, inline HTML, auto-close.

import * as http from "http"
import * as fs from "fs"
import * as path from "path"
import { getConfigDir } from "./config"

// ---------------------------------------------------------------------------
// Result store
// ---------------------------------------------------------------------------

interface QuickActionResult {
  id: string
  actionId: string
  success: boolean
  message?: string
  fullText?: string
  imageData?: any
  error?: string
  timestamp: number
}

const MAX_RESULTS = 10
const results = new Map<string, QuickActionResult>()

function cleanupOldResults(): void {
  if (results.size <= MAX_RESULTS) return
  const entries = [...results.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)
  while (results.size > MAX_RESULTS && entries.length > 0) {
    const [key] = entries.shift()!
    results.delete(key)
  }
}

export function storeResult(result: QuickActionResult): string {
  results.set(result.id, result)
  cleanupOldResults()
  return `http://127.0.0.1:${activePort || 23403}/result/${result.id}`
}

// ---------------------------------------------------------------------------
// HTTP server (singleton, mirrors settings-web.ts)
// ---------------------------------------------------------------------------

let activeServer: http.Server | null = null
let activePort: number | null = null
let lastAccessTime = Date.now()
let autoCloseTimer: ReturnType<typeof setInterval> | null = null

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 10; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const probe = http.createServer()
        probe.on("error", reject)
        probe.listen(port, "127.0.0.1", () => { probe.close(() => resolve()) })
      })
      return port
    } catch { continue }
  }
  throw new Error("No available port for result server")
}

export async function startResultServer(preferredPort = 23403): Promise<number> {
  if (activeServer && activePort) {
    lastAccessTime = Date.now()
    return activePort
  }

  const port = await findAvailablePort(preferredPort)
  lastAccessTime = Date.now()

  const server = http.createServer((req, res) => {
    lastAccessTime = Date.now()
    handleRequest(req, res)
  })

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject)
    server.listen(port, "127.0.0.1", resolve)
  })

  activeServer = server
  activePort = port

  autoCloseTimer = setInterval(() => {
    if (Date.now() - lastAccessTime > 5 * 60 * 1000) stopResultServer()
  }, 60 * 1000)

  return port
}

export function stopResultServer(): void {
  if (autoCloseTimer) { clearInterval(autoCloseTimer); autoCloseTimer = null }
  if (activeServer) { activeServer.close(); activeServer = null; activePort = null }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

function jsonResponse(res: http.ServerResponse, data: any, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const rawUrl = (req.url || "/").split("?")[0]

  try {
    // /result/:id — HTML page
    const resultMatch = rawUrl.match(/^\/result\/([a-zA-Z0-9_-]+)$/)
    if (resultMatch) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(buildResultHTML(resultMatch[1]))
      return
    }

    // /api/result/:id — JSON
    const apiMatch = rawUrl.match(/^\/api\/result\/([a-zA-Z0-9_-]+)$/)
    if (apiMatch) {
      const result = results.get(apiMatch[1])
      if (!result) { jsonResponse(res, { error: "Not found" }, 404); return }
      // Strip large imageData from JSON — served via /screenshot/ route
      const { imageData, ...safe } = result
      jsonResponse(res, safe)
      return
    }

    // /screenshot/:id — raw PNG
    const ssMatch = rawUrl.match(/^\/screenshot\/([a-zA-Z0-9_-]+)$/)
    if (ssMatch) {
      const result = results.get(ssMatch[1])
      if (!result?.imageData) { res.writeHead(404); res.end(); return }
      let base64: string | null = null
      if (typeof result.imageData === "string") base64 = result.imageData
      else if (result.imageData?.base64) base64 = result.imageData.base64
      else if (result.imageData?.data) base64 = result.imageData.data
      if (!base64) { res.writeHead(404); res.end(); return }
      const raw = base64.replace(/^data:image\/\w+;base64,/, "")
      const buf = Buffer.from(raw, "base64")
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buf.length })
      res.end(buf)
      return
    }

    res.writeHead(404)
    res.end("Not found")
  } catch (e: any) {
    jsonResponse(res, { error: e.message }, 500)
  }
}

// ---------------------------------------------------------------------------
// Inline HTML
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function buildResultHTML(resultId: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CMspark Result</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1a1a2e;color:#e0e0e0;min-height:100vh;display:flex;justify-content:center;padding:24px 16px}
.container{max-width:700px;width:100%}
.card{background:#16213e;border-radius:12px;padding:28px 32px;box-shadow:0 4px 24px rgba(0,0,0,0.3)}
h1{font-size:18px;font-weight:600;margin-bottom:4px}
.subtitle{font-size:12px;color:#888;margin-bottom:20px}
.error{color:#EF5350;font-size:14px;line-height:1.6;white-space:pre-wrap}
.text-content{font-size:14px;line-height:1.7;color:#ccc;white-space:pre-wrap;word-break:break-word;max-height:70vh;overflow-y:auto}
.screenshot{max-width:100%;border-radius:8px;margin-top:12px;box-shadow:0 2px 12px rgba(0,0,0,0.4)}
.actions{margin-top:20px;display:flex;gap:10px}
.btn{padding:8px 20px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;border:none;font-family:inherit}
.btn-outline{background:transparent;border:1px solid #4A90D9;color:#4A90D9}
.btn-ghost{background:transparent;border:1px solid rgba(255,255,255,0.15);color:#888}
.summary-box{background:rgba(74,144,217,0.1);border:1px solid rgba(74,144,217,0.2);border-radius:8px;padding:14px 16px;font-size:15px;line-height:1.6;color:#e0e0e0}
.loading{color:#888;font-size:14px}
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <h1 id="title">Loading...</h1>
    <div class="subtitle" id="subtitle"></div>
    <div id="content"><div class="loading">Loading result...</div></div>
    <div class="actions" id="actions" style="display:none">
      <button class="btn btn-outline" id="copyBtn" style="display:none">Copy</button>
      <button class="btn btn-ghost" onclick="window.close();setTimeout(function(){document.body.innerHTML='<div style=text-align:center;color:#888;padding:40px>You can close this tab.</div>'},200)">Close</button>
    </div>
  </div>
</div>
<script>
(function(){
  var id=location.pathname.split("/").pop();
  var titleEl=document.getElementById("title");
  var subtitleEl=document.getElementById("subtitle");
  var contentEl=document.getElementById("content");
  var actionsEl=document.getElementById("actions");
  var copyBtn=document.getElementById("copyBtn");

  var actionTitles={"screenshot":"Screenshot","summarize":"Summary","read-page":"Page Content","extract-data":"Extracted Data","new-chat":"New Chat"};

  fetch("/api/result/"+id).then(function(r){return r.json()}).then(function(d){
    if(d.error){titleEl.textContent="Error";contentEl.innerHTML='<div class="error">'+d.error.replace(/</g,"&lt;")+'</div>';actionsEl.style.display="flex";return}
    var at=d.actionId||"";
    titleEl.textContent=actionTitles[at]||"Result";
    subtitleEl.textContent=new Date(d.timestamp).toLocaleString();

    if(at==="screenshot"&&d.success!==false){
      contentEl.innerHTML='<img class="screenshot" src="/screenshot/'+id+'" alt="Screenshot">';
    }else if(at==="summarize"&&d.message){
      contentEl.innerHTML='<div class="summary-box">'+d.message.replace(/</g,"&lt;").replace(/\\n/g,"<br>")+'</div>';
      copyBtn.style.display="inline-block";
      copyBtn.onclick=function(){navigator.clipboard.writeText(d.message).catch(function(){})};
    }else if((at==="read-page"||at==="extract-data")&&d.message){
      var full=d.fullText||d.message;
      contentEl.innerHTML='<div class="text-content">'+full.replace(/</g,"&lt;")+'</div>';
      copyBtn.style.display="inline-block";
      copyBtn.onclick=function(){navigator.clipboard.writeText(full).catch(function(){})};
    }else if(d.message){
      contentEl.innerHTML='<div class="text-content">'+d.message.replace(/</g,"&lt;")+'</div>';
      copyBtn.style.display="inline-block";
      copyBtn.onclick=function(){navigator.clipboard.writeText(d.message).catch(function(){})};
    }else{
      contentEl.textContent="No content";
    }
    actionsEl.style.display="flex";
  }).catch(function(e){
    titleEl.textContent="Error";
    contentEl.innerHTML='<div class="error">Failed to load result: '+e.message+'</div>';
    actionsEl.style.display="flex";
  });
})();
</script>
</body>
</html>`
}
