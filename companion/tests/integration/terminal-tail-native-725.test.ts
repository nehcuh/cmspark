/** #725 hosted-only REAL @lydell PTY transport; never a shell/Agent/human/browser claim. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const supported = process.platform === "win32" || process.platform === "darwin"

/** Must finish before any application/native import. Values of removed keys are never read. */
function hostedOwnedAdmission() {
  assert.ok(supported, "NATIVE725_UNSUPPORTED_HOST")
  assert.equal(process.env.GITHUB_ACTIONS, "true", "NATIVE725_GHA_REQUIRED")
  assert.equal(process.env.RUNNER_OS, process.platform === "win32" ? "Windows" : "macOS", "NATIVE725_RUNNER_REQUIRED")
  const run = process.env.CMSPARK_TEST_RUN_DIR, data = process.env.CMSPARK_DATA_DIR
  assert.ok(run && data && path.isAbsolute(run) && path.isAbsolute(data), "NATIVE725_CANONICAL_PRELOAD_REQUIRED")
  const runReal = fs.realpathSync(run), dataReal = fs.realpathSync(data)
  const runStat = fs.lstatSync(run, { bigint: true }), dataStat = fs.lstatSync(data, { bigint: true })
  assert.ok(runStat.isDirectory() && !runStat.isSymbolicLink() && dataStat.isDirectory() && !dataStat.isSymbolicLink(), "NATIVE725_OWNED_DIRECTORY_REQUIRED")
  const relation = path.relative(runReal, dataReal)
  assert.ok(relation && relation !== ".." && !relation.startsWith(".." + path.sep) && !path.isAbsolute(relation), "NATIVE725_OWNED_CONTAINMENT_REQUIRED")
  const verify = () => {
    for (const [file, physical, before] of [[run, runReal, runStat], [data, dataReal, dataStat]] as const) {
      assert.equal(fs.realpathSync(file), physical, "NATIVE725_OWNED_IDENTITY_CHANGED")
      const now = fs.lstatSync(file, { bigint: true }), real = fs.statSync(physical, { bigint: true })
      assert.ok(now.isDirectory() && !now.isSymbolicLink(), "NATIVE725_OWNED_IDENTITY_CHANGED")
      assert.equal(now.dev, before.dev); assert.equal(now.ino, before.ino)
      assert.equal(now.dev, real.dev); assert.equal(now.ino, real.ino)
    }
  }
  verify()
  const keep = new Set(["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TZ",
    "GITHUB_ACTIONS", "RUNNER_OS", "CMSPARK_TEST_RUN_DIR", "CMSPARK_DATA_DIR", "RUNNER_TRACKING_ID"])
  // Existing runner tracking is inherited only. No value copy/log/hash, no HOME replacement.
  const admitted = process.platform === "win32" ? new Set([...keep].map(key => key.toUpperCase())) : keep
  for (const key of Object.keys(process.env)) if (!admitted.has(process.platform === "win32" ? key.toUpperCase() : key)) delete process.env[key]
  verify()
  return { data: dataReal, verify }
}

// Fixed owned child writes only synthetic output and its own start marker. No env/provider/network/home access.
const childSource = `"use strict";
const fs=require("node:fs"),path=require("node:path"),readline=require("node:readline");
fs.writeFileSync(path.join(__dirname,"started-"+process.pid),"owned",{flag:"wx",mode:0o600});
process.stdout.write("NATIVE725_READY\\r\\n");
readline.createInterface({input:process.stdin,terminal:false}).on("line",line=>{
 if(line==="echo hi")process.stdout.write("NATIVE725_ECHO:hi\\r\\n");
 else if(line==="payload")process.stdout.write("NATIVE725_DROP_OLD"+"x".repeat(10000)+"中文😀\\x1b]52;c;synthetic\\x07\\u202eNATIVE725_PAYLOAD_DONE\\r\\n");
 else if(line==="exit"){process.stdout.write("NATIVE725_EXIT\\r\\n");process.exit(0);}
});
`

