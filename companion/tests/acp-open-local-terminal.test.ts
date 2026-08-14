// Unit tests for Mode C open-local-terminal pure helpers.
// Shell escape, absolute-path rejection, Windows quoting, Linux terminal pick, L0 script.

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import {
  shellSingleQuote,
  windowsQuotePath,
  rejectNonAbsoluteCommand,
  resolveAbsoluteCommand,
  buildInteractiveScript,
  buildInteractiveExecFragment,
  buildL0DegradeScript,
  buildWindowsCommandLine,
  resolveLinuxTerminalBinary,
  resolveLinuxTerminalFromPref,
  normalizeLocalTerminalApp,
} from "../src/acp/open-local-terminal"

describe("shellSingleQuote", () => {
  it("wraps plain strings in single quotes", () => {
    assert.equal(shellSingleQuote("/tmp/ws"), "'/tmp/ws'")
    assert.equal(shellSingleQuote("hello"), "'hello'")
  })

  it("escapes embedded single quotes for POSIX sh", () => {
    // 'foo'bar' → 'foo'\''bar'
    assert.equal(shellSingleQuote("foo'bar"), `'foo'\\''bar'`)
    assert.equal(shellSingleQuote("a'b'c"), `'a'\\''b'\\''c'`)
  })

  it("handles empty string", () => {
    assert.equal(shellSingleQuote(""), "''")
  })

  it("does not expand metacharacters inside quotes", () => {
    const s = shellSingleQuote("$(rm -rf /) && echo x")
    assert.equal(s, `'$(rm -rf /) && echo x'`)
    assert.ok(s.startsWith("'") && s.endsWith("'"))
  })
})

describe("windowsQuotePath", () => {
  it("double-quotes paths with spaces", () => {
    assert.equal(windowsQuotePath("C:\\Program Files\\app"), `"C:\\Program Files\\app"`)
  })

  it("doubles embedded double-quotes (cmd.exe)", () => {
    assert.equal(windowsQuotePath('C:\\a"b'), `"C:\\a""b"`)
  })

  it("quotes simple paths for uniform cmd parsing", () => {
    assert.equal(windowsQuotePath("C:\\repo"), `"C:\\repo"`)
  })
})

describe("buildWindowsCommandLine", () => {
  it("uses cd /d and quotes cwd + command", () => {
    const line = buildWindowsCommandLine(
      "C:\\Users\\me\\My Project",
      "C:\\Tools\\claude.exe",
    )
    assert.equal(
      line,
      `cd /d "C:\\Users\\me\\My Project" && "C:\\Tools\\claude.exe"`,
    )
  })

  it("escapes quotes in paths", () => {
    const line = buildWindowsCommandLine('D:\\a"b', 'E:\\x"y.exe')
    assert.match(line, /cd \/d "D:\\a""b"/)
    assert.match(line, /"E:\\x""y\.exe"/)
  })
})

describe("rejectNonAbsoluteCommand", () => {
  it("rejects empty / whitespace", () => {
    assert.ok(rejectNonAbsoluteCommand(""))
    assert.ok(rejectNonAbsoluteCommand("   "))
  })

  it("rejects relative and bare names (no PATH lookup)", () => {
    assert.match(rejectNonAbsoluteCommand("claude") || "", /absolute/i)
    assert.match(rejectNonAbsoluteCommand("./claude") || "", /absolute/i)
    assert.match(rejectNonAbsoluteCommand("../bin/claude") || "", /absolute/i)
    assert.match(rejectNonAbsoluteCommand("bin/claude") || "", /absolute/i)
  })

  it("accepts absolute POSIX paths", () => {
    // path.isAbsolute is platform-aware; on win32 POSIX abs may differ —
    // use platform-native absolute.
    const abs =
      process.platform === "win32" ? "C:\\opt\\homebrew\\bin\\claude" : "/opt/homebrew/bin/claude"
    assert.equal(rejectNonAbsoluteCommand(abs), null)
  })

  it("accepts absolute Windows paths when on win32", () => {
    if (process.platform !== "win32") return
    assert.equal(rejectNonAbsoluteCommand("C:\\Tools\\claude.exe"), null)
  })
})

describe("resolveAbsoluteCommand", () => {
  it("rejects relative before realpath", () => {
    const r = resolveAbsoluteCommand("claude", (p) => p)
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.reason, /absolute/i)
  })

  it("accepts absolute and returns realpath result when absolute", () => {
    const input =
      process.platform === "win32" ? "C:\\bin\\claude" : "/usr/local/bin/claude"
    const real =
      process.platform === "win32" ? "C:\\real\\claude" : "/real/claude"
    const r = resolveAbsoluteCommand(input, () => real)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.absolute, real)
  })

  it("rejects if realpath collapses to a relative path", () => {
    const input =
      process.platform === "win32" ? "C:\\bin\\claude" : "/usr/local/bin/claude"
    const r = resolveAbsoluteCommand(input, () => "relative-evil")
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.reason, /absolute/i)
  })

  it("keeps absolute when realpath throws", () => {
    const input =
      process.platform === "win32" ? "C:\\bin\\claude" : "/usr/local/bin/claude"
    const r = resolveAbsoluteCommand(input, () => {
      throw new Error("ENOENT")
    })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.absolute, input)
  })
})

