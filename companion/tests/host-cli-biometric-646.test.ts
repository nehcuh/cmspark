/** #646 existing owner floor. Production admission/manager/dispatcher execute;
 * synthetic binding markers, Hello provider and process traps are inert seams. */
import test, { before, after, type TestContext } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import cp from "node:child_process"
import { EventEmitter } from "node:events"
const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-cli-bio-646-"))
process.env.CMSPARK_DATA_DIR = path.join(owned, "data")
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let config: typeof import("../src/config")
let dispatch: typeof import("../src/tool/companion-dispatch")
let admission: typeof import("../src/tool/l2-admission")
let policy: typeof import("../src/security-policy").securityPolicy
let Policy: typeof import("../src/security-policy").SecurityPolicy
let Manager: typeof import("../src/security-confirmation").SecurityConfirmationManager
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let win: typeof import("../src/host-use/win")
let cli: typeof import("../src/apps/cli-manifest")
const exe = path.join(owned, "owned-cli.exe"), otherExe = path.join(owned, "other-cli.exe")
before(async () => {
  fs.writeFileSync(exe, "OWNED_INERT_NEVER_EXECUTED")
  fs.writeFileSync(otherExe, "OWNED_INERT_NEVER_EXECUTED")
  config = await import("../src/config"); await config.initDataDir()
  dispatch = await import("../src/tool/companion-dispatch")
  admission = await import("../src/tool/l2-admission")
  const security = await import("../src/security-policy"); policy = security.securityPolicy; Policy = security.SecurityPolicy
  Manager = (await import("../src/security-confirmation")).SecurityConfirmationManager
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  win = await import("../src/host-use/win")
  cli = await import("../src/apps/cli-manifest")
})
after(() => fs.rmSync(owned, { recursive: true, force: true }))
type Variant = "nonce" | "hello" | "cancel" | "error" | "deny" | "wrong-nonce" | "wrong-origin"
  | "timeout" | "disconnect" | "no-channel" | "invalid-auth" | "no-auth" | "ordinary-deny"
  | "abort-before" | "abort-pending" | "abort-after" | "disabled" | "removed" | "global-off"
  | "kind" | "exe" | "risk" | "argv" | "limits" | "selected" | "unrelated" | "unknown" | "injection"
  | "expired-auth" | "prevalidated-nonce" | "initial-risk-change"