async function nativeRuntime(signal: AbortSignal) {
  const owned = hostedOwnedAdmission()
  const config = await import("../../src/config")
  assert.equal(fs.realpathSync(config.getConfigDir()), owned.data, "NATIVE725_CONFIG_SCOPE")
  await config.initDataDir()
  config.saveConfig({ embedded_terminal: { enabled: true } })
  const scratch = fs.mkdtempSync(path.join(owned.data, "native725-"))
  const child = path.join(scratch, "owned-transport.cjs")
  fs.writeFileSync(child, childSource, { flag: "wx", mode: 0o600 })
  const pty = await import("../../src/pty/session")
  assert.equal(pty.isPtyBusy(), false, "NATIVE725_EXISTING_SLOT_NOT_OWNED")
  const handler = await import("../../src/pty/handler")
  const intents = await import("../../src/acp/open-local-terminal")
  const tail = await import("../../src/pty/tail")
  const readers = await import("../../src/pty/tail-read")
  const dispatcher = await import("../../src/tool/companion-dispatch")
  const threadId = "native725-" + path.basename(scratch), id = "pty-" + path.basename(scratch)
  const thread = { id: threadId, workspace_root: scratch }
  const services = { threadManager: { get: (value: string) => value === threadId ? thread : null } } as unknown as Parameters<typeof handler.handleTerminalMessage>[2]
  const owner = { readyState: 1 }, foreign = { readyState: 1 }
  let output = "", dataFrames = 0, acks = 0, closed = 0, confirmationCount = 0, spawnNotifications = 0, frameError = false
  const wake = new Set<() => void>()
  const notify = () => { for (const fn of [...wake]) fn() }
  const unsubscribe = pty.onPtyAgentSpawned(() => { spawnNotifications++; notify() })
  let session: Parameters<typeof handler.handleTerminalMessage>[3]
  const send = (frame: any) => {
    if (frame.type === "terminal.data" && frame.id === id) {
      dataFrames++; output = (output + Buffer.from(frame.b64, "base64").toString("utf8")).slice(-65536)
      void handler.handleTerminalMessage("terminal.ack", { id, seq: frame.seq }, services, session, "panel")
        .then(value => { if (value.type !== "terminal.ok") frameError = true; else acks++; notify() }, () => { frameError = true; notify() })
    } else if (frame.type === "terminal.closed" && frame.id === id) closed++
    else if (frame.type === "terminal.error") frameError = true
    notify()
  }
  session = { surface: "panel", originWs: owner, sendToExtension: send, requestConfirmation: async details => {
    confirmationCount++
    assert.equal(details.toolName, "terminal.open")
    assert.deepEqual(details.dangerousApis, ["pty", "shell"])
    assert.ok(details.code.includes(tail.TERMINAL_TAIL_DISCLOSURE), "NATIVE725_DISCLOSURE_BEFORE_APPROVAL")
    return { approved: true } // Test decision, never described as human approval.
  } }
  const wait = (predicate: () => boolean, label: string, deadline: number) => new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const cleanup = () => { clearTimeout(timer); wake.delete(check); signal.removeEventListener("abort", aborted) }
    const check = () => { if (predicate()) { cleanup(); resolve() } }
    const aborted = () => { cleanup(); reject(new Error("NATIVE725_TEST_ABORTED")) }
    const remaining = deadline - performance.now()
    if (remaining <= 0) { reject(new Error("NATIVE725_" + label)); return }
    timer = setTimeout(() => { cleanup(); reject(new Error("NATIVE725_" + label)) }, remaining)
    wake.add(check); signal.addEventListener("abort", aborted, { once: true }); check()
  })
  const call = (type: string, rest: Record<string, unknown> = {}, who = session) => handler.handleTerminalMessage(type, { id, ...rest }, services, who, "panel")
  const open = async (approved = true) => {
    owned.verify(); assert.equal(signal.aborted, false, "NATIVE725_TEST_ABORTED"); assert.equal(pty.isPtyBusy(), false)
    intents.recordEmbedIntent(threadId, { cwd: scratch, file: process.execPath, args: [child] })
    const target = approved ? session : { ...session!, requestConfirmation: async (details: any) => {
      confirmationCount++; assert.ok(details.code.includes(tail.TERMINAL_TAIL_DISCLOSURE)); return { approved: false }
    } }
    return call("terminal.open", { user_gesture: true, thread_id: threadId, cwd: scratch }, target)
  }
  const input = async (line: string) => { const value = await call("terminal.input", { b64: Buffer.from(line + "\r").toString("base64") }); assert.equal(value.type, "terminal.ok", "NATIVE725_INPUT_REFUSED") }
  const reader = readers.bindTerminalTailReader(owner, threadId, value => services.threadManager.get(value), () => owner.readyState === 1)
  const privateRead = () => dispatcher.executeCompanionTool("terminal_tail_read", { session_id: id }, "native725-inert-call", { readTerminalTail: reader })
  const verifyTail = (value: any, marker: string) => {
    assert.equal(value.success, true, "NATIVE725_TAIL_REFUSED")
    assert.equal(value.data.tainted, true); assert.equal(typeof value.data.truncated, "boolean")
    assert.ok(value.data.text.includes(marker), "NATIVE725_MISSING_OWNED_OUTPUT")
    assert.ok(value.data.text.includes(tail.TERMINAL_TAIL_DISCLOSURE)); assert.ok(value.data.text.endsWith("<<<END_UNTRUSTED_TERMINAL_TAIL>>>"))
    const begin = value.data.text.indexOf("<<<UNTRUSTED_TERMINAL_TAIL>>>\n") + "<<<UNTRUSTED_TERMINAL_TAIL>>>\n".length
    const body = value.data.text.slice(begin, -"\n<<<END_UNTRUSTED_TERMINAL_TAIL>>>".length)
    assert.equal(value.data.bytes, Buffer.byteLength(body)); assert.ok(value.data.bytes <= 8192); assert.ok(JSON.stringify(value).length <= 8000)
    assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(body), "NATIVE725_ACTIVE_CONTROL")
  }
  const cleanup = async () => {
    try {
      if (pty.getOwnedPtyContext(id, owner)) await call("terminal.close")
      // Closure may still reserve the original Windows tree slot; never reset it to pass.
      await wait(() => !pty.isPtyBusy(), "CLEANUP_SLOT_NOT_RELEASED", performance.now() + 6000)
      owned.verify(); fs.rmSync(scratch, { recursive: true, force: false })
    } finally { unsubscribe() }
  }
  return { owned, scratch, id, owner, foreign, session, services, pty, readers, threadId, wait, call, open, input, privateRead, verifyTail, cleanup,
    output: () => output, clearOutput: () => { output = "" }, framesAcked: () => dataFrames > 0 && acks === dataFrames,
    closed: () => closed, confirmations: () => confirmationCount, spawned: () => spawnNotifications, frameError: () => frameError }
}

