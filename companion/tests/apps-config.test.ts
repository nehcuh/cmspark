// Tests for companion/src/apps/types.ts (WP1 data layer) and its config.ts
// integration. Mirrors tests/config.test.ts: temp CMSPARK_DATA_DIR pinned before
// the (dynamic) config import, node:test via tsconfig.test.json.

import test, { before, after, describe } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import {
  validateAppEntry,
  normalizeAppEntry,
  maxPolicyForEntry,
  sanitizeAppEntries,
  isUserWritablePath,
  type AppEntry,
} from "../src/apps/types"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-apps-config-"))

let getConfig: typeof import("../src/config").getConfig
let saveConfig: typeof import("../src/config").saveConfig
let initDataDir: typeof import("../src/config").initDataDir
let clearConfigCache: typeof import("../src/config").clearConfigCache
let replaceAppsEntries: typeof import("../src/config").replaceAppsEntries

async function resetConfigFile() {
  clearConfigCache()
  for (const f of fs.readdirSync(tempHome)) {
    if (f === "config.json" || f.startsWith("config.json.corrupt-") || f.includes(".tmp-")) {
      try { fs.rmSync(path.join(tempHome, f)) } catch { /* ignore */ }
    }
  }
  await initDataDir()
  clearConfigCache()
}

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = tempHome
  delete process.env.DEEPSEEK_API_KEY

  const cfg = await import("../src/config")
  getConfig = cfg.getConfig
  saveConfig = cfg.saveConfig
  initDataDir = cfg.initDataDir
  clearConfigCache = cfg.clearConfigCache
  replaceAppsEntries = cfg.replaceAppsEntries

  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function readSavedConfig(): any {
  const configPath = path.join(tempHome, "config.json")
  return JSON.parse(fs.readFileSync(configPath, "utf-8"))
}

/** Capture console.error lines emitted while fn runs (loud-log assertions). */
function captureConsoleError<T>(fn: () => T): { result: T; lines: string[] } {
  const lines: string[] = []
  const orig = console.error
  console.error = (...args: any[]) => { lines.push(args.map(a => String(a)).join(" ")) }
  try {
    return { result: fn(), lines }
  } finally {
    console.error = orig
  }
}

// --- entry factories -------------------------------------------------------

function guiExeEntry(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    token: "win.app.notepad",
    kind: "gui",
    display_name: "Notepad",
    source: "user",
    policy: "manual",
    enabled: true,
    added_at: "2026-07-18T10:00:00.000Z",
    exe: {
      path: "C:\\Program Files\\Notepad\\notepad.exe",
      signer: "CN=Contoso, O=Contoso, C=US",
      user_writable_dir: false,
    },
    ...overrides,
  }
}

function guiAumidEntry(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    token: "win.app.calculator",
    kind: "gui",
    display_name: "Calculator",
    source: "preset",
    policy: "manual",
    enabled: true,
    added_at: "2026-07-18T10:00:00.000Z",
    aumid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
    ...overrides,
  }
}

function cliEntry(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    token: "win.cli.ffmpeg",
    kind: "cli",
    display_name: "ffmpeg",
    source: "user",
    policy: "manual",
    enabled: true,
    added_at: "2026-07-18T10:00:00.000Z",
    exe: {
      path: "C:\\tools\\ffmpeg\\bin\\ffmpeg.exe",
      signer: "CN=Contoso, O=Contoso, C=US",
      user_writable_dir: false,
    },
    cli_manifest: {},
    ...overrides,
  }
}

// --- validateAppEntry: schema accept/reject matrix --------------------------

