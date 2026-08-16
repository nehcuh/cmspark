// Windows ACP spawn: npm shims are #!/bin/sh + .cmd pairs; Node CreateProcess
// cannot run shebang scripts (ENOENT) or .cmd without a console host (EINVAL).

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { spawn } from "node:child_process"
import {
  pickWindowsWhereHit,
  looksLikeWindowsShebangScript,
  findWindowsSiblingShim,
  unwrapWindowsCmdShim,
  resolveWindowsAgentCommand,
  resolveAcpSpawn,
  quoteCmdArg,
  argvForCmdWrap,
  acpSpawnUsesCmdHost,
  joinDp0Relative,
  resolveNodeForJsShim,
  writeExclusiveUtf8,
  windowsTaskkillPath,
} from "../src/acp/win-spawn"
import { discoverCodingAgents, _resetDiscoverCache } from "../src/acp/discover"

const WIN = process.platform === "win32"

describe("pickWindowsWhereHit", () => {
  it("prefers .exe over .cmd over extensionless shebang", () => {
    const picked = pickWindowsWhereHit(
      [
        "C:\\nvm4w\\nodejs\\claude",
        "C:\\nvm4w\\nodejs\\claude.cmd",
        "C:\\nvm4w\\nodejs\\claude.exe",
      ],
      {
        exists: () => true,
        isShebang: (p) => !path.extname(p),
      },
    )
    assert.equal(picked, "C:\\nvm4w\\nodejs\\claude.exe")
  })

  it("prefers .cmd when no PE is listed (typical npm global)", () => {
    const picked = pickWindowsWhereHit(
      ["C:\\nvm4w\\nodejs\\claude", "C:\\nvm4w\\nodejs\\claude.cmd"],
      {
        exists: () => true,
        isShebang: (p) => p.endsWith("claude") && !p.endsWith(".cmd"),
      },
    )
    assert.equal(picked, "C:\\nvm4w\\nodejs\\claude.cmd")
  })

  it("returns undefined when only a shebang shim exists", () => {
    const picked = pickWindowsWhereHit(["C:\\nvm4w\\nodejs\\claude"], {
      exists: () => true,
      isShebang: () => true,
    })
    assert.equal(picked, undefined)
  })

  it("skips missing paths", () => {
    const picked = pickWindowsWhereHit(
      ["C:\\missing\\claude.exe", "C:\\real\\claude.cmd"],
      {
        exists: (p) => p.includes("real"),
        isShebang: () => false,
      },
    )
    assert.equal(picked, "C:\\real\\claude.cmd")
  })
})

describe("looksLikeWindowsShebangScript", () => {
  it("detects #!/bin/sh from injected reader", () => {
    assert.equal(
      looksLikeWindowsShebangScript("C:\\x\\claude", {
        readHead: () => "#!/bin/sh\nbasedir=$(dirname \"$0\")\n",
      }),
      true,
    )
    assert.equal(
      looksLikeWindowsShebangScript("C:\\x\\claude.cmd", {
        readHead: () => "@ECHO off\r\n",
      }),
      false,
    )
  })
})

describe("findWindowsSiblingShim", () => {
  it("finds .cmd next to an extensionless shebang path", () => {
    const sib = findWindowsSiblingShim("C:\\nvm4w\\nodejs\\claude", {
      exists: (p) => p === "C:\\nvm4w\\nodejs\\claude.cmd",
    })
    assert.equal(sib, "C:\\nvm4w\\nodejs\\claude.cmd")
  })

  it("prefers sibling .exe over .cmd", () => {
    const sib = findWindowsSiblingShim("C:\\tools\\claude", {
      exists: (p) => p === "C:\\tools\\claude.exe" || p === "C:\\tools\\claude.cmd",
    })
    assert.equal(sib, "C:\\tools\\claude.exe")
  })
})

