// Local Web settings server for CMspark Companion
// Spawns a temporary HTTP server on 127.0.0.1, opens browser to settings page.

import * as http from "http"
import { getConfig, saveConfig } from "./config"

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
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://127.0.0.1",
  })
  res.end(JSON.stringify(data))
}

// ---------------------------------------------------------------------------
// Singleton server
// ---------------------------------------------------------------------------

let activeServer: http.Server | null = null
let activePort: number | null = null
let lastAccessTime = Date.now()
let autoCloseTimer: ReturnType<typeof setInterval> | null = null

export async function startSettingsServer(preferredPort = 23402): Promise<number> {
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
    if (Date.now() - lastAccessTime > 5 * 60 * 1000) {
      stopSettingsServer()
    }
  }, 60 * 1000)

  return port
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
  }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = (req.url || "/").split("?")[0]

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "http://127.0.0.1",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    })
    res.end()
    return
  }

  try {
    if (url === "/" || url === "/settings") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(SETTINGS_HTML)
      return
    }

    if (url === "/api/health") {
      jsonResponse(res, { status: "ok", uptime: process.uptime() })
      return
    }

    if (url === "/api/config" && req.method === "GET") {
      const config = getConfig()
      const vision = config.vision
      jsonResponse(res, {
        llm: { ...config.llm, api_key: maskApiKey(config.llm.api_key) },
        vision: vision
          ? { ...vision, api_key: maskApiKey(vision.api_key) }
          : { enabled: false, base_url: "http://localhost:11434/v1", api_key: "", model_name: "llava:7b", timeout_ms: 30000, max_tokens: 1024, fallback: "metadata", cache_ttl_seconds: 300 },
      })
      return
    }

    if (url === "/api/config" && req.method === "POST") {
      readBody(req, 10 * 1024)
        .then((body) => {
          if (res.writableEnded) return
          const data = JSON.parse(body)
          const update: any = {}
          // LLM config
          if (data.llm) {
            const llm = { ...data.llm }
            if (llm.api_key === "***" || llm.api_key === "") {
              delete llm.api_key
            }
            const current = getConfig()
            update.llm = { ...current.llm, ...llm }
          }
          // Vision config
          if (data.vision) {
            const vision = { ...data.vision }
            if (vision.api_key === "***" || vision.api_key === "") {
              delete vision.api_key
            }
            const current = getConfig()
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

    if (url === "/api/test" && req.method === "POST") {
      readBody(req, 10 * 1024)
        .then(async (body) => {
          if (res.writableEnded) return
          const { base_url, api_key, model_name } = JSON.parse(body)
          const config = getConfig()
          // Use saved key if the provided one is masked or empty
          const key = (!api_key || api_key.includes("*")) ? config.llm.api_key : api_key
          if (!key) throw new Error("API Key is empty")

          const response = await fetch(`${base_url}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: model_name || "deepseek-chat",
              messages: [{ role: "user", content: "Reply OK" }],
              max_tokens: 5,
            }),
            signal: AbortSignal.timeout(10000),
          })

          if (response.ok) {
            if (!res.writableEnded) jsonResponse(res, { ok: true, message: "Connection successful" })
          } else {
            const err = await response.text()
            if (!res.writableEnded) {
              jsonResponse(res, {
                ok: false,
                error: `API error (${response.status}): ${err.slice(0, 200)}`,
              })
            }
          }
        })
        .catch((e: any) => {
          if (!res.writableEnded) jsonResponse(res, { ok: false, error: `Connection failed: ${e.message}` })
        })
      return
    }

    if (url === "/api/testVision" && req.method === "POST") {
      readBody(req, 10 * 1024)
        .then(async (body) => {
          if (res.writableEnded) return
          const { base_url, api_key, model_name } = JSON.parse(body)
          const config = getConfig()
          // Use saved key if the provided one is masked or empty
          const key = (!api_key || api_key.includes("*")) ? (config.vision?.api_key || "") : api_key

          // Test via OpenAI-compatible /models endpoint (works for Ollama, LM Studio, cloud APIs)
          const modelsUrl = base_url.endsWith("/models")
            ? base_url
            : base_url.replace(/\/+$/, "") + "/models"

          const response = await fetch(modelsUrl, {
            method: "GET",
            headers: key ? { Authorization: `Bearer ${key}` } : {},
            signal: AbortSignal.timeout(10000),
          })

          if (response.ok) {
            if (!res.writableEnded) jsonResponse(res, { ok: true, message: `Vision model connected (${model_name || "default"})` })
          } else {
            const err = await response.text()
            if (!res.writableEnded) {
              jsonResponse(res, { ok: false, error: `Vision server error (${response.status}): ${err.slice(0, 200)}` })
            }
          }
        })
        .catch((e: any) => {
          if (!res.writableEnded) jsonResponse(res, { ok: false, error: `Vision server connection failed: ${e.message}` })
        })
      return
    }

    res.writeHead(404)
    res.end("Not found")
  } catch (e: any) {
    jsonResponse(res, { error: e.message }, 500)
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
      <label>Base URL</label>
      <input type="text" id="baseUrl" placeholder="https://api.openai.com/v1">
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
      <div class="hint">Analyze screenshots and images via a local or remote vision model</div>
    </div>

    <div id="visionFields" style="opacity:0.4;pointer-events:none">
      <div class="field">
        <label>API Key</label>
        <div class="input-row">
          <input type="password" id="visionApiKey" placeholder="sk-... (leave empty for Ollama)">
          <button class="btn-icon" id="toggleVisionKey" title="Show/Hide">&#128065;</button>
        </div>
        <div class="hint">Optional for local models (Ollama). Required for cloud vision APIs.</div>
      </div>

      <div class="field">
        <label>Base URL</label>
        <input type="text" id="visionBaseUrl" placeholder="http://localhost:11434/v1">
        <div class="hint">OpenAI-compatible endpoint. Ollama default: http://localhost:11434/v1</div>
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
          <option value="claude-sonnet-4-6">
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
          <option value="passthrough">Pass image to main LLM</option>
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
  var $=function(id){return document.getElementById(id)};
  var apiKeyEl=$("apiKey"),baseUrlEl=$("baseUrl"),modelNameEl=$("modelName"),
      tempEl=$("temperature"),tempValEl=$("tempVal"),ctxWinEl=$("contextWindow"),
      resultEl=$("result"),savedFlash=$("savedFlash"),statusDot=$("statusDot"),
      visionEnabledEl=$("visionEnabled"),visionFields=$("visionFields"),
      visionApiKeyEl=$("visionApiKey"),visionBaseUrlEl=$("visionBaseUrl"),
      visionModelEl=$("visionModel"),visionTimeoutEl=$("visionTimeout"),
      visionTimeoutValEl=$("visionTimeoutVal"),visionFallbackEl=$("visionFallback"),
      visionResultEl=$("visionResult");

  function toggleVisionFields(){
    var on=visionEnabledEl.checked;
    visionFields.style.opacity=on?"1":"0.4";
    visionFields.style.pointerEvents=on?"auto":"none";
  }

  visionEnabledEl.onchange=toggleVisionFields;

  function load(){
    fetch("/api/config").then(function(r){return r.json()}).then(function(d){
      var llm=d.llm||{};
      apiKeyEl.value=llm.api_key||"";
      baseUrlEl.value=llm.base_url||"";
      modelNameEl.value=llm.model_name||"";
      tempEl.value=llm.temperature!=null?llm.temperature:0.7;
      tempValEl.textContent=tempEl.value;
      ctxWinEl.value=llm.context_window||1000000;
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
      context_window:parseInt(ctxWinEl.value,10)
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
    fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(collect())})
    .then(function(r){return r.json()}).then(function(d){
      if(d.ok){
        savedFlash.classList.add("show");
        setTimeout(function(){savedFlash.classList.remove("show")},1500);
        if(d.llm&&d.llm.api_key)apiKeyEl.value=d.llm.api_key;
      }else{showResult(d.error||"Save failed",false)}
    }).catch(function(e){showResult("Save failed: "+e.message,false)});
  };

  $("testBtn").onclick=function(){
    var data=collect();
    resultEl.className="result";
    $("testBtn").textContent="Testing...";
    $("testBtn").disabled=true;
    fetch("/api/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data.llm)})
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
    fetch("/api/testVision",{
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

  var presets=document.querySelectorAll(".preset");
  for(var i=0;i<presets.length;i++){
    presets[i].onclick=function(){modelNameEl.value=this.getAttribute("data-model")};
  }

  load();
})();
</script>
</body>
</html>`
