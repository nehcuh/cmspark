import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const original = fs.readFileSync("src/desktop/native/DesktopHost.swift", "utf8")
const fixture = fs.readFileSync("tests/fixtures/desktop-480/native-acceptance.swift", "utf8")
const controller = fs.readFileSync("tests/fixtures/desktop-480/native-acceptance-controller.ts", "utf8")
// Semantic adjacency accepts checkout EOLs; byte-exact builder inputs remain raw.
const stopBeforeWindowEmit = /self\.stopWindow\(\)\r?\n            self\.emit\(host,"WINDOW_"/
// Execute the actual closed Swift Boolean expressions as source-derived CPU
// controls. This does not implement AppKit notifications or certify native focus.
function predicates() {
  const current = fixture.match(/func windowCurrent\([^\n]*\)->Bool \{\s*return ([^\n]+)\n/)
  const ready = fixture.match(/guard (win\.isKeyWindow && NSApp\.isActive) else\{return\}/)
  assert.ok(current && ready, "explicit native observation predicates required")
  return { current: new Function("host", "win", "socket", "view", `return (${current[1]})`) as (...args: any[]) => boolean,
    ready: new Function("win", "NSApp", `return (${ready[1]})`) as (...args: any[]) => boolean }
}

test("Mac acceptance waits for actual key and active predicates instead of one queued snapshot", () => {
  const { ready } = predicates(), win = { isKeyWindow: false }, app = { isActive: false }
  assert.equal(ready(win, app), false)
  win.isKeyWindow = true; assert.equal(ready(win, app), false)
  app.isActive = true; assert.equal(ready(win, app), true)
  win.isKeyWindow = false; assert.equal(ready(win, app), false)
  assert.ok(fixture.includes("NSApplication.didBecomeActiveNotification"))
  assert.ok(fixture.includes("NSWindow.didBecomeKeyNotification"))
})

test("Mac observation stays bound to the same native window, current authenticated socket and requested view", () => {
  const { current } = predicates(), win = {}, socket = {}
  const host = { window: win, socket, view: "compact", authenticated: true, phase: "ready" }
  assert.equal(current(host, win, socket, "compact"), true)
  for (const delta of [{ window: {} }, { socket: {} }, { view: "workspace" }, { authenticated: false }, { phase: "initial" }]) {
    assert.equal(current({ ...host, ...delta }, win, socket, "compact"), false)
  }
  assert.equal(current(host, win, socket, "workspace"), false)
})

test("Mac observation records original identity before completion and retains all seven strict bits", () => {
  const arm = fixture.indexOf("if firstWindow==nil { firstWindow=win.windowNumber }")
  assert.ok(arm > 0 && arm < fixture.indexOf("windowObservation={"))
  assert.ok(fixture.includes("let bits=[win.isVisible,win.isKeyWindow,NSApp.isActive,self.firstWindow==win.windowNumber,ownCount==1,client.width==expected.width&&client.height==expected.height,work.contains(frame)]"))
  assert.ok(controller.includes('assert.equal(r.bits, "1111111"'))
  assert.ok(controller.includes('observations.find(r => r.kind === "window" && r.view === "compact")'))
  assert.ok(stopBeforeWindowEmit.test(fixture))
})

test("Mac acceptance builder preserves production bytes and arms cleanup only in the test variant", async () => {
  const builder = await (new Function("url", "return import(url)"))(pathToFileURL(path.resolve("scripts/build-desktop-windows.mjs")).href)
  const variant = builder.desktopAcceptanceVariant("swift", original, fixture)
  assert.equal(variant.inverse, original)
  assert.ok(variant.source.includes("d480AcceptanceWindowStop(self);retirePicker();retireConfirmation(nil);socket=nil;"))
  assert.ok(variant.source.includes("d480AcceptanceWindowStop(self);retireWorkspace();retireDialog();retireConfirmation(false);socket?.cancel"))
  assert.equal(original.includes("d480AcceptanceWindowStop"), false)
  assert.ok(fixture.includes("NotificationCenter.default.removeObserver(observer)"))
  assert.ok(fixture.includes("windowObservers.removeAll()"))
  assert.ok(fixture.includes("windowObservation=nil"))
  assert.equal(fixture.includes("asyncAfter(deadline:.now()+0."), false)
})

test("Mac cleanup adjacency accepts LF/CRLF but still rejects missing or reordered statements", () => {
  const cleanup = 'self.stopWindow()\n            self.emit(host,"WINDOW_"'
  assert.equal(stopBeforeWindowEmit.test(cleanup), true)
  assert.equal(stopBeforeWindowEmit.test(cleanup.replace(/\n/g, "\r\n")), true)
  assert.equal(stopBeforeWindowEmit.test(cleanup.replace("self.stopWindow()", "")), false)
  assert.equal(stopBeforeWindowEmit.test(cleanup.replace("self.emit", "self.other")), false)
  assert.equal(stopBeforeWindowEmit.test('self.emit(host,"WINDOW_"\n            self.stopWindow()'), false)
})
