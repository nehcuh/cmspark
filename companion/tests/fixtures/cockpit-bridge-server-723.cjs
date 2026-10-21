// Remote-owned first vertical: actual startServer/lifecycle/HMAC and actual
// bridge handler. Observe only fixed bridge-state counts; never synthesize it.
'use strict'
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict')
assert.equal(process.platform, 'win32'); assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_OS, 'Windows')
assert.ok(process.env.CMSPARK_DATA_DIR && process.env.CMSPARK_TEST_RUN_DIR && path.isAbsolute(process.env.CMSPARK_723_COMPILED_ROOT))
const dist = process.env.CMSPARK_723_COMPILED_ROOT
const requireProduct = require('node:module').createRequire(path.join(dist, 'server.js'))
const cp = require('node:child_process')
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[method] = () => { throw Error('COCKPIT_BRIDGE_SERVER_EFFECT_DENIED') }
process.dlopen = () => { throw Error('COCKPIT_BRIDGE_SERVER_NATIVE_DENIED') }
const denied = () => { throw Error('COCKPIT_BRIDGE_SERVER_OUTBOUND_DENIED') }
global.fetch = denied
require('node:net').Socket.prototype.connect = denied
require('node:tls').connect = denied
for (const name of ['http', 'https']) for (const method of ['request', 'get']) require('node:' + name)[method] = denied
// The canonical preload allocates a fresh process-owned directory. Pair only
// that directory; never assume the parent's data-dir survives child preload.
require(path.resolve(__dirname, '../../scripts/test-data-dir.cjs'))
const relative = path.relative(fs.realpathSync(process.env.CMSPARK_TEST_RUN_DIR), fs.realpathSync(process.env.CMSPARK_DATA_DIR))
assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
const initialization = new Promise((resolve, reject) => {
  const gone = () => reject(Error('COCKPIT_BRIDGE_INIT_DISCONNECTED'))
  const accept = message => {
    process.removeListener('disconnect', gone)
    if (!message || Object.keys(message).sort().join() !== 'secret,type' || message.type !== 'init' ||
      typeof message.secret !== 'string' || !/^[0-9a-f]{64}$/.test(message.secret)) { reject(Error('COCKPIT_BRIDGE_INIT_INVALID')); return }
    try { fs.writeFileSync(path.join(process.env.CMSPARK_DATA_DIR, 'ws_secret'), message.secret + '\n', { flag: 'wx', mode: 0o600 }); resolve() }
    catch { reject(Error('COCKPIT_BRIDGE_INIT_WRITE_REFUSED')) }
  }
  process.once('message', accept); process.once('disconnect', gone)
})
let expectedId = null, verified = 0, unavailable = 0, ownedServer
;(async () => {
  await initialization
  const config = require(path.join(dist, 'config.js')); await config.initDataDir()
  const previous = config.getConfig()
  config.saveConfig({ port: 23401, llm: { ...previous.llm, api_key: '', base_url: 'http://127.0.0.1:9' },
    vision: { ...previous.vision, enabled: false }, voice: { ...previous.voice, enabled: false },
    mcp: { enabled: false, servers: [] }, acp: { ...previous.acp, enabled: false }, apps: { enabled: false, entries: {} } })
  const server = require(path.join(dist, 'server.js')), life = require(path.join(dist, 'ws/lifecycle.js'))
  const { WebSocket } = requireProduct('ws')
  const originalSend = WebSocket.prototype.send
  WebSocket.prototype.send = function (...args) {
    const result = Reflect.apply(originalSend, this, args)
    try { const frame = args[0]
    if (typeof frame !== 'string' || !frame.startsWith('{"type":"cockpit.bridge.state",')) return result
    const state = JSON.parse(frame), auth = life.getWsAuthState(this)
    if (auth?.authenticated !== true || auth.surface !== 'panel' || auth.origin !== 'chrome-extension://' + expectedId || this.readyState !== WebSocket.OPEN) return result
    if (state.v === 1 && state.state === 'verified') { verified++; process.send?.({ type: 'bridge-state', state: 'verified', count: verified }, () => {}) }
    else if (state.v === 1 && state.state === 'unavailable') { unavailable++; process.send?.({ type: 'bridge-state', state: 'unavailable', count: unavailable }, () => {}) }
    } catch { /* observation failure cannot change the original send result */ }
    return result
  }
  const tm = server.seedThreadManagerForTests(), skills = new (require(path.join(dist, 'skills/skill-engine.js')).SkillEngine)()
  life.bindWsLifecycle({ createToolExecutor: server.createToolExecutor, handleSecurityConfirmationResponse: server.handleSecurityConfirmationResponse,
    initServices: async () => {}, getThreadManager: () => tm, getSkillEngine: () => skills, getHistoryStore: () => ({ close() {} }),
    securityConfirmations: server.securityConfirmations, handleComputerTaskAbort: () => { throw Error('COCKPIT_BRIDGE_NO_TASK') },
    flipAllComputerTaskAborts: () => 0, probeChatModel: async () => {}, // startup DI; outbound transports are denied above
    getMcpSessionId: server.getSessionIdForTests, clearMcpSession: () => {}, getActiveMcpSessions: () => new Set(), activeTrayConfirmsByWs: new WeakMap() })
  const http = require('node:http'), originalCreate = http.createServer
  let listening, failed
  const ready = new Promise((resolve, reject) => { listening = resolve; failed = reject })
  http.createServer = function (...args) {
    assert.equal(ownedServer, undefined)
    ownedServer = Reflect.apply(originalCreate, this, args)
    ownedServer.once('listening', listening); ownedServer.once('error', failed)
    return ownedServer
  }
  try { await life.startServer(); await ready } finally { http.createServer = originalCreate }
  process.on('message', message => {
    if (message?.type === 'observer-id' && typeof message.id === 'string' && /^[a-p]{32}$/.test(message.id)) {
      expectedId = message.id; process.send?.({ type: 'observer-id-set' })
    }
  })
  process.send?.({ type: 'ready' })
})().catch(() => { process.send?.({ type: 'failed', reason: 'COCKPIT_BRIDGE_OWNED_SERVER_FAILED' }); process.exitCode = 1 })
