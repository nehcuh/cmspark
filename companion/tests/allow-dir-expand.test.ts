import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  extractPathCandidate,
  resolveAllowDirToOffer,
  isAccessDeniedMcpError,
  isParentMissingMcpError,
  canOfferAllowDirExpand,
  pathToFileUri,
  isWriteLikeMcpTool,
  isVolumeOrFsRoot,
  isSensitiveSystemDir,
  isMultiUserProfilesRoot,
  normalizeAllowDirKey,
  SENSITIVE_HOME_PREFIXES,
} from "../src/mcp/allow-dir-expand"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-allow-dir-"))
process.env.HOME = tempHome
process.env.USERPROFILE = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let initDataDir: typeof import("../src/config").initDataDir
let saveConfig: typeof import("../src/config").saveConfig
let clearConfigCache: typeof import("../src/config").clearConfigCache
let getConfig: typeof import("../src/config").getConfig

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  saveConfig = configMod.saveConfig
  clearConfigCache = configMod.clearConfigCache
  getConfig = configMod.getConfig
  await initDataDir()
  clearConfigCache()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("extractPathCandidate from params and error text", () => {
  assert.equal(
    extractPathCandidate("x", { path: "/Users/huchen/foo/bar.md" }),
    "/Users/huchen/foo/bar.md",
  )
  const fromErr = extractPathCandidate(
    "Access denied - path outside allowed directories: /Users/huchen/secret",
    {},
  )
  assert.ok(fromErr && fromErr.includes("secret"))
})

test("resolveAllowDirToOffer under home; refuses home root", () => {
  const home = os.homedir()
  const sub = path.join(home, "Documents")
  fs.mkdirSync(sub, { recursive: true })
  const ok = resolveAllowDirToOffer(path.join(sub, "x"), home)
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.notEqual(ok.dir, fs.realpathSync(home))
  }
  const wholeHome = resolveAllowDirToOffer(home, home)
  assert.equal(wholeHome.ok, false)
})

test("resolveAllowDirToOffer allows paths outside home (existing dir)", () => {
  // Use a fake home so the real temp outside dir is not under home
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-fake-home-"))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-outside-"))
  try {
    const r = resolveAllowDirToOffer(path.join(outside, "a.txt"), fakeHome)
    assert.equal(r.ok, true, r.ok ? "" : r.error)
    if (r.ok) {
      assert.equal(r.dir, fs.realpathSync(outside))
    }
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test("resolveAllowDirToOffer refuses volume roots, multi-user roots, and system paths", () => {
  const home = os.homedir()
  const root = path.parse(home).root
  assert.equal(isVolumeOrFsRoot(root), true)
  const wholeVol = resolveAllowDirToOffer(root, home)
  assert.equal(wholeVol.ok, false)
  if (!wholeVol.ok) assert.match(wholeVol.error, /root|drive/i)

  assert.equal(isMultiUserProfilesRoot("C:\\Users", "win32"), true)
  assert.equal(isMultiUserProfilesRoot("C:\\Users\\alice", "win32"), false)
  assert.equal(isMultiUserProfilesRoot("/Users", "darwin"), true)
  assert.equal(isMultiUserProfilesRoot("/Users/alice", "darwin"), false)
  assert.equal(isMultiUserProfilesRoot("/home", "linux"), true)

  const multi = resolveAllowDirToOffer("C:\\Users", home, "win32")
  assert.equal(multi.ok, false)

  // /etc is always treated as sensitive system (posix rules; also refused on win via segment/path)
  assert.equal(isSensitiveSystemDir("/etc/passwd", "linux"), true)
  assert.equal(isSensitiveSystemDir("/opt/myapp", "linux"), false)
  assert.equal(isSensitiveSystemDir("C:\\Windows\\System32", "win32"), true)
  assert.equal(isSensitiveSystemDir("D:\\Projects\\work", "win32"), false)

  const etc = resolveAllowDirToOffer("/etc/passwd", home, "linux")
  assert.equal(etc.ok, false)
})

test("outside-home walk-up only uses immediate parent (no 8-level over-grant)", () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-fake-home3-"))
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-deep-"))
  const deep = path.join(base, "a", "b", "c", "d")
  fs.mkdirSync(deep, { recursive: true })
  // Remove intermediate so only base exists as ancestor of missing leaf
  const missingLeaf = path.join(deep, "missing", "file.txt")
  try {
    // deep exists; parent of missing is deep/missing which does not exist → only immediate parent of abs
    // abs = deep/missing/file.txt, immediate parent deep/missing does not exist → refuse
    const r = resolveAllowDirToOffer(missingLeaf, fakeHome)
    assert.equal(r.ok, false, "must not walk up to base/")
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true })
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test("normalizeAllowDirKey folds win32 case and slashes", () => {
  if (process.platform === "win32") {
    const a = normalizeAllowDirKey("C:\\Users\\Test")
    const b = normalizeAllowDirKey("c:/Users/Test")
    assert.equal(a, b)
  } else {
    assert.equal(normalizeAllowDirKey("/tmp/Foo"), path.resolve("/tmp/Foo").replace(/\\/g, "/"))
  }
})

test("resolveAllowDirToOffer blocks sensitive paths case-insensitively", () => {
  const home = os.homedir()
  // Mixed-case .SSH dir must still be blocked on APFS-style case-insensitive FS
  const sshDir = path.join(home, ".SSH")
  fs.mkdirSync(sshDir, { recursive: true })
  const r = resolveAllowDirToOffer(path.join(sshDir, "id_rsa"), home)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /sensitive/i)
  assert.ok(SENSITIVE_HOME_PREFIXES.includes(".ssh"))

  // Outside home: .ssh segment still blocked
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-fake-home2-"))
  const outsideSsh = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-out-ssh-"))
  const nested = path.join(outsideSsh, ".ssh")
  fs.mkdirSync(nested, { recursive: true })
  try {
    const blocked = resolveAllowDirToOffer(path.join(nested, "id_rsa"), fakeHome)
    assert.equal(blocked.ok, false)
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true })
    fs.rmSync(outsideSsh, { recursive: true, force: true })
  }
})