async function run(t: TestContext, variant: Variant, risk: import("../src/apps/cli-manifest").CliRisk = "dangerous", fullAdmission = false) {
  t.mock.method(os, "platform", () => "win32") // JS branch semantics, not Windows/native acceptance.
  if (variant === "timeout") t.mock.timers.enable({ apis: ["setTimeout"] })
  const manifest: import("../src/apps/cli-manifest").CliManifest = { schema_version: 1, subcommands: [{
    name: "run", risk, positionals: [{ name: "token", required: true, value_regex: "^[A-Za-z0-9._-]{1,64}$" }],
  }, { name: "other", risk: "read-only" }] }
  assert.equal(cli.validateCliManifest(manifest), null)
  const entry: import("../src/apps/types").AppEntry = { token: "win.cli.owned", kind: "cli", display_name: "Owned",
    source: "user", policy: "manual", enabled: true, added_at: "now",
    exe: { path: exe, user_writable_dir: true }, cli_manifest: manifest as any }
  config.saveConfig({ apps: { enabled: true, entries: { [entry.token]: entry } }, security: {
    ...config.getConfig().security, allow_all_schemes: false, auto_approve_dangerous: false, auto_approve_enterprise_tools: false,
  } })
  let initialImportChanged = false
  if (variant === "initial-risk-change") {
    // Real compiled dynamic-import boundary, not a forged prepare result.
    // The handler has already captured its entry when Node resolves this module.
    const loader = require("node:module") as { _load: (...args: any[]) => any }
    const load = loader._load
    t.mock.method(loader, "_load", function (request: string, ...rest: any[]) {
      const loaded = load.call(loader, request, ...rest)
      if (request === "../apps/cli-exec" && !initialImportChanged) {
        initialImportChanged = true
        const current: any = JSON.parse(JSON.stringify(config.getConfig().apps!.entries[entry.token]))
        current.cli_manifest.subcommands[0].risk = "dangerous"
        config.replaceAppsEntries({ [entry.token]: current })
      }
      return loaded
    })
  }
  const tm = new ThreadManager(), thread = tm.create("OWNED_CLI_BIO"), mgr = new Manager()
  const ws: any = new EventEmitter(); ws.readyState = 1
  const otherWs: any = new EventEmitter(); otherWs.readyState = 1
  const controller = new AbortController(), frames: any[] = [], replies: any[] = [], children: any[] = []
  let helloCalls = 0, fixtureIssues = 0, fixtureValidations = 0
  const marker = "NON_EFFECTIVE_STANDALONE_BINDING_MARKER"
  const params: any = { app: entry.token, subcommand: variant === "unknown" ? "unknown" : "run",
    args: [variant === "injection" ? "@response" : "owned"], __thread_id: thread.id }
  const bound = Policy.bindingPayloadFor("host_cli", params)
  if (variant !== "invalid-auth" && variant !== "no-auth") {
    t.mock.method(policy, "issueTokenFor", (name: string, p: any) => {
      assert.equal(name, "host_cli"); assert.equal(Policy.bindingPayloadFor(name, p), bound)
      fixtureIssues++; return { token: marker } as any // Original issuer never executes.
    })
    t.mock.method(policy, "validateTokenFor", (token: string, name: string, p: any) => {
      fixtureValidations++
      if (variant === "expired-auth" && fixtureValidations > 1) return false
      return token === marker && name === "host_cli" && Policy.bindingPayloadFor(name, p) === bound
    })
  } else t.mock.method(policy, "issueTokenFor", () => { throw new Error("VALID_TOKEN_ISSUANCE_FORBIDDEN") })
  t.mock.method(cp, "spawn", () => { throw new Error("NATIVE_OR_PROCESS_SPAWN_FORBIDDEN") })
  t.mock.method(cp, "execFile", ((file: string, argv: string[], opts: any, callback: any) => {
    children.push({ file: file === fs.realpathSync(exe) ? "OWNED_INERT_CLI" : "UNEXPECTED_INERT_CHILD_BOUNDARY", argv, shell: opts.shell, timeout: opts.timeout, maxBuffer: opts.maxBuffer })
    assert.equal(file, fs.realpathSync(exe), "only the owned inert binary may reach the trap")
    queueMicrotask(() => callback(null, "OWNED_TRAP_NO_PROCESS_STARTED", ""))
    return new EventEmitter()
  }) as any)
  t.mock.method(win, "tryWindowsHello", async () => {
    helloCalls++
    if (variant === "cancel") return { cancelled: true }
    if (variant === "error") throw new Error("OWNED_HELLO_INFRA_FAULT")
    if (variant === "hello") return { ok: true, nonce: "OWNED_NOT_NATIVE_HELLO" }
    return { unavailable: true }
  })
  const mutate = () => {
    const current: any = JSON.parse(JSON.stringify(config.getConfig().apps!.entries[entry.token]))
    if (variant === "removed") { config.replaceAppsEntries({}); return }
    if (variant === "global-off") { config.saveConfig({ apps: { ...config.getConfig().apps!, enabled: false } }); return }
    if (variant === "disabled") current.enabled = false
    if (variant === "kind") current.kind = "gui"
    if (variant === "exe") current.exe.path = otherExe
    if (variant === "risk") current.cli_manifest.subcommands[0].risk = "read-only"
    if (variant === "limits") current.cli_manifest.defaults = { timeout_ms: 1000, max_output_bytes: 1024 }
    if (variant === "selected") current.cli_manifest.subcommands[0].positionals[0].value_regex = ".*"
    if (variant === "unrelated") current.cli_manifest.subcommands[1].description = "Unrelated metadata"
    if (variant === "argv") params.args[0] = "changed"
    if (variant === "abort-after") controller.abort()
    config.replaceAppsEntries({ [entry.token]: current })
  }
  const send = (data: any) => {
    frames.push(data)
    if (data.type !== "security.confirmation.request") return
    queueMicrotask(() => {
      if (data.nonce_challenge !== undefined) {
        if (variant === "timeout") { t.mock.timers.tick(45_000); return }
        if (variant === "disconnect") { mgr.rejectAll("disconnect", ws); return }
        if (variant === "abort-pending") { controller.abort(); return }
        if (variant === "wrong-origin") {
          const wrong = mgr.respondFrom(data.confirmation_id, true, otherWs, data.nonce_challenge)
          replies.push(wrong); assert.equal(wrong.outcome, "origin_mismatch"); assert.equal(children.length, 0)
        }
        if (variant === "wrong-nonce") {
          for (let i = 0; i < 3; i++) replies.push(mgr.respondFrom(data.confirmation_id, true, ws, "WRONG_NONCE"))
          return
        }
        mutate()
        replies.push(mgr.respondFrom(data.confirmation_id, variant !== "deny" && variant !== "initial-risk-change", ws, data.nonce_challenge))
      } else replies.push(mgr.respondFrom(data.confirmation_id, variant !== "ordinary-deny", ws))
    })
  }
  ws.send = (raw: any) => send(JSON.parse(String(raw)))
  dispatch.bindCompanionDispatchRuntime({ getThreadManager: () => tm, getSkillEngine: () => new SkillEngine(),
    getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any, getComputerRateLimiterSingleton: () => null, securityConfirmations: mgr,
    getComputerEstopEnsureOverride: () => null, rejectPendingForThread: () => 0, hasPendingForTab: () => false,
    rejectPendingForTab: () => 0 })
  if (variant === "abort-before") controller.abort()
  let admitted: any, wire: any
  if (fullAdmission) {
    admitted = await admission.runL2ToolAdmission({ toolName: "host_cli", finalParams: params,
      toolCallId: "owned-646", startedAt: Date.now(), ws, sessionId: "OWNED", actingThreadId: thread.id,
      isOutboundMcpCall: false, logToolFinish: () => {}, securityConfirmations: mgr, getThreadManager: () => tm,
      getCachedTabUrl: () => undefined, getDomainFromUrl: () => "", computerRateLimiter: async () => null as any,
      activeTrayConfirmsByWs: new WeakMap(), clients: new Set([ws]), wsAuthGet: () => ({ surface: "extension" }) })
  } else admitted = { ok: true, finalParams: { ...params,
    ...(variant === "no-auth" ? {} : { security_token: marker }) } }
  if (admitted.ok) wire = await dispatch.executeCompanionTool("host_cli", admitted.finalParams, "owned-646", {
    signal: controller.signal, computerSessionId: thread.id,
    ...(variant === "prevalidated-nonce" ? { prevalidatedNonce: "NOT_A_BIOMETRIC_APPROVAL" } : {}),
    ...(variant === "no-channel" || variant === "prevalidated-nonce" ? {} : { sendConfirmation: (details: any) => mgr.request(send, details,
      { originWs: ws, signal: controller.signal }) }),
  })
  else wire = admitted.result
  const receipt = { variant, risk, fullAdmission, prepared_risk: cli.buildCliArgv(manifest, params),
    admitted: { ...admitted, ...(admitted.ok ? { finalParams: { ...admitted.finalParams, security_token: "NON_EFFECTIVE_MARKER" } } : {}) },
    wire, frames, replies, children, helloCalls, fixtureIssues, fixtureValidations, initialImportChanged,
    current_manifest_risk: (config.getConfig().apps?.entries[entry.token]?.cli_manifest as any)?.subcommands?.[0]?.risk,
    pending: mgr.pendingCount() }
  t.diagnostic(JSON.stringify(receipt))
  assert.equal(mgr.pendingCount(), 0)
  mgr.rejectAll("disconnect")
  return receipt
}

