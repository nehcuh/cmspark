import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import ts from 'typescript'
import {EventEmitter} from 'node:events'
import {createHmac} from 'node:crypto'
import {ThreadManager} from '../src/threads/thread-manager'
import {DesktopIdentityRegistry} from '../src/desktop/identity'
import {createDesktopChannel} from '../src/desktop/channel'
import {SecurityConfirmationManager} from '../src/security-confirmation'
import {createNativeTerminalRuntime} from '../src/desktop/terminal-runtime'
import {initDataDir} from '../src/config'
import * as pty from '../src/pty/session'

// Execute the actual production desktop close callback without starting the server.
function productionDisconnect(manager: SecurityConfirmationManager, cleared: unknown[]) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/ws/lifecycle.ts'), 'utf8')
  const ast = ts.createSourceFile('lifecycle.ts', source, ts.ScriptTarget.Latest, true)
  const found: ts.Expression[] = []
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createDesktopChannel') {
      const options = node.arguments[0]
      assert.ok(options && ts.isObjectLiteralExpression(options))
      for (const property of options.properties) {
        if (ts.isPropertyAssignment(property) && property.name.getText(ast) === 'onDisconnect') found.push(property.initializer)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(found.length, 1)
  const javascript = ts.transpileModule('(' + found[0].getText(ast) + ')', {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText
  return vm.runInNewContext(javascript, {
    requireRt: () => ({securityConfirmations: manager, clearMcpSession: (peer: unknown) => cleared.push(peer)}),
    require: (id: string) => { assert.equal(id, '../pty/session'); return pty },
  }, {timeout: 1000}) as (peer: unknown) => void
}

async function fixture(t: {after(callback: () => void): void}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-disconnect-')))
  const previous = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = root
  await initDataDir()
  const threads = new ThreadManager()
  threads.create('Owned', 'A')
  threads.update('A', {workspace_root: root})
  let kills = 0
  let exit: (value: {exitCode: number}) => void = () => {}
  const handle = {pid: 0, write() {}, resize() {}, pause() {}, resume() {},
    kill() { kills++; exit({exitCode: 0}) }, onData() {}, onExit(fn: typeof exit) { exit = fn }}
  pty.__testSetPtyPlatform('darwin') // Explicit supported PTY domain; no native process is started.
  pty.__testSetPtySpawn(() => handle)
  const manager = new SecurityConfirmationManager(), cleared: unknown[] = []
  const disconnect = productionDisconnect(manager, cleared)
  const runtime = createNativeTerminalRuntime(() => 'idle')
  runtime.modules = () => ({terminal: true, agent: false})
  const registry = new DesktopIdentityRegistry()
  const channel = createDesktopChannel({registry, services: {threads, skills: {list: () => [], listKnowledge: () => []}, mcp: {listServers: () => []}}, securityConfirmations: manager, terminalRuntime: runtime, onDisconnect: disconnect, maxPayload: 10485760})
  const peers: any[] = []
  function peer(host: string) {
    const ws: any = new EventEmitter(), frames: any[] = []
    ws.readyState = 1
    ws.send = (raw: string) => frames.push(JSON.parse(raw))
    ws.terminate = ws.close = () => { if (ws.readyState === 3) return; ws.readyState = 3; ws.emit('close') }
    peers.push(ws)
    channel.wss.emit('connection', ws)
    frames.shift()
    const boot = registry.issue(host), emit = (value: unknown) => ws.emit('message', Buffer.from(JSON.stringify(value)))
    emit({type: 'desktop.hello', capability_id: boot.capabilityId, protocol_version: 1})
    const challenge = frames.shift()
    emit({type: 'desktop.authenticate', capability_id: boot.capabilityId, protocol_version: 1, proof: createHmac('sha256', Buffer.from(boot.secret, 'hex')).update(JSON.stringify(['cmspark.desktop.auth.v1', boot.capabilityId, challenge.connection_id, 1, challenge.nonce])).digest('hex')})
    assert.equal(frames.shift().type, 'desktop.ready')
    return {ws, emit, frames}
  }
  async function open(owner: ReturnType<typeof peer>, id: string) {
    owner.emit({type: 'desktop.local.state', id: id + '-state', thread_id: 'A'})
    await new Promise<void>(resolve => setImmediate(resolve))
    const state = owner.frames.find(frame => frame.type === 'desktop.local.state.result')
    assert.equal(state?.ok, true)
    owner.emit({type: 'desktop.terminal.open', id, thread_id: 'A', revision: state.state.revision, cols: 80, rows: 24})
    for (let i = 0; i < 100 && !pty.isPtyBusy(); i++) {
      await new Promise<void>(resolve => setImmediate(resolve))
      const request = owner.frames.find(frame => frame.type === 'desktop.confirmation.request')
      if (request) {
        owner.frames.splice(owner.frames.indexOf(request), 1)
        owner.emit({type: 'desktop.confirmation.decision', purpose: request.purpose, confirmation_id: request.confirmation_id, thread_id: request.thread_id, action_digest: request.action_digest, approved: true})
      }
    }
    assert.equal(pty.isPtyBusy(), true, 'actual HMAC actor must reach the injected inert PTY')
    assert.ok(pty.getOwnedPtyContext(id, owner.ws))
  }
  t.after(() => {
    for (const ws of peers) ws.terminate()
    channel.wss.emit('close')
    manager.rejectAll('disconnect')
    pty.__testResetPtySessions()
    if (previous === undefined) delete process.env.CMSPARK_DATA_DIR
    else process.env.CMSPARK_DATA_DIR = previous
    fs.rmSync(root, {recursive: true, force: true})
  })
  return {peer, open, disconnect, cleared, kills: () => kills}
}

test('actual CLOSED desktop socket still retires its owned PTY through production teardown', async t => {
  const f = await fixture(t), owner = f.peer('owner-one')
  await f.open(owner, 'owned-one')
  owner.ws.terminate()
  assert.equal(pty.getOwnedPtyContext('owned-one', owner.ws), null, 'closed peer cannot acquire read authority')
  assert.equal(f.kills(), 1, 'closed-peer retirement must not depend on read authority')
  assert.equal(pty.isPtyBusy(), false)
  assert.deepEqual(f.cleared, [owner.ws])
})

test('foreign and null desktop disconnects cannot kill another exact owner PTY', async t => {
  const f = await fixture(t), owner = f.peer('owner-two'), foreign = f.peer('foreign-two')
  await f.open(owner, 'owned-two')
  foreign.ws.terminate()
  f.disconnect(null)
  assert.equal(f.kills(), 0)
  assert.equal(pty.isPtyBusy(), true)
  assert.ok(pty.getOwnedPtyContext('owned-two', owner.ws))
})

test('late predecessor teardown cannot kill a replacement peer PTY', async t => {
  const f = await fixture(t), old = f.peer('owner-old')
  await f.open(old, 'owned-old')
  old.ws.terminate()
  assert.equal(pty.isPtyBusy(), false)
  const next = f.peer('owner-next')
  await f.open(next, 'owned-next')
  f.disconnect(old.ws)
  assert.equal(f.kills(), 1)
  assert.ok(pty.getOwnedPtyContext('owned-next', next.ws))
})
