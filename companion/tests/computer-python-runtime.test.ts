import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import * as fs from "node:fs"
import {
  sanitizePythonPackages,
  findUv,
  isUvExecutable,
  listWellKnownUvCandidates,
  processLocalLookupPath,
  uvInstallHint,
  buildInstallCommands,
  ensureIsolatedPythonEnv,
  type UvDiscoveryDeps,
} from "../src/computer/python-runtime"

// ── sanitizePythonPackages (regression) ──────────────────────────────────────

test("sanitizePythonPackages drops flags and urls", () => {
  const pkgs = sanitizePythonPackages([
    "torch",
    "--index-url",
    "https://evil.example/simple",
    "-e",
    "/tmp/evil",
    "git+https://x",
    "modelscope",
    "not-a-real-pkg-xyz",
  ])
  assert.deepEqual(pkgs.sort(), ["modelscope", "torch"].sort())
})

test("sanitizePythonPackages empty → default set", () => {
  const pkgs = sanitizePythonPackages([])
  assert.ok(pkgs.includes("torch"))
  assert.ok(pkgs.includes("modelscope"))
})

// ── uvInstallHint (W7) ───────────────────────────────────────────────────────

test("uvInstallHint('win32') contains winget, not brew", () => {
  const h = uvInstallHint("win32")
  assert.match(h, /winget/i)
  assert.doesNotMatch(h, /brew/i)
})

test("uvInstallHint('darwin') may contain brew", () => {
  const h = uvInstallHint("darwin")
  assert.match(h, /brew/i)
})

test("uvInstallHint('linux') uses curl installer, not brew-only", () => {
  const h = uvInstallHint("linux")
  assert.match(h, /curl|astral\.sh/i)
  assert.doesNotMatch(h, /^brew install uv$/)
})

// ── isUvExecutable ───────────────────────────────────────────────────────────

test("isUvExecutable rejects relative and wrong basenames", () => {
  assert.equal(isUvExecutable("uv"), false)
  assert.equal(isUvExecutable("./uv"), false)
  assert.equal(isUvExecutable("C:\\tools\\not-uv.exe"), false)
})

test("isUvExecutable accepts absolute fixture path with correct basename", () => {
  const abs =
    process.platform === "win32"
      ? "C:\\Users\\test\\.local\\bin\\uv.exe"
      : "/home/test/.local/bin/uv"
  const deps: UvDiscoveryDeps = {
    existsSync: (p) => p === abs || p === path.normalize(abs),
    statSync: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
  }
  assert.equal(isUvExecutable(abs, deps), true)
})

// ── listWellKnownUvCandidates (W3/W4) ────────────────────────────────────────

test("unix candidate list includes homebrew paths", () => {
  const cands = listWellKnownUvCandidates({
    platform: "linux",
    homedir: () => "/home/ci",
    env: {},
    existsSync: () => false,
    readdirSync: () => [],
  })
  assert.ok(cands.some((c) => c.includes(".local") && c.endsWith(`${path.sep}uv`) || c.endsWith("/uv")))
  assert.ok(cands.includes("/opt/homebrew/bin/uv"))
  assert.ok(cands.includes("/usr/local/bin/uv"))
})

