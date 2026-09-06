// #432 Slice 0: verify @lydell/node-pty can spawn a real PTY under
// "SEA binary + esbuild external + side-by-side node_modules" (S-2 layout).
//
// Run:
//   node index.js                     (dev)
//   ./dist-app/s-pty-sea              (SEA)
//
// Exit: 0 PASS, 1 wrong output, 2 load/run error.

const path = require("path")
const fs = require("fs")
const Module = require("module")

function isSea() {
  try {
    return require("node:sea").isSea()
  } catch {
    return false
  }
}

function loadPty() {
  const sea = isSea()
  let pty
  let how
  try {
    pty = require("@lydell/node-pty")
    how = "bare"
    console.log("[s-pty] bare require('@lydell/node-pty'): OK")
  } catch (err) {
    console.log("[s-pty] bare require('@lydell/node-pty'): FAIL ->", err.code || err.message)
    const seaRequire = Module.createRequire(process.execPath)
    pty = seaRequire("@lydell/node-pty")
    how = "createRequire(execPath)"
    console.log("[s-pty] Module.createRequire(process.execPath)('@lydell/node-pty'): OK")
  }
  return { pty, how, sea }
}

function spawnProbe(pty) {
  return new Promise((resolve, reject) => {
    const shell = process.env.SHELL || "/bin/zsh"
    // -lc so login-ish PATH; isatty on stdout must be true inside a real PTY.
    const proc = pty.spawn(shell, ["-lc", 'if [ -t 0 ] && [ -t 1 ]; then printf "PTY_OK\\n"; else printf "NOT_TTY fd0=%s fd1=%s\\n" "$( [ -t 0 ] && echo y || echo n)" "$( [ -t 1 ] && echo y || echo n)"; fi'], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || "/tmp",
      env: { ...process.env, TERM: "xterm-256color" },
    })
    let buf = ""
    const t = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
      reject(new Error(`timeout after 8s; got: ${JSON.stringify(buf)}`))
    }, 8000)
    proc.onData((d) => {
      buf += d
    })
    proc.onExit(({ exitCode, signal }) => {
      clearTimeout(t)
      resolve({ buf, exitCode, signal, pid: proc.pid })
    })
  })
}

;(async () => {
  const sea = isSea()
  const baseDir = sea ? path.dirname(process.execPath) : __dirname
  console.log("[s-pty] node:", process.version, "platform:", process.platform, "arch:", process.arch)
  console.log("[s-pty] isSea:", sea)
  console.log("[s-pty] execPath:", process.execPath)
  console.log("[s-pty] baseDir:", baseDir)

  const { pty, how } = loadPty()
  const nm = path.join(baseDir, "node_modules", "@lydell", "node-pty", "package.json")
  if (fs.existsSync(nm)) {
    const pkg = JSON.parse(fs.readFileSync(nm, "utf8"))
    console.log("[s-pty] package:", pkg.name, pkg.version, "at", path.dirname(nm), "via", how)
  } else {
    console.log("[s-pty] package.json not next to baseDir; load via", how)
  }

  const { buf, exitCode, signal, pid } = await spawnProbe(pty)
  const text = buf.replace(/\r/g, "")
  const pass = /\bPTY_OK\b/.test(text)
  console.log("[s-pty] pid:", pid, "exitCode:", exitCode, "signal:", signal)
  console.log("[s-pty] output:", JSON.stringify(text.slice(0, 400)))
  console.log("[s-pty] RESULT:", pass ? "PASS" : "FAIL")
  process.exitCode = pass ? 0 : 1
})().catch((err) => {
  console.error("[s-pty] FATAL:", err && err.stack ? err.stack : err)
  process.exitCode = 2
})
