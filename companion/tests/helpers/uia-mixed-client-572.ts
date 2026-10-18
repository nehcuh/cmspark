// Test-only matched process isolation. This does not change the required normal route.
import test from "node:test"
import assert from "node:assert/strict"
import { execFile, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, watch } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { resolvePowerShellExe, resolveWinScript, resolveComputerUiaNoFocusDll, runPs, type PsRunner } from "../../src/host-use/win/powershell"

export type Arm572 = "A" | "B"
export type Control572 = "action" | "nop" | "invalid" | "stale"
export type Identity572 = { schema: 1; hwnd: number; rootPid: number; selectedPid: number; runtime: number[]; controlType: number; automationId: string; name: string }
const keys572 = "automationId,controlType,hwnd,name,rootPid,runtime,schema,selectedPid"
function integer572(value: unknown, low: number, high: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= low && value <= high }
export function parseIdentity572(text: string, hwnd: number): Identity572 {
  assert.ok(Buffer.byteLength(text, "utf8") <= 4096)
  const d = JSON.parse(text.trim()) as Identity572
  assert.ok(d && !Array.isArray(d) && Object.keys(d).sort().join(",") === keys572)
  assert.equal(d.schema, 1); assert.equal(d.hwnd, hwnd); assert.ok(integer572(d.hwnd, 1, Number.MAX_SAFE_INTEGER))
  for (const n of [d.rootPid, d.selectedPid]) assert.ok(integer572(n, 1, 0xffffffff))
  assert.ok(Array.isArray(d.runtime) && d.runtime.length >= 1 && d.runtime.length <= 64 && d.runtime.every(n => integer572(n, -0x80000000, 0x7fffffff)))
  assert.ok(integer572(d.controlType, 1, 0x7fffffff)); assert.equal(d.automationId, "cmspark_fixture_button"); assert.equal(d.name, "SubmitTest")
  return d
}
function unique572(source: string, anchor: string): number { const i = source.indexOf(anchor); assert.ok(i >= 0 && source.indexOf(anchor, i + anchor.length) < 0, "MIXED572_SOURCE_ANCHOR"); return i }
export function scripts572(bytes: Buffer) {
  const source = bytes.toString("utf8"), eol = source.includes("\r\n") ? "\r\n" : "\n"
  assert.ok(Buffer.from(source, "utf8").equals(bytes))
  const consoleAt = unique572(source, "[Console]::OutputEncoding = [Text.Encoding]::UTF8")
  const managedAt = unique572(source, "Microsoft.PowerShell.Utility\\Add-Type -AssemblyName UIAutomationClient")
  const nativeAt = unique572(source, "$script:noFocusReady = $false")
  const terminalAt = unique572(source, "# Terminal dispatch is outside the generic action catch.")
  const patternAt = unique572(source, "function Try-Pattern(")
  const delegateAt = unique572(source, "  try { $status = & $act $obj }")
  unique572(source, "$el.TryGetCurrentPattern($pattern, [ref]$obj)")
  const stopAt = unique572(source, "function Test-StopFlag {")
  const stopEnd = source.indexOf(eol + "}" + eol, stopAt) + (eol + "}").length
  assert.ok(consoleAt < managedAt && managedAt < nativeAt && nativeAt < terminalAt && patternAt < delegateAt && stopEnd > stopAt)
  const prefix = source.slice(0, nativeAt), suffix = source.slice(nativeAt)
  assert.ok(Buffer.from(prefix + suffix, "utf8").equals(bytes), "MIXED572_WHOLE_SOURCE_INVERSE")
  const common = source.slice(consoleAt, managedAt)
  const managed = source.slice(managedAt, nativeAt)
  const native = source.slice(nativeAt, terminalAt)
  const stop = source.slice(stopAt, stopEnd)
  // This exact source fragment performs the real managed availability call, but
  // returns before the original action delegate. The managed pattern is never invoked.
  const availability = source.slice(patternAt, delegateAt) + "  return $true" + eol + "}" + eol
  assert.ok(availability.includes("$el.TryGetCurrentPattern($pattern, [ref]$obj)"))
  const emitIdentity = String.raw`
Microsoft.PowerShell.Utility\Write-Output (Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -InputObject ([ordered]@{
  schema=1; hwnd=[long]$Hwnd; rootPid=[uint32]$rootOwnerPid; selectedPid=[uint32]$selectedPid;
  runtime=@($selectedRuntime); controlType=[int]$selectedType; automationId=[string]$selectedAutomationId; name=[string]$hit.name
}))
exit 0
`
  const selection = Buffer.from(prefix + emitIdentity.replace(/\n/g, eol), "utf8")
  const header = String.raw`param([Parameter(Mandatory=$true)][string]$IdentityPath,[Parameter(Mandatory=$true)][string]$NoFocusLibrary,[Parameter(Mandatory=$true)][string]$StopFile,[ValidateSet('action','nop','invalid','stale')][string]$Control='action')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
function Get-ManagedLoaded572 {
  foreach($assembly in [AppDomain]::CurrentDomain.GetAssemblies()) {
    $n=$assembly.GetName().Name
    if($n -ceq 'UIAutomationClient' -or $n -ceq 'UIAutomationTypes'){return $true}
  }
  return $false
}
$entryManagedLoaded=[bool](Get-ManagedLoaded572)
$d=Microsoft.PowerShell.Utility\ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($IdentityPath))
if($null -eq $d -or (@($d.PSObject.Properties.Name | Microsoft.PowerShell.Utility\Sort-Object) -join ',') -cne 'automationId,controlType,hwnd,name,rootPid,runtime,schema,selectedPid'){throw 'MIXED572_IDENTITY_SHAPE'}
function Is-Integer572($v,[long]$lo,[long]$hi){return (($v -is [int] -or $v -is [long]) -and $v -ge $lo -and $v -le $hi)}
if(-not (Is-Integer572 $d.schema 1 1) -or -not (Is-Integer572 $d.hwnd 1 9007199254740991) -or -not (Is-Integer572 $d.rootPid 1 4294967295) -or -not (Is-Integer572 $d.selectedPid 1 4294967295) -or -not (Is-Integer572 $d.controlType 1 2147483647)){throw 'MIXED572_IDENTITY_NUMBER'}
if($d.runtime -isnot [array] -or $d.runtime.Count -lt 1 -or $d.runtime.Count -gt 64){throw 'MIXED572_IDENTITY_RUNTIME'}
foreach($n in $d.runtime){if(-not (Is-Integer572 $n -2147483648 2147483647)){throw 'MIXED572_IDENTITY_RUNTIME'}}
if($d.automationId -isnot [string] -or $d.automationId -cne 'cmspark_fixture_button' -or $d.name -isnot [string] -or $d.name -cne 'SubmitTest'){throw 'MIXED572_IDENTITY_LABEL'}
$Hwnd=[long]$d.hwnd; $rootOwnerPid=[uint32]$d.rootPid; $selectedPid=[uint32]$d.selectedPid
[int[]]$selectedRuntime=@($d.runtime); $selectedType=[int]$d.controlType; $selectedAutomationId=[string]$d.automationId
$Name=[string]$d.name; $Mode='invoke'; $Value=''; $Direction='down'; $ScrollAmount=1; $MaxDepth=24; $MaxNodes=4000
$ExpectControlType='Button'; $ExpectAutomationId=$selectedAutomationId
`
  const beforeNative = String.raw`
$preManagedLoaded=[bool](Get-ManagedLoaded572)
$contaminated=$entryManagedLoaded -or ($arm -ceq 'A' -and $preManagedLoaded) -or ($arm -ceq 'B' -and -not $preManagedLoaded)
if($contaminated){
  Microsoft.PowerShell.Utility\Write-Output (Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -InputObject ([ordered]@{schema=1;arm=$arm;control=$Control;state='UNKNOWN';entryManagedLoaded=$entryManagedLoaded;preManagedLoaded=$preManagedLoaded;postManagedLoaded=$preManagedLoaded;invoked=$false;status=$null}))
  exit 0
}
`
  const act = String.raw`
Test-StopFlag
$invoked=$false; $status=$null
if($Control -cne 'nop'){
  if($Control -ceq 'invalid'){$selectedType=0}
  if($Control -ceq 'stale'){$selectedRuntime=@(-2147483648)+@($selectedRuntime)}
  $invoked=$true
  $status=Invoke-NoFocusAction 'invoke'
}
$postManagedLoaded=[bool](Get-ManagedLoaded572)
$state=if($arm -ceq 'A' -and $postManagedLoaded){'UNKNOWN'}else{'OBSERVED'}
Microsoft.PowerShell.Utility\Write-Output (Microsoft.PowerShell.Utility\ConvertTo-Json -Compress -InputObject ([ordered]@{schema=1;arm=$arm;control=$Control;state=$state;entryManagedLoaded=$entryManagedLoaded;preManagedLoaded=$preManagedLoaded;postManagedLoaded=$postManagedLoaded;invoked=$invoked;status=$status}))
exit 0
`
  const compare = String.raw`
if($rootOwnerPid -ne $d.rootPid -or $selectedPid -ne $d.selectedPid -or $selectedType -ne $d.controlType -or $selectedAutomationId -cne $d.automationId -or $hit.name -cne $d.name -or $selectedRuntime.Length -ne $d.runtime.Count){throw 'MIXED572_PRESELECTION_MISMATCH'}
for($i=0;$i -lt $selectedRuntime.Length;$i++){if($selectedRuntime[$i] -ne $d.runtime[$i]){throw 'MIXED572_PRESELECTION_MISMATCH'}}
$tried=Microsoft.PowerShell.Utility\New-Object System.Collections.Generic.List[string]
`
  const managedPrelude = (managed + compare + availability + "if(-not (Try-Pattern 'invoke' ([System.Windows.Automation.InvokePattern]::Pattern) {})){throw 'MIXED572_PRESELECTION_UNAVAILABLE'}\n").replace(/\r?\n/g, eol)
  const action = (arm: Arm572) => Buffer.from(((source.startsWith("\ufeff") ? "\ufeff" : "") + header + `$arm='${arm}'\n` + common + stop + eol +
    (arm === "B" ? managedPrelude : "") +
    beforeNative + native + act).replace(/\r?\n/g, eol), "utf8")
  return { selection, action, sourcePrefix: Buffer.from(prefix), sourceSuffix: Buffer.from(suffix), nativeBlock: Buffer.from(native), managedBlock: Buffer.from(managed), availabilityBlock: Buffer.from(availability), managedPrelude: Buffer.from(managedPrelude) }
}

