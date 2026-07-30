// PR-3: assertDownloadPathAllowed / isWithinRoot / getUserDownloadsDir matrix
// Plan §1.9 — pure functions, no Chrome.

import test from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import {
  getUserDownloadsDir,
  isWithinRoot,
  isUncOrDevicePath,
  assertDownloadPathAllowed,
  prepareBrowserDownloadParams,
  PathEscapeError,
  type PathSandboxFsOps,
} from "../src/path-sandbox.js"

const USER = process.platform === "win32" ? "C:\\Users\\test" : "/home/test"
const DOWNLOADS = path.join(USER, "Downloads")
const ROOTS = [DOWNLOADS]

function mockFs(opts: {
  exists?: Set<string> | string[]
  realpathMap?: Record<string, string>
}): PathSandboxFsOps {
  const exists = new Set(
    (opts.exists instanceof Set ? [...opts.exists] : opts.exists || []).map((p) =>
      path.resolve(p),
    ),
  )
  // Always treat roots and their parents as existing for default happy paths
  exists.add(path.resolve(DOWNLOADS))
  exists.add(path.resolve(USER))
  return {
    existsSync(p) {
      return exists.has(path.resolve(p))
    },
    realpathSync(p) {
      const key = path.resolve(p)
      if (opts.realpathMap?.[key]) return opts.realpathMap[key]
      if (opts.realpathMap?.[p]) return opts.realpathMap[p]
      return key
    },
  }
}

// --- getUserDownloadsDir ---

test("getUserDownloadsDir: win32 uses USERPROFILE/Downloads", () => {
  const d = getUserDownloadsDir("win32", { USERPROFILE: "C:\\Users\\alice" }, () => "Z:\\x")
  assert.equal(d, path.join("C:\\Users\\alice", "Downloads"))
})

test("getUserDownloadsDir: darwin/linux use homedir/Downloads", () => {
  const d = getUserDownloadsDir("darwin", {}, () => "/Users/bob")
  assert.equal(d, path.join("/Users/bob", "Downloads"))
  const l = getUserDownloadsDir("linux", {}, () => "/home/bob")
  assert.equal(l, path.join("/home/bob", "Downloads"))
})

// --- isWithinRoot ---

test("isWithinRoot: exact root ok", () => {
  assert.equal(isWithinRoot(DOWNLOADS, DOWNLOADS), true)
})

test("isWithinRoot: subdir ok", () => {
  assert.equal(isWithinRoot(path.join(DOWNLOADS, "sub"), DOWNLOADS), true)
})

test("isWithinRoot: sibling prefix rejected (Documents2 style)", () => {
  assert.equal(isWithinRoot(DOWNLOADS + "2", DOWNLOADS), false)
  assert.equal(isWithinRoot(DOWNLOADS + "-evil", DOWNLOADS), false)
})

test("isWithinRoot: parent escape rejected", () => {
  assert.equal(isWithinRoot(USER, DOWNLOADS), false)
  assert.equal(isWithinRoot(path.join(USER, "Windows"), DOWNLOADS), false)
})

test("isWithinRoot: case fold ok on win-style paths", () => {
  if (process.platform === "win32") {
    const upper = DOWNLOADS.toUpperCase()
    assert.equal(isWithinRoot(upper, DOWNLOADS), true)
  } else {
    // POSIX: folding still applied by our helper (lowercases both sides)
    const mixed = DOWNLOADS.replace("Downloads", "DOWNLOADS")
    assert.equal(isWithinRoot(mixed, DOWNLOADS), true)
  }
})

// --- UNC ---

test("isUncOrDevicePath: UNC rejected", () => {
  assert.equal(isUncOrDevicePath("\\\\evil\\share"), true)
  assert.equal(isUncOrDevicePath("//evil/share"), true)
})

// --- assertDownloadPathAllowed matrix ---

test("assertDownloadPathAllowed: default Downloads ok", () => {
  const fsOps = mockFs({})
  const r = assertDownloadPathAllowed(DOWNLOADS, ROOTS, fsOps)
  assert.equal(path.resolve(r).toLowerCase(), path.resolve(DOWNLOADS).toLowerCase())
})

test("assertDownloadPathAllowed: Downloads/sub existing ok", () => {
  const sub = path.join(DOWNLOADS, "sub")
  const fsOps = mockFs({ exists: [DOWNLOADS, sub] })
  const r = assertDownloadPathAllowed(sub, ROOTS, fsOps)
  assert.equal(path.resolve(r), path.resolve(sub))
})

test("assertDownloadPathAllowed: Downloads/sub nonexistent leaf uses dirname realpath", () => {
  const sub = path.join(DOWNLOADS, "newfile-dir")
  // parent Downloads exists; leaf does not
  const fsOps = mockFs({ exists: [DOWNLOADS] })
  const r = assertDownloadPathAllowed(sub, ROOTS, fsOps)
  assert.equal(path.resolve(r), path.resolve(sub))
})

test("assertDownloadPathAllowed: .. escape → PATH_ESCAPE", () => {
  const evil = path.join(DOWNLOADS, "..", "..", "Windows")
  const fsOps = mockFs({})
  assert.throws(
    () => assertDownloadPathAllowed(evil, ROOTS, fsOps),
    (e: unknown) => e instanceof PathEscapeError && e.code === "PATH_ESCAPE",
  )
})

