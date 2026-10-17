/* Owned #480 acceptance coordinator. Imported by tests only, never product runtime. */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import http from "node:http"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import type { TestContext } from "node:test"
import { WebSocket, WebSocketServer } from "ws"
import { DesktopHostLauncher, type DesktopNativeBinding } from "../../../src/desktop/host-launcher"
import { DesktopIdentityRegistry } from "../../../src/desktop/identity"
import { attachDesktopUpgrade, createDesktopChannel } from "../../../src/desktop/channel"
import { ThreadManager } from "../../../src/threads/thread-manager"
import { SkillEngine } from "../../../src/skills/skill-engine"
import { McpManager } from "../../../src/mcp/manager"
import { DESKTOP_NATIVE_ORIGIN } from "../../../src/desktop/capabilities"

const fixed = new Set(["AUTH_1", "AUTH_2", "CONSUMED_HANDLES_DENIED", "PARENT_LOCK_ARMED", "DEVTOOLS_DENIED", "FRAME_DENIED", "REMOTE_DENIED", "NEW_WINDOW_DENIED", "DOWNLOAD_DENIED", "DOCUMENT_FRESH", "STALE_DENIED"])
const failures = new Set(["FAIL_NO_DOCUMENT", "FAIL_SCRIPT", "FAIL_ENGINE_API", "FAIL_WINDOW", "FAIL_DEVTOOLS", "FAIL_FRAME_FORWARDED", "FAIL_STALE_FORWARDED", "FAIL_REMOTE", "FAIL_DOWNLOAD", "FAIL_GENERATION", "FAIL_HOSTILE_FORWARDED", "FAIL_FRAME_NOT_OBSERVED", "FAIL_DESCENDANT_NOT_OBSERVED", "FAIL_PARENT_LOCK"])
export type AcceptanceReceipt = { kind: "identity"; control: number; descendant: number } | { kind: "inheritance"; checks: string; stage: number; control: number; descendant: number } | { kind: "fixed"; name: string } | { kind: "window"; view: "compact" | "workspace"; width: number; height: number; expectedWidth: number; expectedHeight: number; bits: string }
export function acceptanceReceipt(value: unknown): AcceptanceReceipt | null {
  if (typeof value !== "string" || value.length > 200 || !value.startsWith("D480A_")) return null
  const name = value.slice(6)
  if (fixed.has(name) || failures.has(name)) return { kind: "fixed", name }
  const identity = /^IDENTITY_(0|[1-7]|256|257)_(0|[1-7]|256|257)$/.exec(name)
  if (identity && identity[0] === name) return { kind: "identity", control: Number(identity[1]), descendant: Number(identity[2]) }
  const inheritance = /^INHERITANCE_([01]{4})_([0-7])_(0|[1-9]\d{0,2})_(0|[1-9]\d{0,2})$/.exec(name)
  const checkerCode = (value: number) => value <= 7 || (value >= 240 && value <= 257)
  if (inheritance && inheritance[0] === name && checkerCode(Number(inheritance[3])) && checkerCode(Number(inheritance[4]))) return { kind: "inheritance", checks: inheritance[1], stage: Number(inheritance[2]), control: Number(inheritance[3]), descendant: Number(inheritance[4]) }
  const m = /^WINDOW_([CW])_([1-9]\d*)_([1-9]\d*)_([1-9]\d*)_([1-9]\d*)_([01]{7})$/.exec(name)
  if (!m) return null
  const values = m.slice(2, 6).map(Number)
  if (!values.every(Number.isSafeInteger)) return null
  return { kind: "window", view: m[1] === "C" ? "compact" : "workspace", width: values[0], height: values[1], expectedWidth: values[2], expectedHeight: values[3], bits: m[6] }
}
export function requireInheritanceIdentity(observations: AcceptanceReceipt[]): void {
  const identity = observations.filter((r): r is Extract<AcceptanceReceipt, { kind: "identity" }> => r.kind === "identity")
  const raw = observations.filter((r): r is Extract<AcceptanceReceipt, { kind: "inheritance" }> => r.kind === "inheritance")
  assert.equal(identity.length, 1, "One exact object-identity receipt required")
  assert.equal(raw.length, 1, "One original raw checker receipt required")
  assert.deepEqual(identity[0], { kind: "identity", control: 4, descendant: 4 })
  assert.equal(raw[0].checks, "1111"); assert.equal(raw[0].stage, 7); assert.equal(raw[0].control, 4)
  assert.ok(Number.isSafeInteger(raw[0].descendant) && raw[0].descendant >= 0 && raw[0].descendant <= 7, "Real checker must complete its sidecar/mask path")
}

