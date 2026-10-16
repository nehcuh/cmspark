import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

// Source-bound scheduler control, not a WinHTTP/WebView2 emulator. Replay the
// finite atomic/UI ordering with the actual native guards and mutations.
const cpp = fs.readFileSync("src/desktop/native/DesktopHost.cpp", "utf8")
const network = cpp.match(/if\(!ready\.(exchange\(false\)|load\(\))\)ExitProcess\(41\);post\(native_offline,id\);Sleep\(5000\);/)
assert.ok(network, "native disconnect guard must be explicitly modeled")
const offline = cpp.match(/else if\(message==native_offline\)\{([^{}]*?)if\(self->web\)/)?.[1]
assert.ok(offline)
const statements = offline.split(";").map(x => x.trim()).filter(Boolean)
assert.ok(statements.every(x => ["self->ready=false", "self->generation.clear()", "self->requests.clear()"].includes(x)))
const retiredEpochRecheck = cpp.includes('if(!ready||phase!=L"ready"){if(frame_epoch!=epoch)return;throw std::runtime_error("PHASE");}')
assert.ok(retiredEpochRecheck || cpp.includes('if(!ready||phase!=L"ready")throw std::runtime_error("PHASE");'))
if (retiredEpochRecheck) {
  assert.equal(cpp.includes("void accept(std::wstring const& body,unsigned long frame_epoch){"), true)
  assert.equal(cpp.includes("self->accept(frame->value,frame->epoch)"), true)
}
assert.equal(cpp.includes("if(frame->epoch!=self->epoch)return 0;"), true)

type State = { ready: boolean; phase: string; epoch: number; generation: boolean; pending: boolean; accepted: number }
function connected(): State { return { ready: true, phase: "ready", epoch: 1, generation: true, pending: true, accepted: 0 } }
function disconnect(s: State): void {
  const wasReady = s.ready
  if (network![1] === "exchange(false)") s.ready = false
  if (!wasReady) throw Error("EXIT_41")
}
function frame(s: State, epoch: number, networkAfterEpochCheck?: () => void): void {
  if (epoch !== s.epoch) return
  networkAfterEpochCheck?.()
  if (!s.ready || s.phase !== "ready") {
    if (retiredEpochRecheck && epoch !== s.epoch) return
    throw Error("EXIT_45_PHASE")
  }
  s.accepted++
}
function offlineMessage(s: State, epoch: number): void {
  if (epoch !== s.epoch) return
  for (const statement of statements) {
    if (statement === "self->ready=false") s.ready = false
    else if (statement === "self->generation.clear()") s.generation = false
    else if (statement === "self->requests.clear()") s.pending = false
  }
}

test("authenticated frame queued before disconnect drains before the UI clears readiness", () => {
  const s = connected()
  // The network posts frame1, then observes the closed socket and posts offline1.
  // The UI can be descheduled throughout both posts: FIFO alone cannot protect
  // frame1 from an atomic readiness clear performed on the network thread.
  disconnect(s)
  assert.doesNotThrow(() => frame(s, 1))
  assert.equal(s.accepted, 1)
  offlineMessage(s, 1)
  assert.deepEqual([s.ready, s.generation, s.pending], [false, false, false])
})

test("already drained authenticated frames keep the same disconnect cleanup", () => {
  const s = connected()
  frame(s, 1)
  disconnect(s)
  offlineMessage(s, 1)
  assert.deepEqual([s.accepted, s.ready, s.generation, s.pending], [1, false, false, false])
})

test("initial unauthenticated connection failure still exits rather than reconnecting", () => {
  const s = connected(); s.ready = false; s.phase = "initial"
  assert.throws(() => disconnect(s), /EXIT_41/)
})

test("old epoch messages cannot clear or authorize a newer connection", () => {
  const s = connected(); s.epoch = 2
  offlineMessage(s, 1)
  frame(s, 1)
  assert.deepEqual([s.ready, s.generation, s.pending, s.accepted], [true, true, true, 0])
})

test("network retirement between UI epoch admission and readiness sampling ignores the retired frame", () => {
  const s = connected()
  assert.doesNotThrow(() => frame(s, 1, () => { s.epoch++; s.ready = false }))
  assert.deepEqual([s.epoch, s.ready, s.accepted], [2, false, 0])
})

test("after UI offline and during invalid handshake phases frames still fail closed", () => {
  const s = connected(); disconnect(s); offlineMessage(s, 1)
  assert.throws(() => frame(s, 1), /EXIT_45_PHASE/)
  s.ready = true; s.phase = "hello"
  assert.throws(() => frame(s, 1), /EXIT_45_PHASE/)
  assert.equal(s.accepted, 0)
})
