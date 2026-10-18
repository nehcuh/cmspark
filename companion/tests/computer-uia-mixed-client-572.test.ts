// Pure controls only. Native A/B is registered in the existing foreground-owning module.
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { scripts572, parseIdentity572, observation572, desktop572, sequence572, requireOutcome572, cleanup572, type Arm572, type Control572, type Identity572 } from "./helpers/uia-mixed-client-572"
import type { PsRunner } from "../src/host-use/win/powershell"

const source = readFileSync("tests/fixtures/win/computer-uia-invoke-mixed-before572.ps1")
const identity: Identity572 = { schema: 1, hwnd: 40, rootPid: 10, selectedPid: 11, runtime: [3, -1, 42], controlType: 50000, automationId: "cmspark_fixture_button", name: "SubmitTest" }
const observed = (arm: Arm572, control: Control572) => ({ schema: 1, arm, control, state: "OBSERVED", entryManagedLoaded: false, preManagedLoaded: arm === "B", postManagedLoaded: arm === "B", invoked: control !== "nop", status: control === "action" ? 0 : control === "nop" ? null : 5 })

test("#572 mixed client generation retains exact original selection/native closures in LF and CRLF", () => {
  for (const bytes of [source, Buffer.from(source.toString("utf8").replace(/\r?\n/g, "\r\n"))]) {
    const g = scripts572(bytes), a = g.action("A").toString(), b = g.action("B").toString()
    assert.equal(a.startsWith("\ufeff"), bytes.toString().startsWith("\ufeff")); assert.equal(b.startsWith("\ufeff"), a.startsWith("\ufeff"))
    assert.ok(Buffer.concat([g.sourcePrefix, g.sourceSuffix]).equals(bytes))
    assert.ok(g.selection.subarray(0, g.sourcePrefix.length).equals(g.sourcePrefix))
    assert.equal(a.includes(g.nativeBlock.toString()), true); assert.equal(b.includes(g.nativeBlock.toString()), true)
    assert.equal(a.includes(g.managedBlock.toString()), false); assert.equal(b.includes(g.managedBlock.toString()), true)
    assert.equal(b.replace("$arm='B'", "$arm='A'").replace(g.managedPrelude.toString(), ""), a, "only the real managed preinitialization bundle and arm label may differ")
    assert.equal(a.includes("[System.Windows.Automation."), false)
    assert.equal(b.includes(g.availabilityBlock.toString()), true)
    assert.equal(g.availabilityBlock.includes(Buffer.from("$status = & $act $obj")), false)
    assert.equal(g.availabilityBlock.includes(Buffer.from("$el.TryGetCurrentPattern($pattern, [ref]$obj)")), true)
    const start = b.indexOf(g.managedBlock.toString()), end = b.indexOf("$preManagedLoaded=")
    assert.ok(start >= 0 && start < b.indexOf("MIXED572_PRESELECTION_MISMATCH") && end < b.indexOf("$status=Invoke-NoFocusAction 'invoke'"))
    assert.ok(a.includes("$entryManagedLoaded=[bool](Get-ManagedLoaded572)")); assert.ok(a.includes("$postManagedLoaded=[bool](Get-ManagedLoaded572)"))
  }
})
test("#572 mixed client source drift fails before generating an action", () => {
  for (const anchor of ["$script:noFocusReady = $false", "function Try-Pattern(", "$el.TryGetCurrentPattern($pattern, [ref]$obj)"]) {
    assert.throws(() => scripts572(Buffer.from(source.toString().replace(anchor, "OWNED_SOURCE_DRIFT"))))
    assert.throws(() => scripts572(Buffer.from(source.toString() + "\n" + anchor)))
  }
})
test("#572 mixed client receipt rejects invented, stale target and malformed scalar identity", () => {
  assert.deepEqual(parseIdentity572(JSON.stringify(identity), 40), identity)
  const mutations = [null, [], { ...identity, unknown: true }, { ...identity, hwnd: 41 }, { ...identity, schema: 2 }, { ...identity, rootPid: 0 }, { ...identity, selectedPid: 0x100000000 }, { ...identity, runtime: [] }, { ...identity, runtime: Array(65).fill(1) }, { ...identity, runtime: [1.5] }, { ...identity, runtime: [0x80000000] }, { ...identity, controlType: "50000" }, { ...identity, automationId: "OTHER" }, { ...identity, name: "OTHER" }]
  for (const d of mutations) assert.throws(() => parseIdentity572(JSON.stringify(d), 40))
})
test("#572 mixed client contamination is UNKNOWN and can never be projected as passing", () => {
  for (const arm of ["A", "B"] as const) for (const control of ["action", "nop", "invalid", "stale"] as const) {
    const good = observed(arm, control); assert.equal(observation572(JSON.stringify(good), arm, control).state, "OBSERVED")
    for (const mutate of [ { ...good, entryManagedLoaded: true }, { ...good, preManagedLoaded: arm !== "B" }, { ...good, postManagedLoaded: arm !== "B" } ]) {
      assert.throws(() => observation572(JSON.stringify(mutate), arm, control))
      assert.equal(observation572(JSON.stringify({ ...mutate, state: "UNKNOWN" }), arm, control).state, "UNKNOWN")
    }
    for (const mutate of [{ ...good, status: 8 }, { ...good, invoked: !good.invoked }, { ...good, extra: true }, { ...good, arm: "OTHER" }]) assert.throws(() => observation572(JSON.stringify(mutate), arm, control))
  }
})
test("#572 mixed client all actions and no-action controls keep every actual desktop assertion", () => {
  const shot = { foreground: 2, cursor: { got: true, x: 0, y: -1 }, zorder: [2, 1] }, v = { ok: true, delivery: "uia-pattern", target_hwnd: 1, focus_kept: true, zorder_kept: true, cursor_kept: true, no_leaked_input: true, background_verified: true, no_leaked_input_kind: "derived" }
  for (const c of ["action", "nop", "invalid", "stale"] as const) {
    desktop572(1, 2, shot, structuredClone(shot), v, c === "action", false, c)
    for (const after of [{ ...shot, foreground: 1 }, { ...shot, cursor: { ...shot.cursor, x: 1 } }, { ...shot, cursor: { ...shot.cursor, got: false } }, { ...shot, zorder: [1, 2] }]) assert.throws(() => desktop572(1, 2, shot, after, v, c === "action", false, c))
    for (const key of ["focus_kept", "zorder_kept", "cursor_kept", "no_leaked_input", "background_verified"]) assert.throws(() => desktop572(1, 2, shot, shot, { ...v, [key]: false }, c === "action", false, c))
    assert.throws(() => desktop572(1, 2, shot, shot, v, c !== "action", false, c)); assert.throws(() => desktop572(1, 2, shot, shot, v, c === "action", true, c))
  }
})
test("#572 mixed actual caller orders real selection/save before one native child and bounds both calls", async () => {
  for (const arm of ["A", "B"] as const) for (const control of ["action", "nop", "invalid", "stale"] as const) {
    const calls: unknown[] = [], files = { selection: "OWNED_SELECTION", action: "OWNED_ACTION", identity: "OWNED_IDENTITY", library: "OWNED_NORMAL_DLL", stop: "OWNED_ABSENT_STOP" }
    const runner: PsRunner = async (script, args, opts) => { calls.push([script, args, opts]); return script === files.selection ? JSON.stringify(identity) : JSON.stringify(observed(arm, control)) }
    const result = await sequence572(arm, control, runner, files, 40, () => 1234, d => { assert.deepEqual(d, identity); calls.push("SAVE") }, async () => { calls.push("BASELINE") }); requireOutcome572(result, control)
    assert.equal(result.arm, arm); assert.equal(calls.length, 4); assert.equal(calls[1], "SAVE"); assert.equal(calls[2], "BASELINE")
    assert.deepEqual(calls[0], ["OWNED_SELECTION", ["-Hwnd", "40", "-Name", "SubmitTest", "-Mode", "invoke", "-ExpectControlType", "Button", "-ExpectAutomationId", "cmspark_fixture_button", "-StopFile", "OWNED_ABSENT_STOP"], { timeoutMs: 1234 }])
    assert.deepEqual(calls[3], ["OWNED_ACTION", ["-IdentityPath", "OWNED_IDENTITY", "-NoFocusLibrary", "OWNED_NORMAL_DLL", "-StopFile", "OWNED_ABSENT_STOP", "-Control", control], { timeoutMs: 1234 }])
  }
})
test("#572 mixed actual caller never acts on invalid extraction/save failure or UNKNOWN", async () => {
  const files = { selection: "S", action: "A", identity: "I", library: "L", stop: "X" }
  for (const kind of ["identity", "save", "baseline", "unknown"] as const) {
    let calls = 0
    const runner: PsRunner = async script => { calls++; if (script === "S") return JSON.stringify(kind === "identity" ? { ...identity, runtime: [] } : identity); return JSON.stringify({ ...observed("A", "action"), state: "UNKNOWN", entryManagedLoaded: true, invoked: false, status: null }) }
    await assert.rejects(async () => { const d = await sequence572("A", "action", runner, files, 40, () => 45_000, () => { if (kind === "save") throw new Error("OWNED_SAVE_FAILED") }, async () => { if (kind === "baseline") throw new Error("OWNED_NOT_SIBLING") }); requireOutcome572(d, "action") })
    assert.equal(calls, kind === "unknown" ? 2 : 1)
  }
})
test("#572 mixed owned cleanup attempts all owners and keeps the original failure", async () => {
  const primary = new Error("OWNED_PRIMARY"), calls: string[] = []
  const owner = (id: string) => ({ child: { kill() { calls.push(id); throw new Error("OWNED_KILL") } }, closed: Promise.resolve(), isClosed: () => false, launchError: () => undefined })
  await assert.rejects(() => cleanup572([owner("A"), owner("B")] as never, () => { calls.push("REMOVE"); throw new Error("OWNED_REMOVE") }, primary), e => e === primary)
  assert.deepEqual(calls, ["B", "A", "REMOVE"])
})

test("#572 malformed action receipts never reflect unknown child fields in public errors", async () => {
  const secret = "OWNED_UNKNOWN_RECEIPT_NEVER_REFLECT", files = { selection: "S", action: "A", identity: "I", library: "L", stop: "X" }
  for (const text of [JSON.stringify({...observed("A", "action"),arm:secret}),JSON.stringify({...observed("A", "action"),control:secret}),JSON.stringify({...observed("A", "action"),schema:{private:secret}}), '{"'+secret+'":']) {
    let calls=0
    await assert.rejects(() => sequence572("A", "action", async script => {calls++;return script==="S"?JSON.stringify(identity):text}, files,40,()=>1000,()=>{},async()=>{}),error=>error instanceof Error && error.message==="MIXED572_INVALID_ACTION_RECEIPT" && !error.message.includes(secret))
    assert.equal(calls,2,"the rejection must come from the actual action receipt after selection")
  }
})