test("win32 candidates include .local\\bin and scoop/choco/cargo", () => {
  const home = "C:\\Users\\ci"
  const cands = listWellKnownUvCandidates({
    platform: "win32",
    homedir: () => home,
    env: {
      LOCALAPPDATA: "C:\\Users\\ci\\AppData\\Local",
      ProgramData: "C:\\ProgramData",
    },
    existsSync: () => false,
    readdirSync: () => [],
  })
  const norm = cands.map((c) => c.replace(/\//g, "\\").toLowerCase())
  assert.ok(norm.some((c) => c.includes(".local\\bin\\uv.exe")))
  assert.ok(norm.some((c) => c.includes("scoop\\shims\\uv.exe")))
  assert.ok(norm.some((c) => c.includes("chocolatey\\bin\\uv.exe")))
  assert.ok(norm.some((c) => c.includes(".cargo\\bin\\uv.exe")))
})

test("WinGet Packages: only astral-sh.uv_* (unrelated package ignored)", () => {
  const packagesDir = "C:\\Users\\ci\\AppData\\Local\\Microsoft\\WinGet\\Packages"
  const cands = listWellKnownUvCandidates({
    platform: "win32",
    homedir: () => "C:\\Users\\ci",
    env: { LOCALAPPDATA: "C:\\Users\\ci\\AppData\\Local" },
    existsSync: (p) => p === packagesDir || p.replace(/\//g, "\\") === packagesDir,
    readdirSync: (p) => {
      const n = p.replace(/\//g, "\\")
      if (n === packagesDir) {
        return ["astral-sh.uv_1.2.3", "SomeOther.Tool_9.9", "not-uv-package"]
      }
      return []
    },
  })
  const joined = cands.join("|").toLowerCase()
  assert.ok(joined.includes("astral-sh.uv_1.2.3"))
  assert.ok(joined.includes("uv.exe"))
  assert.ok(!joined.includes("someother.tool"))
  assert.ok(!joined.includes("not-uv-package"))
})

// ── processLocalLookupPath (W5/W6 — no mcp import) ───────────────────────────

test("processLocalLookupPath includes .local/bin and does not throw", () => {
  const p = processLocalLookupPath({
    platform: process.platform,
    homedir: () => (process.platform === "win32" ? "C:\\Users\\ci" : "/home/ci"),
    env: { PATH: "/usr/bin", LOCALAPPDATA: "C:\\Users\\ci\\AppData\\Local" },
    existsSync: () => false,
    readdirSync: () => [],
  })
  assert.ok(typeof p === "string" && p.length > 0)
  assert.ok(p.includes(".local") || p.includes("homebrew") || p.includes("usr"))
})

test("W6: python-runtime module source must not import mcp/transport", () => {
  // Static guard — computer layer must not depend on mcp
  const srcPath = path.join(__dirname, "..", "src", "computer", "python-runtime.ts")
  // When running from .test-dist, source is sibling under project
  const candidates = [
    srcPath,
    path.join(__dirname, "..", "..", "src", "computer", "python-runtime.ts"),
    path.resolve(__dirname, "../../src/computer/python-runtime.ts"),
  ]
  let src = ""
  for (const c of candidates) {
    try {
      src = fs.readFileSync(c, "utf8")
      break
    } catch {
      /* try next */
    }
  }
  // Also try from workspace root relative to this file's compiled location
  if (!src) {
    const rootGuess = path.resolve(process.cwd(), "src/computer/python-runtime.ts")
    try {
      src = fs.readFileSync(rootGuess, "utf8")
    } catch {
      /* skip if unavailable */
    }
  }
  if (src) {
    assert.doesNotMatch(src, /from\s+["'].*mcp\/transport/)
    assert.doesNotMatch(src, /require\(["'].*mcp\/transport/)
  }
})

// ── findUv discovery (W1/W2/W11) ─────────────────────────────────────────────

/** Path API matching findUv's injected platform (host may be linux while platform=win32). */
function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix
}

function fixtureFileDeps(absUv: string, platform: NodeJS.Platform): UvDiscoveryDeps {
  const P = pathFor(platform)
  const norm = (p: string) => P.normalize(p)
  const files = new Set([norm(absUv)])
  return {
    platform,
    env: { PATH: "" }, // stripped PATH
    homedir: () =>
      platform === "win32" ? "C:\\Users\\fixture" : "/home/fixture",
    existsSync: (p) => files.has(norm(p)),
    readdirSync: () => [],
    statSync: (p) => ({
      isFile: () => files.has(norm(p)),
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => norm(p),
    runCapture: async (bin, args) => {
      // version probe on the absolute fixture
      if (norm(bin) === norm(absUv) && args[0] === "--version") {
        return { code: 0, out: "uv 0.6.0\n", err: "" }
      }
      // where/which under stripped PATH → fail
      if (bin === "where" || bin === "which") {
        return { code: 1, out: "", err: "not found" }
      }
      return { code: 127, out: "", err: "ENOENT" }
    },
  }
}

test("stripped PATH + fixture .local/bin/uv → ok + absolute", async () => {
  // Always exercise both layouts via platform inject, independent of CI host OS
  const platform: NodeJS.Platform = "linux"
  const P = pathFor(platform)
  const home = "/home/fixture"
  const localUv = P.join(home, ".local", "bin", "uv")

  const deps = fixtureFileDeps(localUv, platform)
  deps.homedir = () => home
  deps.env = { PATH: "" }

  const r = await findUv(deps)
  assert.equal(r.ok, true)
  assert.ok(r.path)
  assert.ok(P.isAbsolute(r.path!))
  assert.notEqual(r.path, "uv")
  const base = P.basename(r.path!).toLowerCase()
  assert.ok(base === "uv" || base === "uv.exe")
})

test("stripped PATH + fixture WinGet astral-sh.uv_x/uv.exe → ok + absolute", async () => {
  const platform: NodeJS.Platform = "win32"
  const P = pathFor(platform)
  const home = "C:\\Users\\fixture"
  const localApp = P.join(home, "AppData", "Local")
  const packagesRoot = P.join(localApp, "Microsoft", "WinGet", "Packages")
  const pkgDir = P.join(packagesRoot, "astral-sh.uv_0.6.14")
  const uvExe = P.join(pkgDir, "uv.exe")
  const same = (a: string, b: string) => P.normalize(a) === P.normalize(b)

  const deps: UvDiscoveryDeps = {
    platform,
    env: { PATH: "", LOCALAPPDATA: localApp },
    homedir: () => home,
    existsSync: (p) => same(p, uvExe) || same(p, packagesRoot),
    readdirSync: (p) => (same(p, packagesRoot) ? ["astral-sh.uv_0.6.14"] : []),
    statSync: (p) => ({
      isFile: () => same(p, uvExe),
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: async (bin, args) => {
      if (same(bin, uvExe) && args[0] === "--version") {
        return { code: 0, out: "uv 0.6.14\n", err: "" }
      }
      if (bin === "where" || bin === "which") return { code: 1, out: "", err: "" }
      return { code: 127, out: "", err: "ENOENT" }
    },
  }

  const r = await findUv(deps)
  assert.equal(r.ok, true)
  assert.ok(r.path && P.isAbsolute(r.path))
  assert.notEqual(r.path, "uv")
  assert.equal(P.basename(r.path!).toLowerCase(), "uv.exe")
})

test("unrelated WinGet package dir with uv.exe is ignored", async () => {
  const platform: NodeJS.Platform = "win32"
  const P = pathFor(platform)
  const home = "C:\\Users\\fixture"
  const localApp = P.join(home, "AppData", "Local")
  const packagesRoot = P.join(localApp, "Microsoft", "WinGet", "Packages")
  const evilPkg = P.join(packagesRoot, "Evil.Tool_1.0")
  const evilUv = P.join(evilPkg, "uv.exe")
  const same = (a: string, b: string) => P.normalize(a) === P.normalize(b)

  const deps: UvDiscoveryDeps = {
    platform,
    env: { PATH: "", LOCALAPPDATA: localApp },
    homedir: () => home,
    existsSync: (p) => same(p, evilUv) || same(p, packagesRoot),
    readdirSync: (p) => (same(p, packagesRoot) ? ["Evil.Tool_1.0"] : []),
    statSync: (p) => ({
      isFile: () => same(p, evilUv),
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: async (bin) => {
      if (bin === "where" || bin === "which") return { code: 1, out: "", err: "" }
      // if somehow probed, pretend version works — still must not be selected
      if (same(bin, evilUv)) {
        return { code: 0, out: "uv fake\n", err: "" }
      }
      return { code: 127, out: "", err: "ENOENT" }
    },
  }

  const r = await findUv(deps)
  assert.equal(r.ok, false)
  assert.equal(r.path, undefined)
})

test("findUv ok never returns bare 'uv'", async () => {
  // Even if where returns relative "uv", we must fail or absolute-only
  const deps: UvDiscoveryDeps = {
    platform: "linux",
    env: { PATH: "/usr/bin" },
    homedir: () => "/home/x",
    existsSync: () => false,
    readdirSync: () => [],
    statSync: () => ({
      isFile: () => false,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => p,
    runCapture: async (bin, args) => {
      if ((bin === "which" || bin === "where") && args[0] === "uv") {
        return { code: 0, out: "uv\n", err: "" } // relative hit — must reject
      }
      if (bin === "uv") {
        return { code: 0, out: "uv 1.0\n", err: "" }
      }
      return { code: 1, out: "", err: "" }
    },
  }
  const r = await findUv(deps)
  assert.equal(r.ok, false)
  assert.notEqual(r.path, "uv")
})

test("where hit must be absolute + basename uv before pin (N2)", async () => {
  // Use path.posix so Windows hosts don't rewrite /opt/... via win32.normalize
  const pp = path.posix
  const realUv = "/opt/homebrew/bin/uv"
  const same = (a: string, b: string) => pp.normalize(a) === pp.normalize(b)
  const deps: UvDiscoveryDeps = {
    platform: "darwin",
    env: { PATH: "/opt/homebrew/bin" },
    homedir: () => "/Users/x",
    // well-known candidates exist but we also test where path
    existsSync: (p) => same(p, realUv),
    readdirSync: () => [],
    statSync: (p) => ({
      isFile: () => same(p, realUv),
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => pp.normalize(p),
    runCapture: async (bin, args) => {
      if (same(bin, realUv) && args[0] === "--version") {
        return { code: 0, out: "uv 0.5\n", err: "" }
      }
      if (bin === "which") {
        return { code: 0, out: `${realUv}\n`, err: "" }
      }
      return { code: 1, out: "", err: "" }
    },
  }
  const r = await findUv(deps)
  assert.equal(r.ok, true)
  assert.ok(pp.isAbsolute(r.path!))
  assert.equal(pp.basename(r.path!), "uv")
})

// ── buildInstallCommands + uvPath (N3) ───────────────────────────────────────

test("buildInstallCommands prefers quoted absolute uvPath", () => {
  const abs =
    process.platform === "win32"
      ? "C:\\Users\\x\\.local\\bin\\uv.exe"
      : "/home/x/.local/bin/uv"
  const cmds = buildInstallCommands({
    mode: "isolated",
    uvAvailable: true,
    uvPath: abs,
    packages: ["torch"],
  })
  assert.ok(cmds.length >= 1)
  assert.ok(cmds[0]!.includes(abs))
  assert.ok(!cmds[0]!.startsWith("uv "))
})

test("buildInstallCommands win32 uses PowerShell & 'path' invoke for spaces", () => {
  const abs = "C:\\Users\\John Doe\\AppData\\Local\\uv.exe"
  const cmds = buildInstallCommands({
    mode: "isolated",
    uvAvailable: true,
    uvPath: abs,
    packages: ["torch"],
    platform: "win32",
  })
  assert.ok(cmds[0]!.startsWith("& '"))
  assert.ok(cmds[0]!.includes(abs))
  assert.ok(cmds[0]!.includes("venv"))
})

test("buildInstallCommands darwin uses double-quoted absolute uvPath", () => {
  const abs = "/Users/me/.local/bin/uv"
  const cmds = buildInstallCommands({
    mode: "isolated",
    uvAvailable: true,
    uvPath: abs,
    packages: ["torch"],
    platform: "darwin",
  })
  assert.ok(cmds[0]!.includes(`"${abs}"`))
  assert.ok(!cmds[0]!.startsWith("& "))
})

// ── ensureIsolatedPythonEnv absolute argv0 (T2) ──────────────────────────────

test("ensureIsolatedPythonEnv uses absolute argv0 (mock)", async () => {
  const absUv =
    process.platform === "win32"
      ? "C:\\Tools\\uv.exe"
      : "/usr/local/bin/uv"
  const spawns: Array<{ bin: string; args: string[] }> = []

  const result = await ensureIsolatedPythonEnv(["torch"], {
    findUv: async () => ({ ok: true, path: absUv }),
    existsSync: () => false, // force venv create path
    runCapture: async (bin, args) => {
      spawns.push({ bin, args })
      // pretend success for venv + pip + version-like
      return { code: 0, out: "ok\n", err: "" }
    },
  })

  assert.equal(result.usedUv, true)
  assert.ok(spawns.length >= 1)
  for (const s of spawns) {
    // All uv-related spawns must use absolute argv0 — never bare "uv"
    if (s.args[0] === "venv" || s.args[0] === "pip") {
      assert.ok(path.isAbsolute(s.bin), `expected absolute uv bin, got ${s.bin}`)
      assert.equal(s.bin, absUv)
      assert.notEqual(s.bin, "uv")
    }
  }
})

test("ensureIsolatedPythonEnv treats non-absolute uv as unavailable", async () => {
  const spawns: string[] = []
  const result = await ensureIsolatedPythonEnv([], {
    findUv: async () => ({ ok: true, path: "uv" }), // illegal after discovery
    existsSync: () => false,
    runCapture: async (bin) => {
      spawns.push(bin)
      return { code: 0, out: "", err: "" }
    },
  })
  assert.equal(result.usedUv, false)
  assert.ok(!spawns.includes("uv"))
})

// ── W9: uv non-blocking (payload-level contract smoke) ───────────────────────

test("W9: uvInstallHint and missing uv do not imply blocking download gates", () => {
  // Contract: uv is optional — install hint is informational only
  const hint = uvInstallHint("win32")
  assert.ok(hint.length > 0)
  // uvAvailable=false still allows buildInstallCommands via python -m venv
  const cmds = buildInstallCommands({
    mode: "isolated",
    uvAvailable: false,
    packages: ["torch"],
  })
  assert.ok(cmds.some((c) => c.includes("venv") || c.includes("pip")))
  assert.ok(!cmds.some((c) => c.startsWith("uv ")))
})