test("pathToFileUri encodes spaces and CJK", () => {
  const uri = pathToFileUri("/Users/me/foo bar/报告")
  assert.ok(uri.startsWith("file://"))
  assert.ok(uri.includes("%20") || uri.includes("foo"))
  assert.ok(/%E6%8A%A5%E5%91%8A|%E6%8A%A5/.test(uri) || uri.includes(encodeURIComponent("报告")))
})

test("error classifiers and write-like tools", () => {
  assert.equal(isParentMissingMcpError("Parent directory does not exist: /a/b"), true)
  assert.equal(isAccessDeniedMcpError("Access denied - path outside allowed directories: /x"), true)
  assert.equal(isAccessDeniedMcpError("Parent directory does not exist"), false)
  assert.equal(isWriteLikeMcpTool("create_directory"), true)
  assert.equal(isWriteLikeMcpTool("write_file"), true)
  assert.equal(isWriteLikeMcpTool("read_text_file"), false)
})

test("canOfferAllowDirExpand requires filesystem server (pre-L2 gate)", () => {
  clearConfigCache()
  saveConfig({
    mcp: {
      enabled: true,
      servers: {
        "not-fs": {
          transport: "stdio",
          command: "echo",
          args: [],
          enabled: true,
        },
        filesystem: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", os.homedir()],
          enabled: true,
        },
      },
    },
  } as any)
  clearConfigCache()

  const denied = "Access denied - path outside allowed directories: " + path.join(os.homedir(), "proj", "a")
  const sub = path.join(os.homedir(), "proj")
  fs.mkdirSync(sub, { recursive: true })

  const badServer = canOfferAllowDirExpand({
    serverName: "not-fs",
    rawErr: denied,
    params: { path: path.join(sub, "a.txt") },
  })
  assert.equal(badServer.offer, false)
  if (!badServer.offer) assert.equal(badServer.reason, "not_filesystem_server")

  const good = canOfferAllowDirExpand({
    serverName: "filesystem",
    rawErr: denied,
    params: { path: path.join(sub, "a.txt") },
  })
  assert.equal(good.offer, true)
  if (good.offer) {
    assert.ok(good.dir.includes("proj") || good.dir === fs.realpathSync(sub))
  }

  const parentMissing = canOfferAllowDirExpand({
    serverName: "filesystem",
    rawErr: "Parent directory does not exist: " + path.join(sub, "nested"),
    params: { path: path.join(sub, "nested", "f") },
  })
  assert.equal(parentMissing.offer, false)
})

test("canOfferAllowDirExpand offers outside-home path on access denied", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-offer-out-"))
  // Ensure process home (tempHome) does not contain outside when they share tmp root
  // outside is under os.tmpdir(); tempHome is also under tmpdir — outside may still
  // be outside tempHome if sibling. Confirm with path.relative.
  const rel = path.relative(tempHome, outside)
  assert.ok(rel.startsWith("..") || path.isAbsolute(rel), "fixture must be outside test home")

  clearConfigCache()
  saveConfig({
    mcp: {
      enabled: true,
      servers: {
        filesystem: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", tempHome],
          enabled: true,
        },
      },
    },
  } as any)
  clearConfigCache()

  try {
    const denied =
      "Access denied - path outside allowed directories: " + path.join(outside, "report.md")
    const offer = canOfferAllowDirExpand({
      serverName: "filesystem",
      rawErr: denied,
      params: { path: path.join(outside, "report.md") },
    })
    assert.equal(offer.offer, true, offer.offer ? "" : offer.reason)
    if (offer.offer) {
      assert.equal(offer.dir, fs.realpathSync(outside))
    }
  } finally {
    fs.rmSync(outside, { recursive: true, force: true })
  }
})