export function requireWindow(r: AcceptanceReceipt | undefined, view: "compact" | "workspace"): void {
  assert.ok(r && r.kind === "window", "Actual owned window observation required")
  assert.equal(r.view, view); assert.equal(r.width, r.expectedWidth); assert.equal(r.height, r.expectedHeight)
  assert.equal(r.bits, "1111111", "Visible/key/active/same/singleton/exact-geometry/clamp all required")
}
export function requireInheritance(value: { sidecar_valid: boolean; control_mask: number; sibling_mask: number }): void {
  assert.equal(value.sidecar_valid, true); assert.equal(value.control_mask, 4)
  assert.equal(value.sibling_mask, 4, "Actual sibling must prove sentinel presence and protected endpoint absence; error/partial masks fail")
}
// Observe production-admitted responses only. Incoming phase/proof text is never
// a success receipt; ready is bound by the channel's synchronous authenticated callback.
export function observeAcceptanceResponses(wss: WebSocketServer, owned: () => { host: string; capabilityId: string }, registry: DesktopIdentityRegistry, record: (receipt: AcceptanceReceipt) => void, proof: (value: string) => void, activity: () => void = () => {}) {
  let ready: { ws: WebSocket; proof: string } | undefined
  let current: { ws: WebSocket; host: string; capabilityId: string } | undefined
  const currentSocket = () => current && current.host === owned().host && current.capabilityId === owned().capabilityId && current.ws.readyState === WebSocket.OPEN ? current.ws : undefined
  const unbind = registry.onRevoke(id => { if (current?.capabilityId === id) current = undefined })
  wss.once("close", unbind)
  wss.on("connection", ws => {
    let candidateProof = ""
    ws.prependListener("message", raw => {
      let frame: any; try { frame = JSON.parse(String(raw)) } catch { return }
      if (frame?.type === "desktop.authenticate" && typeof frame.proof === "string" && /^[0-9a-f]{64}$/i.test(frame.proof)) candidateProof = frame.proof
    })
    const send = ws.send
    ws.send = function (this: WebSocket, ...args: any[]) {
      const result = Reflect.apply(send, this, args)
      if (this === ws && currentSocket() === ws) activity()
      let frame: any; try { frame = JSON.parse(String(args[0])) } catch { return result }
      if (this !== ws || !frame || typeof frame !== "object" || Array.isArray(frame) || Object.keys(frame).length !== 2) return result
      if (frame.type === "desktop.ready" && frame.protocol_version === 1 && ws.readyState === WebSocket.OPEN) ready = { ws, proof: candidateProof }
      else if (frame.type === "system.pong" && currentSocket() === ws) {
        const receipt = acceptanceReceipt(frame.id)
        if (receipt) record(receipt)
      }
      return result
    }
    ws.once("close", () => { candidateProof = ""; if (ready?.ws === ws) ready = undefined; if (current?.ws === ws) current = undefined })
  })
  return {
    currentSocket,
    authenticated(host: string): boolean {
      const admitted = ready; ready = undefined
      const expected = owned()
      if (!admitted || host !== expected.host || !host || !expected.capabilityId || admitted.ws.readyState !== WebSocket.OPEN) return false
      current = { ws: admitted.ws, host, capabilityId: expected.capabilityId }
      if (admitted.proof) proof(admitted.proof)
      return true
    },
  }
}