test("assertDownloadPathAllowed: different drive rejected on win shape", () => {
  if (process.platform !== "win32") {
    // On POSIX, D:\... may resolve oddly; still must not be under DOWNLOADS
    const other = "/mnt/d/other"
    const fsOps = mockFs({})
    assert.throws(() => assertDownloadPathAllowed(other, ROOTS, fsOps), PathEscapeError)
    return
  }
  const other = "D:\\stuff"
  const fsOps = mockFs({})
  assert.throws(() => assertDownloadPathAllowed(other, ROOTS, fsOps), PathEscapeError)
})

test("assertDownloadPathAllowed: UNC → PATH_ESCAPE", () => {
  const fsOps = mockFs({})
  assert.throws(
    () => assertDownloadPathAllowed("\\\\evil\\share\\x", ROOTS, fsOps),
    PathEscapeError,
  )
})

test("assertDownloadPathAllowed: junction realpath escape → PATH_ESCAPE", () => {
  const sub = path.join(DOWNLOADS, "link")
  const outside = path.join(USER, "Outside")
  const fsOps = mockFs({
    exists: [DOWNLOADS, sub],
    realpathMap: {
      [path.resolve(sub)]: path.resolve(outside),
    },
  })
  assert.throws(() => assertDownloadPathAllowed(sub, ROOTS, fsOps), PathEscapeError)
})

// --- prepareBrowserDownloadParams ---

test("prepareBrowserDownloadParams: default path, text only", () => {
  const r = prepareBrowserDownloadParams({
    params: { tabId: 1, text: "下载" },
    isWorker: false,
    roots: ROOTS,
    fsOps: mockFs({}),
    platform: process.platform,
    env: process.platform === "win32" ? { USERPROFILE: USER } : {},
    homedir: () => USER,
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(path.resolve(r.downloadPath).toLowerCase(), path.resolve(DOWNLOADS).toLowerCase())
  assert.equal(r.params.timeoutMs, 60_000)
  assert.equal(r.params.text, "下载")
  // No raw path other than sandboxed
  assert.ok(!String(r.params.downloadPath).includes(".."))
})

test("prepareBrowserDownloadParams: malicious path never forwarded", () => {
  const evil = path.join(USER, "Windows")
  const r = prepareBrowserDownloadParams({
    params: { tabId: 1, selector: "a#dl", downloadPath: evil },
    isWorker: false,
    roots: ROOTS,
    fsOps: mockFs({}),
    platform: process.platform,
    homedir: () => USER,
    env: process.platform === "win32" ? { USERPROFILE: USER } : {},
  })
  assert.equal(r.ok, false)
  // Failure result must not include a success payload with params to forward
  assert.ok(!("params" in r), "PATH_ESCAPE must not include params for tool.execute")
  if (r.ok) return
  assert.equal(r.error_code, "PATH_ESCAPE")
  assert.match(r.error, /PATH_ESCAPE/)
})

test("prepareBrowserDownloadParams: ok path only forwards sandboxed downloadPath", () => {
  const safe = path.join(DOWNLOADS, "subdir")
  const r = prepareBrowserDownloadParams({
    params: { tabId: 1, selector: "a#dl", downloadPath: safe },
    isWorker: false,
    roots: ROOTS,
    fsOps: mockFs({ exists: [DOWNLOADS, safe] }),
    platform: process.platform,
    homedir: () => USER,
    env: process.platform === "win32" ? { USERPROFILE: USER } : {},
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(path.resolve(r.params.downloadPath), path.resolve(safe))
  assert.ok(!String(r.params.downloadPath).includes("Windows"))
  assert.ok(!String(r.params.downloadPath).includes(".."))
})

test("prepareBrowserDownloadParams: worker + custom path → WORKER_PATH_DENIED", () => {
  const evil = path.join(DOWNLOADS, "worker-only-nope-wait") // still under downloads —
  // workers denied ANY custom path that is not exactly default Downloads
  const custom = path.join(DOWNLOADS, "sub")
  const r = prepareBrowserDownloadParams({
    params: { tabId: 1, text: "下载", downloadPath: custom },
    isWorker: true,
    roots: ROOTS,
    fsOps: mockFs({ exists: [DOWNLOADS, custom] }),
    platform: process.platform,
    homedir: () => USER,
    env: process.platform === "win32" ? { USERPROFILE: USER } : {},
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error_code, "WORKER_PATH_DENIED")
  // payload must not be an ok-forward with the custom path
  assert.ok(!("params" in r && (r as any).params?.downloadPath === custom))
})

test("prepareBrowserDownloadParams: selector and text both empty → reject", () => {
  const r = prepareBrowserDownloadParams({
    params: { tabId: 1 },
    isWorker: false,
    roots: ROOTS,
    fsOps: mockFs({}),
    homedir: () => USER,
    env: process.platform === "win32" ? { USERPROFILE: USER } : {},
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.error_code, "SELECTOR_OR_TEXT_REQUIRED")
})

test("prepareBrowserDownloadParams: timeoutMs clamped to 120s max", () => {
  const r = prepareBrowserDownloadParams({
    params: { tabId: 1, text: "dl", timeoutMs: 999_999 },
    isWorker: false,
    roots: ROOTS,
    fsOps: mockFs({}),
    homedir: () => USER,
    env: process.platform === "win32" ? { USERPROFILE: USER } : {},
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.params.timeoutMs, 120_000)
})
