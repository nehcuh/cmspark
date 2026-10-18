// #572 — PsInputInjector.invokeUia: the background delivery route, adapter side.
//
// The contract worth guarding here is that a *fallback decision* is returned, not thrown:
// the executor must be able to switch to the coordinate path without unwinding. And an
// unrecognised failure must never be quietly mapped onto a "known" reason — that would turn
// an unknown state into a confident wrong answer, which is the exact defect class this whole
// batch of work is about.
import test from "node:test"
import assert from "node:assert/strict"
import { PsInputInjector } from "../src/computer/win-adapters"

type Call = { script: string; args: string[] }

/** Runner that records calls and replies with a canned outcome. */
function fakeRunner(reply: { stdout?: string; stderr?: string; throwIt?: boolean }) {
  const calls: Call[] = []
  const runner = async (script: string, args: string[]) => {
    calls.push({ script, args })
    if (script.endsWith("computer-uia-select.ps1")) {
      const value = (key: string) => args[args.indexOf(key) + 1]
      const mode = value("-Mode"), name = value("-Name")
      const modes = mode === "auto" ? ["invoke", ...(args.includes("-Value") ? ["setvalue"] : []), "select", "toggle"] : [mode]
      return JSON.stringify({ schema:1, hwnd:Number(value("-Hwnd")),rootPid:10,selectedPid:10,runtime:[42],
        controlTypeId:50000,controlType:args.includes("-ExpectControlType")?value("-ExpectControlType"):"Button",
        automationId:args.includes("-ExpectAutomationId")?value("-ExpectAutomationId"):"cmspark_fixture_button",name,
        x:1920,y:1061,bbox:{x:1785,y:1028,w:270,h:66},patterns:modes.map(mode=>({mode,state:"ready"})) })
    }
    if (reply.throwIt) {
      const e: any = new Error("boom")
      e.stderr = reply.stderr ?? ""
      throw e
    }
    return reply.stdout ?? ""
  }
  return { calls, runner: runner as never }
}

const OK_JSON = JSON.stringify({
  ok: true,
  mode: "invoke",
  name: "SubmitTest",
  controlType: "Button",
  automationId: "cmspark_fixture_button",
  x: 1920,
  y: 1061,
  bbox: { x: 1785, y: 1028, w: 270, h: 66 },
  tried: ["invoke:ok"],
  foreground: false,
  ms: 2107,
})

test("#572 invokeUia: a successful run parses into ok:true and promises foreground:false", async () => {
  const { runner, calls } = fakeRunner({ stdout: OK_JSON })
  const inj = new PsInputInjector(runner)
  const r = await inj.invokeUia(777, "SubmitTest", "invoke", { expectControlType: "Button" })
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.equal(r.mode, "invoke")
  assert.equal(r.controlType, "Button")
  assert.equal(r.automationId, "cmspark_fixture_button")
  assert.deepEqual(r.bbox, { x: 1785, y: 1028, w: 270, h: 66 })
  assert.deepEqual(r.tried, ["invoke:ok"])
  assert.equal(r.foreground, false, "the background route must never claim foreground")
  // It must run the invoke script, not the SendInput one.
  assert.match(calls[0].script, /computer-uia-select\.ps1$/)
  assert.match(calls[1].script, /computer-uia-act\.ps1$/)
  assert.ok(calls[0].args.includes("-ExpectControlType"), "identity expectation must reach the script")
})

test("#573 invokeUia forwards -StopFile when the injector was given a stop file", async () => {
  const { runner, calls } = fakeRunner({ stdout: OK_JSON })
  const inj = new PsInputInjector(runner, "/tmp/cmspark-stop.flag")
  const r = await inj.invokeUia(777, "SubmitTest", "invoke")
  assert.equal(r.ok, true)
  const stopAt = calls[0].args.indexOf("-StopFile")
  assert.ok(stopAt >= 0, `argv missing -StopFile: ${calls[0].args.join(" ")}`)
  assert.equal(calls[0].args[stopAt + 1], "/tmp/cmspark-stop.flag")
})

test("#572 invokeUia: element_gone is a RESULT, not a throw — the caller falls back", async () => {
  const { runner } = fakeRunner({
    throwIt: true,
    stderr: "UIA_ELEMENT_GONE:anchor 'Submit' not found — re-locate",
  })
  const inj = new PsInputInjector(runner)
  const r = await inj.invokeUia(777, "Submit", "invoke")
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.reason, "element_gone")
  assert.match(r.detail, /not found/)
})