// Fixed test-only observations: no capability, secret, proof, endpoint or wire data.
export function acceptanceDiagnostic(reason: string, phase: string, mode: string, counts: { auths: number; issues: number; launches: number; exits: number; listReads: number; lastExitCode?: number | null }, observations: AcceptanceReceipt[]) {
  const finiteCount = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 1000 ? n : null
  return {
    reason: ["deadline", "cleanup"].includes(reason) ? reason : "unknown",
    phase: ["starting", "waiting-auth-metadata", "waiting-reconnect-auth", "waiting-replay-close", "waiting-relaunch", "complete"].includes(phase) ? phase : "unknown",
    mode: ["visual", "hostile", "reconnect", "relaunch", "inheritance", "parent"].includes(mode) ? mode : "unknown",
    auths: finiteCount(counts.auths), issues: finiteCount(counts.issues), launches: finiteCount(counts.launches), exits: finiteCount(counts.exits), listReads: finiteCount(counts.listReads),
    lastExitCode: Number.isSafeInteger(counts.lastExitCode) && counts.lastExitCode! >= -0x80000000 && counts.lastExitCode! <= 0xffffffff ? counts.lastExitCode : null,
    fixed: [...new Set(observations.filter(r => r.kind === "fixed" && (fixed.has(r.name) || failures.has(r.name))).map(r => (r as { name: string }).name))].sort(),
    inheritance: observations.filter(r => r.kind === "inheritance").slice(0, 1),
    identity: observations.filter(r => r.kind === "identity").slice(0, 1),
    windows: finiteCount(observations.filter(r => r.kind === "window").length),
  }
}

