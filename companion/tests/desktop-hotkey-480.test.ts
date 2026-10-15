import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import http from "node:http"
import { once } from "node:events"
import { createHmac, randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import * as ts from "typescript"
import { WebSocket, WebSocketServer } from "ws"
import { DesktopHostLauncher } from "../src/desktop/host-launcher"
import { DesktopIdentityRegistry } from "../src/desktop/identity"
import { createDesktopChannel, attachDesktopUpgrade } from "../src/desktop/channel"
import { requestDesktopOpen } from "../src/desktop/open"
import { DESKTOP_NATIVE_ORIGIN } from "../src/desktop/capabilities"

// Node test deadlines abort the signal; they do not cancel an awaited fixture promise.
function waitForTest<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason) }
    signal.addEventListener("abort", abort, { once: true })
    pending.then(value => { signal.removeEventListener("abort", abort); resolve(value) }, error => { signal.removeEventListener("abort", abort); reject(error) })
  })
}

// Complete production handler, without starting the tray/main entry point.
// Substitute only current client and legacy UI/notification effect boundaries.
function actionFixture(client: unknown) {
  const file = path.resolve("src/menu-bar-agent.ts"), source = fs.readFileSync(file, "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const functions = ast.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "handleAction")
  assert.equal(functions.length, 1)
  const effects = { legacyOpen: 0, legacyToggle: 0, notifications: [] as unknown[] }
  const context = { module: { exports: {} }, companionClient: client, console: { log() {} },
    openSummonerWebShell: async () => { effects.legacyOpen++ },
    toggleSummonerWebShell: async () => { effects.legacyToggle++ },
    safeNotify: (value: unknown) => { effects.notifications.push(value) },
  }
  const js = ts.transpileModule(functions[0].getText(ast) + "\nmodule.exports = handleAction", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(js, context)
  return { run: context.module.exports as (action: { type: string }) => Promise<void>, effects }
}
function actualHotkeyAction(): string {
  const source = fs.readFileSync(path.resolve("src/tray/Tray.swift"), "utf8")
  const body = source.slice(source.indexOf("func handleSummonerHotKeyPressed() {"), source.indexOf("// Summoner overlay lives"))
  assert.match(body, /if summonerController\.composingNow/)
  const matches = [...body.matchAll(/jsonLine\(\["type": "click", "action": "([^"]+)"\]\)/g)]
  assert.equal(matches.length, 1)
  return matches[0][1]
}
function noLegacy(f: ReturnType<typeof actionFixture>) { assert.equal(f.effects.legacyOpen, 0); assert.equal(f.effects.legacyToggle, 0) }

test("registered hotkey and explicit desktop menu use the exact same compact launch request", async () => {
  const calls: Array<{ type: string; view: unknown; timeout: number }> = []
  const f = actionFixture({ sendAppRequest: async (type: string, payload: { view: unknown }, timeout: number) => { calls.push({ type, view: payload.view, timeout }); return { ok: true } } })
  for (const type of [actualHotkeyAction(), "desktop"]) await f.run({ type })
  assert.deepEqual(calls, [{ type: "desktop.open", view: "compact", timeout: 30_000 }, { type: "desktop.open", view: "compact", timeout: 30_000 }])
  noLegacy(f); assert.equal(f.effects.notifications.length, 0)
})

test("explicit old conversation window remains separate from the native hotkey", async () => {
  let requests = 0
  const f = actionFixture({ sendAppRequest: async () => { requests++; return { ok: true } } })
  await f.run({ type: "summoner" })
  assert.equal(f.effects.legacyOpen, 1); assert.equal(f.effects.legacyToggle, 0); assert.equal(requests, 0)
  for (const file of ["src/tray/Tray.swift", "src/tray/systray2-bridge.ts", "src/tray/readline-tray.ts"])
    assert.equal(fs.readFileSync(path.resolve(file), "utf8").includes("对话浮窗（旧版）…"), true, file)
})

for (const mode of ["disconnected", "denied", "throw"] as const) test(`native hotkey/menu ${mode} stays explicit without opening the old window`, async () => {
  let requests = 0
  const client = mode === "disconnected" ? null : { sendAppRequest: async () => { requests++; if (mode === "throw") throw Error("owned inert transport failure"); return { ok: false, error_code: "DESKTOP_NATIVE_UNAVAILABLE" } } }
  const f = actionFixture(client)
  for (const type of [actualHotkeyAction(), "desktop"]) await f.run({ type })
  assert.equal(requests, mode === "disconnected" ? 0 : 2); noLegacy(f)
  assert.equal(f.effects.notifications.length, 2)
  for (const value of f.effects.notifications) {
    const notice = value as { title: string; message: string; timeout: number }
    assert.equal(notice.title, "CMspark 工作台"); assert.equal(notice.timeout, 5)
    assert.equal(notice.message, mode === "disconnected" ? "Companion 未连接，无法打开工作台" : mode === "throw" ? "工作台连接失败，请重试。" : "无法打开原生工作台，请检查程序包是否完整。")
  }
})

test("actual hotkey handler and launcher share one issued HMAC WS host across concurrent and repeated opens", { timeout: 10_000 }, async (t) => {
  const registry = new DesktopIdentityRegistry(), server = http.createServer(), legacy = new WebSocketServer({ noServer: true })
  let launcher!: DesktopHostLauncher
  let issues = 0, launches = 0, exits = 0, terminated = 0, phase = "setup"
  const hosts: string[] = [], windows: string[] = [], requests: Array<{ view: unknown; timeout: number }> = [], clients: WebSocket[] = []
  const waiting: Array<{ count: number; resolve: () => void }> = []
  const issue = registry.issue.bind(registry)
  registry.issue = host => { issues++; hosts.push(host); return issue(host) }
  const services = { threads: { desktopMetadataSnapshot: () => [], get: () => undefined, getMessages: () => [] }, skills: { list: () => [], listKnowledge: () => [] }, mcp: { listServers: () => [] } }
  const channel = createDesktopChannel({ registry, services, maxPayload: 1024 * 1024, onAuthenticated: host => launcher.authenticated(host) })
  attachDesktopUpgrade(server, legacy, channel.wss, () => false)
  try {
  server.listen(0, "127.0.0.1"); await once(server, "listening", { signal: t.signal })
  const endpoint = `ws://127.0.0.1:${(server.address() as { port: number }).port}/desktop`
  let peerError: Error | undefined
  launcher = new DesktopHostLauncher(registry, endpoint, (host, view) => channel.window(host, view), () => ({ binary: "owned-inert-no-executable", binding: {
    launch: (_binary, capabilityId, secret, url, onExit) => {
      launches++
      const ws = new WebSocket(url, { origin: DESKTOP_NATIVE_ORIGIN }); clients.push(ws)
      ws.on("error", error => { peerError = error })
      ws.on("close", () => { exits++; onExit(0) })
      ws.on("message", bytes => {
        const frame = JSON.parse(String(bytes))
        if (frame.type === "desktop.challenge.request") ws.send(JSON.stringify({ type: "desktop.hello", capability_id: capabilityId, protocol_version: 1 }))
        else if (frame.type === "desktop.challenge") {
          const proof = createHmac("sha256", Buffer.from(secret, "hex")).update(JSON.stringify(["cmspark.desktop.auth.v1", capabilityId, frame.connection_id, 1, frame.nonce])).digest("hex")
          ws.send(JSON.stringify({ type: "desktop.authenticate", capability_id: capabilityId, protocol_version: 1, proof }))
        } else if (frame.type === "desktop.window") {
          windows.push(frame.view)
          for (const item of waiting) if (windows.length >= item.count) item.resolve()
        }
      })
      return { terminate: () => { terminated++; ws.terminate() } }
    },
  } }))
  function windowCount(count: number) { return windows.length >= count ? Promise.resolve() : new Promise<void>(resolve => waiting.push({ count, resolve })) }
  const tray = { authenticated: true, surface: "tray", origin: "cmspark-tray://local" }
  const f = actionFixture({ sendAppRequest: async (type: string, payload: { view: unknown }, timeout: number) => { requests.push({ view: payload.view, timeout }); return requestDesktopOpen({ type, ...payload }, tray, launcher) } })
    const first = f.run({ type: actualHotkeyAction() }), second = f.run({ type: actualHotkeyAction() })
    assert.equal(issues, 1); assert.equal(launches, 1)
    phase = "waiting-launches"; await waitForTest(Promise.all([first, second]), t.signal)
    phase = "waiting-windows-2"; await waitForTest(windowCount(2), t.signal)
    assert.equal(channel.window("foreign-owner", "compact"), false)
    phase = "waiting-repeat"; await waitForTest(f.run({ type: actualHotkeyAction() }), t.signal)
    phase = "waiting-windows-3"; await waitForTest(windowCount(3), t.signal)
    assert.equal(issues, 1); assert.equal(launches, 1); assert.equal(hosts.length, 1)
    assert.deepEqual(windows, ["compact", "compact", "compact"])
    assert.equal(requests.length, 3); for (const item of requests) { assert.equal(item.view, "compact"); assert.equal(item.timeout, 30_000) }
    assert.equal(legacy.clients.size, 0); assert.equal(channel.wss.clients.size, 1)
    assert.equal(f.effects.notifications.length, 0); noLegacy(f); assert.equal(peerError, undefined)
  } finally {
    // Subscribe before termination; on abort the owned launch/WS resources must still close.
    const closed = clients.filter(ws => ws.readyState !== WebSocket.CLOSED).map(ws => once(ws, "close"))
    launcher?.close()
    for (const ws of clients) if (ws.readyState !== WebSocket.CLOSED) ws.terminate()
    for (const ws of channel.wss.clients) ws.terminate()
    for (const ws of legacy.clients) ws.terminate()
    const cleanup = Promise.all([...closed, new Promise<void>(resolve => channel.wss.close(() => resolve())), new Promise<void>(resolve => legacy.close(() => resolve())), new Promise<void>((resolve, reject) => server.close(error => { if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error); else resolve() }))])
    server.closeAllConnections()
    // Test-only cleanup bound, independent of the already-aborted10s signal; no product deadline change.
    let cleanupTimer: NodeJS.Timeout | undefined
    try { await Promise.race([cleanup, new Promise<never>((_, reject) => { cleanupTimer = setTimeout(() => reject(Error("Owned hotkey fixture cleanup did not complete")), 1_000); cleanupTimer.unref() })]) }
    finally { clearTimeout(cleanupTimer) }
    if (launches) { assert.equal(exits, launches); assert.ok(terminated >= 1) }
    assert.equal(server.listening, false); assert.equal(channel.wss.clients.size, 0); assert.equal(legacy.clients.size, 0)
    console.log("HOTKEY_480_CLEANUP " + JSON.stringify({ phase, serverListening: server.listening, clientSockets: clients.filter(ws => ws.readyState !== WebSocket.CLOSED).length, serverSockets: channel.wss.clients.size + legacy.clients.size, issues, launches, exits }))
  }
})

// Real compiled fixture child, isolated from canonical discovery by its leading underscore.
// Controlled500ms replaces only this owned copy's10s test limit; product30s stays intact.
test("test abort closes the real never-authenticated hotkey fixture and keeps its failure", { timeout: 5_000 }, () => {
  const compiled = fs.readFileSync(__filename, "utf8")
  const deadline = "timeout: " + "10_000", authenticate = 'type: "desktop.' + 'authenticate", capability_id: capabilityId'
  assert.equal(compiled.split(deadline).length - 1, 1)
  assert.equal(compiled.split(authenticate).length - 1, 1)
  const adverse = compiled.replace(deadline, "timeout: 500").replace(authenticate, 'type: "owned.never-authenticated", capability_id: capabilityId')
  const file = path.join(__dirname, `_desktop-hotkey-abort-${randomUUID()}.js`)
  fs.writeFileSync(file, adverse, { flag: "wx", mode: 0o600 })
  try {
    // Independent CLI child must not inherit the parent test runner's private V8 IPC reporter context.
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ["--require", path.resolve("scripts/test-data-dir.cjs"), "--experimental-test-isolation=none", "--test", "--test-name-pattern", "^actual hotkey handler and launcher share one issued HMAC WS host across concurrent and repeated opens$", file], { encoding: "utf8", timeout: 3_000, killSignal: "SIGKILL", env })
    assert.equal(result.error, undefined, "Controlled failed fixture must exit naturally after its own abort, not require the outer guard")
    assert.equal(result.signal, null)
    assert.equal(result.status, 1, "The failed authentication/deadline must remain a real failing test")
    assert.match(result.stdout, /ERR_TEST_FAILURE/)
    const line = result.stdout.split("\n").find(value => /^(?:# )?HOTKEY_480_CLEANUP /.test(value))
    assert.ok(line, "Actual aborted fixture must report closed owned resources")
    const receipt = JSON.parse(line.replace(/^# /, "").slice("HOTKEY_480_CLEANUP ".length))
    assert.equal(receipt.phase, "waiting-windows-2")
    assert.equal(receipt.serverListening, false); assert.equal(receipt.clientSockets, 0); assert.equal(receipt.serverSockets, 0)
    assert.equal(receipt.issues, 1); assert.equal(receipt.launches, 1); assert.equal(receipt.exits, 1)
  } finally { fs.unlinkSync(file) }
})