function fixedUnavailable(value: any) {
  assert.deepEqual(value, { success: false, error: "TERMINAL_TAIL_UNAVAILABLE", error_code: "TERMINAL_TAIL_UNAVAILABLE" })
}

// Unsupported Linux is the only skip. Supported non-GHA/manual calls fail before imports/spawn.
test("725 hosted real PTY transport: disclosed open, echo, rollover, CJK/control and close", { skip: !supported, timeout: 20_000, concurrency: false }, async t => {
  const r = await nativeRuntime(t.signal), deadline = performance.now() + 12000
  try {
    const opened = await r.open(); assert.equal(opened.type, "terminal.opened", "NATIVE725_REAL_PTY_OPEN_REQUIRED")
    assert.equal(opened.launch_kind, "embedded_agent") // Existing source label; child is a fixture, not a coding Agent.
    await r.wait(() => r.output().includes("NATIVE725_READY") && r.framesAcked(), "READY_NOT_OBSERVED", deadline)
    assert.equal(r.spawned(), 1); assert.equal(r.confirmations(), 1)
    await r.input("echo hi")
    await r.wait(() => r.output().includes("NATIVE725_ECHO:hi") && r.framesAcked(), "ECHO_NOT_OBSERVED", deadline)
    r.verifyTail(await r.privateRead(), "NATIVE725_ECHO:hi")
    const ui = await r.call("terminal.tail.read"); assert.equal(ui.type, "terminal.tail"); r.verifyTail(ui.result, "NATIVE725_ECHO:hi")
    r.clearOutput(); await r.input("payload")
    await r.wait(() => r.output().includes("NATIVE725_PAYLOAD_DONE") && r.framesAcked(), "PAYLOAD_NOT_OBSERVED", deadline)
    assert.ok(Buffer.byteLength(r.output()) > 8192, "NATIVE725_NATIVE_OUTPUT_BOUNDARY_NOT_REACHED")
    assert.ok(r.output().includes("中文😀"), "NATIVE725_NATIVE_CJK_NOT_OBSERVED")
    const tail = await r.privateRead(); r.verifyTail(tail, "NATIVE725_PAYLOAD_DONE")
    assert.equal(tail.data.truncated, true); assert.ok(tail.data.text.includes("中文😀")); assert.ok(tail.data.text.includes("[U+202E]"), "NATIVE725_NATIVE_CONTROL_NOT_OBSERVED")
    assert.ok(!tail.data.text.includes("NATIVE725_DROP_OLD")); assert.equal(r.frameError(), false)
    await r.call("terminal.close"); fixedUnavailable(await r.privateRead())
    await r.wait(() => r.closed() > 0 && !r.pty.isPtyBusy(), "CLOSE_NOT_RELEASED", deadline)
    r.clearOutput(); const reopened = await r.open(); assert.equal(reopened.type, "terminal.opened")
    await r.wait(() => r.output().includes("NATIVE725_READY") && r.framesAcked(), "REOPEN_NOT_READY", deadline)
    const fresh = await r.privateRead(); r.verifyTail(fresh, "NATIVE725_READY"); assert.ok(!fresh.data.text.includes("NATIVE725_PAYLOAD_DONE"), "NATIVE725_OLD_BODY_REVIVED")
    t.diagnostic("actual native PTY with fixed owned Node transport; synthetic L2 decision; no shell/Agent/provider/human/browser claim")
  } finally { await r.cleanup() }
})