function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason) }
    signal.addEventListener("abort", abort, { once: true })
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value) }, error => { signal.removeEventListener("abort", abort); reject(error) })
  })
}
export function ownedDirectoryIdentity(directory: string): { dev: number; ino: number; real: string } {
  const stat = fs.lstatSync(directory); assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "Owned directory required")
  return { dev: stat.dev, ino: stat.ino, real: fs.realpathSync(directory) }
}
export function requireOwnedDirectory(directory: string, expected: { dev: number; ino: number; real: string }): void {
  assert.deepEqual(ownedDirectoryIdentity(directory), expected, "Owned directory identity changed; refuse cleanup")
}
function ownDataRoot(): string {
  const root = process.env.CMSPARK_TEST_RUN_DIR, data = process.env.CMSPARK_DATA_DIR
  assert.ok(root && data && path.isAbsolute(root) && path.isAbsolute(data), "Existing owned test-data preload required")
  const r = fs.realpathSync(root), d = fs.realpathSync(data), relative = path.relative(r, d)
  assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  return d
}
export async function nativeAcceptance(t: TestContext, mode: "visual" | "hostile" | "reconnect" | "relaunch" | "inheritance" | "parent", parentCase?: string): Promise<void> {
  const data = ownDataRoot(), native = path.resolve("dist/desktop-native"), variant = mode === "hostile" ? "hostile" : mode === "inheritance" ? "inheritance" : mode === "parent" ? "parent" : "visual"
  let artifactRoot = path.join(native, "acceptance", variant), ownedClone: string | undefined, cloneIdentity: ReturnType<typeof ownedDirectoryIdentity> | undefined
  if (mode === "inheritance") {
    ownedClone = fs.mkdtempSync(path.join(fs.realpathSync(path.dirname(artifactRoot)), "owned-consumed-")); cloneIdentity = ownedDirectoryIdentity(ownedClone)
    for (const name of ["cmspark-desktop.exe", "desktop-inheritance.exe"]) { const input = path.join(artifactRoot, name); const stat = fs.lstatSync(input); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1); fs.copyFileSync(input, path.join(ownedClone, name), fs.constants.COPYFILE_EXCL) }
    fs.mkdirSync(path.join(ownedClone, "assets"))
    for (const name of ["index.html", "app.css", "app.js"]) fs.copyFileSync(path.join(artifactRoot, "assets", name), path.join(ownedClone, "assets", name), fs.constants.COPYFILE_EXCL)
    artifactRoot = ownedClone
  }
  if (mode === "parent") {
    assert.ok(parentCase && path.isAbsolute(parentCase)); const real=fs.realpathSync(parentCase),relative=path.relative(fs.realpathSync(process.env.CMSPARK_TEST_RUN_DIR!),real)
    assert.ok(relative && relative!==".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); ownedDirectoryIdentity(parentCase);artifactRoot=real
  }
  const binary = path.join(artifactRoot, process.platform === "win32" ? "cmspark-desktop.exe" : "cmspark-desktop")
  assert.ok(fs.statSync(binary).isFile(), "Actual acceptance fixture build required")
  const addon = require(path.join(native, "desktop-launcher.node")) as DesktopNativeBinding
  const threads = new ThreadManager(); threads.create("Owned native acceptance")
  const skill = path.join(data, "skills", "owned-native-acceptance"); fs.mkdirSync(skill, { recursive: true })
  fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: owned-native-acceptance\ndescription: inert owned fixture\n---\nInert fixture.\n")
  const skills = new SkillEngine(), mcp = new McpManager()
  let issues = 0, launches = 0, exits = 0, auths = 0, listReads = 0
  let lastExitCode: number | null = null
  let capabilityId = "", secret = "", oldProof = "", ownedHost = ""
  const registry = new DesktopIdentityRegistry(), issue = registry.issue.bind(registry)
  registry.issue = host => { issues++; const boot = issue(host); ownedHost = host; capabilityId = boot.capabilityId; secret = boot.secret; return boot }
  const services = { threads, skills, mcp: { listServers: () => { listReads++; return mcp.listServers() } } }
  const server = http.createServer(), legacy = new WebSocketServer({ noServer: true })
  let launcher!: DesktopHostLauncher
  let observer!: ReturnType<typeof observeAcceptanceResponses>
  const channel = createDesktopChannel({ registry, services, maxPayload: 10 * 1024 * 1024, onAuthenticated: host => { if (observer.authenticated(host)) { auths++; launcher.authenticated(host) } } })
  attachDesktopUpgrade(server, legacy, channel.wss, () => false)
  const observations: AcceptanceReceipt[] = [], waiters = new Set<() => void>()
  let observedFailure: Error | undefined
  observer = observeAcceptanceResponses(channel.wss, () => ({ host: ownedHost, capabilityId }), registry, receipt => {
    if (receipt.kind === "fixed" && observations.some(r => r.kind === "fixed" && r.name === receipt.name)) observedFailure = Error("OWNED_NATIVE_DUPLICATE_PHASE")
    if ((receipt.kind === "inheritance" || receipt.kind === "identity") && observations.some(r => r.kind === receipt.kind)) observedFailure = Error("OWNED_NATIVE_DUPLICATE_PHASE")
    observations.push(receipt)
    if (receipt.kind === "fixed" && receipt.name.startsWith("FAIL_")) observedFailure = Error(receipt.name)
    for (const wake of waiters) wake()
  }, value => { if (!oldProof) oldProof = value }, () => { for (const wake of waiters) wake() })

  async function until(predicate: () => boolean): Promise<void> {
    const pending = new Promise<void>((resolve, reject) => {
      const wake = () => { if (observedFailure) { waiters.delete(wake); reject(observedFailure) } else if (predicate()) { waiters.delete(wake); resolve() } }
      waiters.add(wake); wake()
    })
    await bounded(pending, t.signal)
  }
  const has = (name: string) => observations.some(r => r.kind === "fixed" && r.name === name)
  let diagnosticPhase = "starting"
  const diagnostic = (reason: "deadline" | "cleanup") => {
    try { fs.writeSync(1, "DESKTOP_480_ACCEPTANCE_PHASE " + JSON.stringify(acceptanceDiagnostic(reason, diagnosticPhase, mode, { auths, issues, launches, exits, listReads, lastExitCode }, observations)) + "\n") }
    catch { /* Observation must not replace the original test failure. */ }
  }
  const deadlineDiagnostic = () => diagnostic("deadline")
  t.signal.addEventListener("abort", deadlineDiagnostic, { once: true })
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening", { signal: t.signal })
    const endpoint = `ws://127.0.0.1:${(server.address() as any).port}/desktop`
    launcher = new DesktopHostLauncher(registry, endpoint, (host, view) => channel.window(host, view), () => ({ binary, binding: {
      launch: (file, cap, key, url, onExit) => { const child = addon.launch(file, cap, key, url, code => { lastExitCode = code; exits++; onExit(code); for (const wake of waiters) wake() }); launches++; return child },
    } }))
    const a = launcher.open("compact"), b = launcher.open("compact")
    await bounded(Promise.all([a, b]).then(results => { for (const result of results) assert.equal(result.ok, true) }), t.signal)
    diagnosticPhase = "waiting-auth-metadata"
    await until(() => has("AUTH_1") && listReads > 0)
    assert.equal(issues, 1); assert.equal(launches, 1); assert.equal(legacy.clients.size, 0)
    if (mode === "visual") {
      await until(() => observations.some(r => r.kind === "window" && r.view === "compact"))
      requireWindow(observations.find(r => r.kind === "window" && r.view === "compact"), "compact")
      assert.equal((await launcher.open("workspace")).ok, true)
      await until(() => observations.some(r => r.kind === "window" && r.view === "workspace"))
      requireWindow(observations.find(r => r.kind === "window" && r.view === "workspace"), "workspace")
      const count = observations.filter(r => r.kind === "window" && r.view === "compact").length
      assert.equal((await launcher.open("compact")).ok, true)
      await until(() => observations.filter(r => r.kind === "window" && r.view === "compact").length > count)
      requireWindow(observations.filter(r => r.kind === "window" && r.view === "compact").at(-1), "compact")
      assert.equal(issues, 1); assert.equal(launches, 1)
    } else if (mode === "hostile") {
      await until(() => ["DEVTOOLS_DENIED", "FRAME_DENIED", "REMOTE_DENIED", "NEW_WINDOW_DENIED", "DOWNLOAD_DENIED", "DOCUMENT_FRESH", "STALE_DENIED"].every(has) && listReads >= 2)
      assert.equal(issues, 1); assert.equal(launches, 1)
    } else if (mode === "parent") {
      await until(() => has("PARENT_LOCK_ARMED")); process.stdout.write("D480_PARENT_ISSUER_READY\n")
      await bounded(new Promise<void>(() => {}), t.signal)
    } else if (mode === "inheritance") {
      await until(() => has("CONSUMED_HANDLES_DENIED")); requireInheritanceIdentity(observations); assert.equal(issues, 1); assert.equal(launches, 1)
    } else if (mode === "reconnect") {
      diagnosticPhase = "waiting-reconnect-auth"
      const old = observer.currentSocket(); assert.ok(old, "Owned authenticated current socket required"); old.terminate()
      await until(() => has("AUTH_2") && auths === 2)
      assert.equal(issues, 1); assert.equal(launches, 1)
      diagnosticPhase = "waiting-replay-close"
      const replay = new WebSocket(endpoint, { origin: DESKTOP_NATIVE_ORIGIN })
      try {
        replay.on("error", () => {})
        replay.on("message", bytes => { const f = JSON.parse(String(bytes)); if (f.type === "desktop.challenge.request") replay.send(JSON.stringify({ type: "desktop.hello", capability_id: capabilityId, protocol_version: 1 })); else if (f.type === "desktop.challenge") replay.send(JSON.stringify({ type: "desktop.authenticate", capability_id: capabilityId, protocol_version: 1, proof: oldProof })) })
        await once(replay, "close", { signal: t.signal })
        assert.equal(auths, 2); assert.equal(channel.wss.clients.size, 1)
      } finally { replay.terminate() }
    } else {
      diagnosticPhase = "waiting-relaunch"
      launcher.close(); await until(() => exits === 1)
      observations.length = 0
      assert.equal((await bounded(launcher.open("compact"), t.signal)).ok, true)
      await until(() => has("AUTH_1") && auths === 2)
      assert.equal(issues, 2); assert.equal(launches, 2)
    }
    diagnosticPhase = "complete"
    // A token is never returned, logged or persisted. Keep only finite scoped counts.
    assert.equal(secret.length, 64)
    console.log("DESKTOP_480_ACCEPTANCE " + JSON.stringify({ mode, auths, issues, launches, actualStoreReads: listReads, fixed: observations.filter(r => r.kind === "fixed").map(r => (r as { name: string }).name), windows: observations.filter(r => r.kind === "window") }))
  } finally {
    diagnostic("cleanup")
    t.signal.removeEventListener("abort", deadlineDiagnostic)
    launcher?.close(); registry.revokeAll()
    for (const ws of [...channel.wss.clients, ...legacy.clients]) ws.terminate()
    const settled = new Promise<void>(resolve => { const check = () => { if (exits === launches) { waiters.delete(check); resolve() } }; waiters.add(check); check() })
    const cleanup = Promise.all([settled, mcp.shutdown(), new Promise<void>(r => channel.wss.close(() => r())), new Promise<void>(r => legacy.close(() => r())), new Promise<void>((resolve, reject) => server.close(error => { if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error); else resolve() }))])
    server.closeAllConnections()
    // Existing test-only cleanup guard pattern. It never converts a native deadline failure into PASS.
    let timer: NodeJS.Timeout | undefined
    try { await Promise.race([cleanup, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("OWNED_NATIVE_CLEANUP_INCOMPLETE")), 1000); timer.unref() })]) }
    finally { clearTimeout(timer); capabilityId = ""; secret = ""; oldProof = ""; waiters.clear() }
    assert.equal(server.listening, false); assert.equal(channel.wss.clients.size, 0); assert.equal(legacy.clients.size, 0)
    assert.equal(exits, launches, "Every actually launched owned native process must settle")
    if (ownedClone && cloneIdentity) { requireOwnedDirectory(ownedClone, cloneIdentity); fs.rmSync(ownedClone, { recursive: true, force: true }) }
  }
}