export type Observation572 = { schema: 1; arm: Arm572; control: Control572; state: "OBSERVED" | "UNKNOWN"; entryManagedLoaded: boolean; preManagedLoaded: boolean; postManagedLoaded: boolean; invoked: boolean; status: number | null }
export function observation572(text: string, arm: Arm572, control: Control572): Observation572 {
  assert.ok(Buffer.byteLength(text, "utf8") <= 2048)
  let d: Observation572
  try { d = JSON.parse(text.trim()) as Observation572 } catch { throw new Error("MIXED572_INVALID_ACTION_RECEIPT") }
  assert.ok(d && !Array.isArray(d) && Object.keys(d).sort().join(",") === "arm,control,entryManagedLoaded,invoked,postManagedLoaded,preManagedLoaded,schema,state,status")
  if (d.schema !== 1 || d.arm !== arm || d.control !== control) throw new Error("MIXED572_INVALID_ACTION_RECEIPT")
  for (const key of ["entryManagedLoaded", "preManagedLoaded", "postManagedLoaded", "invoked"] as const) assert.equal(typeof d[key], "boolean")
  assert.ok(d.state === "OBSERVED" || d.state === "UNKNOWN"); assert.ok(d.status === null || integer572(d.status, 0, 7))
  const contaminated = d.entryManagedLoaded || (arm === "A" ? d.preManagedLoaded || d.postManagedLoaded : !d.preManagedLoaded || !d.postManagedLoaded)
  if (d.state === "UNKNOWN") { assert.ok(contaminated); return d }
  assert.equal(contaminated, false, "MIXED572_CONTAMINATED_NOT_PASS")
  assert.equal(d.invoked, control !== "nop"); if (control === "nop") assert.equal(d.status, null); else assert.notEqual(d.status, null)
  return d
}
type Shot572 = { foreground: number; cursor: { got: boolean; x: number; y: number }; zorder: number[] }
export function desktop572(target: number, sibling: number, before: Shot572, after: Shot572, verdict: Record<string, unknown>, targetMarker: boolean, siblingMarker: boolean, control: Control572): void {
  assert.ok(integer572(target, 1, Number.MAX_SAFE_INTEGER) && integer572(sibling, 1, Number.MAX_SAFE_INTEGER) && target !== sibling)
  for (const shot of [before, after]) {
    assert.ok(shot.foreground === sibling, "MIXED572_FOREGROUND_SIBLING_REQUIRED"); assert.equal(shot.cursor.got, true); assert.ok(Number.isFinite(shot.cursor.x) && Number.isFinite(shot.cursor.y))
    assert.ok(Array.isArray(shot.zorder) && shot.zorder.length > 0 && shot.zorder.length <= 16 && shot.zorder.every(n => integer572(n, 1, Number.MAX_SAFE_INTEGER)))
    assert.ok(shot.zorder.includes(target) && shot.zorder.includes(sibling))
  }
  assert.ok(JSON.stringify(after.zorder) === JSON.stringify(before.zorder), "MIXED572_ZORDER_CHANGED"); assert.ok(after.cursor.x === before.cursor.x && after.cursor.y === before.cursor.y, "MIXED572_CURSOR_CHANGED")
  assert.equal(verdict.ok, true); assert.equal(verdict.delivery, "uia-pattern"); assert.ok(verdict.target_hwnd === target, "MIXED572_ORACLE_TARGET_MISMATCH")
  for (const key of ["focus_kept", "zorder_kept", "cursor_kept", "no_leaked_input", "background_verified"]) assert.equal(verdict[key], true)
  assert.equal(verdict.no_leaked_input_kind, "derived"); assert.equal(targetMarker, control === "action"); assert.equal(siblingMarker, false)
}
type Owner572 = { child: ChildProcess; closed: Promise<void>; isClosed(): boolean; launchError(): Error | undefined }
function start572(fixture: string, args: string[], remaining: number): Owner572 {
  let ended = false, failure: Error | undefined
  const child = execFile(resolvePowerShellExe(), ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", fixture, ...args], { encoding: "utf8", windowsHide: true, timeout: remaining, maxBuffer: 4096 }, error => { if (error) failure = error })
  const closed = new Promise<void>(resolve => child.once("close", () => { ended = true; resolve() }))
  return { child, closed, isClosed: () => ended, launchError: () => failure }
}
function wait572<T>(file: string, owner: Owner572, deadline: number, parse: (text: string) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown, value?: T) => { if (settled) return; settled = true; clearTimeout(timer); try { watcher.close() } catch {} ; if (error) reject(error); else resolve(value as T) }
    const check = () => { try { if (existsSync(file)) finish(undefined, parse(readFileSync(file, "utf8"))) } catch (error) { finish(error) } }
    const watcher = watch(path.dirname(file), check), timer = setTimeout(() => finish(new Error("MIXED572_RECEIPT_DEADLINE")), Math.max(1, deadline - performance.now()))
    void owner.closed.then(() => finish(new Error("MIXED572_OWNER_CLOSED"))); check()
  })
}
export async function cleanup572(children: Owner572[], remove: () => void, primary: unknown): Promise<void> {
  let failure: unknown
  for (const owner of [...children].reverse()) {
    try { if (!owner.isClosed() && !owner.child.kill()) throw new Error("MIXED572_TERMINATE_FAILED") } catch (error) { failure ??= error }
    try { await owner.closed } catch (error) { failure ??= error }
  }
  try { remove() } catch (error) { failure ??= error }
  if (primary !== undefined) throw primary
  if (failure !== undefined) throw failure
}
export async function sequence572(arm: Arm572, control: Control572, runner: PsRunner, files: { selection: string; action: string; identity: string; library: string; stop: string }, target: number, remaining: () => number, save: (d: Identity572) => void, beforeAction: () => Promise<void>): Promise<Observation572> {
  const bounded: PsRunner = (script, args) => runner(script, args, { timeoutMs: Math.min(15_000, remaining()) })
  const selected = await bounded(files.selection, ["-Hwnd", String(target), "-Name", "SubmitTest", "-Mode", "invoke", "-ExpectControlType", "Button", "-ExpectAutomationId", "cmspark_fixture_button", "-StopFile", files.stop])
  let identity: Identity572
  try { identity = parseIdentity572(selected, target) } catch { throw new Error("MIXED572_INVALID_SELECTION_RECEIPT") }
  save(identity)
  // As in the required case, discovery precedes the real sibling-foreground baseline.
  // Never restore focus if discovery already changed it.
  await beforeAction()
  const result = observation572(await bounded(files.action, ["-IdentityPath", files.identity, "-NoFocusLibrary", files.library, "-StopFile", files.stop, "-Control", control]), arm, control)
  return result
}
export function requireOutcome572(result: Observation572, control: Control572): void {
  assert.equal(result.state, "OBSERVED", "MIXED572_UNKNOWN_NOT_PASS")
  if (control === "action") assert.equal(result.status, 0)
  if (control === "invalid" || control === "stale") assert.ok(result.status === 4 || result.status === 5)
}
async function runNative572(arm: Arm572, control: Control572): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "uia-mixed-client572-")), children: Owner572[] = [], deadline = performance.now() + 45_000
  const remaining = () => { const n = Math.floor(deadline - performance.now()); assert.ok(n > 0, "MIXED572_ORIGINAL_45S_EXHAUSTED"); return n }
  let primary: unknown, observation: Observation572 | undefined, desktopObservation: Record<string, unknown> | undefined
  const bounded: PsRunner = async (script, args) => {
    try { return await runPs(script, args, { timeoutMs: Math.min(15_000, remaining()) }) }
    catch { throw new Error("MIXED572_CHILD_REFUSED_OR_FAILED") } // Never echo owned identities/paths/argv.
  }
  try {
    assert.equal(process.arch, "x64"); const scripts = scripts572(readFileSync(resolveWinScript("computer-uia-invoke.ps1")))
    const marker = path.join(dir, "target.marker"), siblingMarker = path.join(dir, "sibling.marker")
    const launch = async (role: "target" | "sibling") => {
      const ready = path.join(dir, role + ".ready"), receipt = path.join(dir, role + ".json")
      const owner = start572(path.resolve("tests/fixtures/win/uia-wpf-fixture.ps1"), ["-Marker", role === "target" ? marker : siblingMarker, "-Ready", ready, "-ButtonText", role === "target" ? "SubmitTest" : "ForegroundSibling", "-AcceptanceReady", receipt, ...(role === "sibling" ? ["-OwnForeground"] : [])], remaining()); children.push(owner)
      const d = await wait572(receipt, owner, deadline, text => JSON.parse(text) as { hwnd: number; foreground: number; active: boolean })
      assert.ok(integer572(d.hwnd, 1, Number.MAX_SAFE_INTEGER)); if (role === "sibling") { assert.ok(d.foreground === d.hwnd, "MIXED572_SIBLING_READINESS"); assert.equal(d.active, true) }; return d.hwnd
    }
    const target = await launch("target"), sibling = await launch("sibling")
    assert.equal(existsSync(marker), false); assert.equal(existsSync(siblingMarker), false)
    const selection = path.join(dir, "selection.ps1"), action = path.join(dir, "action.ps1"), identity = path.join(dir, "identity.json")
    writeFileSync(selection, scripts.selection, { flag: "wx", mode: 0o600 }); writeFileSync(action, scripts.action(arm), { flag: "wx", mode: 0o600 })
    const shot = async (name: string) => { const file = path.join(dir, name + ".json"); await bounded(resolveWinScript("computer-bg-oracles.ps1"), ["-Mode", "snapshot", "-TargetHwnd", String(target), "-Out", file]); return JSON.parse(readFileSync(file, "utf8")) as Shot572 }
    let before: Shot572 | undefined
    observation = await sequence572(arm, control, bounded, { selection, action, identity, library: resolveComputerUiaNoFocusDll(), stop: path.join(dir, "absent.stop") }, target, remaining, d => writeFileSync(identity, JSON.stringify(d), { flag: "wx", mode: 0o600 }), async () => { before = await shot("before"); assert.ok(before.foreground === sibling, "MIXED572_INITIAL_FOREGROUND_NOT_SIBLING") })
    if (observation.state === "OBSERVED" && observation.status === 0 && control === "action") await wait572(marker, children[0], deadline, text => { assert.ok(/^clicked \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(text), "MIXED572_MARKER_SHAPE"); return true })
    const after = await shot("after"), verdictPath = path.join(dir, "verdict.json")
    await bounded(resolveWinScript("computer-bg-oracles.ps1"), ["-Mode", "compare", "-Before", path.join(dir, "before.json"), "-After", path.join(dir, "after.json"), "-TargetHwnd", String(target), "-Delivery", "uia-pattern", "-Out", verdictPath])
    assert.ok(before)
    const verdict = JSON.parse(readFileSync(verdictPath, "utf8")) as Record<string, unknown>
    desktopObservation = { schema: 1, arm, control, beforeSibling: before.foreground === sibling, afterSibling: after.foreground === sibling, afterTarget: after.foreground === target, targetMarker: existsSync(marker), siblingMarker: existsSync(siblingMarker), focusKept: verdict.focus_kept === true, zorderKept: verdict.zorder_kept === true, cursorKept: verdict.cursor_kept === true, noLeakedInput: verdict.no_leaked_input === true, noLeakedInputKind: "derived", backgroundVerified: verdict.background_verified === true }
    requireOutcome572(observation, control)
    desktop572(target, sibling, before, after, verdict, existsSync(marker), existsSync(siblingMarker), control)
    assert.ok(children.every(owner => !owner.isClosed()))
  } catch (error) { primary = error }
  finally {
    if (observation) try { console.log("UIA572_MIXED_CLIENT_OBSERVATION " + JSON.stringify(observation)) } catch {}
    if (desktopObservation) try { console.log("UIA572_MIXED_CLIENT_DESKTOP " + JSON.stringify(desktopObservation)) } catch {}
    await cleanup572(children, () => rmSync(dir, { recursive: true, force: true }), primary)
  }
  assert.equal(children.length, 2); assert.ok(children.every(owner => owner.isClosed()))
}
// Register inside the existing integration module: no second canonical file owns foreground concurrently.
export function registerMixedClientNative572(): void {
  for (const arm of ["A", "B"] as const) for (const control of ["action", "nop", "invalid", "stale"] as const)
    test(`#572 matched mixed-client ${arm} ${control} keeps original owned desktop oracles`, { skip: process.platform !== "win32", timeout: 45_000 }, () => runNative572(arm, control))
}
