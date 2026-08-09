const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const secret = fs.readFileSync(path.join(process.env.USERPROFILE, ".cmspark-agent", "ws_secret"), "utf8").trim();
// Match sidepanel origin filter (isAllowedWsOrigin)
const ORIGIN = "chrome-extension://ddmijppddlpidmimkhhgplcajhifbmik";

function wait(ws, pred, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    const onMsg = (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (pred(msg)) {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
  });
}

async function main() {
  const ws = new WebSocket("ws://127.0.0.1:23401", {
    headers: { Origin: ORIGIN },
  });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });

  const challenge = await wait(ws, (m) => m.type === "auth.challenge" && m.nonce);
  const proof = crypto.createHmac("sha256", secret).update(String(challenge.nonce)).digest("hex");
  ws.send(JSON.stringify({ type: "auth.handshake", proof }));
  const auth = await wait(ws, (m) => m.type === "auth.ok" || m.type === "auth.error" || m.type === "error");
  if (auth.type !== "auth.ok") {
    console.log(JSON.stringify({ phase: "auth", auth }, null, 2));
    process.exit(2);
  }

  ws.send(JSON.stringify({ type: "computer.model.get_state", source: "settings" }));
  const state = await wait(ws, (m) => m.type === "computer.model.state", 60000);

  const p = path;
  const visible = {
    pythonMode: state.pythonMode,
    pythonPath: state.pythonPath,
    uvAvailable: state.uvAvailable,
    uvPath: state.uvPath,
    uvInstallHint: state.uvInstallHint,
    pythonInstallHint: state.pythonInstallHint,
    basePythonAvailable: state.basePythonAvailable,
    pythonResolution: state.pythonResolution,
    isolatedEnvExists: state.isolatedEnvExists,
    readinessSummary: state.readinessSummary,
    nextSteps: state.nextSteps,
    canDownload: state.canDownload,
    canEnable: state.canEnable,
  };

  const checks = {
    auth_ok: true,
    got_computer_model_state: state.type === "computer.model.state",
    uv_available: state.uvAvailable === true,
    uv_path_absolute: typeof state.uvPath === "string" && p.isAbsolute(state.uvPath) && /uv\.exe$/i.test(state.uvPath),
    isolated_exists: state.isolatedEnvExists === true,
    python_path_isolated:
      typeof state.pythonPath === "string" &&
      p.isAbsolute(state.pythonPath) &&
      /python-env/i.test(state.pythonPath) &&
      !/windowsapps/i.test(state.pythonPath),
    base_python_available: state.basePythonAvailable === true,
    resolution_mentions_isolated:
      typeof state.pythonResolution === "string" && /独立环境/.test(state.pythonResolution),
    python_install_hint_winget:
      typeof state.pythonInstallHint === "string" &&
      /winget/i.test(state.pythonInstallHint) &&
      !/brew install python/i.test(state.pythonInstallHint),
    not_python_missing_primary:
      typeof state.readinessSummary === "string" && !/请先安装 Python/.test(state.readinessSummary),
    next_steps_use_absolute_uv:
      Array.isArray(state.nextSteps) &&
      state.nextSteps.some((s) => /uv\.exe/i.test(String(s)) || /astral-sh\.uv/i.test(String(s))),
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  console.log(JSON.stringify({ overall: failed.length ? "FAIL" : "PASS", failed, checks, visible }, null, 2));
  ws.close();
  process.exit(failed.length ? 3 : 0);
}
main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