export function fixedLine(child: ChildProcess, name: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve,reject)=>{
    let text="";const cleanup=()=>{child.stdout?.off("data",data);child.off("exit",exit);child.off("error",error);signal.removeEventListener("abort",abort)}
    const abort=()=>{cleanup();reject(signal.reason)},exit=()=>{cleanup();reject(Error("OWNED_CHILD_EXIT_BEFORE_FIXED_RECEIPT"))},error=()=>{cleanup();reject(Error("OWNED_CHILD_SPAWN_FAILED"))}
    const data=(chunk:Buffer)=>{text+=chunk.toString("utf8");if(text.length>4096){cleanup();reject(Error("OWNED_CHILD_RECEIPT_LIMIT"));return}let newline;while((newline=text.indexOf("\n"))>=0){const line=text.slice(0,newline).replace(/\r$/u,"");text=text.slice(newline+1);if(line===name){cleanup();resolve();return}}}
    child.stdout?.on("data",data);child.once("exit",exit);child.once("error",error);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort()
  })
}
export async function nativeParentDeath(t: TestContext): Promise<void> {
  const data=ownDataRoot(),directory=fs.mkdtempSync(path.join(data,"native-parent-")),identity=ownedDirectoryIdentity(directory)
  const file=path.join(directory,"parent-exit.receipt"),fd=fs.openSync(file,"wx+",0o600),before=fs.fstatSync(fd)
  assert.equal(before.isFile(),true);assert.equal(before.nlink,1);assert.equal(before.size,0)
  if(process.platform==="win32"){const processFile=fs.openSync(path.join(directory,"parent-process.receipt"),"wx",0o600);fs.closeSync(processFile)}
  let issuer:ChildProcess|undefined,probe:ChildProcess|undefined,nativeTeardownObserved=false
  const exited=(child:ChildProcess)=>new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve({code:child.exitCode,signal:child.signalCode});else child.once("close",(code,signal)=>resolve({code,signal}))})
  try{
    const source=path.resolve("dist/desktop-native/acceptance/parent"),binary=process.platform==="win32"?"cmspark-desktop.exe":"cmspark-desktop",checker=process.platform==="win32"?"desktop-parent-probe.exe":"desktop-parent-probe"
    for(const name of [binary,checker]){const input=path.join(source,name),stat=fs.lstatSync(input);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);fs.copyFileSync(input,path.join(directory,name),fs.constants.COPYFILE_EXCL)}
    fs.mkdirSync(path.join(directory,"assets"));for(const name of ["index.html","app.css","app.js"])fs.copyFileSync(path.join(source,"assets",name),path.join(directory,"assets",name),fs.constants.COPYFILE_EXCL)
    const env:NodeJS.ProcessEnv={CMSPARK_TEST_RUN_DIR:process.env.CMSPARK_TEST_RUN_DIR}
    for(const key of ["SystemRoot","SYSTEMROOT","TEMP","TMP","TMPDIR","PATH"])if(process.env[key])env[key]=process.env[key]
    // This is the actual owned issuer, not a secret-forwarding intermediary. Registry/native/bootstrap remain inside it.
    issuer=spawn(process.execPath,["--require",path.resolve("scripts/test-data-dir.cjs"),__filename,"--owned-parent",directory],{stdio:["ignore","pipe","pipe"],env});issuer.stderr?.resume()
    const issuerExit=exited(issuer);await fixedLine(issuer,"D480_PARENT_ISSUER_READY",t.signal)
    if(process.platform==="win32"){
      // Fixed negative observations bind neither another image nor a reused PID.
      for(const mode of ["--wrong-parent-creation","--wrong-parent-image"]){
        const negative=spawnSync(path.join(directory,checker),[mode],{stdio:"ignore",env,timeout:10000,windowsHide:true})
        assert.equal(negative.status,219,"Exact owned process identity mismatch must be refused before lock waiting")
        assert.equal(negative.signal,null)
      }
    }
    probe=spawn(path.join(directory,checker),[],{stdio:["ignore","pipe","pipe"],env});probe.stderr?.resume()
    const probeExit=exited(probe);await fixedLine(probe,"D480_PARENT_LOCK_WAITING",t.signal)
    const nativeExit=fixedLine(probe,"D480_PARENT_NATIVE_EXIT_OBSERVED",t.signal)
    assert.equal(issuer.kill("SIGKILL"),true);await bounded(issuerExit,t.signal)
    await nativeExit;const result=await bounded(probeExit,t.signal);assert.equal(result.code,0);assert.equal(result.signal,null);nativeTeardownObserved=true
    const after=fs.fstatSync(fd),named=fs.lstatSync(file);assert.ok(named.isFile()&&!named.isSymbolicLink());assert.equal(after.dev,before.dev);assert.equal(after.ino,before.ino);assert.equal(named.dev,before.dev);assert.equal(named.ino,before.ino);assert.equal(after.nlink,1);assert.equal(after.size,1)
    const byte=Buffer.alloc(1);assert.equal(fs.readSync(fd,byte,0,1,0),1);assert.equal(byte[0],49)
    console.log("DESKTOP_480_PARENT_EXIT "+JSON.stringify({actualIssuerKilled:true,nativeHeldLockBeforeKill:true,actualNativeTeardownObserved:true,freshSameFileOneBit:true}))
  }finally{
    for(const child of [issuer,probe])if(child&&child.exitCode===null&&child.signalCode===null)child.kill("SIGKILL")
    await Promise.all([issuer,probe].filter((c):c is ChildProcess=>!!c).map(exited));fs.closeSync(fd);requireOwnedDirectory(directory,identity)
    // A failed/aborted case cannot prove whether the detached native host has exited.
    // Its fixed20s test-only watchdog is only a safety guard, never a positive receipt.
    if(nativeTeardownObserved)fs.rmSync(directory,{recursive:true,force:true})
    else console.log("DESKTOP_480_PARENT_CLEANUP "+JSON.stringify({ownedIssuerAndProbeClosed:true,nativeTeardownObserved:false,ownedCaseRetained:true}))
  }
}
// Only this unshipped owned fixture CLI. No capability/secret travels in argv/env/stdout.
if(require.main===module){
  if(process.argv.length!==4||process.argv[2]!=="--owned-parent")throw Error("OWNED_PARENT_ARGUMENTS_INVALID")
  nativeAcceptance({signal:AbortSignal.timeout(20000)} as TestContext,"parent",process.argv[3]).catch(()=>{process.stderr.write("OWNED_PARENT_FIXTURE_FAILED\n");process.exitCode=1})
}
