import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-sh-"))
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
process.env.HOME = tempHome

let initDataDir: any
let clearConfigCache: any
let saveConfig: any
let shell: typeof import("../src/capability/shell")
let scan: typeof import("../src/netsec/scan")

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  clearConfigCache = configMod.clearConfigCache
  saveConfig = configMod.saveConfig
  await initDataDir()
  clearConfigCache()
  shell = await import("../src/capability/shell")
  scan = await import("../src/netsec/scan")
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("shell_exec blocked when module disabled", async () => {
  saveConfig({
    capability_profile: "enterprise",
    modules: { shell: { available: true, enabled: false } },
  } as any)
  clearConfigCache()
  const r = await shell.shellExec({ command: "echo hi" })
  assert.equal(r.success, false)
  assert.match(r.error || "", /module_disabled/)
})

test("shell_exec runs when enabled", async () => {
  saveConfig({
    capability_profile: "enterprise",
    modules: {
      shell: { available: true, enabled: true, policy: "confirm_per_command" },
    },
  } as any)
  clearConfigCache()
  const r = await shell.shellExec({ command: "echo hello-cmspark" })
  assert.equal(r.success, true)
  assert.match(r.data?.stdout || "", /hello-cmspark/)
})

// --- P1-4 / P1a: allowlist metachar structure tighten ---

function enableShellAllowlist(cmds: string[]) {
  saveConfig({
    capability_profile: "enterprise",
    modules: {
      shell: {
        available: true,
        enabled: true,
        policy: "allowlist",
        allowlist_commands: cmds,
      },
    },
  } as any)
  clearConfigCache()
}

test("P1a allowlist: benign allowlisted command succeeds", async () => {
  enableShellAllowlist(["echo"])
  const r = await shell.shellExec({ command: "echo hello-allowlist" })
  assert.equal(r.success, true)
  assert.match(r.data?.stdout || "", /hello-allowlist/)
})

test("P1a allowlist: prefix + '; rm' rejected (metachar, no side effect)", async () => {
  enableShellAllowlist(["echo"])
  const marker = path.join(tempHome, "p14-should-not-exist")
  const r = await shell.shellExec({
    command: `echo hi; rm -rf ${marker}; touch ${marker}`,
  })
  assert.equal(r.success, false)
  assert.match(r.error || "", /metacharacter/i)
  assert.equal(fs.existsSync(marker), false, "metachar chain must not run")
})

test("P1a allowlist: rejects && | $() backticks redirects newlines under prefix", async () => {
  enableShellAllowlist(["echo"])
  const cases = [
    "echo a && echo b",
    "echo a | cat",
    "echo $(uname)",
    "echo `uname`",
    "echo hi > /tmp/x",
    "echo hi < /tmp/x",
    "echo a\necho b",
    "echo a\recho b",
  ]
  for (const cmd of cases) {
    const r = shell.commandAllowedByPolicy(cmd)
    assert.equal(r.ok, false, `expected metachar reject for: ${JSON.stringify(cmd)}`)
    assert.match((r as { error: string }).error, /metacharacter/i)
    // Same gate via checkShellScope (server SHELL_SCOPE_DENIED path)
    const scope = shell.checkShellScope(cmd)
    assert.equal(scope.ok, false)
  }
})

test("P1a allowlist: non-prefix still denied with not-in-allowlist", async () => {
  enableShellAllowlist(["echo"])
  const r = shell.commandAllowedByPolicy("uname -a")
  assert.equal(r.ok, false)
  assert.match((r as { error: string }).error, /not in allowlist/)
})

test("P1a confirm_per_command: metachar ban is allowlist-only (policy layer)", async () => {
  saveConfig({
    capability_profile: "enterprise",
    modules: {
      shell: { available: true, enabled: true, policy: "confirm_per_command" },
    },
  } as any)
  clearConfigCache()
  // Policy layer allows chaining; L2 forceConfirm still required on execute path (unchanged)
  const r = shell.commandAllowedByPolicy("echo a; echo b")
  assert.equal(r.ok, true)
  assert.equal(shell.hasShellAllowlistMetachar("echo a; echo b"), true)
  assert.equal(shell.hasShellAllowlistMetachar("echo hello"), false)
})

