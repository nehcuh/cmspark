import test from "node:test"
import assert from "node:assert/strict"
import { upstreamStatus } from "./fixtures/lcu-v0.13.0/producer"
import { projectLcuStatus, lcuEnableRefusal, lcuCandidates, lcuEnvironment, lcuAppRequest, lcuAppResponse, supportedLcuPlatform, validLcuCommand } from "../src/computer/lcu/contract"
import { discoverLcu, probeLcu, type LcuCommandIdentity } from "../src/computer/lcu/discovery"
import { authorizeLcuOperation } from "../src/computer/lcu/authorization"
import { upstreamElicitation } from "./fixtures/lcu-v0.13.0/mcp"

const identity: LcuCommandIdentity = { command: "/owned/bin/lcu", realPath: "/owned/release/bin/lcu", dev: 1, ino: 2, size: 3, mtimeMs: 4 }
const copy = <T>(value: T): T => structuredClone(value)

test("LCU projects the actual pinned upstream collect/assess output and drops private status branches", async () => {
  const raw = await upstreamStatus()
  assert.match(JSON.stringify(raw), /PRIVATE_SETUP_SENTINEL/)
  const status = projectLcuStatus(raw)
  assert.ok(status)
  assert.equal(status.pair, "tested")
  assert.equal(status.nativeVerified, false)
  assert.equal(lcuEnableRefusal(status), undefined)
  assert.deepEqual(Object.keys(status).sort(), ["lcuVersion", "platform", "architecture", "appVersion", "runtimeVersion", "pair", "changedSinceInstall", "nativeVerified"].sort())
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE_|\/Applications|\/owned/)
})

test("actual upstream untested, missing record, malformed record and changed installation stay unverified", async () => {
  for (const options of [{ appVersion: "unlisted" }, { record: "missing" as const }, { record: "malformed" as const }, { changed: true }]) {
    const status = projectLcuStatus(await upstreamStatus(options))
    assert.ok(status)
    assert.ok(lcuEnableRefusal(status))
  }
  assert.equal(projectLcuStatus(await upstreamStatus({ record: "missing" }))?.pair, "unknown")
  assert.equal(projectLcuStatus(await upstreamStatus({ appVersion: "unlisted" }))?.pair, "untested")
})

test("upstream Linux support is detection only until CMspark native approval is verified", async () => {
  const status = projectLcuStatus(await upstreamStatus({ platform: "linux" }))
  assert.ok(status)
  assert.equal(lcuEnableRefusal(status), "LCU_PLATFORM_APPROVAL_NOT_VERIFIED")
  assert.equal(supportedLcuPlatform("win32", "x64"), "unsupported")
  assert.equal(supportedLcuPlatform("darwin", "x64"), "unsupported")
})

test("contradictory actual producer identity fields cannot attest a runtime", async () => {
  const raw = await upstreamStatus() as any
  for (const [key, value] of [["tested", false], ["platform", "linux"], ["architecture", "x64"], ["app_version", "different"], ["runtime", "different"]] as Array<[string, unknown]>) {
    const input = copy(raw); input.compatibility[key] = value
    assert.equal(projectLcuStatus(input), undefined, String(key))
  }
  const input = copy(raw); input.changed_since_install = false
  assert.equal(projectLcuStatus(input), undefined)
  assert.equal(lcuEnableRefusal({ ...projectLcuStatus(raw)!, lcuVersion: "future" }), "LCU_VERSION_UNSUPPORTED")
})

test("command selection cannot accept an argv string, relative path, control character or unsupported platform", () => {
  for (const command of ["lcu", "/owned/lcu --chrome", "/owned/lcu\n", "/owned/codex", ""]) assert.equal(validLcuCommand(command), false)
  assert.equal(validLcuCommand("/owned/my installation/bin/lcu"), true)
  assert.deepEqual(lcuCandidates("win32", "x64", "/home/a", "/owned/bin/lcu"), [])
  assert.deepEqual(lcuCandidates("darwin", "arm64", "/home/a"), ["/home/a/.local/share/lcu/current/bin/lcu"])
})

test("LCU child environment excludes credential, loader, approval override and sandbox-disable variables", () => {
  const env = lcuEnvironment({ HOME: "/owned", PATH: "/bin", LANG: "C", OPENAI_API_KEY: "secret", NODE_OPTIONS: "--require evil", NODE_REPL_REQUEST_META: "forged", LCU_NODE_REPL_SANDBOX: "off", LCU_ALLOW_AGENT_HOST_APPROVAL: "1", CUA_REPL_ENABLED_SURFACES: "browser", SKY_ENABLE_AUDIO: "1" })
  assert.deepEqual(env, { HOME: "/owned", PATH: "/bin", LANG: "C", CUA_REPL_ENABLED_SURFACES: "computer", SKY_ENABLE_AUDIO: "0", NODE_REPL_ENABLE_AUDIO: "0" })
})