test("#646 actual ordinary admission cannot substitute for dangerous biometric approval", async t => {
  const r = await run(t, "deny", "dangerous", true)
  assert.equal(r.children.length, 0); assert.equal(r.wire.success, false)
  assert.equal(r.frames.filter(f => f.nonce_challenge !== undefined).length, 1)
})
for (const risk of ["read-only", "state-changing"] as const) test(`#646 actual ${risk} ordinary L2 keeps its established execution behavior`, async t => {
  const r = await run(t, "deny", risk, true)
  assert.equal(r.children.length, 1); assert.equal(r.wire.success, true); assert.equal(r.helloCalls, 0)
  assert.equal(r.frames.filter(f => f.nonce_challenge !== undefined).length, 0)
})
test("#646 actual ordinary L2 refusal still prevents dangerous dispatch", async t => {
  const r = await run(t, "ordinary-deny", "dangerous", true)
  assert.equal(r.children.length, 0); assert.equal(r.helloCalls, 0); assert.equal(r.fixtureIssues, 0)
})
test("#646 current manifest risk is refreshed after the actual initial dynamic-import window", async t => {
  const r = await run(t, "initial-risk-change", "read-only")
  assert.equal(r.initialImportChanged, true, "the actual module boundary must have been exercised")
  assert.equal(r.children.length, 0); assert.equal(r.wire.success, false); assert.equal(r.helloCalls, 1)
})
for (const variant of ["nonce", "hello", "wrong-origin", "unrelated"] as const) test(`#646 actual preauthorized dangerous ${variant} second-factor path reaches only the inert trap`, async t => {
  const r = await run(t, variant)
  assert.equal(r.children.length, 1); assert.equal(r.wire.success, true); assert.equal(r.helloCalls, 1)
})
for (const variant of ["cancel", "error", "deny", "wrong-nonce", "timeout", "disconnect", "no-channel", "invalid-auth", "no-auth",
  "abort-before", "abort-pending", "abort-after", "disabled", "removed", "global-off", "kind", "exe", "risk", "argv", "limits", "selected",
  "unknown", "injection", "expired-auth", "prevalidated-nonce"] as const) test(`#646 actual preauthorized dangerous ${variant} leaves the child boundary untouched`, async t => {
  const r = await run(t, variant)
  assert.equal(r.children.length, 0); assert.equal(r.wire.success, false)
  if (variant === "expired-auth") {
    // Scoped non-effective binding marker reaches the real second validation;
    // this is neither a native token nor an actual human biometric approval.
    assert.equal(r.fixtureValidations, 2)
    assert.equal(r.wire.error, "Invalid or expired security token for host_cli")
    assert.equal(r.wire.data?.error_code, "SECURITY_TOKEN_INVALID")
  }
  if (["cancel", "error", "no-channel", "invalid-auth", "no-auth", "abort-before", "unknown", "injection", "prevalidated-nonce"].includes(variant)) {
    assert.equal(r.frames.filter(f => f.nonce_challenge !== undefined).length, 0)
  }
})
