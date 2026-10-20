// #480 unshipped C++ source lowering + controlled event schedule; no SDK/engine/native execution.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
const root = path.resolve(__dirname, "../..")
const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8")
const fixture = () => read("tests/fixtures/desktop-480/native-acceptance.cpp")
function body(source: string, anchor: string): string {
  const start = source.indexOf(anchor); assert.ok(start >= 0, anchor); assert.equal(source.indexOf(anchor, start + anchor.length), -1, anchor)
  const begin = source.indexOf("{", start); let depth = 1, quote = "", escaped = false
  for (let i = begin + 1; i < source.length; i++) {
    const c = source[i]
    if (quote) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === quote) quote = ""; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === "{") depth++
    else if (c === "}" && --depth === 0) return source.slice(begin + 1, i)
  }
  throw Error("unterminated actual source")
}
function lower(source: string) {
  const begin = source.indexOf("#ifdef D480_HOSTILE"), end = source.indexOf("#else", begin)
  if (begin >= 0) source = source.slice(begin + "#ifdef D480_HOSTILE".length, end)
  source = source.replace(/L"/g, '"').replace(/std::wstring\(([^()]*)\)/g, "$1")
    .replace(/\.empty\(\)/g, ".length===0").replace(/\bnullptr\b/g, "null")
    .replace(/\bTRUE\b/g, "true").replace(/\bFALSE\b/g, "false")
    .replace(/const std::wstring /g, "const ").replace(/const auto /g, "const ")
    .replace(/\b(?:LPWSTR|HRESULT|BOOL|bool|COREWEBVIEW2_WEB_ERROR_STATUS) /g, "let ")
    .replace(/\bUINT64 (\w+)=0;/g, "let $1=0n;")
    .replace(/(args|web|h\.web)->get_(\w+)\(&(\w+)\)/g, "get($1,'$2',value=>$3=value)")
    .replace(/->/g, ".").replace(/D480Acceptance::navigation\(/g, "navigation(").replace(/D480Acceptance::completed\(/g, "completed(")
  assert.doesNotMatch(source, /::|#|\b(?:LPWSTR|HRESULT|UINT64|BOOL|auto)\b|(?<!&)&(?!&)/, "unsupported C++ lowering")
  return source
}
function harness(source = fixture()) {
  const state: any = { phase: 2, remotePending: false, remoteNavigationId: 0n, remoteGeneration: "" }
  const events: any[] = [], trace: string[] = []
  const web: any = { Source: "https://cmspark-desktop.invalid/index.html", Get() { return this } }
  const h: any = { web, ready: true, generation: "owned-generation" }
  const get = (object: any, name: string, output: (v: any) => void) => {
    trace.push(name); object?.hooks?.[name]?.(); if (object?.failed === name) return -1
    output(object?.[name]); return 0
  }
  const env: any = { state, get, document_url: web.Source, SUCCEEDED: (n: number) => n >= 0, FAILED: (n: number) => n < 0,
    COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN: "UNKNOWN", COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED: "CANCELED", S_OK: 0,
    CoTaskMemFree() {}, emit(_h: any, marker: string) { events.push(["marker", marker]) },
    script(_h: any, code: string, generation: string) { events.push(["script", code, generation]) } }
  const compile = (anchor: string, parameters: string) => vm.runInNewContext(`(function(${parameters}){with(state){${lower(body(source, anchor))}}})`, env)
  const navigation = compile("void D480Acceptance::navigation(", "h,args,allowed,uri")
  const old = !source.includes("void D480Acceptance::completed(")
  env.navigation = (host: any, args: any) => navigation(host, args, false, args?.Uri)
  env.completed = old ? () => {} : compile("void D480Acceptance::completed(", "h,args")
  const starting = old ? (_sender: any, args: any) => env.navigation(h, args) : compile("Callback<ICoreWebView2NavigationStartingEventHandler>([&h]", "sender,args")
  const completed = old ? () => {} : compile("Callback<ICoreWebView2NavigationCompletedEventHandler>([&h]", "sender,args")
  const start = (args: any = { Uri: "https://cmspark-480-blocked.invalid/", NavigationId: 17n }, sender = h.web) => starting(h === sender ? h : sender, args)
  const finish = (args: any = { NavigationId: 17n, IsSuccess: false, WebErrorStatus: "CANCELED" }, sender = h.web) => completed(sender, args)
  // Callback captures h in native source; bind that same inert owned object, never a real WebView.
  env.h = h
  return { state, h, web, events, trace, start, finish }
}
function builder() {
  const source = read("scripts/build-desktop-windows.mjs"), ast = ts.createSourceFile("builder.mjs", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === "desktopAcceptanceVariant")
  assert.equal(functions.length, 1)
  return vm.runInNewContext("(" + functions[0].getText(ast).replace(/^export\s+/, "") + ")", { Error })
}
test("#480 hostile generated variant retains shipped navigation bytes and exact LF/CRLF inverses", () => {
  const build = builder(), original = read("src/desktop/native/DesktopHost.cpp"), controller = fixture()
  for (const hostCRLF of [false, true]) for (const fixtureCRLF of [false, true]) {
    const host = original.replace(/\r\n/g, "\n").replace(/\n/g, hostCRLF ? "\r\n" : "\n"), f = controller.replace(/\r\n/g, "\n").replace(/\n/g, fixtureCRLF ? "\r\n" : "\n")
    const variant = build("cpp", host, f); assert.equal(variant.inverse, host)
    assert.equal(/D480Acceptance::navigation\(\*this,allow,uri\)/.test(variant.source), false)
    assert.ok(variant.source.includes("bool allow=uri&&std::wstring(uri)==document_url;CoTaskMemFree(uri);"))
  }
  const swift = read("src/desktop/native/DesktopHost.swift"), mac = read("tests/fixtures/desktop-480/native-acceptance.swift")
  assert.equal(build("swift", swift, mac).inverse, swift)
  assert.equal(controller.split("add_NavigationStarting(").length, 2); assert.equal(controller.split("add_NavigationCompleted(").length, 2)
  assert.throws(() => build("cpp", original + original, controller), /ANCHOR/)
})
test("#480 blocked Starting only captures ID/generation; cannot emit denial or enqueue next script", () => {
  const x = harness(); x.start(); assert.deepEqual(x.events, []); assert.equal(x.state.remoteNavigationId, 17n)
  assert.equal(x.state.remoteGeneration, x.h.generation); assert.equal(x.state.remotePending, true); assert.equal(x.state.phase, 2)
})
test("#480 exact cancelled completion advances once with original marker/script and captured generation", () => {
  const x = harness(); x.start(); assert.deepEqual(x.events, []); x.finish(); x.finish()
  assert.deepEqual(x.events, [["marker", "REMOTE_DENIED"], ["script", "window.open('https://cmspark-480-blocked.invalid/','_blank');", "owned-generation"]])
  assert.equal(x.state.phase, 3); assert.equal(x.state.remotePending, false)
})
test("#480 invalid completion ID/result/HRESULT/source/document/owner cannot advance or count evidence", () => {
  const mutations: ((x: ReturnType<typeof harness>, args: any) => any)[] = [
    (_x,a) => a.NavigationId = 18n, (_x,a) => a.IsSuccess = true, (_x,a) => a.WebErrorStatus = "OTHER",
    ...["NavigationId", "IsSuccess", "WebErrorStatus"].map(name => (_x: any,a: any) => a.failed = name),
    x => x.web.failed = "Source", x => x.web.Source = null, x => x.web.Source = "https://foreign.invalid/",
    x => x.h.generation = "replacement", x => x.h.generation = "", x => x.h.ready = false,
    x => x.state.phase = 4, x => x.state.remotePending = false, x => x.h.web = { ...x.web },
  ]
  for (const mutate of mutations) { const x = harness(); x.start(); const args: any = { NavigationId: 17n, IsSuccess: false, WebErrorStatus: "CANCELED" }; mutate(x,args); x.finish(args, x.web); assert.deepEqual(x.events, []) }
  const x = harness(); x.start(); x.finish(undefined, {} as any); assert.deepEqual(x.events, [])
  const y = harness(); y.start(); y.finish(null); assert.deepEqual(y.events, [])
})
test("#480 capture rejects missing/wrong URI, HRESULT, readiness, generation, foreign sender and duplicate replacement", () => {
  const mutations: ((x: ReturnType<typeof harness>, args: any) => any)[] = [
    (_x,a) => a.Uri = null, (_x,a) => a.Uri = "https://foreign.invalid/", (_x,a) => a.failed = "Uri", (_x,a) => a.failed = "NavigationId",
    x => x.h.ready = false, x => x.h.generation = "", x => x.state.phase = 1,
  ]
  for (const mutate of mutations) { const x = harness(), args: any = { Uri: "https://cmspark-480-blocked.invalid/", NavigationId: 17n }; mutate(x,args); x.start(args); x.finish(); assert.deepEqual(x.events, []); assert.equal(x.state.remotePending,false) }
  const x = harness(); x.start(undefined, {} as any); x.start(null); assert.deepEqual(x.events, []); assert.equal(x.state.remotePending, false)
  x.start(); x.start({ Uri: "https://cmspark-480-blocked.invalid/", NavigationId: 19n }); assert.equal(x.state.remoteNavigationId,17n)
})
test("#480 source-read reentry cannot carry an earlier document/phase/web identity into advancement", () => {
  for (const change of [(x: any) => x.h.generation = "changed", (x: any) => x.h.ready = false, (x: any) => x.state.phase = 4, (x: any) => x.h.web = { ...x.web }]) {
    const x = harness(); x.start(); x.web.hooks = { Source: () => change(x) }; x.finish(undefined, x.web); assert.deepEqual(x.events, [])
  }
  const x = harness(); x.start({ Uri: "https://cmspark-480-blocked.invalid/", NavigationId: 17n, hooks: { NavigationId: () => { x.h.generation = "changed" } } }); x.finish(); assert.deepEqual(x.events, [])
})
test("#480 UINT64 identity remains exact at zero and above JS safe-number range", () => {
  for (const id of [0n, 9007199254740993n, 18446744073709551615n]) {
    const x = harness(); x.start({ Uri: "https://cmspark-480-blocked.invalid/", NavigationId: id }); x.finish({ NavigationId: id === 0n ? 1n : id - 1n, IsSuccess: false, WebErrorStatus: "CANCELED" }); assert.deepEqual(x.events, [])
    x.finish({ NavigationId: id, IsSuccess: false, WebErrorStatus: "CANCELED" }); assert.equal(x.events.length, 2)
  }
})
test("#480 remaining hostile stages keep original scripts and no retry/timer/foreign lookup is introduced", () => {
  const source = fixture(), navigation = body(source, "void D480Acceptance::navigation("), completed = body(source, "void D480Acceptance::completed(")
  assert.doesNotMatch(navigation, /emit\(|script\(|phase=3/)
  assert.doesNotMatch(navigation + completed, /Sleep|SetTimer|PostMessage|Reload|Navigate|ExecuteScript|GetWindow|OpenProcess/)
  for (const value of ["DEVTOOLS_DENIED", "FRAME_DENIED", "REMOTE_DENIED", "NEW_WINDOW_DENIED", "DOWNLOAD_DENIED", "DOCUMENT_FRESH", "STALE_DENIED"]) assert.ok(source.includes('L"' + value + '"'))
  assert.ok(source.includes('a.download=\'owned-inert.txt\'')); assert.ok(source.includes('phase=5;h.web->Reload();'))
})