describe("unwrapWindowsCmdShim", () => {
  it("resolves %dp0% ...exe %* wrappers (Claude Code)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-cmd-"))
    const exe = path.join(dir, "node_modules", "pkg", "bin", "agent.exe")
    fs.mkdirSync(path.dirname(exe), { recursive: true })
    fs.writeFileSync(exe, "MZ")
    const cmdPath = path.join(dir, "agent.cmd")
    fs.writeFileSync(
      cmdPath,
      [
        "@ECHO off",
        "SETLOCAL",
        'CALL :find_dp0',
        '"%dp0%\\node_modules\\pkg\\bin\\agent.exe"   %*',
        "",
      ].join("\r\n"),
    )
    const u = unwrapWindowsCmdShim(cmdPath)
    assert.ok(u)
    assert.equal(u!.command, exe)
    assert.deepEqual(u!.prefixArgs, [])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("resolves npm node + cli.js shims (Pi)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-cmd-"))
    const script = path.join(dir, "node_modules", "pi", "dist", "cli.js")
    fs.mkdirSync(path.dirname(script), { recursive: true })
    fs.writeFileSync(script, "console.log('ok')")
    const nodeExe = path.join(dir, "node.exe")
    fs.writeFileSync(nodeExe, "MZ")
    const cmdPath = path.join(dir, "pi.cmd")
    fs.writeFileSync(
      cmdPath,
      [
        "@ECHO off",
        'IF EXIST "%dp0%\\node.exe" (',
        '  SET "_prog=%dp0%\\node.exe"',
        ") ELSE (",
        '  SET "_prog=node"',
        ")",
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\pi\\dist\\cli.js" %*',
        "",
      ].join("\r\n"),
    )
    const u = unwrapWindowsCmdShim(cmdPath)
    assert.ok(u)
    assert.equal(u!.command, nodeExe)
    assert.deepEqual(u!.prefixArgs, [script])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe("resolveAcpSpawn", () => {
  it("is identity on non-win32", () => {
    const r = resolveAcpSpawn("/opt/homebrew/bin/claude", ["-p"], { platform: "darwin" })
    assert.equal(r.command, "/opt/homebrew/bin/claude")
    assert.deepEqual(r.args, ["-p"])
    assert.deepEqual(r.options, {})
  })

  it("passes .exe through with windowsHide on win32", () => {
    const r = resolveAcpSpawn("C:\\Tools\\claude.exe", ["-p", "hi"], { platform: "win32" })
    assert.equal(r.command, "C:\\Tools\\claude.exe")
    assert.deepEqual(r.args, ["-p", "hi"])
    assert.equal(r.options.windowsHide, true)
    assert.equal(r.options.windowsVerbatimArguments, undefined)
  })

  it("wraps unresolved .cmd via cmd.exe /d /s /c (no shell:true)", () => {
    const r = resolveAcpSpawn("C:\\missing\\agent.cmd", ["--version"], {
      platform: "win32",
      exists: () => false,
      readFile: () => {
        throw new Error("nope")
      },
    })
    assert.match(r.command, /cmd\.exe$/i)
    assert.equal(acpSpawnUsesCmdHost(r), true)
    assert.equal(r.args[0], "/d")
    assert.equal(r.args[1], "/s")
    assert.equal(r.args[2], "/c")
    assert.match(r.args[3] || "", /agent\.cmd/)
    const cmdline = r.args[3] || ""
    assert.ok(cmdline.startsWith('"') && cmdline.endsWith('"'), "wrapViaCmd must wrap the entire cmdline in quotes")
    assert.equal(r.options.windowsHide, true)
    assert.equal(r.options.windowsVerbatimArguments, true)
  })

  it("does not put a huge/metachar prompt into wrapViaCmd args", () => {
    const prompt = `page_context & calc.exe < nul\n${"A".repeat(4000)}`
    const r = resolveAcpSpawn(
      "C:\\missing\\agent.cmd",
      ["-p", prompt, "--output-format", "text"],
      {
        platform: "win32",
        exists: () => false,
        readFile: () => {
          throw new Error("nope")
        },
      },
    )
    assert.equal(acpSpawnUsesCmdHost(r), true)
    const blob = r.args.join("\0")
    assert.ok(!blob.includes("calc.exe"), "metachar prompt must not reach cmd /c")
    assert.ok(!blob.includes("page_context"), "page prompt must not reach cmd /c")
    assert.ok(!blob.includes("AAAA"), "huge prompt body must not reach cmd /c")
    assert.doesNotMatch(r.args[3] || "", /(?:^|[\s"])-p(?:[\s"]|$)/)
    assert.match(r.args[3] || "", /--output-format/)
    assert.match(r.args[3] || "", /\btext\b/)
    const cmdline = r.args[3] || ""
    assert.ok(cmdline.startsWith('"') && cmdline.endsWith('"'))
  })

  it("rewrites extensionless shebang to sibling .cmd then unwraps", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-shim-"))
    const exe = path.join(dir, "node_modules", "x", "bin", "claude.exe")
    fs.mkdirSync(path.dirname(exe), { recursive: true })
    fs.writeFileSync(exe, "MZ")
    const shim = path.join(dir, "claude")
    fs.writeFileSync(shim, "#!/bin/sh\nexec \"$basedir/node_modules/x/bin/claude.exe\"\n")
    const cmdPath = path.join(dir, "claude.cmd")
    fs.writeFileSync(cmdPath, `"%dp0%\\node_modules\\x\\bin\\claude.exe"   %*\r\n`)
    const r = resolveAcpSpawn(shim, ["--version"], { platform: "win32" })
    assert.equal(r.command, exe)
    assert.deepEqual(r.args, ["--version"])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe("quoteCmdArg", () => {
  it("leaves simple tokens bare", () => {
    assert.equal(quoteCmdArg("--version"), "--version")
    assert.equal(quoteCmdArg("C:\\a\\b.exe"), "C:\\a\\b.exe")
  })

  it("quotes spaces and doubles quotes (not backslash-quote)", () => {
    assert.equal(quoteCmdArg("C:\\Program Files\\a.exe"), `"C:\\Program Files\\a.exe"`)
    assert.equal(quoteCmdArg('say "hi"'), `"say ""hi"""`)
    assert.doesNotMatch(quoteCmdArg('say "hi"'), /\\"/)
  })

  it("escapes % as %% and quotes metachar tokens", () => {
    assert.equal(quoteCmdArg("%PATH%"), `"%%PATH%%"`)
    assert.ok(quoteCmdArg("a&b").startsWith('"'))
  })
})

describe("argvForCmdWrap", () => {
  it("drops -p/--print and the following non-flag value", () => {
    assert.deepEqual(argvForCmdWrap(["-p", "hello world", "--output-format", "text"]), [
      "--output-format",
      "text",
    ])
    assert.deepEqual(argvForCmdWrap(["--print", "task", "--no-session"]), ["--no-session"])
  })

  it("keeps -p's neighbor when it is a flag", () => {
    assert.deepEqual(argvForCmdWrap(["-p", "--output-format", "text"]), [
      "--output-format",
      "text",
    ])
  })

  it("drops long / newline / metachar args but keeps short flags", () => {
    const dropped = argvForCmdWrap([
      "--output-format",
      "text",
      "x".repeat(300),
      "line\nbreak",
      "a&b",
    ])
    assert.deepEqual(dropped, ["--output-format", "text"])
  })
})

describe("joinDp0Relative / resolveNodeForJsShim / exclusive write", () => {
  it("normalizes backslashes so POSIX hosts join the same tree (R11)", () => {
    const dir = path.join(os.tmpdir(), "shim-dir")
    const a = joinDp0Relative(dir, "node_modules\\pkg\\bin\\agent.exe")
    const b = joinDp0Relative(dir, "node_modules/pkg/bin/agent.exe")
    assert.equal(a, b)
    assert.ok(a.endsWith(path.join("node_modules", "pkg", "bin", "agent.exe")))
  })

  it("refuses packaged companion PE as node for JS shims (R9)", () => {
    const dir = "C:\\nvm4w\\nodejs"
    assert.equal(
      resolveNodeForJsShim(dir, {
        exists: () => false,
        execPath: "C:\\Program Files\\CMspark\\cmspark-agent.exe",
      }),
      null,
    )
    assert.equal(
      resolveNodeForJsShim(dir, {
        exists: (p) => p.endsWith("node.exe"),
        execPath: "C:\\Program Files\\CMspark\\cmspark-agent.exe",
      }),
      path.join(dir, "node.exe"),
    )
    assert.match(
      resolveNodeForJsShim(dir, {
        exists: () => false,
        execPath: "C:\\nvm4w\\nodejs\\node.exe",
      }) || "",
      /node\.exe$/i,
    )
  })

  it("unwraps %~dp0 node + cli.js shims (R10)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-dp0-"))
    const script = path.join(dir, "node_modules", "codex", "bin", "cli.js")
    const nodeExe = path.join(dir, "node.exe")
    fs.mkdirSync(path.dirname(script), { recursive: true })
    fs.writeFileSync(script, "ok")
    fs.writeFileSync(nodeExe, "MZ")
    const cmdPath = path.join(dir, "codex.cmd")
    fs.writeFileSync(
      cmdPath,
      `"%~dp0\\node.exe"  "%~dp0\\node_modules\\codex\\bin\\cli.js" %*\r\n`,
    )
    const u = unwrapWindowsCmdShim(cmdPath)
    assert.ok(u)
    assert.equal(u!.command, nodeExe)
    assert.deepEqual(u!.prefixArgs, [script])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("writeExclusiveUtf8 uses wx (second write fails) (R6)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-wx-"))
    const f = path.join(dir, "task.md")
    writeExclusiveUtf8(f, "one")
    assert.equal(fs.readFileSync(f, "utf8"), "one")
    assert.throws(() => writeExclusiveUtf8(f, "two"))
    assert.equal(fs.readFileSync(f, "utf8"), "one")
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("windowsTaskkillPath is System32 not a PATH name (R8)", () => {
    const p = windowsTaskkillPath({ SystemRoot: "C:\\Windows" })
    assert.match(p.replace(/\//g, "\\"), /\\System32\\taskkill\.exe$/i)
    assert.doesNotMatch(p, /^taskkill$/i)
  })
})

describe("spawnAcpChild wiring lock (R12)", () => {
  it("manager and protocol-session call spawnAcpChild not raw spawn(server.command)", () => {
    const acpDir = path.resolve(__dirname, "..", "..", "src", "acp")
    const manager = fs.readFileSync(path.join(acpDir, "manager.ts"), "utf8")
    const proto = fs.readFileSync(path.join(acpDir, "protocol-session.ts"), "utf8")
    assert.match(manager, /spawnAcpChild\(server\.command/)
    assert.match(proto, /spawnAcpChild\(opts\.command/)
    assert.doesNotMatch(manager, /spawn\(\s*server\.command/)
    assert.doesNotMatch(proto, /spawn\(\s*opts\.command/)
    assert.match(manager, /flag:\s*"wx"/)
  })
})

describe("acpSpawnUsesCmdHost", () => {
  it("is true for cmd.exe / cmd basename", () => {
    assert.equal(acpSpawnUsesCmdHost({ command: "C:\\Windows\\System32\\cmd.exe" }), true)
    assert.equal(acpSpawnUsesCmdHost({ command: "cmd" }), true)
    assert.equal(acpSpawnUsesCmdHost({ command: "C:\\Tools\\claude.exe" }), false)
    assert.equal(acpSpawnUsesCmdHost({ command: "C:\\Tools\\node.exe" }), false)
  })
})

describe("discoverCodingAgents Windows spawn target", () => {
  it("does not return a Unix shebang shim when a .cmd/.exe sibling exists", {
    skip: !WIN,
  }, () => {
    _resetDiscoverCache()
    const agents = discoverCodingAgents(true)
    for (const a of agents) {
      let head = ""
      try {
        head = fs.readFileSync(a.command, "utf8").slice(0, 80)
      } catch {
        continue
      }
      assert.doesNotMatch(
        head,
        /^#![ \t]*\//,
        `discovered ${a.id} command is a POSIX shebang shim: ${a.command}`,
      )
      assert.match(
        a.command,
        /\.(cmd|bat|exe|com)$/i,
        `discovered ${a.id} should be a Windows spawnable (.cmd/.exe), got ${a.command}`,
      )
    }
  })
})

describe("live spawn via resolveAcpSpawn", () => {
  it("spawns a fixture .cmd wrapper and captures stdout (win32)", { skip: !WIN }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-live-"))
    const exe = process.execPath
    const script = path.join(dir, "echo.js")
    fs.writeFileSync(script, "process.stdout.write('ACP_WIN_OK')")
    const cmdPath = path.join(dir, "echo-agent.cmd")
    // Unresolvable shim so we exercise the cmd.exe fallback path
    fs.writeFileSync(
      cmdPath,
      `@ECHO off\r\n"${exe}" "${script}"\r\n`,
    )
    const spec = resolveAcpSpawn(cmdPath, [], { platform: "win32" })
    const out = await new Promise<{ code: number | null; stdout: string; err?: string }>(
      (resolve) => {
        const child = spawn(spec.command, spec.args, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: spec.options.windowsHide,
          windowsVerbatimArguments: spec.options.windowsVerbatimArguments,
        })
        let stdout = ""
        let err: string | undefined
        child.stdout.on("data", (d: Buffer) => {
          stdout += d.toString("utf8")
        })
        child.on("error", (e) => {
          err = e.message
        })
        child.on("close", (code) => resolve({ code, stdout, err }))
      },
    )
    fs.rmSync(dir, { recursive: true, force: true })
    assert.equal(out.err, undefined, out.err)
    assert.equal(out.code, 0)
    assert.match(out.stdout, /ACP_WIN_OK/)
  })

  it("spawns discovered claude --version without ENOENT/EINVAL (win32)", {
    skip: !WIN,
  }, async () => {
    _resetDiscoverCache()
    const claude = discoverCodingAgents(true).find((a) => a.id === "claude")
    if (!claude) return
    const spec = resolveAcpSpawn(claude.command, ["--version"], { platform: "win32" })
    const out = await new Promise<{ code: number | null; stdout: string; err?: string }>(
      (resolve) => {
        const child = spawn(spec.command, spec.args, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: spec.options.windowsHide,
          windowsVerbatimArguments: spec.options.windowsVerbatimArguments,
        })
        let stdout = ""
        let err: string | undefined
        child.stdout.on("data", (d: Buffer) => {
          stdout += d.toString("utf8")
        })
        child.on("error", (e) => {
          err = (e as NodeJS.ErrnoException).code + " " + e.message
        })
        child.on("close", (code) => resolve({ code, stdout, err }))
        setTimeout(() => {
          try {
            child.kill()
          } catch {
            /* */
          }
        }, 8000)
      },
    )
    assert.equal(out.err, undefined, `spawn failed: ${out.err} via ${spec.command}`)
    assert.notEqual(out.code, -4058)
    assert.doesNotMatch(out.err || "", /ENOENT|EINVAL/)
    assert.match(out.stdout, /Claude|claude|\d+\.\d+/)
  })
})
