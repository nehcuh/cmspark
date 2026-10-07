import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { createKimiTaskPrefill } from "../src/pty/kimi-task-prefill"

// Captured from the installed Kimi Code 2.1.1 PTY. No login, trust approval,
// message submission or external model request was made to record these screens.
const ready = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/kimi-prefill/ready.ansi"), "utf8")
const trust = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/kimi-prefill/trust.ansi"), "utf8")

test("a fragmented TUI render waits for the message box and submits a multiline task once", () => {
  const writes: string[] = []
  const feed = createKimiTaskPrefill("审阅代码\n'quotes' $(literal)", text => writes.push(text))
  for (const char of trust) feed(char)
  assert.deepEqual(writes, [])
  const completion = ready.indexOf("\x1b[?2026l", ready.indexOf("Welcome to Kimi Code!"))
  for (const char of ready.slice(0, completion)) feed(char)
  assert.deepEqual(writes, [])
  for (const char of ready.slice(completion)) feed(char)
  feed(ready)
  assert.deepEqual(writes, ["\x1b[200~审阅代码\n'quotes' $(literal)\x1b[201~\r"])
})

test("task controls cannot escape bracketed paste; only the final Enter submits", () => {
  const writes: string[] = []
  createKimiTaskPrefill("text\r\n\x1b[201~\x03\rdo not run", text => writes.push(text))(ready)
  assert.deepEqual(writes, ["\x1b[200~text\n[201~\ndo not run\x1b[201~\r"])
})

test("no Enter is sent for trust screens, absent tasks, or subsequent permission screens", () => {
  const writes: string[] = []
  const feed = createKimiTaskPrefill("review", text => writes.push(text))
  feed(trust)
  assert.equal(writes.length, 0)
  feed(ready)
  feed(trust)
  feed(ready)
  createKimiTaskPrefill(undefined, text => writes.push(text))(ready)
  assert.deepEqual(writes, ["\x1b[200~review\x1b[201~\r"])
})

test("a failed write is never retried into a subsequent screen", () => {
  let attempts = 0
  const feed = createKimiTaskPrefill("review", () => { attempts++; throw new Error("closed") })
  assert.throws(() => feed(ready), /closed/)
  assert.equal(feed(ready), false)
  assert.equal(feed(trust), false)
  assert.equal(attempts, 1)
})

test("an old ready render coalesced with a trust menu never submits into the menu", () => {
  const writes: string[] = []
  const feed = createKimiTaskPrefill("review", text => writes.push(text))
  assert.equal(feed(ready + trust), false)
  assert.deepEqual(writes, [])
  assert.equal(feed(ready), true, "a later actual input render can accept the approved task")
  assert.equal(writes.length, 1)
})

test("a partial newer menu frame prevents fallback to the old ready frame", () => {
  const writes: string[] = []
  const feed = createKimiTaskPrefill("review", text => writes.push(text))
  const split = trust.indexOf("Trust this folder?")
  assert.equal(feed(ready + trust.slice(0, split)), false)
  assert.equal(feed(trust.slice(split)), false)
  assert.deepEqual(writes, [])
})

test("permission and login overlays in the same input render never receive Enter", () => {
  for (const menu of ["Trust this folder?", "Login required", "Sign in", "Yes, allow reading from /project", "Permissions"]) {
    const writes: string[] = []
    const feed = createKimiTaskPrefill("review", text => writes.push(text))
    const rendered = `\x1b[?2026hWelcome to Kimi Code!\nNo session yet\n│ >   │\n${menu}\x1b[?2026l`
    assert.equal(feed("\x1b[?2004h" + rendered), false, menu)
    assert.deepEqual(writes, [], menu)
  }
})