test("passive discovery never launches or even inspects candidates on unsupported Windows", async () => {
  let inspected = 0
  assert.deepEqual(await discoverLcu(undefined, { platform: "win32", arch: "x64", identity: async () => { inspected++; return identity } }), { status: "unsupported_platform" })
  assert.equal(inspected, 0)
  assert.equal((await discoverLcu(identity.command, { platform: "darwin", arch: "arm64", identity: async () => identity })).status, "detected_unverified")
})

test("status probe binds executable identity before/after and never propagates raw rejected output", async () => {
  const stdout = JSON.stringify(await upstreamStatus())
  let reads = 0, executions = 0
  const result = await probeLcu(identity, undefined, { identity: async () => ++reads === 1 ? identity : { ...identity, ino: 99 }, run: async () => { executions++; return { ok: true, stdout } } })
  assert.equal(executions, 1)
  assert.deepEqual(result, { status: "refused", refusal: "LCU_INSTALLATION_CHANGED_OR_CANCELLED" })
  const malformed = await probeLcu(identity, undefined, { identity: async () => identity, run: async () => ({ ok: true, stdout: "PRIVATE_RAW_OUTPUT" }) })
  assert.deepEqual(malformed, { status: "refused", refusal: "LCU_STATUS_INVALID" })
})

test("cancelled probe and changed pre-probe identity cannot become checked", async () => {
  const controller = new AbortController()
  const refused = await probeLcu(identity, controller.signal, { identity: async () => identity, run: async () => { controller.abort(); return { ok: true, stdout: JSON.stringify(await upstreamStatus()) } } })
  assert.equal(refused.refusal, "LCU_INSTALLATION_CHANGED_OR_CANCELLED")
  let launched = false
  assert.equal((await probeLcu(identity, undefined, { identity: async () => ({ ...identity, size: 9 }), run: async () => { launched = true; throw new Error("must not execute") } })).refusal, "LCU_INSTALLATION_CHANGED")
  assert.equal(launched, false)
})

test("unknown app approval form, browser, agent host and late reply fail closed", async () => {
  // The original public fixture supplies all app/schema/meta fields. This unit
  // boundary tests a form request; the session suite separately exercises what
  // the actual SDK emits, including its mode/default handling.
  const original = { mode: "form", ...await upstreamElicitation("approval-native") }
  const app = lcuAppRequest(original)
  assert.ok(app)
  assert.deepEqual(lcuAppResponse(app, true, false), { action: "cancel" })
  assert.deepEqual(lcuAppResponse(app, false, true), { action: "decline" })
  assert.deepEqual(lcuAppResponse(app, true, true), { action: "accept", content: {} })
  assert.equal(JSON.stringify(lcuAppResponse(app, true, true)).includes("always"), false)
  for (const id of ["CMspark", "com.apple.Terminal", "com.google.Chrome", "com.openai.codex"]) assert.equal(lcuAppRequest({ ...original, _meta: { ...original._meta, tool_params: { app: id } } }), undefined)
  assert.equal(lcuAppRequest({ ...original, requestedSchema: { type: "object", properties: { secret: { type: "string" } } } }), undefined)
  assert.equal(lcuAppRequest({ ...original, _meta: { ...original._meta, connector_id: "browser-use" } }), undefined)
})

test("every desktop operation requires current native OS approval; browser-nonce fallback cannot authorize", async () => {
  let native = 0
  const details: any[] = []
  const channel = { current: () => true, request: async (value: any) => { details.push(value); return { approved: true, confirmationId: "owned-confirm", reason: "approved" as const } } }
  assert.equal(await authorizeLcuOperation(channel, "lcu_js", "exact code", undefined, { platform: "darwin", biometric: async () => { native++; return { approved: true, method: "manual-nonce", nonce: "typed" } as any } }), false)
  assert.equal(await authorizeLcuOperation(channel, "lcu_js", "exact code", undefined, { platform: "darwin", biometric: async () => { native++; return { approved: true, method: "touchid", nonce: "native" } } }), true)
  assert.equal(native, 2)
  assert.equal(details[0].autoConfirmEligible, false)
  assert.equal(details[0].fullPreview, "exact code")
  assert.deepEqual(details[0].criticalApis, ["computer-use.lcu"])
})

test("native approval success arriving after owner revocation, abort or unsupported platform is unusable", async () => {
  let current = true, native = 0
  const channel = { current: () => current, request: async () => ({ approved: true, confirmationId: "owned", reason: "approved" as const }) }
  assert.equal(await authorizeLcuOperation(channel, "lcu_js", "code", undefined, { platform: "darwin", biometric: async () => { native++; current = false; return { approved: true, method: "touchid", nonce: "n" } } }), false)
  current = true
  const signal = AbortSignal.abort()
  assert.equal(await authorizeLcuOperation(channel, "lcu_js", "code", signal, { platform: "darwin", biometric: async () => { throw new Error("unreachable") } }), false)
  assert.equal(await authorizeLcuOperation(channel, "lcu_js", "code", undefined, { platform: "linux", biometric: async () => { throw new Error("unreachable") } }), false)
  assert.equal(native, 1)
})
