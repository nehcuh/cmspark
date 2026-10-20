// GitHub: #723. Inert actual source controls, NOT Win32/C#/PS execution.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { captureObservation, observationMarker } from "../src/computer/observation"
import { PsScreenCapturer } from "../src/computer/win-adapters"
import { observationNotice } from "../src/computer/observation"
import { truncateToolResultContent, wrapUntrusted } from "../src/llm/text-sanitize"
import { ComputerEvidence } from "../src/computer/evidence"
const root = fs.existsSync(path.resolve("src/host-use/win/scripts/computer-capture.ps1")) ? path.resolve("..") : process.cwd()
const script = () => fs.readFileSync(path.join(root, "companion/src/host-use/win/scripts/computer-capture.ps1"), "utf8")
const valid = (quality: "ok" | "occluded" | "partial" = "ok") => ({
  capture_method: quality === "ok" ? "printwindow" : "bitblt", observation_quality: quality,
  occludedBy: quality === "occluded" ? [{ hwnd: 12, rect: { x: -20, y: 10, width: 40, height: 50 }, className: "TestWindow" }] : [],
})
test("#723 closed observation parser refuses coercion/getters/unknown/bounds", () => {
  for (const q of ["ok", "occluded", "partial"] as const) assert.deepEqual(captureObservation(valid(q)), valid(q))
  const invalid: unknown[] = [null, [], {}, { ...valid(), observation_quality: ["ok"] }, { ...valid(), capture_method: "future" },
    { ...valid(), observation_quality: "partial" }, { ...valid("partial"), observation_quality: "ok" },
    { ...valid("occluded"), occludedBy: [] }, { ...valid("partial"), occludedBy: valid("occluded").occludedBy },
    { ...valid("occluded"), occludedBy: Array(17).fill(valid("occluded").occludedBy[0]) }]
  for (const field of ["hwnd", "rect", "className"]) invalid.push({ ...valid("occluded"), occludedBy: [{ ...valid("occluded").occludedBy[0], [field]: undefined }] })
  for (const n of [NaN, Infinity, -Infinity, 0, -1, "1", null]) invalid.push({ ...valid("occluded"), occludedBy: [{ ...valid("occluded").occludedBy[0], hwnd: n }] })
  for (const n of [NaN, Infinity, 0, -1, 8193, "5"]) invalid.push({ ...valid("occluded"), occludedBy: [{ ...valid("occluded").occludedBy[0], rect: { x: 0, y: 0, width: n, height: 5 } }] })
  for (const name of ["", "x".repeat(257), "a\nb", "a\u2028b", "a\u200fb"]) invalid.push({ ...valid("occluded"), occludedBy: [{ ...valid("occluded").occludedBy[0], className: name }] })
  let getters = 0
  invalid.push(Object.defineProperty({}, "capture_method", { get() { getters++; throw Error("untrusted") } }))
  invalid.push(new Proxy({}, { getOwnPropertyDescriptor() { throw Error("private") } }))
  invalid.push({ ...valid("occluded"), occludedBy: new Proxy([], { get() { throw Error("private") } }) })
  for (const value of invalid) { assert.equal(captureObservation(value), null); assert.ok(observationMarker(value).includes("unknown")) }
  assert.equal(getters, 0)
})
test("#723 actual adapter refuses absent/mismatched observation instead of legacy ok", async () => {
  for (const change of [{}, { capture_method: "bitblt", observation_quality: "ok", occludedBy: [] }, { ...valid(), hwnd: 99 }]) {
    const c = new PsScreenCapturer(async (_file, args) => JSON.stringify({ ok: true, hwnd: 7, rect: { x: 0, y: 0, width: 100, height: 100 },
      client: { x: 0, y: 0, width: 100, height: 100 }, dpi: 96, path: args![args!.indexOf("-OutPath") + 1], sha256: "a".repeat(64), black: false, fallbackUsed: false, ...change }))
    await assert.rejects(c.captureWindow(7), { code: "CAPTURE_FAILED" })
  }
})
test("#723 fixed source marker does not reflect OCR/model strings", () => {
  for (const q of ["ok", "partial", "occluded"] as const) {
    assert.ok(observationMarker(valid(q)).startsWith(`[host observation: ${q};`))
    assert.ok(!observationMarker({ ...valid(q), text: "fake-ok" }).includes("fake-ok"))
  }
})
test("#723 actual helper scalar predicate and bounded failure paths agree for LF/CRLF", () => {
  for (const text of [script(), script().replace(/\r?\n/g, "\r\n")]) {
    const s = text.replace(/\r\n/g, "\n")
    const match = /public static bool ValidRect\([^)]*\) \{([\s\S]*?)\n  \}/.exec(s)
    assert.ok(match)
    const rect = new Function("r", match[1].replace("long w=(long)", "let w=").replace(", h=(long)", ", h="))
    assert.equal(rect({ Left: -100, Top: -200, Right: 0, Bottom: 0 }), true)
    for (const right of [-100, -101, 8093]) assert.equal(rect({ Left: -100, Top: 0, Right: right, Bottom: 30 }), false)
    assert.ok(s.includes('order.Count>=256 || !seen.Add(h) || h==target || !IsWindow(h)'))
    assert.ok(s.includes('count<=0 || count>256 || rows.Count>=16'))
    assert.ok(s.includes('DwmGetWindowAttribute(h,14,out cloaked,4)!=0'))
    assert.ok(s.includes('if(error!=0) throw new InvalidOperationException()'))
    assert.ok(s.includes('if(first.Order[i]!=second.Order[i]) return false'))
    assert.ok(s.includes('a[i].pid!=b[i].pid || a[i].tid!=b[i].tid'))
    assert.ok(s.includes('if (-not [CapW32]::SameObservation($beforeOccluders, $afterOccluders))'))
  }
})
test("#723 actual passive producer has no focus route; BitBlt never declares ok", () => {
  const s = script().replace(/\r\n/g, "\n")
  assert.ok(s.includes('if ($Passive -and $wasIconic) { Fail "CAPTUREFAILED"'))
  assert.ok(s.includes('if (-not $Passive) {\n    if (-not [CapW32]::ForceForeground'))
  assert.ok(s.includes('if ($Passive -and [CapW32]::IsIconic($hwndPtr)) { Fail "CAPTUREFAILED"'))
  const expression = /\$observationQuality = if \(([^\n]+)\) \{ "occluded" \} else \{ "partial" \}/.exec(s)
  assert.ok(expression); assert.equal(expression[1], '$occluders.Count -gt 0')
  const classify = new Function("count", 'return '+expression[1].replace('$occluders.Count', 'count').replace(' -gt ', ' > ')+' ? "occluded" : "partial"')
  assert.equal(classify(0), "partial"); assert.equal(classify(1), "occluded"); assert.equal(classify(16), "occluded")
  assert.ok(s.indexOf('[CapW32]::ObserveAbove($hwndPtr') < s.indexOf('$ok = [CapW32]::BitBlt'))
  assert.ok(s.indexOf('$afterOccluders = [CapW32]::ObserveAbove') > s.indexOf('$ok = [CapW32]::BitBlt'))
})