test("netsec denied when allowlist empty", async () => {
  saveConfig({
    capability_profile: "enterprise",
    modules: {
      netsec: {
        available: true,
        enabled: true,
        target_allowlist: [],
        require_task_auth: true,
      },
    },
  } as any)
  clearConfigCache()
  const r = await scan.netsecPortScan({
    targets: ["127.0.0.1"],
    taskAuth: { authorized: true, targets: ["127.0.0.1"] },
  })
  assert.equal(r.success, false)
  assert.match(r.error || "", /allowlist/i)
})

test("netsec probes localhost when authorized", async () => {
  saveConfig({
    capability_profile: "enterprise",
    modules: {
      netsec: {
        available: true,
        enabled: true,
        target_allowlist: ["127.0.0.1", "localhost"],
        require_task_auth: true,
      },
    },
  } as any)
  clearConfigCache()
  const r = await scan.netsecPortScan({
    targets: ["127.0.0.1"],
    ports: [1, 65534], // unlikely open
    taskAuth: { authorized: true, targets: ["127.0.0.1"] },
  })
  assert.equal(r.success, true)
  assert.ok(Array.isArray(r.data?.results))
})

// --- C7 / C8 multi-adv: bind payload normalization ---

test("C7 normalizeShellCwd: cwd > working_directory > workspace > process.cwd", () => {
  const a = shell.normalizeShellCwd({ cwd: "/tmp/foo" }, "/workspace")
  assert.equal(a, path.resolve("/tmp/foo"))
  const b = shell.normalizeShellCwd({ working_directory: "/tmp/bar" }, "/workspace")
  assert.equal(b, path.resolve("/tmp/bar"))
  const c = shell.normalizeShellCwd({}, "/workspace/proj")
  assert.equal(c, path.resolve("/workspace/proj"))
  const d = shell.normalizeShellCwd({})
  assert.equal(d, path.resolve(process.cwd()))
})

test("C7 shell binding equality: issue/validate with normalized cwd", () => {
  const { SecurityPolicy } = require("../src/security-policy") as typeof import("../src/security-policy")
  const pol = new SecurityPolicy()
  const params = {
    command: "echo x",
    cwd: shell.normalizeShellCwd({ working_directory: "rel/dir" }, "/ws"),
  }
  const tok = pol.issueTokenFor("shell_exec", params)
  assert.equal(pol.validateTokenFor(tok.token, "shell_exec", params), true)
  // Different cwd must fail
  assert.equal(
    pol.validateTokenFor(tok.token, "shell_exec", { ...params, cwd: path.resolve("/other") }),
    false,
  )
})

test("C8 normalizeNetsecPorts: empty → COMMON_PORTS copy", () => {
  const a = scan.normalizeNetsecPorts(undefined)
  assert.deepEqual(a, [...scan.COMMON_PORTS])
  const b = scan.normalizeNetsecPorts([])
  assert.deepEqual(b, [...scan.COMMON_PORTS])
  const c = scan.normalizeNetsecPorts([80, 443, 99999, -1])
  assert.deepEqual(c, [80, 443])
})

test("C8 netsec binding equality: empty ports normalized before issue", () => {
  const { SecurityPolicy } = require("../src/security-policy") as typeof import("../src/security-policy")
  const pol = new SecurityPolicy()
  const ports = scan.normalizeNetsecPorts([])
  const params = { targets: ["127.0.0.1"], ports }
  // Tokens are single-use — issue per assertion
  const tokOk = pol.issueTokenFor("netsec_port_scan", params)
  assert.equal(pol.validateTokenFor(tokOk.token, "netsec_port_scan", params), true)
  const tokEmpty = pol.issueTokenFor("netsec_port_scan", params)
  // Empty ports on validate would bind differently if not normalized
  assert.equal(
    pol.validateTokenFor(tokEmpty.token, "netsec_port_scan", { targets: ["127.0.0.1"], ports: [] }),
    false,
  )
  const tokNorm = pol.issueTokenFor("netsec_port_scan", params)
  // Same after normalize
  assert.equal(
    pol.validateTokenFor(tokNorm.token, "netsec_port_scan", {
      targets: ["127.0.0.1"],
      ports: scan.normalizeNetsecPorts([]),
    }),
    true,
  )
})
