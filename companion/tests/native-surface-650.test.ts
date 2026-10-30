import nodeTest from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import vm from "node:vm"
import * as crypto from "node:crypto"
import type { TestContext } from "node:test"
import { acquireSurface650, parseSurfaceBorrow650, withSurface650 } from "./fixtures/native-surface-650"

// Only these new pure regression tests get a failure deadline. Existing native
// test budgets and resource admission remain unchanged. Every wait uses t.signal.
function boundedTest(name: string, run: (t: TestContext) => Promise<void>) {
  return nodeTest(name, { timeout: 5000 }, run)
}

function owned() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-test-run-")), data = fs.mkdtempSync(path.join(root, "process-"))
  return { root, data, claim: path.join(root, "native-surface-650", "claim"), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}
boundedTest("surface lease excludes a second real filesystem client until the first lifetime closes", async t => {
  const o = owned(), signal = t.signal
  try {
    const first = await acquireSurface650(o.root, o.data, signal); let entered = false
    const pending = acquireSurface650(o.root, o.data, signal).then(v => { entered = true; return v })
    await Promise.resolve(); assert.equal(entered, false); first.checkpoint(); first.release()
    const second = await pending; assert.equal(entered, true); second.checkpoint(); second.release(); assert.equal(fs.existsSync(o.claim), false)
  } finally { o.cleanup() }
})
boundedTest("notification plus registered atomic recheck does not lose same-turn release", async t => {
  const o = owned(), signal = t.signal; let first: Awaited<ReturnType<typeof acquireSurface650>> | undefined
  const open = fs.openSync; let hook = 0
  try {
    first = await acquireSurface650(o.root, o.data, signal)
    fs.openSync = ((...args: Parameters<typeof fs.openSync>) => {
      try { return Reflect.apply(open, fs, args) } catch (e) {
        if (!hook && args[0] === path.join(fs.realpathSync(o.root), "native-surface-650", "claim") && args[1] === "wx+" && (e as NodeJS.ErrnoException).code === "EEXIST") { hook++; first!.release() }
        throw e
      }
    }) as typeof fs.openSync
    const second = await acquireSurface650(o.root, o.data, signal); assert.equal(hook, 1); second.checkpoint(); second.release()
  } finally { fs.openSync = open; o.cleanup() }
})
boundedTest("aborted contender cannot enter or remove the actual foreign owner claim", async t => {
  const o = owned(), abort = new AbortController(), reason = Error("OWNED_ABORT")
  try {
    const first = await acquireSurface650(o.root, o.data, t.signal), bytes = fs.readFileSync(o.claim)
    const pending = acquireSurface650(o.root, o.data, AbortSignal.any([t.signal, abort.signal])); abort.abort(reason)
    await assert.rejects(pending, e => e === reason); assert.deepEqual(fs.readFileSync(o.claim), bytes); first.checkpoint(); first.release()
    await assert.rejects(acquireSurface650(o.root, o.data, AbortSignal.any([t.signal, abort.signal])), e => e === reason); assert.equal(fs.existsSync(o.claim), false)
  } finally { o.cleanup() }
})
boundedTest("malformed and non-file claims refuse without adopting or deleting them", async t => {
  const o = owned(), signal = t.signal
  try {
    fs.mkdirSync(path.dirname(o.claim)); fs.writeFileSync(o.claim, "owned-malformed")
    await assert.rejects(acquireSurface650(o.root, o.data, signal), /OWNED_NATIVE_SURFACE_REFUSED/); assert.equal(fs.readFileSync(o.claim, "utf8"), "owned-malformed")
    fs.unlinkSync(o.claim); const target = path.join(o.root, "unchanged"); fs.writeFileSync(target, "a".repeat(64)); fs.mkdirSync(o.claim)
    await assert.rejects(acquireSurface650(o.root, o.data, signal), /OWNED_NATIVE_SURFACE_REFUSED/); assert.equal(fs.lstatSync(o.claim).isDirectory(), true); assert.equal(fs.readFileSync(target, "utf8"), "a".repeat(64))
  } finally { o.cleanup() }
})
boundedTest("replaced claim aborts the owner and release never deletes the replacement", async t => {
  const o = owned(), signal = t.signal
  let lease: Awaited<ReturnType<typeof acquireSurface650>> | undefined
  try {
    lease = await acquireSurface650(o.root, o.data, signal)
    fs.renameSync(o.claim, path.join(o.root, "original-claim")); fs.writeFileSync(o.claim, "b".repeat(64))
    assert.throws(() => lease!.checkpoint(), /OWNED_NATIVE_SURFACE_REFUSED/)
    assert.equal(lease.signal.aborted, true, "synchronous ownership loss must abort synchronously, not wait for a future filesystem notification")
    assert.throws(() => lease!.release(), /OWNED_NATIVE_SURFACE_REFUSED/); assert.equal(fs.readFileSync(o.claim, "utf8"), "b".repeat(64))
  } finally { if (lease) try { lease.release() } catch {} o.cleanup() }
})
boundedTest("observed scope identity replacement cannot silently rebind an existing lease", async t => {
  const o = owned(), stat = fs.lstatSync, other = path.join(o.root, "replacement-scope")
  const descriptor = Object.getOwnPropertyDescriptor(fs, "lstatSync")!
  let lease: Awaited<ReturnType<typeof acquireSurface650>> | undefined, scopeReads = 0
  try {
    // Use a different real owned directory identity through the actual stat
    // boundary. Renaming a directory with a live Windows watch is not portable.
    fs.mkdirSync(other)
    const replacement = stat(other, { bigint: true })
    lease = await acquireSurface650(o.root, o.data, t.signal)
    const scope = path.dirname(path.join(fs.realpathSync(o.root), "native-surface-650", "claim")), bytes = fs.readFileSync(o.claim)
    const original = stat(scope, { bigint: true })
    assert.notDeepEqual([replacement.dev, replacement.ino, replacement.birthtimeNs], [original.dev, original.ino, original.birthtimeNs])
    Object.defineProperty(fs, "lstatSync", { ...descriptor, value: ((...args: Parameters<typeof fs.lstatSync>) => {
      if (args[0] === scope) { scopeReads++; return replacement }
      return Reflect.apply(stat, fs, args)
    }) as typeof fs.lstatSync })
    assert.throws(() => lease!.checkpoint(), /OWNED_NATIVE_SURFACE_REFUSED/)
    assert.equal(lease.signal.aborted, true)
    assert.throws(() => lease!.release(), /OWNED_NATIVE_SURFACE_REFUSED/)
    assert.ok(scopeReads >= 2, "both checkpoint and release must validate scope identity")
    assert.deepEqual(fs.readFileSync(o.claim), bytes, "refusal must not delete or rewrite the original claim")
  } finally {
    Object.defineProperty(fs, "lstatSync", descriptor)
    if (lease) try { lease.release() } catch {}
    o.cleanup()
  }
})
boundedTest("explicit same-run borrow validates nonce and identity but cannot release the parent's lease", async t => {
  const o = owned(), signal = t.signal
  try {
    const owner = await acquireSurface650(o.root, o.data, signal), token = owner.borrow(), parsed = parseSurfaceBorrow650(JSON.stringify(token))
    const child = await acquireSurface650(o.root, o.data, signal, parsed); child.checkpoint(); child.release(); owner.checkpoint(); assert.equal(fs.existsSync(o.claim), true)
    await assert.rejects(acquireSurface650(o.root, o.data, signal, { ...token, nonce: "0".repeat(64) }), /OWNED_NATIVE_SURFACE_REFUSED/)
    await assert.rejects(acquireSurface650(o.root, o.data, signal, { ...token, claimIdentity: { ...token.claimIdentity, ino: "0" } }), /OWNED_NATIVE_SURFACE_REFUSED/)
    const other = owned(); try { await assert.rejects(acquireSurface650(other.root, other.data, signal, token), /OWNED_NATIVE_SURFACE_REFUSED/) } finally { other.cleanup() }
    owner.release(); await assert.rejects(acquireSurface650(o.root, o.data, signal, token)); assert.equal(fs.existsSync(o.claim), false)
    assert.throws(() => parseSurfaceBorrow650(JSON.stringify({ ...token, unknown: true })), /OWNED_NATIVE_SURFACE_REFUSED/)
  } finally { o.cleanup() }
})
boundedTest("unknown native teardown retains its actual claim rather than permitting another owner", async t => {
  const o = owned(), abort = new AbortController()
  try {
    const lease = await acquireSurface650(o.root, o.data, AbortSignal.any([t.signal, abort.signal])); lease.retain(); assert.throws(() => lease.release(), /OWNED_NATIVE_SURFACE_UNSETTLED/); assert.equal(fs.existsSync(o.claim), true)
    const contender = acquireSurface650(o.root, o.data, AbortSignal.any([t.signal, abort.signal])); abort.abort(); await assert.rejects(contender); assert.equal(fs.existsSync(o.claim), true)
  } finally { o.cleanup() }
})
boundedTest("actual wrapper preserves a thrown producer primary and releases only its owned claim", async t => {
  const o = owned(), beforeRoot = process.env.CMSPARK_TEST_RUN_DIR, beforeData = process.env.CMSPARK_DATA_DIR, primary = Error("OWNED_PRIMARY")
  process.env.CMSPARK_TEST_RUN_DIR = o.root; process.env.CMSPARK_DATA_DIR = o.data
  try {
    const context = { signal: t.signal } as TestContext
    await assert.rejects(withSurface650(context, async (_t, lease) => { lease.checkpoint(); throw primary }), e => e === primary)
    assert.equal(fs.existsSync(o.claim), false)
    const next = await acquireSurface650(o.root, o.data, t.signal); next.release()
  } finally {
    if (beforeRoot === undefined) delete process.env.CMSPARK_TEST_RUN_DIR; else process.env.CMSPARK_TEST_RUN_DIR = beforeRoot
    if (beforeData === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = beforeData
    o.cleanup()
  }
})
boundedTest("root/data outside the explicit invocation is refused without creating a claim", async t => {
  const o = owned(), other = owned(), signal = t.signal
  try {
    await assert.rejects(acquireSurface650(undefined, o.data, signal)); await assert.rejects(acquireSurface650(o.root, other.data, signal)); assert.equal(fs.existsSync(o.claim), false)
  } finally { o.cleanup(); other.cleanup() }
})

boundedTest("a real contender between exclusive inode creation and nonce publication waits without false refusal", async t => {
  const o = owned(), abort = new AbortController(), open = fs.openSync
  let owner: Awaited<ReturnType<typeof acquireSurface650>> | undefined, second: Awaited<ReturnType<typeof acquireSurface650>> | undefined
  let pending: Promise<{ lease?: Awaited<ReturnType<typeof acquireSurface650>>; error?: unknown }> | undefined, intercepted = false, rejected = false
  const actualClaim = path.join(fs.realpathSync(o.root), "native-surface-650", "claim")
  try {
    fs.openSync = ((...args: Parameters<typeof fs.openSync>) => {
      const fd = Reflect.apply(open, fs, args)
      if (!intercepted && args[0] === actualClaim && args[1] === "wx+") {
        intercepted = true
        assert.equal(fs.fstatSync(fd).size, 0, "the contender must really run before nonce publication")
        pending = acquireSurface650(o.root, o.data, AbortSignal.any([t.signal, abort.signal])).then(lease => ({ lease }), error => { rejected = true; return { error } })
      }
      return fd
    }) as typeof fs.openSync
    owner = await acquireSurface650(o.root, o.data, AbortSignal.any([t.signal, abort.signal])); fs.openSync = open
    await Promise.resolve(); assert.equal(intercepted, true); assert.equal(rejected, false, "a publishing owner must be busy, not malformed")
    owner.release(); owner = undefined
    const result = await pending!; assert.equal(result.error, undefined); second = result.lease!; second.checkpoint(); second.release(); second = undefined
  } finally {
    fs.openSync = open; abort.abort()
    for (const lease of [owner, second]) if (lease) try { lease.release() } catch {}
    await pending; o.cleanup()
  }
})
boundedTest("an empty foreign claim is only busy; abort neither adopts nor deletes it and malformed64 still refuses", async t => {
  const o = owned(), abort = new AbortController()
  try {
    fs.mkdirSync(path.dirname(o.claim)); fs.writeFileSync(o.claim, "")
    const pending = acquireSurface650(o.root, o.data, AbortSignal.any([t.signal, abort.signal])); abort.abort(); await assert.rejects(pending); assert.equal(fs.statSync(o.claim).size, 0)
    fs.writeFileSync(o.claim, "z".repeat(64)); await assert.rejects(acquireSurface650(o.root, o.data, t.signal)); assert.equal(fs.readFileSync(o.claim, "utf8"), "z".repeat(64))
  } finally { o.cleanup() }
})

// Original cancellation cannot hand off a still-live owner. Proven cleanup can
// settle the same identity even after its caller signal has already aborted.
boundedTest("active-owner abort holds exclusion until actual cleanup settles and releases", async t => {
  const o = owned(), ownerAbort = new AbortController(), contenderAbort = new AbortController()
  let owner: Awaited<ReturnType<typeof acquireSurface650>> | undefined, next: Awaited<ReturnType<typeof acquireSurface650>> | undefined
  let pending: Promise<Awaited<ReturnType<typeof acquireSurface650>>> | undefined, entered = false
  try {
    owner = await acquireSurface650(o.root, o.data, AbortSignal.any([t.signal, ownerAbort.signal])); owner.retain()
    pending = acquireSurface650(o.root, o.data, AbortSignal.any([t.signal, contenderAbort.signal])).then(v => { entered = true; return v })
    ownerAbort.abort(Error("OWNED_PRIMARY_ABORT")); await Promise.resolve()
    assert.equal(owner.signal.aborted, true); assert.equal(entered, false); assert.equal(fs.existsSync(o.claim), true)
    owner.settled(); owner.release(); owner = undefined
    next = await pending; assert.equal(entered, true); next.release(); next = undefined
  } finally { contenderAbort.abort(); for (const lease of [owner, next]) if (lease) try { lease.release() } catch {} if (pending) await pending.catch(()=>{}); o.cleanup() }
})
boundedTest("actual nested wrapper borrow leaves the parent exclusive until its awaited cleanup", async t => {
  const o = owned(), oldRoot = process.env.CMSPARK_TEST_RUN_DIR, oldData = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_TEST_RUN_DIR = o.root; process.env.CMSPARK_DATA_DIR = o.data
  try {
    const context = { signal: t.signal } as TestContext
    await withSurface650(context, async (parentContext, parent) => {
      await withSurface650(parentContext, async (_childContext, child) => { child.checkpoint(); child.retain(); child.settled() }, parent.borrow())
      parent.checkpoint(); assert.equal(fs.existsSync(o.claim), true)
    })
    assert.equal(fs.existsSync(o.claim), false)
  } finally {
    if (oldRoot === undefined) delete process.env.CMSPARK_TEST_RUN_DIR; else process.env.CMSPARK_TEST_RUN_DIR=oldRoot
    if (oldData === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR=oldData
    o.cleanup()
  }
})

boundedTest("settlement ownership loss cannot replace the original producer failure or admit success", async t => {
  const o = owned(), oldRoot = process.env.CMSPARK_TEST_RUN_DIR, oldData = process.env.CMSPARK_DATA_DIR, primary = Error("OWNED_NATIVE_PRIMARY")
  process.env.CMSPARK_TEST_RUN_DIR=o.root; process.env.CMSPARK_DATA_DIR=o.data
  const replacement = () => { fs.renameSync(o.claim, path.join(o.root, "original-claim")); fs.writeFileSync(o.claim, "d".repeat(64)) }
  try {
    const diagnostics: string[] = [], context = {signal:t.signal,diagnostic:(s:string)=>diagnostics.push(s)} as unknown as TestContext
    await assert.rejects(withSurface650(context, async (_t, lease) => {
      try { replacement(); throw primary } finally { lease.retain(); lease.settled(); assert.equal(lease.signal.aborted,true) }
    }), e => e === primary)
    assert.equal(fs.readFileSync(o.claim,"utf8"),"d".repeat(64))
    fs.unlinkSync(o.claim); fs.unlinkSync(path.join(o.root,"original-claim"))
    await assert.rejects(withSurface650(context, async (_t, lease) => { replacement(); lease.retain(); lease.settled() }), /OWNED_NATIVE_SURFACE_REFUSED/)
    assert.equal(fs.readFileSync(o.claim,"utf8"),"d".repeat(64)); assert.deepEqual(diagnostics,["NATIVE_SURFACE_650_CLEANUP_REFUSED","NATIVE_SURFACE_650_CLEANUP_REFUSED"])
  } finally {
    if(oldRoot===undefined)delete process.env.CMSPARK_TEST_RUN_DIR;else process.env.CMSPARK_TEST_RUN_DIR=oldRoot
    if(oldData===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=oldData
    o.cleanup()
  }
})


boundedTest("wrapper keeps its preload data binding while a previous native callback restores mutable environment", async t => {
  const original=owned(),outside=owned(),other=owned(),code=fs.readFileSync(path.join(__dirname,"fixtures/native-surface-650.js"),"utf8")
  const boot={CMSPARK_TEST_RUN_DIR:original.root,CMSPARK_DATA_DIR:original.data},mod:{exports:any}={exports:{}},allowed:any={"node:fs":fs,"node:path":path,"node:crypto":crypto}
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require:(name:string)=>{assert.ok(Object.hasOwn(allowed,name));return allowed[name]},process:{env:boot},AbortController,AbortSignal,Buffer})
  const api=mod.exports as {acquireSurface650:typeof acquireSurface650;withSurface650:typeof withSurface650}
  let owner:Awaited<ReturnType<typeof acquireSurface650>>|undefined,pending:Promise<unknown>|undefined,entered=0
  const abort=new AbortController(),context={signal:AbortSignal.any([t.signal,abort.signal])} as TestContext
  try{
    owner=await api.acquireSurface650(original.root,original.data,t.signal);const bytes=fs.readFileSync(original.claim)
    boot.CMSPARK_DATA_DIR=outside.data // Same runner root, old callback still owns its temporary data.
    pending=api.withSurface650(context,async(_t,lease)=>{entered++;lease.checkpoint();return "OWNED_ENTERED"}).then(value=>({value}),error=>({error}))
    await Promise.resolve();assert.equal(entered,0);assert.deepEqual(fs.readFileSync(original.claim),bytes)
    owner.release();owner=undefined;assert.deepEqual(await pending,{value:"OWNED_ENTERED"});pending=undefined;assert.equal(entered,1);assert.equal(fs.existsSync(original.claim),false)
    // Mutating the data string cannot rebind even to another valid data dir.
    boot.CMSPARK_DATA_DIR=other.data;await api.withSurface650(context,async(_t,lease)=>{lease.checkpoint();assert.equal(fs.existsSync(original.claim),true);assert.equal(fs.existsSync(other.claim),false)})
    owner=await api.acquireSurface650(original.root,original.data,t.signal);const kept=fs.readFileSync(original.claim)
    pending=api.withSurface650(context,async()=>{throw Error("UNEXPECTED_ABORTED_ACTION")}).then(value=>({value}),error=>({error}));abort.abort();const refused:any=await pending;pending=undefined;assert.ok(refused.error);assert.deepEqual(fs.readFileSync(original.claim),kept);owner.checkpoint();owner.release();owner=undefined
    // Existing explicit other-root test seam remains valid; no new root grant.
    boot.CMSPARK_TEST_RUN_DIR=other.root;boot.CMSPARK_DATA_DIR=other.data
    await api.withSurface650({signal:t.signal} as TestContext,async(_t,lease)=>{lease.checkpoint();assert.equal(fs.existsSync(other.claim),true)})
  }finally{abort.abort();if(owner)try{owner.release()}catch{};if(pending)await pending.catch(()=>{});for(const o of [original,outside,other])o.cleanup()}
})

boundedTest("terminal admission waits for the real surface owner before reading mutable data", async t => {
  const ts = require("typescript") as typeof import("typescript")
  const source = fs.readFileSync(path.resolve(__dirname, "../../tests/desktop-native-thread-metadata-476.test.ts"), "utf8")
  const ast = ts.createSourceFile("desktop-native-thread-metadata-476.test.ts", source, ts.ScriptTarget.Latest, true)
  const declaration = (name: string) => {
    const matches = ast.statements.filter((n): n is import("typescript").FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name)
    assert.equal(matches.length, 1); return matches[0]
  }
  const tests = ast.statements.filter(ts.isExpressionStatement).map(n => n.expression).filter((n): n is import("typescript").CallExpression =>
    ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "test" && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === "#476 terminal-only native confirmation→real user PTY→selected partial excerpt→canonical reopen")
  assert.equal(tests.length, 1)
  const outer = tests[0].arguments[2]; assert.ok(ts.isArrowFunction(outer) && ts.isBlock(outer.body))
  const statements = outer.body.statements
  assert.ok(ts.isExpressionStatement(statements[0]) && ts.isCallExpression(statements[0].expression) && statements[0].expression.expression.getText(ast) === "hostedTerminalHost705")
  assert.ok(ts.isReturnStatement(statements[1]) && statements[1].expression && ts.isCallExpression(statements[1].expression) && statements[1].expression.expression.getText(ast) === "withSurface650")
  const body = statements[1].expression.arguments[1]; assert.ok(ts.isArrowFunction(body) && ts.isBlock(body.body))
  const first = body.body.statements[0]; assert.ok(ts.isVariableStatement(first))
  const init = first.declarationList.declarations[0].initializer
  assert.ok(init && ts.isCallExpression(init) && init.expression.getText(ast) === "hostedTerminalAdmission705")

  const original=owned(), outside=owned(), code=fs.readFileSync(path.join(__dirname,"fixtures/native-surface-650.js"),"utf8")
  const boot:any={CMSPARK_TEST_RUN_DIR:original.root,CMSPARK_DATA_DIR:original.data,GITHUB_ACTIONS:"true",RUNNER_OS:"macOS",PATH:"/usr/bin:/bin"}
  const proc={platform:"darwin",env:boot}, mod:{exports:any}={exports:{}}, allowed:any={"node:fs":fs,"node:path":path,"node:crypto":crypto}
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require:(name:string)=>{assert.ok(Object.hasOwn(allowed,name));return allowed[name]},process:proc,AbortController,AbortSignal,Buffer})
  const api=mod.exports as {acquireSurface650:typeof acquireSurface650;withSurface650:typeof withSurface650}
  const admit=vm.runInNewContext(declaration("hostedTerminalHost705").getText(ast)+";"+declaration("hostedTerminalAdmission705").getText(ast)+";hostedTerminalAdmission705",{process:proc,assert,fs,path,Set}) as ()=>string
  let owner:Awaited<ReturnType<typeof acquireSurface650>>|undefined, pending:Promise<unknown>|undefined,entered=0
  const cancel=new AbortController(),context={signal:AbortSignal.any([t.signal,cancel.signal])} as TestContext
  try {
    boot.GITHUB_ACTIONS="false"; assert.throws(admit,/TERMINAL705_REMOTE_GHA_REQUIRED/); assert.equal(fs.existsSync(original.claim),false); boot.GITHUB_ACTIONS="true"
    owner=await api.acquireSurface650(original.root,original.data,t.signal); owner.retain()
    boot.CMSPARK_DATA_DIR=outside.data
    assert.throws(admit,/TERMINAL705_OWNED_DATA_REQUIRED/,"the former pre-lease read encounters the prior owner's data")
    pending=api.withSurface650(context,async(_t,lease)=>{entered++;lease.checkpoint();return admit()})
    await Promise.resolve(); assert.equal(entered,0)
    boot.CMSPARK_DATA_DIR=original.data; owner.settled(); owner.release(); owner=undefined
    assert.equal(await pending,fs.realpathSync(original.data)); pending=undefined; assert.equal(entered,1)
    owner=await api.acquireSurface650(original.root,original.data,t.signal); owner.retain(); const claim=fs.readFileSync(original.claim)
    pending=api.withSurface650(context,async()=>{entered++;return admit()}); cancel.abort()
    await assert.rejects(pending); pending=undefined; assert.equal(entered,1); assert.deepEqual(fs.readFileSync(original.claim),claim)
    owner.settled(); owner.release(); owner=undefined
  } finally { cancel.abort(); if(owner)try{owner.settled();owner.release()}catch{}; if(pending)await pending.catch(()=>{}); original.cleanup(); outside.cleanup() }
})
