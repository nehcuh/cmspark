/** Actual full generated C++ source with inert Win32 leaves; not Windows ABI/input proof. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
const read = (name: string) => fs.readFileSync(path.resolve(name), 'utf8')
const hooks = require(path.resolve('scripts/desktop-mcp-fixture.mjs'))
const terminal = require(path.resolve('scripts/desktop-terminal-fixture.mjs'))
const lineage = require(path.resolve('scripts/tests/observation-826-inverse.cjs'))
function generated(kind: string, language = 'cpp', eol = '\n', fixtureEol = eol) {
 const host = read('src/desktop/native/DesktopHost.' + language).replace(/\r?\n/g, eol)
 const fixture = (name: string) => read('tests/fixtures/desktop-476/' + name + '.' + language).replace(/\r?\n/g, fixtureEol)
 const form = read('tests/fixtures/desktop-476/' + kind + '-form.js')
 const built = kind === 'local' ? hooks.desktopLocalFixture(language, host, fixture('local-acceptance'), form) : kind === 'archive' ? hooks.desktopArchiveFixture(language, host, fixture('native-acceptance'), form, fixture('archive-acceptance')) : terminal.desktopTerminalFixture(language, host, fixture('terminal-acceptance'), form)
 assert.equal(built.inverse, host)
 return built.source as string
}
function lowerCaption(source: string) {
 const start = source.indexOf('static bool d476_owned_caption826(HWND window){'), end = source.indexOf('\n}\n', start)
 assert.ok(start >= 0 && end > start)
 return source.slice(source.indexOf('{', start) + 1, end)
  .replace('const auto previous826=', 'const previous826=').replace('const bool inserted826=[&]()->bool{', 'const inserted826=(()=>{').replace(' }();', ' })();')
  .replace('DWORD pid826=0,hitPid826=0;', 'let pid826=0,hitPid826=0;').replace('RECT rect826{};POINT client826{};', 'const rect826={};const client826={x:0,y:0};')
  .replace('const int64_t x826=((int64_t)rect826.left+rect826.right)/2,y826=((int64_t)rect826.top+client826.y)/2;', 'const x826=Math.trunc((rect826.left+rect826.right)/2),y826=Math.trunc((rect826.top+client826.y)/2);')
  .replace('POINT point826{(LONG)x826,(LONG)y826};', 'const point826={x:x826,y:y826};').replace('const int left826=', 'const left826=').replace('const HWND hit826=', 'const hit826=').replace('const bool restored826=', 'const restored826=')
  .replace(/\(int64_t\)/g, '').replace(/\(short\)/g, '').replace(/\(LONG\)([^;]+);/g, 'Math.trunc($1);').replace(/\bnullptr\b/g, 'null')
  .replace(/GetWindowThreadProcessId\((window|hit826),&(pid826|hitPid826)\)/g, 'GetWindowThreadProcessId($1,v=>$2=v)')
  .replace('GetWindowRect(window,&rect826)', 'GetWindowRect(window,rect826)').replace('ClientToScreen(window,&client826)', 'ClientToScreen(window,client826)')
  .replace('INPUT batch826[3]{};', 'const batch826=[{mi:{}},{mi:{}},{mi:{}}];').replace('sizeof(INPUT)', 'SDK_INPUT_SIZE')
}
function harness(kind = 'local') {
 const source = generated(kind), cls = kind === 'local' ? 'D476LocalInitialActivation788::begin' : kind === 'archive' ? 'D476ArchiveInitialActivation788::begin' : 'D705TerminalAcceptance::begin_form'
 const start = source.indexOf('void ' + cls + '(Desktop& h){'), end = kind === 'terminal' ? source.indexOf(' std::wstring code=', start) : source.indexOf('\n}', start)
 assert.ok(start >= 0 && end > start)
 let body = source.slice(source.indexOf('{', start) + 1, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/&h\b/g, 'h').replace(/\(LONG_PTR\)/g, '').replace('h.generation.empty()', '(h.generation.length===0)').replace(/catch\(\.\.\.\)/g, 'catch').replace(/(\d+)u\b/g, '$1')
 body = body.replace('bool visible788=false;HWND foreground788=nullptr;', 'let visible788=false;let foreground788=null;').replace('D476LocalAcceptance::document(h);', 'forms++;').replace('D476ArchiveAcceptance::arm(h);', 'arms++;').replace('D476Acceptance::document(h);', 'forms++;') + (kind === 'terminal' ? 'forms++;' : '')
 const web: any = {}, controller: any = {}; web.Get = () => web; controller.Get = () => controller
 const h = { window: 1, closing: false, ready: true, generation: 'owned', epoch: 1, web, controller }
 const s: any = { h, owner: h, window: 1, document: 'owned', epoch: 1, web, controller, form_window: 1, form_web: web, form_controller826: controller, started: false, failed: false, form_requested: false,
  selectionAttempted826: false, selectionComplete826: false, selection_attempted826: false, selection_complete826: false, forms: 0, arms: 0, foreground: 8, visible: true, minimized: false, enabled: true, pid: 7, hitPid: 7, hitRoot: 1, hit: 1, hitTest: 2,
  rect: { left: -1800, top: 50, right: -1400, bottom: 400 }, clientTop: 86, screen: [-1920, 0, 3840, 1080], input: 3, inputs: [], dpi: [], dpiEnter: true, dpiRestore: true, rectOk: true, clientOk: true,
  DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2: 'physical', GWLP_USERDATA: 0, GA_ROOT: 2, WM_NCHITTEST: 132, HTCAPTION: 2, SM_XVIRTUALSCREEN: 0, SM_YVIRTUALSCREEN: 1, SM_CXVIRTUALSCREEN: 2, SM_CYVIRTUALSCREEN: 3,
  INPUT_MOUSE: 0, MOUSEEVENTF_MOVE: 1, MOUSEEVENTF_ABSOLUTE: 0x8000, MOUSEEVENTF_VIRTUALDESK: 0x4000, MOUSEEVENTF_LEFTDOWN: 2, MOUSEEVENTF_LEFTUP: 4, SDK_INPUT_SIZE: 40,
  IsWindow: () => true, IsWindowVisible: () => s.visible, IsWindowEnabled: () => s.enabled, IsIconic: () => s.minimized, GetWindowLongPtrW: () => h, GetForegroundWindow: () => s.foreground, GetCurrentProcessId: () => 7,
  GetWindowThreadProcessId: (hwnd: number, put: (pid: number) => void) => { put(hwnd === 1 ? s.pid : s.hitPid); return 7 }, GetAncestor: () => s.hitRoot,
  SetThreadDpiAwarenessContext: (context: string) => { s.dpi.push(context); return context === 'physical' ? s.dpiEnter ? 'previous' : null : s.dpiRestore ? 'physical' : null },
  GetWindowRect: (_window: any, rect: any) => { Object.assign(rect, s.rect); return s.rectOk }, ClientToScreen: (_window: any, point: any) => { point.y = s.clientTop; return s.clientOk }, GetSystemMetrics: (index: number) => s.screen[index],
  MAKELPARAM: (x: number, y: number) => { assert.ok(Number.isInteger(x) && x >= -32768 && x <= 32767 && Number.isInteger(y) && y >= -32768 && y <= 32767); return { x, y } },
  SendMessageW: (_hwnd: any, message: number) => { assert.equal(message, 132); return s.hitTest }, WindowFromPoint: () => s.hit,
  SendInput: (count: number, batch: any[], size: number) => { assert.equal(count, 3); assert.equal(size, 40); s.inputs.push(JSON.parse(JSON.stringify(batch))); s.reenter?.(); return s.input },
  fail: () => { s.failed = true }, failure: () => { s.failed = true }, observe788() {}, join788() {}, relation788: () => 4,
 }
 vm.createContext(s)
 vm.runInContext('globalThis.d476_owned_caption826=(window)=>{' + lowerCaption(source) + '\n};globalThis.begin=()=>{' + body + '\n};', s)
 return s
}
test('826 full emitted three Windows families include one owned-input setup; all product inverses and Mac bytes retain authority', () => {
 for (const kind of ['local', 'archive', 'terminal']) for (const language of ['cpp', 'swift']) for (const eol of ['\n', '\r\n']) for (const fixtureEol of ['\n', '\r\n']) {
  const source = generated(kind, language, eol, fixtureEol)
  if (language === 'cpp') { assert.equal((source.match(/static bool d476_owned_caption826\(/g) || []).length, 1); assert.match(source, /SendInput\(3,batch826,sizeof\(INPUT\)\)==3/); assert.match(source, /INPUT batch826\[3\]\{\}/) }
  else assert.doesNotMatch(source, /d476_owned_caption826|OWNED_INPUT826|selection_complete826/)
 }
})
test('826 actual generated setup selects once and still waits for actual foreground on every family', () => {
 for (const kind of ['local', 'archive', 'terminal']) {
  const s = harness(kind); s.visible=false; s.begin(); assert.equal(s.forms,0); assert.equal(s.inputs.length,0); assert.equal(s.dpi.length,0); s.visible=true; s.begin(); assert.equal(s.forms, 0); assert.equal(s.inputs.length, 1); assert.deepEqual([...s.dpi], ['physical', 'previous'])
  s.foreground = 1; s.begin(); s.begin(); assert.equal(s.forms, 1); assert.equal(s.inputs.length, 1); assert.equal(s.arms, kind === 'archive' ? 1 : 0)
  assert.deepEqual(s.inputs[0].map((row: any) => row.mi.dwFlags), [0xc001, 2, 4]); assert.ok(s.inputs[0][0].mi.dx > 0 && s.inputs[0][0].mi.dx < 65535)
 }
})
test('826 actual caption guards refuse unsafe targets without input and restore scoped DPI on every ordinary exit', () => {
 for (const change of [{ minimized: true }, { enabled: false }, { pid: 9 }, { hit: 2, hitPid: 9 }, { hitRoot: 9 }, { hitTest: 20 }, { hit: 0 }, { rectOk: false }, { clientOk: false }, { screen: [0, 0, 1920, 1080] }, { rect: { left: 40000, top: 0, right: 40400, bottom: 400 }, clientTop: 40, screen: [32768, 0, 10000, 1000] }]) {
  const s = harness(); Object.assign(s, change); s.begin(); s.foreground = 1; s.begin(); assert.equal(s.inputs.length, 0); assert.equal(s.forms, 0); assert.equal(s.failed, true); assert.deepEqual([...s.dpi], ['physical', 'previous'])
 }
 const s = harness(); s.dpiEnter = false; s.begin(); assert.equal(s.inputs.length, 0); assert.deepEqual([...s.dpi], ['physical'])
 const r = harness(); r.dpiRestore = false; r.begin(); r.foreground = 1; r.begin(); assert.equal(r.inputs.length, 1); assert.equal(r.forms, 0); assert.equal(r.failed, true)
})
test('826 short/reentrant/stale selection cannot pass the full3 fence or retry on later foreground', () => {
 for (const kind of ['local', 'archive', 'terminal']) {
  for (const inserted of [0, 1, 2]) { const s = harness(kind); s.input = inserted; s.reenter = () => { s.foreground = 1; s.begin(); assert.equal(s.forms, 0) }; s.begin(); s.begin(); assert.equal(s.inputs.length, 1); assert.equal(s.forms, 0); assert.equal(s.failed, true); assert.deepEqual([...s.dpi], ['physical', 'previous']) }
  const full = harness(kind); full.reenter = () => { full.foreground = 1; full.begin(); assert.equal(full.forms, 0) }; full.begin(); full.begin(); assert.equal(full.forms, 1); assert.equal(full.inputs.length, 1)
  for (const mutate of [(s: any) => s.h.epoch++, (s: any) => { s.h.controller = { Get: () => ({}) } }, (s: any) => { s.h.window = 9 }, (s: any) => { s.h.closing = true }]) { const s = harness(kind); s.reenter = () => { mutate(s); s.foreground = 1; s.begin() }; s.begin(); assert.equal(s.forms, 0); assert.equal(s.inputs.length, 1); assert.equal(s.failed, true) }
 }
})
function declaration(name: string) { const source = read('tests/desktop-native-thread-metadata-476.test.ts'), ast = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true); const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.ok(node); return node.getText(ast) }
test('826 current Windows LOCAL/ARCHIVE hosted-only admission is explicit, pure and before any native launch', () => {
 const source = read('tests/desktop-native-thread-metadata-476.test.ts')
 for (const [role, title] of [['LOCAL', '#476 native local-work keys'], ['ARCHIVE', '#476 actual native permanent archive']]) {
  const begin = source.indexOf(title), end = source.indexOf('\ntest(', begin), section = source.slice(begin, end < 0 ? undefined : end)
  const call = `/*OWNED_INPUT826_${role}*/if(process.platform==='win32')hostedTerminalHost705();`
  assert.equal(section.split(call).length, 2); assert.ok(section.indexOf(call) < section.indexOf('fs.mkdtempSync')); assert.ok(section.indexOf(call) < section.indexOf('.launch('))
 }
 for (const env of [{}, { GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS' }, { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows' }]) {
  const s: any = { assert, process: { platform: 'win32', env } }, before = JSON.stringify(env); vm.createContext(s); vm.runInContext(ts.transpileModule(declaration('hostedTerminalHost705'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, s)
  if (env.RUNNER_OS === 'Windows') s.hostedTerminalHost705(); else assert.throws(() => s.hostedTerminalHost705())
  assert.equal(JSON.stringify(env), before)
 }
})
test('826 behavior2call inverse then OBS9 full inverse retains prior46d and rejects missing/mutated admission', () => {
 const source = read('tests/desktop-native-thread-metadata-476.test.ts')
 for (const eol of ['\n', '\r\n']) {
  const raw = source.replace(/\r?\n/g, eol), intermediate = lineage.restoreInitialOwnedInput826(raw), prior = lineage.restoreObservation826('native', raw)
  assert.doesNotMatch(intermediate, /OWNED_INPUT826/); assert.equal((intermediate.match(/\/\*OBS826_BEGIN\*\//g) || []).length, 9); assert.doesNotMatch(prior, /OBS826_|OWNED_INPUT826/)
  for (const changed of [raw + eol, raw.replace('OWNED_INPUT826_LOCAL', 'OWNED_INPUT826_CHANGED'), raw.replace("/*OWNED_INPUT826_LOCAL*/if(process.platform==='win32')hostedTerminalHost705();", '')]) assert.throws(() => lineage.restoreObservation826('native', changed))
 }
 const generator = read('scripts/desktop-terminal-fixture.mjs')
 for (const eol of ['\n', '\r\n']) {
  const raw = generator.replace(/\r?\n/g, eol), prior = lineage.restoreInitialFixture826(raw)
  assert.doesNotMatch(prior, /OWNED_INPUT826|desktopOwnedCaptionSetup826/)
  for (const changed of [raw + eol, raw.replace('INPUT826_GENERATOR_BEGIN', 'INPUT826_BAD_BEGIN')]) assert.throws(() => lineage.restoreInitialFixture826(changed))
 }
})
test('826 actual first Dialog callbacks expose only bounded attempts and preserve the original third ACK drop', () => {
 const source = read('tests/desktop-native-thread-metadata-476.test.ts'), ast = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true)
 let outgoing: string | undefined, incoming: string | undefined
 function visit(n: ts.Node) { if (ts.isArrowFunction(n) && n.parameters.length === 2 && n.getText(ast).includes('terminalAttempted=true')) outgoing = n.getText(ast); if (ts.isArrowFunction(n) && n.parameters.length === 1 && n.parameters[0].name.getText(ast) === 'raw' && n.getText(ast).includes('sendRequests=Math.min')) incoming = n.getText(ast); ts.forEachChild(n, visit) } visit(ast); assert.ok(outgoing && incoming)
 const s: any = { terminalAttempted: false, openReplyAttempts: 0, sendRequests: 0, authenticated: true, userCommits: 0, target: undefined, dropped: false, failed: false, receipts: new Set(), required: [], threads: {}, prepareDialogL2Fixture() {}, Math, JSON, Reflect, forwards: 0, terminated: 0, original() { s.forwards++; return 'original' }, ws: { terminate() { s.terminated++ } }, failResolve() {} }
 vm.createContext(s); vm.runInContext(ts.transpileModule('globalThis.outgoing=' + outgoing + ';globalThis.incoming=' + incoming, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, s)
 s.outgoing(JSON.stringify({ type: 'desktop.chat.event', kind: 'terminal', private: 'PRIVATE' })); assert.equal(s.terminalAttempted, true)
 for (let i = 0; i < 10; i++) { s.outgoing(JSON.stringify({ type: 'desktop.thread.open.result' })); s.incoming(JSON.stringify({ type: 'desktop.chat.send', private: 'PRIVATE' })) }
 assert.equal(s.openReplyAttempts, 6); assert.equal(s.sendRequests, 4); s.authenticated = false; s.incoming(JSON.stringify({ type: 'desktop.chat.send' })); assert.equal(s.sendRequests, 4)
 for (let i = 0; i < 3; i++) s.outgoing(JSON.stringify({ type: 'desktop.chat.event', kind: 'user' }))
 assert.equal(s.userCommits, 3); assert.equal(s.dropped, true); assert.equal(s.terminated, 1); assert.equal(s.forwards, 13)
 assert.doesNotMatch(JSON.stringify({ terminalAttempted: s.terminalAttempted, openReplyAttempts: s.openReplyAttempts, sendRequests: s.sendRequests }), /PRIVATE/)
})