describe("validateAppEntry schema matrix", { concurrency: 1 }, () => {
  test("accepts a valid gui exe entry", () => {
    assert.equal(validateAppEntry(guiExeEntry()), null)
  })

  test("accepts a valid gui aumid entry", () => {
    assert.equal(validateAppEntry(guiAumidEntry()), null)
  })

  test("accepts a valid cli entry with empty-object cli_manifest placeholder", () => {
    assert.equal(validateAppEntry(cliEntry()), null)
    assert.equal(validateAppEntry(cliEntry({ cli_manifest: null })), null)
  })

  test("accepts exe.sha256 and empty templates array", () => {
    const e = guiExeEntry()
    ;(e.exe as any).sha256 = "a".repeat(64)
    e.templates = []
    assert.equal(validateAppEntry(e), null)
  })

  test("accepts unknown policy VALUES (coerced to manual by normalize, not rejected)", () => {
    assert.equal(validateAppEntry(guiExeEntry({ policy: "godmode" })), null)
  })

  test("rejects non-object entries", () => {
    assert.ok(validateAppEntry(null) !== null)
    assert.ok(validateAppEntry("win.app.notepad") !== null)
    assert.ok(validateAppEntry([guiExeEntry()]) !== null)
    assert.ok(validateAppEntry(42) !== null)
  })

  test("rejects bad tokens", () => {
    for (const token of [
      "win.app.Notepad", // uppercase
      "win.app.a", // slug too short (min 2 chars)
      `win.app.${"a".repeat(33)}`, // slug too long (max 32)
      "win.foo.notepad", // namespace must be app|cli
      "app.notepad", // missing win. prefix
      "win.app.", // empty slug
      "win.app.note pad", // space
      123,
      undefined,
    ]) {
      assert.ok(validateAppEntry(guiExeEntry({ token })) !== null, `token ${token} must be rejected`)
    }
  })

  test("rejects invalid kind and token/kind namespace mismatch", () => {
    assert.ok(validateAppEntry(guiExeEntry({ kind: "GUI" })) !== null)
    assert.ok(validateAppEntry(cliEntry({ kind: "gui" })) !== null, "win.cli.* token with kind gui")
    assert.ok(validateAppEntry(guiExeEntry({ kind: "cli" })) !== null, "win.app.* token with kind cli")
  })

  test("rejects bad display_name / source / enabled / added_at", () => {
    assert.ok(validateAppEntry(guiExeEntry({ display_name: "" })) !== null)
    assert.ok(validateAppEntry(guiExeEntry({ display_name: 5 })) !== null)
    assert.ok(validateAppEntry(guiExeEntry({ source: "gallery" })) !== null)
    assert.ok(validateAppEntry(guiExeEntry({ enabled: "yes" })) !== null)
    assert.ok(validateAppEntry(guiExeEntry({ added_at: "" })) !== null)
    const noAddedAt = guiExeEntry()
    delete noAddedAt.added_at
    assert.ok(validateAppEntry(noAddedAt) !== null)
  })

  test("rejects missing policy (non-string), unlike unknown policy string", () => {
    const noPolicy = guiExeEntry()
    delete noPolicy.policy
    assert.ok(validateAppEntry(noPolicy) !== null)
    assert.ok(validateAppEntry(guiExeEntry({ policy: 3 })) !== null)
  })

  test("gui requires at least one of exe / aumid / bundleId", () => {
    const both = guiExeEntry({ aumid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" })
    // Both exe + aumid is allowed (macOS WP3: 3 identifiers coexist)
    assert.equal(validateAppEntry(both), null, "exe + aumid should be allowed")
    const neither = guiExeEntry()
    delete neither.exe
    assert.ok(validateAppEntry(neither) !== null, "neither exe nor aumid nor bundleId must be rejected")
    // macOS bundleId-only entry should be accepted
    const macOnly = guiExeEntry({ token: "mac.app.notes", kind: "gui", bundleId: "com.apple.Notes" })
    delete macOnly.exe
    assert.equal(validateAppEntry(macOnly), null, "bundleId-only macOS entry should be accepted")
  })

  test("cli requires exe and forbids aumid", () => {
    const noExe = cliEntry()
    delete noExe.exe
    assert.ok(validateAppEntry(noExe) !== null)
    assert.ok(validateAppEntry(cliEntry({ aumid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" })) !== null)
  })

  test("rejects malformed exe block", () => {
    const noPath = guiExeEntry()
    ;(noPath.exe as any).path = ""
    assert.ok(validateAppEntry(noPath) !== null)
    const noWritable = guiExeEntry()
    delete (noWritable.exe as any).user_writable_dir
    assert.ok(validateAppEntry(noWritable) !== null)
    const badSigner = guiExeEntry()
    ;(badSigner.exe as any).signer = 42
    assert.ok(validateAppEntry(badSigner) !== null)
    const badSha = guiExeEntry()
    ;(badSha.exe as any).sha256 = 42
    assert.ok(validateAppEntry(badSha) !== null)
    const arrayExe = guiExeEntry({ exe: ["C:\\x.exe"] })
    assert.ok(validateAppEntry(arrayExe) !== null)
  })

  test("rejects malformed aumid (D11)", () => {
    assert.ok(validateAppEntry(guiAumidEntry({ aumid: "no-bang-here" })) !== null)
    assert.ok(validateAppEntry(guiAumidEntry({ aumid: "" })) !== null)
    assert.ok(validateAppEntry(guiAumidEntry({ aumid: 42 })) !== null)
  })

  test("rejects non-empty templates (Phase-2 per D12) and non-array templates", () => {
    assert.ok(validateAppEntry(guiExeEntry({ templates: [{ name: "t" }] })) !== null)
    assert.ok(validateAppEntry(guiExeEntry({ templates: "nope" })) !== null)
  })

  test("rejects non-object cli_manifest", () => {
    assert.ok(validateAppEntry(cliEntry({ cli_manifest: [1, 2] })) !== null)
    assert.ok(validateAppEntry(cliEntry({ cli_manifest: "nope" })) !== null)
  })
})

// --- prototype pollution ----------------------------------------------------

describe("apps prototype-pollution defense", { concurrency: 1 }, () => {
  test("nested __proto__ key inside entry is rejected (validateAppEntry)", () => {
    const raw = JSON.parse(
      '{"token":"win.app.notepad","kind":"gui","display_name":"Notepad","source":"user","policy":"manual","enabled":true,"added_at":"2026-07-18T10:00:00.000Z","exe":{"path":"C:\\\\x.exe","user_writable_dir":false,"__proto__":{"polluted":true}}}',
    )
    assert.ok(validateAppEntry(raw) !== null)
    assert.equal(({} as any).polluted, undefined, "Object.prototype must not be polluted")
  })

  test("constructor/prototype keys inside entry are rejected", () => {
    const raw = JSON.parse(
      '{"token":"win.app.notepad","kind":"gui","display_name":"Notepad","source":"user","policy":"manual","enabled":true,"added_at":"2026-07-18T10:00:00.000Z","constructor":{"polluted":true},"exe":{"path":"C:\\\\x.exe","user_writable_dir":false}}',
    )
    assert.ok(validateAppEntry(raw) !== null)
  })

  test("pollution keys in the entries MAP are dropped with a loud log (sanitizeAppEntries)", () => {
    const entries = JSON.parse(
      `{"__proto__":{"polluted":true},"constructor":{"polluted":true},"win.app.notepad":${JSON.stringify(guiExeEntry())}}`,
    )
    const { result, lines } = captureConsoleError(() => sanitizeAppEntries(entries))
    assert.equal(Object.hasOwn(result, "__proto__"), false)
    assert.equal(Object.hasOwn(result, "constructor"), false)
    assert.equal(({} as any).polluted, undefined)
    assert.ok(result["win.app.notepad"], "legit entry must survive")
    assert.ok(lines.some(l => l.includes("prototype-pollution key")), "drop must be loudly logged")
  })
})

// --- policy cap + normalization (Owner decision 3) --------------------------

describe("maxPolicyForEntry / normalizeAppEntry policy cap", { concurrency: 1 }, () => {
  test("signed exe outside user-writable dirs keeps cap auto", () => {
    assert.equal(maxPolicyForEntry(guiExeEntry() as AppEntry), "auto")
  })

  test("user-writable exe caps at ai; unsigned caps at ai; aumid caps at ai", () => {
    const writable = guiExeEntry()
    ;(writable.exe as any).user_writable_dir = true
    assert.equal(maxPolicyForEntry(writable as AppEntry), "ai")

    const unsigned = guiExeEntry()
    delete (unsigned.exe as any).signer
    assert.equal(maxPolicyForEntry(unsigned as AppEntry), "ai")

    const emptySigner = guiExeEntry()
    ;(emptySigner.exe as any).signer = ""
    assert.equal(maxPolicyForEntry(emptySigner as AppEntry), "ai")

    assert.equal(maxPolicyForEntry(guiAumidEntry() as AppEntry), "ai", "aumid: no signer on record")
  })

  // WP2 review W4 — a signed exe on a network share is replaceable by anyone
  // with write access to the share; it must never be auto-eligible.
  test("W4: UNC exe path caps at ai (signed or not, either slash style)", () => {
    const uncSigned = guiExeEntry({ policy: "auto" })
    ;(uncSigned.exe as any).path = "\\\\fileserver\\tools\\signed.exe"
    assert.equal(maxPolicyForEntry(uncSigned as AppEntry), "ai")

    const uncFwd = guiExeEntry({ policy: "auto" })
    ;(uncFwd.exe as any).path = "//fileserver/tools/signed.exe"
    assert.equal(maxPolicyForEntry(uncFwd as AppEntry), "ai")

    // normalizeAppEntry clamps a persisted auto UNC entry with a loud log.
    const clamped = captureConsoleError(() => normalizeAppEntry(uncSigned as AppEntry))
    assert.equal(clamped.result.policy, "ai")
    assert.ok(clamped.lines.some(l => l.includes("exceeds cap") && l.includes("clamped")))
  })

  test("unknown policy value coerces to manual + loud log", () => {
    const e = guiExeEntry({ policy: "godmode" }) as AppEntry
    const { result, lines } = captureConsoleError(() => normalizeAppEntry(e))
    assert.equal(result.policy, "manual")
    assert.ok(lines.some(l => l.includes("unknown policy") && l.includes("win.app.notepad")))
  })

  test("auto clamps to ai on user-writable exe (loud log); ai stays ai; manual stays manual", () => {
    const writableAuto = guiExeEntry({ policy: "auto" })
    ;(writableAuto.exe as any).user_writable_dir = true
    const clamped = captureConsoleError(() => normalizeAppEntry(writableAuto as AppEntry))
    assert.equal(clamped.result.policy, "ai")
    assert.ok(clamped.lines.some(l => l.includes("exceeds cap") && l.includes("clamped")))

    const writableAi = guiExeEntry({ policy: "ai" })
    ;(writableAi.exe as any).user_writable_dir = true
    const aiRun = captureConsoleError(() => normalizeAppEntry(writableAi as AppEntry))
    assert.equal(aiRun.result.policy, "ai")
    assert.equal(aiRun.lines.length, 0, "ai within cap must not log")

    const writableManual = guiExeEntry({ policy: "manual" })
    ;(writableManual.exe as any).user_writable_dir = true
    const manualRun = captureConsoleError(() => normalizeAppEntry(writableManual as AppEntry))
    assert.equal(manualRun.result.policy, "manual")
    assert.equal(manualRun.lines.length, 0, "manual within cap must not log")
  })

  test("auto clamps to ai on unsigned exe", () => {
    const unsignedAuto = guiExeEntry({ policy: "auto" })
    delete (unsignedAuto.exe as any).signer
    const { result, lines } = captureConsoleError(() => normalizeAppEntry(unsignedAuto as AppEntry))
    assert.equal(result.policy, "ai")
    assert.ok(lines.some(l => l.includes("exceeds cap")))
  })

  test("signed non-user-writable auto entry is returned unchanged (no clamp, no log)", () => {
    const e = guiExeEntry({ policy: "auto" }) as AppEntry
    const { result, lines } = captureConsoleError(() => normalizeAppEntry(e))
    assert.equal(result.policy, "auto")
    assert.equal(result, e, "already-normalized entry must be returned by identity")
    assert.equal(lines.length, 0)
  })
})

// --- isUserWritablePath boundary cases (A2 formula) --------------------------

describe("isUserWritablePath", { concurrency: 1 }, () => {
  const saved: Record<string, string | undefined> = {}
  let tmpRoot: string
  let localDir: string
  let roamingDir: string
  let userDir: string

  before(() => {
    // The three roots must be SIBLINGS so sibling-prefix cases are not
    // accidentally under another root (e.g. real %LOCALAPPDATA%-evil would be
    // under %APPDATA% on a stock machine).
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-apps-uwp-"))
    localDir = path.join(tmpRoot, "local")
    roamingDir = path.join(tmpRoot, "roaming")
    userDir = path.join(tmpRoot, "user")
    for (const k of ["LOCALAPPDATA", "APPDATA", "USERPROFILE"]) saved[k] = process.env[k]
    process.env.LOCALAPPDATA = localDir
    process.env.APPDATA = roamingDir
    process.env.USERPROFILE = userDir
  })

  after(() => {
    for (const k of ["LOCALAPPDATA", "APPDATA", "USERPROFILE"]) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  test("paths under %LOCALAPPDATA% / %APPDATA% / %USERPROFILE% are user-writable", () => {
    assert.equal(isUserWritablePath(path.join(localDir, "x", "app.exe")), true)
    assert.equal(isUserWritablePath(path.join(roamingDir, "x")), true)
    assert.equal(isUserWritablePath(path.join(userDir, "Documents", "x.exe")), true)
    assert.equal(isUserWritablePath(localDir), true, "the root itself counts (exact match)")
  })

  test("paths outside the roots are not user-writable", () => {
    assert.equal(isUserWritablePath("C:\\Program Files\\x\\app.exe"), false)
    assert.equal(isUserWritablePath("C:\\Windows\\System32\\x.exe"), false)
  })

  test("sibling prefix (%LOCALAPPDATA%-evil) is NOT under the root (A2 boundary)", () => {
    assert.equal(isUserWritablePath(path.join(tmpRoot, "local-evil", "x.exe")), false)
    assert.equal(isUserWritablePath(tmpRoot + path.sep + "local2"), false)
  })

  test("comparison is case-insensitive (NTFS)", () => {
    assert.equal(isUserWritablePath(localDir.toUpperCase() + "\\X"), true)
    assert.equal(isUserWritablePath(path.join(roamingDir, "X").toUpperCase()), true)
  })

  test("'..' segments are resolved before comparison", () => {
    // %LOCALAPPDATA%\.. escapes the root entirely → false
    assert.equal(isUserWritablePath(path.join(localDir, "..")), false)
    // %LOCALAPPDATA%\..\roaming\x lands under %APPDATA% → true
    assert.equal(isUserWritablePath(path.join(localDir, "..", "roaming", "x")), true)
    // %USERPROFILE%\..\..\outside\x escapes every root → false
    assert.equal(isUserWritablePath(path.join(userDir, "..", "..", "outside", "x")), false)
  })

  test("empty / non-string input is not user-writable", () => {
    assert.equal(isUserWritablePath(""), false)
    assert.equal(isUserWritablePath(undefined as any), false)
  })
})

// --- config.ts integration --------------------------------------------------

describe("apps config integration", { concurrency: 1 }, () => {
  before(async () => {
    delete process.env.DEEPSEEK_API_KEY
    await resetConfigFile()
  })

  test("fresh config gets apps defaults { enabled: true, entries: {} }", async () => {
    await resetConfigFile()
    assert.deepEqual(getConfig().apps, { enabled: true, entries: {} })
  })

  test("older config.json without an apps block loads with defaults", async () => {
    await resetConfigFile()
    fs.writeFileSync(path.join(tempHome, "config.json"), JSON.stringify({ port: 23499 }), "utf-8")
    clearConfigCache()
    const cfg = getConfig()
    assert.equal(cfg.port, 23499, "existing fields must survive the merge")
    assert.deepEqual(cfg.apps, { enabled: true, entries: {} })
  })

  test("replaceAppsEntries round-trips entries through disk + reload", async () => {
    await resetConfigFile()
    const entries: Record<string, AppEntry> = {
      "win.app.notepad": guiExeEntry({ policy: "auto" }) as AppEntry,
      "win.cli.ffmpeg": cliEntry({ policy: "ai" }) as AppEntry,
    }
    replaceAppsEntries(entries)

    const onDisk = readSavedConfig()
    assert.equal(onDisk.apps.enabled, true)
    assert.equal(onDisk.apps.entries["win.app.notepad"].policy, "auto")
    assert.equal(onDisk.apps.entries["win.cli.ffmpeg"].exe.path, "C:\\tools\\ffmpeg\\bin\\ffmpeg.exe")

    clearConfigCache()
    const cfg = getConfig()
    assert.equal(cfg.apps?.entries["win.app.notepad"].display_name, "Notepad")
    assert.equal(cfg.apps?.entries["win.app.notepad"].policy, "auto", "signed non-writable keeps auto after reload")
    assert.equal(cfg.apps?.entries["win.cli.ffmpeg"].policy, "ai")
  })

  test("replaceAppsEntries is a wholesale swap — removed entries disappear", async () => {
    await resetConfigFile()
    replaceAppsEntries({
      "win.app.notepad": guiExeEntry() as AppEntry,
      "win.cli.ffmpeg": cliEntry() as AppEntry,
    })
    replaceAppsEntries({ "win.app.notepad": guiExeEntry() as AppEntry })
    clearConfigCache()
    const cfg = getConfig()
    assert.deepEqual(Object.keys(cfg.apps?.entries ?? {}), ["win.app.notepad"])
    assert.deepEqual(Object.keys(readSavedConfig().apps.entries), ["win.app.notepad"], "disk must match (no stale entries)")
  })

  test("replaceAppsEntries preserves the apps.enabled flag", async () => {
    await resetConfigFile()
    saveConfig({ apps: { enabled: false } } as any)
    assert.equal(getConfig().apps?.enabled, false)
    replaceAppsEntries({ "win.app.notepad": guiExeEntry() as AppEntry })
    assert.equal(getConfig().apps?.enabled, false)
    assert.equal(readSavedConfig().apps.enabled, false)
  })

  test("corrupt / tampered entries never crash config load", async () => {
    await resetConfigFile()
    const configPath = path.join(tempHome, "config.json")
    const base = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    const writableUnsigned = guiExeEntry({ token: "win.app.writable", policy: "auto" })
    ;(writableUnsigned.exe as any).user_writable_dir = true
    delete (writableUnsigned.exe as any).signer
    base.apps = {
      enabled: true,
      entries: {
        "win.app.good": guiExeEntry({ token: "win.app.good", policy: "auto" }),
        "win.app.badpolicy": guiExeEntry({ token: "win.app.badpolicy", policy: "godmode" }),
        "win.app.writable": writableUnsigned,
        "win.app.broken": { token: "NOT A TOKEN", enabled: true },
        "win.app.mismatch": guiExeEntry({ token: "win.app.other" }),
        "not-even-an-object": "garbage",
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(base), "utf-8")
    clearConfigCache()

    const { result: cfg, lines } = captureConsoleError(() => getConfig())
    const entries = cfg.apps?.entries ?? {}
    assert.equal(entries["win.app.good"]?.policy, "auto", "signed non-writable keeps auto")
    assert.equal(entries["win.app.badpolicy"]?.policy, "manual", "unknown policy coerced to manual")
    assert.equal(entries["win.app.writable"]?.policy, "ai", "unsigned + user-writable auto clamped to ai")
    assert.equal(entries["win.app.broken"]?.enabled, false, "schema failure → entry disabled, not crash")
    assert.equal(entries["win.app.mismatch"]?.enabled, false, "key/token mismatch → entry disabled")
    assert.equal("not-even-an-object" in entries, false, "non-object entry dropped")
    assert.ok(lines.some(l => l.includes("unknown policy") && l.includes("coercing")))
    assert.ok(lines.some(l => l.includes("exceeds cap") && l.includes("clamped")))
    assert.ok(lines.some(l => l.includes("failed validation") && l.includes("disabled")))
    assert.ok(lines.some(l => l.includes("does not match")))
  })

  test("non-object apps.entries (e.g. an array) resets to {} without crashing", async () => {
    await resetConfigFile()
    const configPath = path.join(tempHome, "config.json")
    const base = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    base.apps = { enabled: true, entries: [1, 2, 3] }
    fs.writeFileSync(configPath, JSON.stringify(base), "utf-8")
    clearConfigCache()

    const { result: cfg, lines } = captureConsoleError(() => getConfig())
    assert.deepEqual(cfg.apps?.entries, {})
    assert.equal(cfg.apps?.enabled, true)
    assert.ok(lines.some(l => l.includes("apps.entries is not an object")))
  })

  test("pollution keys in a hand-edited config's entries map are dropped at load", async () => {
    await resetConfigFile()
    const configPath = path.join(tempHome, "config.json")
    const base = fs.readFileSync(configPath, "utf-8")
    const parsed = JSON.parse(base)
    parsed.apps = {
      enabled: true,
      entries: JSON.parse(
        `{"__proto__":{"polluted":true},"win.app.notepad":${JSON.stringify(guiExeEntry())}}`,
      ),
    }
    fs.writeFileSync(configPath, JSON.stringify(parsed), "utf-8")
    clearConfigCache()

    const { result: cfg } = captureConsoleError(() => getConfig())
    assert.equal(({} as any).polluted, undefined, "Object.prototype must not be polluted")
    assert.equal(Object.hasOwn(cfg.apps?.entries ?? {}, "__proto__"), false)
    assert.ok(cfg.apps?.entries["win.app.notepad"], "legit entry must survive")
    // Note: on the config-load path the pollution key is stripped by config.ts's
    // deepMerge L1 guard BEFORE sanitizeAppEntries runs (double-layer defense), so
    // no sanitize-side loud log fires here. The loud log is asserted in the direct
    // sanitizeAppEntries unit test above.
  })
})
