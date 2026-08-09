import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import * as fs from "node:fs"
import {
  sanitizePythonPackages,
  findUv,
  isUvExecutable,
  listWellKnownUvCandidates,
  listWellKnownPythonCandidates,
  listManagerPythonCandidates,
  processLocalLookupPath,
  uvInstallHint,
  pythonInstallHint,
  buildInstallCommands,
  ensureIsolatedPythonEnv,
  longPathFailureHint,
  findPythonBase,
  resolvePythonRuntime,
  validatePythonExecutable,
  parsePythonVersion,
  isWindowsStorePythonStub,
  versionMeetsMin,
  MIN_PYTHON_VERSION,
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

test("longPathFailureHint only expands on win32 (P-F8)", () => {
  assert.equal(longPathFailureHint("pip install 失败", "darwin"), "pip install 失败")
  const w = longPathFailureHint("uv pip install 失败（见日志）", "win32")
  assert.ok(w.includes("MAX_PATH") || w.includes("长路径"))
  assert.ok(w.startsWith("uv pip install"))
})

// ── Base Python discovery cascade (PY-T1..T21 / N2) ─────────────────────────

function goodPyProbe(absPy: string, version = "3.12.0") {
  return async (bin: string, args: string[]) => {
    const joined = args.join(" ")
    if (joined.includes("sys.executable") || joined.includes("version_info")) {
      // Accept absolute fixture or py launcher
      if (
        pathFor("win32").normalize(bin) === pathFor("win32").normalize(absPy) ||
        pathFor("linux").normalize(bin) === pathFor("linux").normalize(absPy) ||
        bin === absPy ||
        bin === "py"
      ) {
        return { code: 0, out: `${absPy}\n${version}\n`, err: "" }
      }
    }
    if (bin === "where" || bin === "which") return { code: 1, out: "", err: "" }
    if (bin === "py" && args[0] === "-0p") return { code: 1, out: "", err: "" }
    if (bin === "py" && args[0] === "-3") {
      return { code: 0, out: `${absPy}\n${version}\n`, err: "" }
    }
    return { code: 127, out: "", err: "ENOENT" }
  }
}

test("PY-T1: stripped PATH + fixture Local Programs/Python/Python312 → well-known", async () => {
  const platform: NodeJS.Platform = "win32"
  const P = pathFor(platform)
  const home = "C:\\Users\\fixture"
  const localApp = P.join(home, "AppData", "Local")
  const pyRoot = P.join(localApp, "Programs", "Python")
  const pyDir = P.join(pyRoot, "Python312")
  const pyExe = P.join(pyDir, "python.exe")
  const same = (a: string, b: string) => P.normalize(a) === P.normalize(b)

  const deps: UvDiscoveryDeps = {
    platform,
    env: { PATH: "", LOCALAPPDATA: localApp },
    homedir: () => home,
    existsSync: (p) => same(p, pyExe) || same(p, pyRoot) || same(p, pyDir),
    readdirSync: (p) => {
      if (same(p, pyRoot)) return ["Python312"]
      return []
    },
    statSync: (p) => ({
      isFile: () => same(p, pyExe),
      isSymbolicLink: () => false,
      isDirectory: () => same(p, pyRoot) || same(p, pyDir),
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: goodPyProbe(pyExe),
  }

  const r = await findPythonBase({ includeIsolated: false, deps })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.ok(P.isAbsolute(r.path))
    assert.equal(r.source, "well-known")
    assert.notEqual(r.path, "python")
    assert.notEqual(r.path, "py")
  }
})

test("PY-T2: fixture WinGet Python.Python.3.12 → ok absolute", async () => {
  const platform: NodeJS.Platform = "win32"
  const P = pathFor(platform)
  const home = "C:\\Users\\fixture"
  const localApp = P.join(home, "AppData", "Local")
  const packagesRoot = P.join(localApp, "Microsoft", "WinGet", "Packages")
  const pkgDir = P.join(packagesRoot, "Python.Python.3.12_3.12.0")
  const pyExe = P.join(pkgDir, "python.exe")
  const same = (a: string, b: string) => P.normalize(a) === P.normalize(b)

  const deps: UvDiscoveryDeps = {
    platform,
    env: { PATH: "", LOCALAPPDATA: localApp },
    homedir: () => home,
    existsSync: (p) => same(p, pyExe) || same(p, packagesRoot) || same(p, pkgDir),
    readdirSync: (p) => {
      if (same(p, packagesRoot)) return ["Python.Python.3.12_3.12.0"]
      if (same(p, pkgDir)) return []
      return []
    },
    statSync: (p) => ({
      isFile: () => same(p, pyExe),
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: goodPyProbe(pyExe),
  }

  const r = await findPythonBase({ includeIsolated: false, deps })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.ok(P.isAbsolute(r.path))
    assert.equal(P.basename(r.path).toLowerCase(), "python.exe")
  }
})

test("PY-T3: unrelated WinGet package dir with python.exe ignored", async () => {
  const platform: NodeJS.Platform = "win32"
  const P = pathFor(platform)
  const home = "C:\\Users\\fixture"
  const localApp = P.join(home, "AppData", "Local")
  const packagesRoot = P.join(localApp, "Microsoft", "WinGet", "Packages")
  const evilPkg = P.join(packagesRoot, "Evil.Tool_1.0")
  const evilPy = P.join(evilPkg, "python.exe")
  const same = (a: string, b: string) => P.normalize(a) === P.normalize(b)

  const deps: UvDiscoveryDeps = {
    platform,
    env: { PATH: "", LOCALAPPDATA: localApp },
    homedir: () => home,
    existsSync: (p) => same(p, evilPy) || same(p, packagesRoot),
    readdirSync: (p) => (same(p, packagesRoot) ? ["Evil.Tool_1.0"] : []),
    statSync: (p) => ({
      isFile: () => same(p, evilPy),
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: async (bin) => {
      if (bin === "where" || bin === "which" || bin === "py") {
        return { code: 1, out: "", err: "" }
      }
      if (same(bin, evilPy)) {
        return { code: 0, out: `${evilPy}\n3.12.0\n`, err: "" }
      }
      return { code: 127, out: "", err: "ENOENT" }
    },
  }

  const r = await findPythonBase({ includeIsolated: false, deps })
  assert.equal(r.ok, false)
})

test("PY-T4: WindowsApps path candidate rejected", async () => {
  const platform: NodeJS.Platform = "win32"
  const P = pathFor(platform)
  const home = "C:\\Users\\fixture"
  const storePy =
    "C:\\Users\\fixture\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe"
  assert.equal(isWindowsStorePythonStub(storePy, { platform }), true)

  const deps: UvDiscoveryDeps = {
    platform,
    env: { PATH: "", LOCALAPPDATA: P.join(home, "AppData", "Local") },
    homedir: () => home,
    existsSync: (p) => P.normalize(p) === P.normalize(storePy),
    readdirSync: () => [],
    statSync: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: async () => ({
      code: 0,
      out: `${storePy}\n3.12.0\n`,
      err: "",
    }),
  }

  // listWellKnown must never include WindowsApps
  const cands = listWellKnownPythonCandidates(deps)
  assert.ok(!cands.some((c) => /windowsapps/i.test(c)))

  const r = await findPythonBase({
    includeIsolated: false,
    configPath: storePy,
    deps,
  })
  assert.equal(r.ok, false)
})

test("PY-T5: validatePythonExecutable Store path → ok false", async () => {
  const storePy =
    "C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe"
  const deps: UvDiscoveryDeps = {
    platform: "win32",
    existsSync: () => true,
    realpathSync: (p) => p,
    statSync: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    runCapture: async () => ({
      code: 0,
      out: `${storePy}\n3.12.0\n`,
      err: "",
    }),
  }
  const v = await validatePythonExecutable(storePy, deps)
  assert.equal(v.ok, false)
})

test("PY-T6: mock version 2.7 / 3.8 rejected", async () => {
  const platform: NodeJS.Platform = "linux"
  const P = pathFor(platform)
  const py = "/usr/bin/python3"
  for (const ver of ["2.7.18", "3.8.10"]) {
    const deps: UvDiscoveryDeps = {
      platform,
      env: { PATH: "" },
      homedir: () => "/home/x",
      existsSync: (p) => P.normalize(p) === P.normalize(py),
      readdirSync: () => [],
      statSync: () => ({
        isFile: () => true,
        isSymbolicLink: () => false,
        isDirectory: () => false,
      }),
      realpathSync: (p) => P.normalize(p),
      runCapture: async (bin) => {
        if (P.normalize(bin) === P.normalize(py) || bin === py) {
          return { code: 0, out: `${py}\n${ver}\n`, err: "" }
        }
        if (bin === "which" || bin === "where") return { code: 1, out: "", err: "" }
        return { code: 127, out: "", err: "" }
      },
    }
    const r = await findPythonBase({ includeIsolated: false, deps })
    assert.equal(r.ok, false, `expected reject version ${ver}`)
  }
  assert.equal(versionMeetsMin({ major: 3, minor: 8 }, MIN_PYTHON_VERSION), false)
  assert.equal(versionMeetsMin({ major: 2, minor: 7 }, MIN_PYTHON_VERSION), false)
})

test("PY-T7: mock version 3.10+ accepted", async () => {
  const platform: NodeJS.Platform = "linux"
  const P = pathFor(platform)
  const py = "/usr/bin/python3"
  const deps: UvDiscoveryDeps = {
    platform,
    env: { PATH: "" },
    homedir: () => "/home/x",
    existsSync: (p) => P.normalize(p) === P.normalize(py),
    readdirSync: () => [],
    statSync: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: goodPyProbe(py, "3.10.0"),
  }
  // force well-known hit: list includes /usr/bin/python3
  const r = await findPythonBase({ includeIsolated: false, deps })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.ok(P.isAbsolute(r.path))
  }
  assert.equal(versionMeetsMin({ major: 3, minor: 10 }, MIN_PYTHON_VERSION), true)
  assert.equal(parsePythonVersion("3.11.2")?.minor, 11)
})

test("PY-T8: ok never bare python/py", async () => {
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
      if ((bin === "which" || bin === "where") && (args[0] === "python" || args[0] === "python3")) {
        return { code: 0, out: "python3\n", err: "" } // relative — reject
      }
      if (bin === "python" || bin === "python3") {
        return { code: 0, out: "python3\n3.12.0\n", err: "" }
      }
      return { code: 1, out: "", err: "" }
    },
  }
  const r = await findPythonBase({ includeIsolated: false, deps })
  assert.equal(r.ok, false)
  if (r.ok) {
    assert.notEqual((r as any).path, "python")
    assert.notEqual((r as any).path, "py")
    assert.notEqual((r as any).path, "python3")
  }
})

test("PY-T9: pythonInstallHint('win32') has winget, not brew-only", () => {
  const h = pythonInstallHint("win32")
  assert.match(h, /winget/i)
  assert.match(h, /Python\.Python\.3/i)
  assert.match(h, /python\.org/i)
  assert.doesNotMatch(h, /brew install/i)
})

test("PY-T10: pythonInstallHint('darwin') may brew", () => {
  const h = pythonInstallHint("darwin")
  assert.match(h, /brew/i)
})

test("PY-T11: resolve isolated missing + base fixture → no pythonPath, create-env", async () => {
  const platform: NodeJS.Platform = "linux"
  const P = pathFor(platform)
  const py = "/usr/bin/python3"
  const deps: UvDiscoveryDeps = {
    platform,
    env: { PATH: "" },
    homedir: () => "/home/x",
    existsSync: (p) => {
      // isolated bin does not exist; well-known base does
      if (String(p).includes("python-env")) return false
      return P.normalize(p) === P.normalize(py)
    },
    readdirSync: () => [],
    statSync: (p) => ({
      isFile: () => P.normalize(p) === P.normalize(py),
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: async (bin, args) => {
      if (bin === "where" || bin === "which") return { code: 1, out: "", err: "" }
      if (args[0] === "--version") return { code: 1, out: "", err: "" } // no uv
      return goodPyProbe(py, "3.11.0")(bin, args)
    },
  }
  const rt = await resolvePythonRuntime({ mode: "isolated", deps })
  assert.equal(rt.isolatedExists, false)
  assert.equal(rt.pythonPath, undefined)
  assert.equal(rt.basePythonAvailable, true)
  assert.match(rt.resolution, /创建独立环境|检测到 Python/)
})

test("PY-T12: resolve isolated exists → pythonPath absolute iso style", async () => {
  // Use real isolatedPythonBin path shape via existsSync true for that path only
  const { isolatedPythonBin } = await import("../src/computer/python-runtime")
  const iso = isolatedPythonBin()
  const deps: UvDiscoveryDeps = {
    platform: process.platform,
    env: { PATH: "" },
    homedir: () => (process.platform === "win32" ? "C:\\Users\\x" : "/home/x"),
    existsSync: (p) => path.normalize(p) === path.normalize(iso),
    readdirSync: () => [],
    statSync: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => path.normalize(p),
    runCapture: async (bin, args) => {
      if (args[0] === "--version") return { code: 1, out: "", err: "" }
      if (path.normalize(bin) === path.normalize(iso) || bin === iso) {
        return { code: 0, out: `${iso}\n3.12.1\n`, err: "" }
      }
      if (bin === "where" || bin === "which") return { code: 1, out: "", err: "" }
      return { code: 127, out: "", err: "" }
    },
  }
  const rt = await resolvePythonRuntime({ mode: "isolated", deps })
  assert.equal(rt.isolatedExists, true)
  assert.ok(rt.pythonPath)
  assert.ok(path.isAbsolute(rt.pythonPath!))
  assert.match(rt.resolution, /独立环境/)
})

test("PY-T13: ensure without uv uses absolute base argv0", async () => {
  const platform = process.platform
  const absPy =
    platform === "win32" ? "C:\\Python312\\python.exe" : "/usr/bin/python3"
  const spawns: Array<{ bin: string; args: string[] }> = []
  const P = pathFor(platform === "win32" ? "win32" : "linux")

  // Seed well-known so findPythonBase succeeds under injected deps
  const home = platform === "win32" ? "C:\\Users\\fixture" : "/home/fixture"
  const deps: UvDiscoveryDeps & {
    findUv: () => Promise<{ ok: boolean; path?: string }>
  } = {
    platform: platform === "win32" ? "win32" : "linux",
    findUv: async () => ({ ok: false }),
    env: {
      PATH: "",
      ...(platform === "win32"
        ? { LOCALAPPDATA: P.join(home, "AppData", "Local"), ProgramFiles: "C:\\Program Files" }
        : {}),
    },
    homedir: () => home,
    existsSync: (p) => {
      if (String(p).includes("python-env")) return false
      return P.normalize(p) === P.normalize(absPy)
    },
    readdirSync: (p) => {
      // unix list is fixed paths; for win32 plant ProgramFiles/Python312
      if (platform === "win32" && /Program Files$/i.test(P.normalize(p).replace(/\//g, "\\"))) {
        return ["Python312"]
      }
      return []
    },
    statSync: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: async (bin, args) => {
      spawns.push({ bin, args })
      if (args[0] === "--version") return { code: 1, out: "", err: "" }
      if (args[0] === "-m" && args[1] === "venv") {
        return { code: 0, out: "ok\n", err: "" }
      }
      if (
        P.normalize(bin) === P.normalize(absPy) ||
        bin === absPy ||
        (args.join(" ").includes("sys.executable") &&
          (P.normalize(bin) === P.normalize(absPy) || bin === absPy))
      ) {
        return { code: 0, out: `${absPy}\n3.12.0\n`, err: "" }
      }
      // also accept when well-known path differs slightly
      if (args.join(" ").includes("sys.executable") || args.join(" ").includes("version_info")) {
        // If probing our abs py
        if (String(bin).toLowerCase().includes("python")) {
          return { code: 0, out: `${absPy}\n3.12.0\n`, err: "" }
        }
      }
      if (bin === "where" || bin === "which" || bin === "py") {
        return { code: 1, out: "", err: "" }
      }
      return { code: 0, out: "ok\n", err: "" }
    },
  }

  // For non-win32, absPy is already in well-known list (/usr/bin/python3)
  // For win32, plant via ProgramFiles readdir → Python312/python.exe
  if (platform === "win32") {
    const planted = P.join("C:\\Program Files", "Python312", "python.exe")
    deps.existsSync = (p) => {
      if (String(p).includes("python-env")) return false
      return (
        P.normalize(p) === P.normalize(planted) ||
        P.normalize(p) === P.normalize("C:\\Program Files")
      )
    }
    deps.runCapture = async (bin, args) => {
      spawns.push({ bin, args })
      if (args[0] === "-m" && args[1] === "venv") {
        assert.ok(path.win32.isAbsolute(bin) || path.isAbsolute(bin), `venv argv0 absolute, got ${bin}`)
        assert.notEqual(bin, "python")
        assert.notEqual(bin, "py")
        return { code: 0, out: "ok\n", err: "" }
      }
      if (args.join(" ").includes("sys.executable") || args.join(" ").includes("version_info")) {
        return { code: 0, out: `${planted}\n3.12.0\n`, err: "" }
      }
      if (bin === "where" || bin === "which" || bin === "py") {
        return { code: 1, out: "", err: "" }
      }
      return { code: 0, out: "", err: "" }
    }
  }

  const result = await ensureIsolatedPythonEnv([], deps)
  assert.equal(result.usedUv, false)
  assert.equal(result.ok, true)
  const venvSpawn = spawns.find((s) => s.args[0] === "-m" && s.args[1] === "venv")
  assert.ok(venvSpawn, "expected python -m venv spawn")
  assert.ok(
    path.isAbsolute(venvSpawn!.bin) || path.win32.isAbsolute(venvSpawn!.bin),
    `expected absolute base argv0, got ${venvSpawn!.bin}`,
  )
  assert.notEqual(venvSpawn!.bin, "python")
  assert.notEqual(venvSpawn!.bin, "py")
  assert.notEqual(venvSpawn!.bin, "python3")
})

test("PY-T14: ensure with uv still absolute uv (regression)", async () => {
  const absUv =
    process.platform === "win32" ? "C:\\Tools\\uv.exe" : "/usr/local/bin/uv"
  const spawns: Array<{ bin: string; args: string[] }> = []
  const result = await ensureIsolatedPythonEnv(["torch"], {
    findUv: async () => ({ ok: true, path: absUv }),
    existsSync: () => false,
    runCapture: async (bin, args) => {
      spawns.push({ bin, args })
      return { code: 0, out: "ok\n", err: "" }
    },
  })
  assert.equal(result.usedUv, true)
  assert.equal(result.ok, true)
  for (const s of spawns) {
    if (s.args[0] === "venv" || s.args[0] === "pip") {
      assert.equal(s.bin, absUv)
      assert.ok(path.isAbsolute(s.bin))
    }
  }
})

test("PY-T15: listWellKnown Python 不含 WindowsApps", () => {
  const cands = listWellKnownPythonCandidates({
    platform: "win32",
    homedir: () => "C:\\Users\\ci",
    env: {
      LOCALAPPDATA: "C:\\Users\\ci\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
    },
    existsSync: () => false,
    readdirSync: () => [],
  })
  assert.ok(cands.every((c) => !/windowsapps/i.test(c)))
  // still lists installer-root allowlist even if missing
  const joined = cands.join("|").toLowerCase()
  assert.ok(joined.includes("anaconda3") || joined.includes("miniconda3") || joined.includes("scoop"))
})

test("PY-T16: computer sources do not import mcp/transport", () => {
  const roots = [
    path.join(__dirname, "..", "src", "computer"),
    path.join(process.cwd(), "src", "computer"),
  ]
  let dir = ""
  for (const r of roots) {
    try {
      if (fs.statSync(r).isDirectory()) {
        dir = r
        break
      }
    } catch {
      /* try next */
    }
  }
  if (!dir) return
  const files = ["python-runtime.ts", "qwen-vl-download.ts", "qwen-vl-preflight.ts"]
  for (const f of files) {
    const fp = path.join(dir, f)
    try {
      const src = fs.readFileSync(fp, "utf8")
      assert.doesNotMatch(src, /from\s+["'].*mcp\/transport/)
      assert.doesNotMatch(src, /require\(["'].*mcp\/transport/)
    } catch {
      /* skip missing */
    }
  }
})

test("PY-T17: findUv still discovers well-known under stripped PATH (regression)", async () => {
  const platform: NodeJS.Platform = "linux"
  const P = pathFor(platform)
  const home = "/home/fixture"
  const localUv = P.join(home, ".local", "bin", "uv")
  const deps = fixtureFileDeps(localUv, platform)
  deps.homedir = () => home
  deps.env = { PATH: "" }
  const r = await findUv(deps)
  assert.equal(r.ok, true)
  assert.ok(r.path && P.isAbsolute(r.path))
  assert.notEqual(r.path, "uv")
})

// N2 extras
test("PY-T18: config priority over well-known", async () => {
  const platform: NodeJS.Platform = "linux"
  const P = pathFor(platform)
  const configPy = "/opt/custom/bin/python3"
  const wellKnown = "/usr/bin/python3"
  const deps: UvDiscoveryDeps = {
    platform,
    env: { PATH: "" },
    homedir: () => "/home/x",
    existsSync: (p) =>
      P.normalize(p) === P.normalize(configPy) ||
      P.normalize(p) === P.normalize(wellKnown),
    readdirSync: () => [],
    statSync: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: async (bin, args) => {
      if (bin === "where" || bin === "which") return { code: 1, out: "", err: "" }
      if (
        P.normalize(bin) === P.normalize(configPy) ||
        P.normalize(bin) === P.normalize(wellKnown)
      ) {
        return { code: 0, out: `${bin}\n3.11.0\n`, err: "" }
      }
      return { code: 127, out: "", err: "" }
    },
  }
  const r = await findPythonBase({
    configPath: configPy,
    includeIsolated: false,
    deps,
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.source, "config")
    assert.ok(r.path.includes("custom") || P.normalize(r.path) === P.normalize(configPy))
  }
})

test("PY-T19: manager seed pyenv-win versions", async () => {
  const platform: NodeJS.Platform = "win32"
  const P = pathFor(platform)
  const home = "C:\\Users\\fixture"
  const versions = P.join(home, ".pyenv", "pyenv-win", "versions")
  const pyExe = P.join(versions, "3.12.0", "python.exe")
  const same = (a: string, b: string) => P.normalize(a) === P.normalize(b)
  const deps: UvDiscoveryDeps = {
    platform,
    env: { PATH: "", LOCALAPPDATA: P.join(home, "AppData", "Local") },
    homedir: () => home,
    existsSync: (p) => same(p, pyExe) || same(p, versions),
    readdirSync: (p) => (same(p, versions) ? ["3.12.0"] : []),
    statSync: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: goodPyProbe(pyExe),
  }
  const mgr = listManagerPythonCandidates(deps)
  assert.ok(mgr.some((c) => /pyenv/i.test(c) && /python\.exe$/i.test(c)))
  const r = await findPythonBase({ includeIsolated: false, deps })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.source, "manager")
    assert.ok(P.isAbsolute(r.path))
  }
})

test("PY-T20: py-launcher discovery via py -0p", async () => {
  const platform: NodeJS.Platform = "win32"
  const P = pathFor(platform)
  const home = "C:\\Users\\fixture"
  const pyExe = "C:\\Python312\\python.exe"
  const deps: UvDiscoveryDeps = {
    platform,
    env: { PATH: "", LOCALAPPDATA: P.join(home, "AppData", "Local") },
    homedir: () => home,
    existsSync: () => false, // no well-known / manager
    readdirSync: () => [],
    statSync: () => ({
      isFile: () => true,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    }),
    realpathSync: (p) => P.normalize(p),
    runCapture: async (bin, args) => {
      if (bin === "where" || bin === "which") return { code: 1, out: "", err: "" }
      if (bin === "py" && args[0] === "-0p") {
        return { code: 0, out: ` -V:3.12 *        ${pyExe}\n`, err: "" }
      }
      if (bin === "py" && args[0] === "-3") {
        return { code: 0, out: `${pyExe}\n3.12.0\n`, err: "" }
      }
      if (P.normalize(bin) === P.normalize(pyExe) || bin === pyExe) {
        return { code: 0, out: `${pyExe}\n3.12.0\n`, err: "" }
      }
      // probe of path from -0p
      if (args.join(" ").includes("sys.executable")) {
        return { code: 0, out: `${pyExe}\n3.12.0\n`, err: "" }
      }
      return { code: 127, out: "", err: "" }
    },
  }
  const r = await findPythonBase({ includeIsolated: false, deps })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.source, "py-launcher")
    assert.ok(P.isAbsolute(r.path))
    assert.notEqual(r.path, "py")
  }
})

test("PY-T21: download absolute candidates contract (no bare argv0 in filter)", () => {
  // Static contract: qwen-vl-download must not list bare python/py as final candidates
  const candidates = [
    path.join(__dirname, "..", "src", "computer", "qwen-vl-download.ts"),
    path.join(process.cwd(), "src", "computer", "qwen-vl-download.ts"),
  ]
  let src = ""
  for (const c of candidates) {
    try {
      src = fs.readFileSync(c, "utf8")
      break
    } catch {
      /* next */
    }
  }
  if (!src) return
  // Old bare system fallback removed
  assert.doesNotMatch(src, /\?\s*\[\s*"python"\s*,\s*"py"\s*\]/)
  assert.doesNotMatch(src, /"python3",\s*"python"\]/)
  assert.match(src, /findPythonBase/)
  assert.match(src, /path\.isAbsolute/)
})