test("725 hosted real PTY transport: denied open, foreign owner, peer loss and native exit", { skip: !supported, timeout: 20_000, concurrency: false }, async t => {
  const r = await nativeRuntime(t.signal), deadline = performance.now() + 12000
  try {
    const denied = await r.open(false); assert.equal(denied.type, "terminal.closed"); assert.equal(denied.code, "denied")
    assert.equal(r.pty.isPtyBusy(), false); assert.equal(r.spawned(), 0)
    assert.equal(fs.readdirSync(r.scratch).filter(name => name.startsWith("started-")).length, 0, "NATIVE725_DENIED_CHILD_LAUNCHED")
    fixedUnavailable(await r.privateRead())
    const opened = await r.open(); assert.equal(opened.type, "terminal.opened", "NATIVE725_REAL_PTY_OPEN_REQUIRED")
    await r.wait(() => r.output().includes("NATIVE725_READY") && r.framesAcked(), "READY_NOT_OBSERVED", deadline)
    const foreign = r.readers.bindTerminalTailReader(r.foreign, r.threadId, id => r.services.threadManager.get(id), () => true)
    fixedUnavailable(foreign(r.id))
    const refused = await r.call("terminal.close", {}, { ...r.session!, originWs: r.foreign }); assert.equal(refused.type, "terminal.error")
    assert.equal(r.pty.getLivePtyId(), r.id)
    r.owner.readyState = 3
    assert.equal(r.pty.killPtyByPeer(r.owner), true) // Exact production WS-close entry; no browser is launched.
    r.owner.readyState = 1; fixedUnavailable(await r.privateRead())
    await r.wait(() => !r.pty.isPtyBusy(), "PEER_CLOSE_NOT_RELEASED", deadline)
    r.clearOutput(); const reopened = await r.open(); assert.equal(reopened.type, "terminal.opened")
    await r.wait(() => r.output().includes("NATIVE725_READY") && r.framesAcked(), "REOPEN_NOT_READY", deadline)
    const before = r.closed(); await r.input("exit")
    await r.wait(() => r.closed() > before && !r.pty.isPtyBusy(), "NATIVE_EXIT_NOT_RELEASED", deadline)
    fixedUnavailable(await r.privateRead()); assert.equal(r.frameError(), false)
    t.diagnostic("actual owned PTY lifecycle; denied0successfullaunch/foreign/peer-loss/native-exit; unchanged tree cleanup and45s heartbeat")
  } finally { await r.cleanup() }
})