describe("buildInteractiveScript / buildL0DegradeScript", () => {
  const cwd = process.platform === "win32" ? "C:\\ws" : "/tmp/ws"
  const cmd =
    process.platform === "win32" ? "C:\\bin\\claude" : "/opt/homebrew/bin/claude"

  it("L1 includes cd, dual-process banner, and exec of quoted command", () => {
    const s = buildInteractiveScript({
      cwd,
      command: cmd,
      agentLabel: "Claude",
      goalHint: "fix auth",
    })
    assert.match(s, new RegExp(`cd ${shellSingleQuote(cwd).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
    assert.match(s, /不是同一会话/)
    assert.match(s, /Agent: Claude/)
    assert.match(s, /任务: fix auth/)
    assert.ok(s.includes(`exec ${shellSingleQuote(cmd)}`))
  })

  it("L0 has banner but no exec of agent", () => {
    const s = buildL0DegradeScript({
      cwd,
      command: cmd,
      agentLabel: "Pi",
    })
    assert.match(s, /L0/)
    assert.doesNotMatch(s, /\bexec\b/)
    assert.ok(s.includes(shellSingleQuote(cmd)))
  })

  it("strips newlines from goalHint", () => {
    const s = buildInteractiveScript({
      cwd,
      command: cmd,
      goalHint: "line1\nline2\r\nline3",
    })
    assert.doesNotMatch(s, /line1\n/)
    assert.match(s, /line1 line2 line3/)
  })

  it("L1 with promptFile loads task and passes to interactive agent", () => {
    const pf =
      process.platform === "win32" ? "C:\\tmp\\task.md" : "/tmp/cmspark-mode-c-task.md"
    const s = buildInteractiveScript({
      cwd,
      command: cmd,
      agentId: "claude",
      agentLabel: "Claude",
      goalHint: "short",
      promptFile: pf,
      prompt: "full task body",
    })
    assert.match(s, /CMSPARK_TASK=\$\(cat /)
    assert.match(s, /exec /)
    assert.match(s, /"\$\{CMSPARK_TASK\}"/)
    assert.ok(s.includes(shellSingleQuote(pf)))
  })

  it("buildInteractiveExecFragment with inline prompt quotes it", () => {
    const frag = buildInteractiveExecFragment({
      command: cmd,
      agentId: "pi",
      prompt: "使用 fanout 审查",
    })
    assert.ok(frag.startsWith("exec "))
    assert.ok(frag.includes(shellSingleQuote("使用 fanout 审查")))
  })
})

describe("normalizeLocalTerminalApp", () => {
  it("maps empty/default to auto", () => {
    assert.equal(normalizeLocalTerminalApp(""), "auto")
    assert.equal(normalizeLocalTerminalApp("  auto  "), "auto")
    assert.equal(normalizeLocalTerminalApp("default"), "auto")
    assert.equal(normalizeLocalTerminalApp(null), "auto")
  })

  it("accepts known ids and absolute paths", () => {
    assert.equal(normalizeLocalTerminalApp("iTerm"), "iTerm")
    assert.equal(normalizeLocalTerminalApp("/Applications/iTerm.app"), "/Applications/iTerm.app")
  })

  it("maps common typos to Ghostty / iTerm", () => {
    assert.equal(normalizeLocalTerminalApp("ghotty"), "Ghostty")
    assert.equal(normalizeLocalTerminalApp("Ghostty"), "Ghostty")
    assert.equal(normalizeLocalTerminalApp("iterm2"), "iTerm")
  })

  it("rejects shell metacharacters", () => {
    assert.equal(normalizeLocalTerminalApp("Terminal; rm -rf /"), "auto")
    assert.equal(normalizeLocalTerminalApp("$(evil)"), "auto")
  })
})

describe("resolveLinuxTerminalFromPref", () => {
  it("uses absolute pref when exists", () => {
    const t = resolveLinuxTerminalFromPref("/custom/term", {}, (p) => p === "/custom/term")
    assert.equal(t, "/custom/term")
  })

  it("falls back to TERMINAL / common when auto", () => {
    const t = resolveLinuxTerminalFromPref("auto", { TERMINAL: "/usr/bin/kitty" })
    assert.equal(t, "/usr/bin/kitty")
  })
})

describe("resolveLinuxTerminalBinary", () => {
  it("prefers TERMINAL env", () => {
    const t = resolveLinuxTerminalBinary({ TERMINAL: "/usr/bin/alacritty" })
    assert.equal(t, "/usr/bin/alacritty")
  })

  it("does NOT use COLORTERM as a terminal binary", () => {
    const t = resolveLinuxTerminalBinary({
      COLORTERM: "truecolor",
      // no TERMINAL
    })
    // Must not return "truecolor" or any COLORTERM value
    assert.notEqual(t, "truecolor")
    if (t) {
      assert.notEqual(t, process.env.COLORTERM)
      // Either a known fallback path name or null — never COLORTERM payload
      assert.ok(
        t === "x-terminal-emulator" ||
          t === "gnome-terminal" ||
          t === "konsole" ||
          t === "xfce4-terminal" ||
          t === "xterm" ||
          t.includes("/") ||
          t.includes("terminal"),
      )
    }
  })

  it("ignores COLORTERM even when TERMINAL is unset and COLORTERM looks like a path", () => {
    const t = resolveLinuxTerminalBinary({
      COLORTERM: "/evil/truecolor-not-a-term",
    })
    assert.notEqual(t, "/evil/truecolor-not-a-term")
  })

  it("trims TERMINAL", () => {
    const t = resolveLinuxTerminalBinary({ TERMINAL: "  kitty  " })
    assert.equal(t, "kitty")
  })
})

describe("path.isAbsolute matrix (platform)", () => {
  it("documents rejection of non-absolute on this platform", () => {
    for (const bad of ["claude", "./x", "foo/bar", ""]) {
      assert.ok(
        rejectNonAbsoluteCommand(bad),
        `expected reject for ${JSON.stringify(bad)} (platform=${process.platform})`,
      )
    }
    // Platform-native absolute should pass path.isAbsolute
    const good = path.resolve("/opt/agent")
    assert.equal(path.isAbsolute(good), true)
    assert.equal(rejectNonAbsoluteCommand(good), null)
  })
})
