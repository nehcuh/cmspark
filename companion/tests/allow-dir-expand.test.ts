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
  SENSITIVE_HOME_PREFIXES,
} from "../src/mcp/allow-dir-expand"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-allow-dir-"))
process.env.HOME = tempHome
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

test("resolveAllowDirToOffer only under home; refuses home root", () => {
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
  const bad = resolveAllowDirToOffer("/etc/passwd", home)
  assert.equal(bad.ok, false)
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