test("#572 invokeUia: pattern_unavailable is reported precisely (the WinForms case)", async () => {
  const { runner } = fakeRunner({
    throwIt: true,
    stderr: "UIA_PATTERN_UNAVAILABLE:no usable UIA action pattern for 'SubmitTest' (Pane) tried=[invoke:unsupported]",
  })
  const inj = new PsInputInjector(runner)
  const r = await inj.invokeUia(777, "SubmitTest", "auto")
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.reason, "pattern_unavailable")
  assert.match(r.detail, /invoke:unsupported/)
})

test("#572 invokeUia: an UNKNOWN prefix is not quietly mapped onto a known reason", async () => {
  const { runner } = fakeRunner({ throwIt: true, stderr: "SOMETHING_NEW:who knows" })
  const inj = new PsInputInjector(runner)
  const r = await inj.invokeUia(777, "x", "auto")
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.reason, "bad_output", "unknown states must not masquerade as known ones")
  assert.match(r.detail, /SOMETHING_NEW/)
})

test("#572 invokeUia: unparseable stdout is bad_output, not a silent success", async () => {
  const { runner } = fakeRunner({ stdout: "not json at all" })
  const inj = new PsInputInjector(runner)
  const r = await inj.invokeUia(777, "x", "auto")
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.reason, "bad_output")
})

test("#572 invokeUia: exit 0 without ok:true is bad_output", async () => {
  const { runner } = fakeRunner({ stdout: JSON.stringify({ ok: false }) })
  const inj = new PsInputInjector(runner)
  const r = await inj.invokeUia(777, "x", "auto")
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.reason, "bad_output")
})

test("#572 invokeUia: -Value only travels when a value is actually given", async () => {
  const { runner, calls } = fakeRunner({ stdout: OK_JSON })
  const inj = new PsInputInjector(runner)
  await inj.invokeUia(1, "n", "auto")
  assert.ok(!calls[0].args.includes("-Value"), "auto with no value must not send an empty -Value")
  await inj.invokeUia(1, "n", "setvalue", { value: "hello" })
  assert.deepEqual(calls[2].args.slice(calls[2].args.indexOf("-Value"), calls[2].args.indexOf("-Value") + 2), [
    "-Value",
    "hello",
  ])
})

for (const prefix of ['STOPPED','UIA_WINDOW_GONE','UIA_ELEMENT_GONE','UIA_ELEMENT_MISMATCH','UIA_METHOD_FAILED','UIA_PATTERN_UNAVAILABLE']) {
  test(`#572 no-focus closed terminal frame ${prefix} stays terminal`, async () => {
    const { runner } = fakeRunner({ throwIt: true, stderr: `UIA_TERMINAL:${prefix}` })
    const result = await new PsInputInjector(runner).invokeUia(777, 'SubmitTest', 'invoke')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.terminal, true)
    assert.equal(result.reason === 'bad_output', false)
    assert.equal(result.detail, 'background UIA terminal refusal')
  })
}
test('#572 no-focus arbitrary ordinary detail cannot forge the terminal frame', async () => {
  const {runner}=fakeRunner({throwIt:true,stderr:'UIA_PATTERN_UNAVAILABLE:detail UIA_TERMINAL:UIA_METHOD_FAILED'})
  const result=await new PsInputInjector(runner).invokeUia(777,'SubmitTest','invoke')
  assert.equal(result.ok,false)
  if(result.ok)return
  assert.equal(result.reason,'pattern_unavailable')
  assert.equal(result.terminal,undefined)
})
for (const reply of [{throwIt:true}, {stdout:''}, {stdout:'not json'}, {stdout:'{"ok":false}'}, {stdout:'{"ok":true,"mode":"toggle"}'}]) {
  test(`#572 no-focus uncertain receipt ${JSON.stringify(reply)} is terminal`,async()=>{
    const {runner}=fakeRunner(reply)
    const result=await new PsInputInjector(runner).invokeUia(777,'SubmitTest','invoke')
    assert.equal(result.ok,false)
    if(result.ok)return
    assert.equal(result.terminal,true)
  })
}
