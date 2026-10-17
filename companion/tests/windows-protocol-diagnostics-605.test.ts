/** Actual source helpers only; never import/run the native integration module. */
import test, { after, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { EventEmitter, errorMonitor } from "node:events"
import http from "node:http"
import https from "node:https"
import net from "node:net"
import tls from "node:tls"
let attempts = 0
const deny = () => { attempts++; throw new Error("Forbidden OS/network effect in source-only controls") }
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) mock.method(require("node:child_process"), key, deny as any)
for (const mod of [http, https]) for (const key of ["request", "get"] as const) mock.method(mod, key, deny as any)
mock.method(net, "connect", deny as any); mock.method(net, "createConnection", deny as any); mock.method(tls, "connect", deny as any)
for (const mod of [net, http, https]) mock.method(mod, "createServer", deny as any)
mock.method(process, "kill", deny as any); mock.method(process, "dlopen", deny as any)
after(() => { assert.equal(attempts, 0); mock.restoreAll() })
const ts = require("typescript") as typeof import("typescript")
const root = path.resolve(__dirname, "../..")
const source = fs.readFileSync(path.join(root, "tests/integration/windows-job-env-605.test.ts"), "utf8")
const ast = ts.createSourceFile("actual.ts", source, ts.ScriptTarget.Latest, true)
const helpers = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ["wait", "assertProtocol", "observeProtocolStartup"].includes(n.name?.text ?? ""))
assert.equal(helpers.filter(n => (n as import("typescript").FunctionDeclaration).name?.text === "wait").length, 1)
const actualHelpers = ts.transpileModule(helpers.map(n => n.getText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function fixture(clockFault = false) {
  let now = 0, pauses = 0
  const ctx = vm.createContext({ assert, Buffer, errorMonitor, Date: { now: () => now },
    performance: { now: () => { if (clockFault) throw new Error("owned clock fault"); return now } },
    pause: async (ms: number) => { assert.equal(ms, 20); pauses++; now += ms },
  })
  vm.runInContext(actualHelpers, ctx)
  return { ctx, get now() { return now }, get pauses() { return pauses }, advance: (n: number) => { now += n } }
}
test("actual wait does not observe metadata on successful polls", async () => {
  const f = fixture(); let checks = 0, reads = 0
  await f.ctx.wait(() => ++checks === 4, () => { reads++; throw new SyntaxError("owned partial marker") })
  assert.equal(f.now, 60); assert.equal(f.pauses, 3); assert.equal(reads, 0)
})
test("actual timeout stays 8000ms/400polls with one diagnostic snapshot", async () => {
  const f = fixture(); let reads = 0
  await assert.rejects(f.ctx.wait(() => false, () => { reads++; return "owned deadline" }), { code: "ERR_ASSERTION" })
  assert.equal(f.now, 8000); assert.equal(f.pauses, 400); assert.equal(reads, 1)
})
test("metadata failure cannot replace the original deadline assertion", async () => {
  const f = fixture(); let reads = 0
  await assert.rejects(f.ctx.wait(() => false, () => { reads++; throw new SyntaxError("owned partial marker") }), { code: "ERR_ASSERTION", message: "Owned protocol assertion failed; diagnostic unavailable" })
  assert.equal(f.now, 8000); assert.equal(reads, 1)
})
test("actual predicate failure keeps the same error without diagnostic work", async () => {
  const f = fixture(), sentinel = new Error("owned predicate")
  await assert.rejects(f.ctx.wait(() => { throw sentinel }, () => { throw new Error("must not run") }), e => e === sentinel)
  assert.equal(f.now, 0); assert.equal(f.pauses, 0)
})
function child() {
  return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
}
function records(observation: any, environment = "full", timing = "immediate") {
  const rows: any[] = []; observation.emit({ diagnostic: (raw: string) => rows.push(JSON.parse(raw)) }, environment, timing); return rows
}
test("actual owned events produce finite timings/counts and no payload or PID", () => {
  const f = fixture(), o = f.ctx.observeProtocolStartup(), c = child()
  f.advance(1); o.prepared(); f.advance(1); o.spawned(c); f.advance(1); c.emit("spawn")
  c.stdout.emit("data", Buffer.from("OWNED_PRIVATE_PAYLOAD")); c.stderr.emit("data", "中文")
  o.written(); f.advance(1); c.emit("exit", 0, null); c.emit("close", 0, null)
  const [r] = records(o)
  assert.equal(r.prepared_ms, 1); assert.equal(r.spawn_return_ms, 2); assert.equal(r.spawn_event_ms, 3)
  assert.equal(r.stdout_first_ms, 3); assert.equal(r.stdout_bytes, 21); assert.equal(r.stderr_bytes, 6)
  assert.equal(r.stdin_callback_ms, 3); assert.equal(r.exit_ms, 4); assert.equal(r.close_ms, 4); assert.equal(r.exit_code, 0)
  assert.doesNotMatch(JSON.stringify(r), /OWNED_PRIVATE|pid|argv|cwd|path|command|secret/)
})
test("actual errorMonitor preserves the original unhandled error and snapshots code once", () => {
  const f = fixture(), o = f.ctx.observeProtocolStartup(), c = child(); o.spawned(c)
  let reads = 0
  const sentinel = Object.defineProperty(new Error("OWNED_PRIVATE_ERROR"), "code", { get() { return ++reads === 1 ? "EPIPE" : "OWNED_PRIVATE_CODE" } })
  assert.throws(() => c.emit("error", sentinel), e => e === sentinel)
  const [r] = records(o); assert.equal(reads, 1); assert.equal(r.error_code, "EPIPE")
  assert.doesNotMatch(JSON.stringify(r), /OWNED_PRIVATE/)
})
test("actual observer rejects code coercion and invalid labels without replacing faults", () => {
  const f = fixture(), o = f.ctx.observeProtocolStartup(); let coercions = 0
  o.written(Object.defineProperty({}, "code", { get() { return { toString() { coercions++; throw new Error("must not coerce") } } } }))
  assert.equal(records(o)[0].error_code, "OTHER"); assert.equal(coercions, 0)
  assert.equal(records(o, "OWNED_PRIVATE_ENV").length, 0)
  assert.doesNotThrow(() => o.emit({ diagnostic() { throw new Error("owned logger fault") } }, "full", "immediate"))
})
test("actual observer clock failure remains non-authoritative and non-throwing", () => {
  const f = fixture(true), o = f.ctx.observeProtocolStartup(), c = child()
  assert.doesNotThrow(() => { o.prepared(); o.spawned(c); o.written(); c.emit("spawn"); c.emit("close") })
  const [r] = records(o); assert.equal(r.prepared_ms, null); assert.equal(r.spawn_event_ms, null); assert.equal(r.close_ms, null)
})