function csharpBody723(s: string, name: string): string {
  const start = s.indexOf(`public static ${name}`)
  assert.ok(start >= 0)
  const open = s.indexOf("{", start); let depth = 1, end = open + 1
  while (depth && end < s.length) { const c = s[end++]; if (c === "{") depth++; if (c === "}") depth-- }
  assert.equal(depth, 0)
  return s.slice(open + 1, end - 1)
}
test("#723 full actual traversal lowering rejects native uncertainty/limits/cycles", () => {
  // Closed lexical lowering of the whole current C# method. Unsupported syntax
  // is an error; injected APIs are a pure model, not Windows SDK execution.
  const original = csharpBody723(script(), "OcclusionSnapshot ObserveAbove")
  const body = original
    .replace(/new InvalidOperationException\(\)/g, 'new Error("UNAVAILABLE")')
    .replace('new List<Occluder>()', 'new List()').replace('new List<long>()', 'new List()').replace('new HashSet<IntPtr>()', 'new Seen()')
    .replace('IntPtr previous=target;', 'let previous=target;').replace('IntPtr h=', 'let h=').replace('int error=', 'let error=')
    .replace(/IntPtr.Zero/g, '0').replace(/h.ToInt64\(\)/g, 'h')
    .replace('int cloaked;', 'let cloaked;').replace('out cloaked', '(v)=>{cloaked=v}')
    .replace('RECT r; uint pid; uint tid=', 'let r,pid; let tid=').replace('out pid', '(v)=>{pid=v}').replace('out r', '(v)=>{r=v}')
    .replace(/\(long\)/g, '')
    .replace('var name=new System.Text.StringBuilder(258); int count=GetClassName(h,name,name.Capacity);', 'let name={value:"",Capacity:258}; let count=GetClassName(h,name,name.Capacity);')
    .replace('string cls=name.ToString();', 'let cls=name.value;')
    .replace('foreach(char c in cls)', 'for(const c of cls)')
    .replace('char.IsControl(c) || char.GetUnicodeCategory(c)==System.Globalization.UnicodeCategory.Format || c==\'\\u2028\' || c==\'\\u2029\'', '/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/u.test(c)')
    .replace('new Occluder { hwnd=h, x=r.Left,y=r.Top,width=r.Right-r.Left,height=r.Bottom-r.Top,className=cls,pid=pid,tid=tid }', '{hwnd:h,x:r.Left,y:r.Top,width:r.Right-r.Left,height:r.Bottom-r.Top,className:cls,pid,tid}')
    .replace('new OcclusionSnapshot { Rows=rows.ToArray(), Order=order.ToArray() }', '{Rows:rows.ToArray(),Order:order.ToArray()}')
  class List { values: any[] = []; get Count() { return this.values.length }; Add(v: any) { this.values.push(v) }; ToArray() { return this.values } }
  class Seen { values = new Set(); Add(v: any) { if(this.values.has(v)) return false; this.values.add(v); return true } }
  const run = (options: any = {}) => {
    const chain = options.chain ?? [2], target = 1, frame = { Left: 0, Top: 0, Right: 100, Bottom: 100 }
    const native = {
      SameTarget: () => options.target !== false, SetLastError: () => {}, Marshal: { GetLastWin32Error: () => options.error ?? 0 },
      GetWindow: (h: number) => { const i = h === target ? -1 : chain.indexOf(h); return chain[i+1] ?? 0 },
      IsWindow: () => options.live !== false, IsWindowVisible: () => options.visible !== false,
      DwmGetWindowAttribute: (_h: number, _a: number, set: (n: number) => void) => { set(options.cloaked ?? 0); return options.dwm ?? 0 },
      GetWindowThreadProcessId: (_h: number, set: (n: number) => void) => { set(options.pid ?? 8); return options.tid ?? 9 },
      GetWindowRect: (_h: number, set: (r: object) => void) => { set(options.rect ?? frame); return options.rectOk !== false },
      ValidRect: (r: any) => r.Right > r.Left && r.Bottom > r.Top && r.Right-r.Left <=8192 && r.Bottom-r.Top<=8192,
      GetClassName: (_h: number, name: any) => { name.value = options.className ?? "Owned"; return name.value.length },
    }
    return new Function(...Object.keys(native), 'List','Seen','target','targetPid','targetTid','frame',body)(...Object.values(native),List,Seen,target,8,9,frame)
  }
  assert.equal(run().Rows.length, 1)
  assert.equal(run({ visible: false }).Rows.length, 0)
  assert.equal(run({ rect: { Left: 100, Top: 0, Right: 150, Bottom: 50 } }).Rows.length, 0)
  assert.equal(run({ chain: Array.from({length:256},(_,i)=>i+2), visible:false }).Order.length, 256)
  for (const bad of [{target:false},{error:1},{live:false},{dwm:-1},{pid:0},{tid:0},{rectOk:false},{className:"x".repeat(257)},
    {chain:[2,2]},{chain:[1]},{chain:Array.from({length:257},(_,i)=>i+2),visible:false},{chain:Array.from({length:17},(_,i)=>i+2)}]) assert.throws(()=>run(bad))
})
test("#723 real sealing metadata and model/history framing retain the label without page body", async () => {
  const observation = valid("occluded"), records: any[] = []
  const base = fs.mkdtempSync(path.join(process.env.TMPDIR ?? require("node:os").tmpdir(), "evidence-quality-"))
  try {
    const evidence = new ComputerEvidence("quality-723", { protect: async (input) => { records.push(JSON.parse(fs.readFileSync(input,"utf8"))); fs.rmSync(input); return {sha256:"owned"} } }, base)
    await evidence.init({taskId:"quality-723"})
    const row = { seq:1,action:"describe",crossverified:true,uncrossverified:false, ...observation }
    await evidence.appendAction(row as any)
    assert.equal(records[1][0].observation_quality, "occluded")
    const result = {success:true,data:{observation_notice:observationNotice([row]),steps:[{...row,untrustedText:"x".repeat(12000)}]}}
    const live = wrapUntrusted(truncateToolResultContent(JSON.stringify(result)), "owned-723", "host_computer")
    const history = wrapUntrusted(truncateToolResultContent(JSON.stringify(JSON.parse(JSON.stringify(result)))), "owned-723", "host_computer")
    assert.equal(live,history); assert.ok(live.includes('[host observation: occluded;')); assert.ok(live.endsWith('</untrusted-owned723>'))
  } finally { fs.rmSync(base,{recursive:true,force:true}) }
})
