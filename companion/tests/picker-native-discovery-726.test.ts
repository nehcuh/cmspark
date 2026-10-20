// Lexically lower actual C# decision bodies with inert API facts. Not C#/Win32/UIA execution.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
const file = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === ".test-dist" ? "../../tests/helpers/picker-native-726.ps1" : "helpers/picker-native-726.ps1")
function body(text: string, signature: string) {
  const start = text.indexOf(signature); assert.ok(start >= 0, signature); assert.equal(text.indexOf(signature, start + 1), -1)
  const begin = text.indexOf("{", start); let depth = 1, end = begin + 1
  for (; end < text.length && depth; end++) { if (text[end] === "{") depth++; if (text[end] === "}") depth-- }
  assert.equal(depth, 0); return text.slice(begin + 1, end - 1)
}
function lower(source: string): string {
  return source.replace(/new System\.Collections\.Generic\.List<(?:IntPtr|int)>\(\)/g, "new NativeList()")
    .replace(/foreach\s*\((?:ProcessThread|var)\s+(\w+)\s+in\s+(\w+)\)/g, "for (const $1 of $2)")
    .replace(/EnumThreadWndProc callback\s*=/g, "const callback=")
    .replace(/\b(?:var|int|bool|uint|IntPtr|object)\s+(\w+)/g, "let $1")
    .replace(/\(uint\)/g, "").replace(/IntPtr\.Zero/g, "0")
    .replace(/throw new InvalidOperationException\(\)/g, 'throw Error("NATIVE_UNKNOWN")')
    .replace(/uint actualPid;\s*var actualThread=GetWindowThreadProcessId\(h,out actualPid\);/g, "const {pid:actualPid,tid:actualThread}=GetWindowThreadProcessId(h);")
    .replace(/let actualPid;\s*let actualThread=GetWindowThreadProcessId\(h,out actualPid\);/g, "const {pid:actualPid,tid:actualThread}=GetWindowThreadProcessId(h);")
    .replace(/new System\.Text\.StringBuilder\(256\)/g, "new NativeClassBuffer(256)")
    .replace(/GC\.KeepAlive\(callback\)/g, "KeepAlive(callback)")
    .replace(/(\w+)\.ToInt64\(\)/g, "Number($1)")
    .replace(/e\.TryGetCurrentPattern\(InvokePattern\.Pattern,out pattern\)/g, "(pattern=e.pattern,e.supported)")
    .replace(/\(\(InvokePattern\)pattern\)\.Invoke\(\)/g, "pattern.Invoke()")
}
function fixture() {
  const text = fs.readFileSync(file, "utf8"), pid = 726, calls: string[] = []
  const rows = new Map<number, any>([[1, { pid, tid: 11, visible: false, owner: 0, kind: "hidden" }], [2, { pid, tid: 11, visible: true, owner: 1, kind: "form" }], [3, { pid, tid: 11, visible: true, owner: 2, kind: "#32770" }], [4, { pid, tid: 11, visible: true, owner: 2, kind: "#32770" }], [31, { pid, tid: 11, visible: true, root: 3, id: 1, kind: "button" }], [32, { pid, tid: 11, visible: true, root: 3, id: 2, kind: "button" }]])
  let windows: number[] = [1, 2, 3], threads: any[] = [{ Id: 11 }], apiFalse = false, apiThrow = false, forceTrueOnStop = false, endEnumeration: (() => void) | undefined, invoked = 0
  const child: any = { Id: pid, Handle: 100, HasExited: false, MainWindowHandle: 0, Refresh() {}, get Threads() { return Object.assign([...threads], { Count: threads.length }) } }
  class NativeList { values: unknown[] = []; get Count() { return this.values.length }; Add(value: unknown) { this.values.push(value) }; Contains(value: unknown) { return this.values.includes(value) }; [Symbol.iterator]() { return this.values[Symbol.iterator]() } }
  class NativeClassBuffer { value = ""; constructor(public Capacity: number) {}; ToString() { return this.value } }
  function owned(h: number) { const row = rows.get(h); calls.push("owned"); return !!row && !row.invalid && row.pid === pid }
  function element(h: number) { const row = rows.get(h); calls.push("uia"); if (row?.uiaThrow) throw Error("INERT_UIA"); if (!row) return null; return { Current: { ProcessId: row.uiaPid ?? row.pid, NativeWindowHandle: row.uiaHandle ?? h, IsOffscreen: !!row.offscreen, IsEnabled: row.enabled !== false, ControlType: row.controlType ?? "Button" }, supported: row.pattern !== false, pattern: { Invoke() { invoked++ } } } }
  const constants = Array.from(text.matchAll(/const int (MaxThreads|MaxWindows)=(\d+);/g), m => `const ${m[1]}=${m[2]};`).join("\n")
  const live = text.includes("void Live()") ? body(text, "void Live()") : "if(child.HasExited)throw Error('NATIVE_UNKNOWN');child.Refresh();"
  const js = `${constants}\nlet captured=0;function Live(){${lower(live)}}function Dialog(){${lower(body(text, "IntPtr Dialog()"))}}function Snapshot(){${lower(body(text, "public string Snapshot()"))}}function Invoke(mode){${lower(body(text, "public bool Invoke(string mode)"))}}exports.api={Dialog,Snapshot,Invoke};`
  const exports: any = {}
  vm.runInNewContext(js, { exports, child, pid, NativeList, NativeClassBuffer, Number, Owned: owned,
    Class: (h: number, kind: string) => rows.get(h)?.kind === kind,
    IsWindow: (h: number) => !!rows.get(h) && !rows.get(h).invalid,
    IsWindowVisible: (h: number) => !!rows.get(h)?.visible,
    GetWindow: () => 3,
    GetWindowThreadProcessId(h: number) { calls.push("identity"); const row = rows.get(h); if (row?.identityThrow) throw Error("INERT_IDENTITY"); return { pid: row?.pid ?? 0, tid: row?.invalid ? 0 : row?.tid ?? 0 } },
    GetClassName(h: number, buffer: NativeClassBuffer) { calls.push("class"); const row = rows.get(h); if (row?.classThrow) throw Error("INERT_CLASS"); buffer.value = row?.kind ?? ""; return row?.classLength ?? buffer.value.length },
    GetAncestor(h: number, flag: number) { const row = rows.get(h); if (flag === 2) return row?.root ?? h; assert.equal(flag, 3); let current = h; for (let n = 0; n < 8 && rows.get(current)?.owner; n++) current = rows.get(current).owner; return current },
    GetDlgItem(h: number, id: number) { calls.push("button"); return h === 3 ? id === 1 ? 31 : 32 : 0 }, GetDlgCtrlID: (h: number) => rows.get(h)?.id ?? 0,
    AutomationElement: { FromHandle: element }, ControlType: { Button: "Button" }, KeepAlive() {},
    EnumThreadWindows(tid: number, callback: (h: number, unused: number) => boolean) { calls.push("enumerate"); if (apiThrow) throw Error("INERT_ENUM"); const selected = tid === 11 ? windows : []; let stopped = false; for (const h of selected) { if (!callback(h, 0)) { stopped = true; break } }; endEnumeration?.(); return forceTrueOnStop ? true : !stopped && !apiFalse && selected.length > 0 },
  }, { filename: file + ":lexical-decision-projection", timeout: 3000 })
  return { api: exports.api, child, rows, calls, invoked: () => invoked, text,
    windows(v: number[]) { windows = v }, threads(v: any[]) { threads = v }, falseAPI() { apiFalse = true }, throwAPI() { apiThrow = true }, trueOnStop() { forceTrueOnStop = true }, end(fn: () => void) { endEnumeration = fn } }
}
test("726 actual discovery finds sole owned visible modal with hidden root and MainWindowHandle zero", () => {
  const f = fixture(); assert.equal(f.child.MainWindowHandle, 0); assert.equal(f.api.Snapshot(), "EXACT"); assert.equal(f.api.Invoke("ok"), true); assert.equal(f.invoked(), 1)
})
test("726 empty thread means WAIT and repeated HWND is one candidate", () => {
  const empty = fixture(); empty.windows([]); assert.equal(empty.api.Snapshot(), "WAIT")
  const duplicate = fixture(); duplicate.windows([3, 3]); assert.equal(duplicate.api.Snapshot(), "EXACT")
})
test("726 callback identity is first and foreign PID/reused TID/invalid HWND refuse before class or UIA", () => {
  for (const delta of [{ pid: 999 }, { tid: 22 }, { invalid: true }, { identityThrow: true }]) { const f = fixture(); f.windows([3]); Object.assign(f.rows.get(3), delta); assert.throws(() => f.api.Snapshot()); assert.equal(f.calls.includes("class"), false); assert.equal(f.calls.includes("uia"), false) }
})
test("726 multiple modals or duplicate/invalid thread identities are UNKNOWN", () => {
  const f = fixture(); f.windows([3, 4]); assert.throws(() => f.api.Snapshot())
  for (const threads of [[{ Id: 11 }, { Id: 11 }], [{ Id: 0 }], [{ get Id() { throw Error("INERT_THREAD") } }]]) { const x = fixture(); x.threads(threads); assert.throws(() => x.api.Snapshot()) }
})
test("726 64 thread and 256 callback limits refuse excess without accepting a truncated candidate", () => {
  const valid = fixture(); valid.threads(Array.from({ length: 64 }, (_, i) => ({ Id: i + 11 }))); assert.equal(valid.api.Snapshot(), "EXACT")
  const a = fixture(); a.threads(Array.from({ length: 65 }, (_, i) => ({ Id: i + 1 }))); assert.throws(() => a.api.Snapshot()); assert.equal(a.calls.includes("enumerate"), false)
  const b = fixture(); b.windows(Array(255).fill(1).concat(3)); assert.equal(b.api.Snapshot(), "EXACT")
  const c = fixture(); c.windows(Array(256).fill(1).concat(3)); assert.throws(() => c.api.Snapshot()); assert.equal(c.calls.filter(x => x === "identity").length, 256)
})
test("726 FALSE after callbacks and callback query fault never become complete snapshots", () => {
  const f = fixture(); f.windows([3]); f.falseAPI(); assert.throws(() => f.api.Snapshot())
  const api = fixture(); api.throwAPI(); assert.throws(() => api.api.Snapshot())
  for (const delta of [{ classLength: 0 }, { classLength: 255 }, { classThrow: true }]) { const x = fixture(); x.windows([3]); Object.assign(x.rows.get(3), delta); x.trueOnStop(); assert.throws(() => x.api.Snapshot()) }
})
test("726 child exit/handle loss before or during enumeration and foreign root/UIA refuse", () => {
  for (const delta of [{ HasExited: true }, { Handle: 0 }, { Id: 999 }]) { const f = fixture(); Object.assign(f.child, delta); assert.throws(() => f.api.Snapshot()) }
  const late = fixture(); late.end(() => { late.child.HasExited = true }); assert.throws(() => late.api.Snapshot())
  for (const delta of [{ pid: 999 }, { invalid: true }]) { const f = fixture(); Object.assign(f.rows.get(1), delta); assert.throws(() => f.api.Snapshot()) }
  for (const delta of [{ uiaPid: 999 }, { uiaHandle: 99 }, { uiaThrow: true }]) { const f = fixture(); Object.assign(f.rows.get(3), delta); assert.throws(() => f.api.Snapshot()) }
})
test("726 Invoke rediscovery requires captured exact HWND before touching buttons", () => {
  const f = fixture(); assert.equal(f.api.Snapshot(), "EXACT"); f.windows([4]); assert.equal(f.api.Invoke("ok"), false); assert.equal(f.calls.includes("button"), false); assert.equal(f.invoked(), 0)
})
test("726 actual original OK/Cancel UIA button checks remain strict in source projection", () => {
  for (const mode of ["ok", "cancel"]) { const f = fixture(); assert.equal(f.api.Snapshot(), "EXACT"); assert.equal(f.api.Invoke(mode), true); assert.equal(f.invoked(), 1) }
  for (const delta of [{ pid: 999 }, { visible: false }, { root: 99 }, { id: 9 }, { uiaPid: 999 }, { uiaHandle: 99 }, { offscreen: true }, { enabled: false }, { controlType: "Text" }, { pattern: false }]) { const f = fixture(); assert.equal(f.api.Snapshot(), "EXACT"); Object.assign(f.rows.get(31), delta); assert.equal(f.api.Invoke("ok"), false); assert.equal(f.invoked(), 0) }
  const unknown = fixture(); assert.equal(unknown.api.Invoke("other"), false)
})
