import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

test("S2.1 createBlankThread inherits live config — no DeepSeek stamp", () => {
  const src = readFileSync(
    join(process.cwd(), "src/sidepanel/components/ThreadList.tsx"),
    "utf8",
  )
  const start = src.indexOf("export function createBlankThread")
  assert.ok(start >= 0, "createBlankThread export missing")
  const end = src.indexOf("function generateShortId", start)
  const fn = src.slice(start, end > start ? end : start + 800)
  assert.match(fn, /config_override:\s*\{\}\s*as Thread/)
  assert.ok(!/provider:\s*["']deepseek["']/i.test(fn))
  assert.ok(!/model:\s*["']deepseek/i.test(fn))
})

// Execute actual producers/receiver; no mounted DOM, browser or runtime bridge.
import vm from "node:vm"
import ts from "typescript"

function unique<T>(values: T[]): T { assert.equal(values.length, 1); return values[0] }
function nodes(source: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = []
  const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit) }
  visit(source); return found
}
function actualBlankCreation() {
  const parse = (file: string) => ts.createSourceFile(file, readFileSync(join(process.cwd(), "src", file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const list = parse("sidepanel/components/ThreadList.tsx"), rail = parse("sidepanel/components/StatusRail.tsx")
  const hook = parse("sidepanel/hooks/useWebSocket.ts"), background = parse("background/index.ts")
  const fn = (source: ts.SourceFile, name: string) => unique(nodes(source, n => ts.isFunctionDeclaration(n) && n.name?.text === name)).getText(source)
  const clause = (source: ts.SourceFile, label: string) => unique(nodes(source, n => ts.isCaseClause(n) && ts.isStringLiteral(n.expression) && n.expression.text === label)).getText(source)
  const button = unique(nodes(rail, n => ts.isJsxOpeningElement(n) && n.tagName.getText(rail) === "button" && n.attributes.properties.some(a => ts.isJsxAttribute(a) && a.name.getText(rail) === "className" && a.initializer && ts.isStringLiteral(a.initializer) && a.initializer.text.includes("cm-header-new")))) as ts.JsxOpeningElement
  const click = unique(button.attributes.properties.filter(a => ts.isJsxAttribute(a) && a.name.getText(rail) === "onClick")) as ts.JsxAttribute
  if (!click.initializer || !ts.isJsxExpression(click.initializer) || !click.initializer.expression) throw new Error("actual New callback missing")
  const clickExpression = click.initializer.expression.getText(rail)
  const emit = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const explicit = emit(fn(list, "createBlankThread") + "\n" + fn(list, "generateShortId"))
  const auto = emit(fn(hook, "generateShortId") + '\nglobalThis.auto = msg => { switch(msg.type) {' + clause(hook, "thread.list") + '} };')
  const receive = emit('globalThis.receive = (message, sendResponse) => { switch(message.type) {' + clause(background, "thread.create") + '} };')
  let clock = 10000, random = 0
  class FixedDate extends Date { constructor() { super(clock) } static override now() { return clock } }
  const math = Object.create(Math); math.random = () => (++random % 35) / 36
  const sent: any[] = [], responses: any[] = [], produced: any[] = [], added: any[] = []
  const sw = { Date: FixedDate, wsClient: { send(message: unknown) { sent.push(JSON.parse(JSON.stringify(message))); return true } } }
  const actualReceive = vm.runInNewContext(receive + "; receive", sw, { timeout: 2000 })
  const deliver = (message: unknown) => { produced.push(JSON.parse(JSON.stringify(message))); return actualReceive(message, (value: unknown) => responses.push(JSON.parse(JSON.stringify(value)))) }
  const page = () => {
    const context: Record<string, unknown> = { exports: {}, Date: FixedDate, Math: math, dispatch: (action: any) => { if (action.type === "ADD_THREAD") added.push(action.thread) }, chrome: { runtime: { sendMessage: deliver } }, creatingBlankThreadRef: { current: false }, activeThreadRef: { current: null } }
    context.createBlankThread = vm.runInNewContext(explicit + "; exports.createBlankThread", context, { timeout: 2000 })
    const actualClick = vm.runInNewContext("(" + clickExpression + ")", context, { timeout: 2000 })
    const actualAuto = vm.runInNewContext(auto + "; auto", context, { timeout: 2000 })
    return { click: () => actualClick(), auto: () => actualAuto({ type: "thread.list", threads: [], list_scope: "active" }) }
  }
  return { page, advance: (ms: number) => { clock += ms }, sent, responses, produced, added, deliver }
}

test("#735 actual explicit New survives auto init and a second explicit New within 100ms", () => {
  for (const first of ["auto", "click"] as const) {
    const s = actualBlankCreation(), a = s.page(), b = s.page()
    a[first](); s.advance(100); b.click()
    assert.equal(s.added.length, 2); assert.equal(s.sent.length, 2)
    assert.equal(s.produced[1].user_gesture, true)
    assert.equal(new Set(s.sent.map(m => m.id)).size, 2)
    for (const message of s.sent) assert.deepEqual(Object.keys(message).sort(), ["alias", "id", "type"])
    assert.equal(s.responses.some(r => r.deduped), false)
  }
})

test("#735 explicit intent does not start or extend the original automatic dedup window", () => {
  const a = actualBlankCreation(), explicit = a.page(), firstAuto = a.page(), secondAuto = a.page()
  explicit.click(); a.advance(100); firstAuto.auto(); a.advance(100); secondAuto.auto()
  assert.equal(a.sent.length, 2); assert.equal(a.responses[2].deduped, true)
  const b = actualBlankCreation(), auto = b.page(), click = b.page(), nextAuto = b.page()
  auto.auto(); b.advance(1999); click.click(); b.advance(1); nextAuto.auto()
  assert.equal(b.sent.length, 3); assert.equal(b.responses.some(r => r.deduped), false)
})

test("#735 two auto pages retain dedup and the original exact 2000ms boundary", () => {
  const s = actualBlankCreation(), a = s.page(), b = s.page(), c = s.page()
  a.auto(); s.advance(1999); b.auto(); s.advance(1); c.auto()
  assert.equal(s.sent.length, 2); assert.equal(s.responses[1].deduped, true)
  assert.equal(s.produced.every(m => m.user_gesture === undefined), true)
  assert.equal(s.sent.every(m => m.alias === "" && m.type === "thread.create"), true)
})

test("#735 only strict true bypasses dedup and no internal hint enters the WS message", () => {
  for (const hint of [undefined, false, 0, 1, "true", {}, []]) {
    const s = actualBlankCreation(), first = s.page(), second = s.page()
    first.auto(); second.auto()
    // Mutate an actual producer output; this is not an invented wire payload.
    const message = { ...s.produced[1], user_gesture: hint }
    s.deliver(message)
    assert.equal(s.sent.length, 1); assert.equal(s.responses.at(-1).deduped, true)
  }
  const s = actualBlankCreation(); s.page().auto(); s.page().click()
  assert.equal(s.sent.length, 2)
  assert.equal(s.sent.some(m => Object.hasOwn(m, "user_gesture")), false)
})
