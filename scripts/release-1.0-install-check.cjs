const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const { createHmac, randomUUID } = require('node:crypto')
const { createServer } = require('node:http')
const { setTimeout: delay } = require('node:timers/promises')
const { chromium } = require('playwright')
const { WebSocket } = require('ws')

const exec = promisify(execFile)
const windows = process.platform === 'win32'
const mac = process.platform === 'darwin'
const root = path.join(process.env.RUNNER_TEMP, 'cmspark-install-check')
const installed = path.join(root, 'installed')
const data = path.join(root, 'user-data')
const backup = path.join(root, 'backup')
const extension = path.join(root, 'extension')
const browserProfile = path.join(root, 'chromium-profile')
const origin = 'http://127.0.0.1:23401'
const env = { ...process.env, CMSPARK_DATA_DIR: data, CMSPARK_SKIP_LOGIN_ENV: '1' }
delete env.GH_TOKEN
delete env.GITHUB_TOKEN
const notes = []
const mark = value => { notes.push(value); console.log(value) }

async function eventually(probe, label, milliseconds = 20000) {
  const limit = Date.now() + milliseconds
  do {
    const found = await probe()
    if (found) return found
    await delay(100)
  } while (Date.now() < limit)
  throw Error('Timed out: ' + label)
}

async function files(dir) {
  const result = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await files(name))
    else result.push(name)
  }
  return result
}

function bundle() {
  if (mac) return path.join(installed, 'CMspark.app', 'Contents', 'Resources')
  return windows ? installed : '/opt/cmspark'
}

async function install(variant, version) {
  const assets = await files(path.join(root, variant))
  const exact = windows ? 'CMspark-Setup-v' + version + '-windows-x64.exe'
    : mac ? 'CMspark-v' + version + '-macOS-arm64.dmg' : 'cmspark_' + version + '-1_amd64.deb'
  const packageFile = assets.find(file => path.basename(file) === exact)
  assert.ok(packageFile, exact)
  if (windows) {
    await exec(packageFile, ['/S', '/D=' + installed], { timeout: 180000, windowsHide: true })
  } else if (mac) {
    const mount = path.join(root, 'mount')
    await fs.mkdir(mount, { recursive: true })
    await exec('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, packageFile])
    try {
      const app = path.join(mount, 'CMspark.app')
      await exec('codesign', ['--verify', '--deep', '--strict', app])
      await fs.rm(path.join(installed, 'CMspark.app'), { recursive: true, force: true })
      await fs.mkdir(installed, { recursive: true })
      await exec('ditto', [app, path.join(installed, 'CMspark.app')])
    } finally { await exec('hdiutil', ['detach', mount]) }
  } else {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'real package installation requires a disposable Actions runner')
    await exec('sudo', ['dpkg', '-i', packageFile], { timeout: 180000 })
    const service = 'cmspark-companion.service'
    const active = await exec('systemctl', ['--user', 'is-active', service]).then(
      result => result.stdout.trim() === 'active', () => false
    )
    if (active) {
      mark('DEB postinst started its user service; stopping it before switching to the owned data directory')
      await exec('systemctl', ['--user', 'stop', 'cmspark-tray.service', service], { timeout: 30000 })
    }
    assert.equal(await fetch(origin + '/healthz').then(() => true, () => false), false, 'port must be free after package service stop')
  }
  const extZip = assets.find(file => path.basename(file) === 'CMspark-Chrome-Extension-v' + version + '.zip')
  assert.ok(extZip, 'standalone extension zip')
  await fs.rm(extension, { recursive: true, force: true })
  await fs.mkdir(extension, { recursive: true })
  if (windows) await exec('tar.exe', ['-xf', extZip, '-C', extension])
  else await exec('unzip', ['-q', extZip, '-d', extension])
  const manifest = (await files(extension)).find(file => path.basename(file) === 'manifest.json')
  assert.ok(manifest)
  const parsed = JSON.parse(await fs.readFile(manifest, 'utf8'))
  assert.equal(parsed.version, version)
  assert.match((await exec(cli(), [agent(), '--version'], { env, timeout: 15000 })).stdout, new RegExp(version.replaceAll('.', '\\.')))
  mark('Installed companion and extension ' + version + ' (' + process.env.PLATFORM + ')')
  return { directory: path.dirname(manifest), panel: parsed.side_panel?.default_path || 'sidepanel.html', version }
}

function cli() { return path.join(bundle(), windows ? 'node.exe' : 'node') }
function agent() { return path.join(bundle(), 'cmspark-agent.js') }
let child
let closed
async function start() {
  child = spawn(cli(), [agent(), 'daemon', 'start'], { env, cwd: bundle(), stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true })
  closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  await eventually(async () => {
    assert.equal(child.exitCode, null, 'owned daemon exited during boot')
    return fetch(origin + '/healthz').then(r => r.ok, () => false)
  }, 'installed companion /healthz')
  await eventually(() => fs.readFile(path.join(data, 'ws_secret'), 'utf8').then(secret => /^[a-f0-9]{64}$/.test(secret.trim()), () => false), 'owned pairing secret persisted')
}

async function stop() {
  if (!child) return
  if (child.exitCode === null && child.signalCode === null) {
    try {
      await exec(cli(), [agent(), 'daemon', 'stop'], { env, cwd: bundle(), timeout: 24000 })
      assert.deepEqual(await Promise.race([closed, delay(2000).then(() => 'timeout')]), { code: 0, signal: null })
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }
  }
  child = null
}

async function connect(authenticated = true) {
  const secret = authenticated ? (await fs.readFile(path.join(data, 'ws_secret'), 'utf8')).trim() : ''
  const ws = new WebSocket(origin.replace('http', 'ws'), { origin: 'chrome-extension://owned-install-check' })
  const events = []
  ws.on('error', () => {})
  ws.on('message', raw => {
    const frame = JSON.parse(raw)
    events.push(frame)
    if (frame.type === 'auth.challenge') {
      if (authenticated) ws.send(JSON.stringify({ type:'auth.handshake', proof:createHmac('sha256',secret).update(frame.nonce).digest('hex') }))
      else ws.send(JSON.stringify({ type:'thread.list', id:'before-auth' }))
    }
  })
  if (!authenticated) {
    await eventually(() => ws.readyState === WebSocket.CLOSED, 'unauthenticated socket closed')
    assert.ok(!events.some(e => e.type === 'thread.list'))
    return
  }
  await eventually(() => {
    if (ws.readyState === WebSocket.CLOSED) throw Error('Owned socket closed during auth; frames: ' + events.map(event => event.type).join(','))
    return events.some(e => e.type === 'auth.ok')
  }, 'companion HMAC authentication')
  return {
    close: () => new Promise(resolve => { ws.once('close', resolve); ws.close() }),
    send: async (type, fields = {}) => {
      const id = randomUUID()
      ws.send(JSON.stringify({ type, id, ...fields }))
      return eventually(() => events.find(e => e.id === id), 'protocol response: ' + type)
    },
  }
}

let browser
async function openExtension(asset, pair) {
  browser = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + asset.directory, '--load-extension=' + asset.directory],
  })
  let worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker', { timeout: 20000 })
  const id = new URL(worker.url()).host
  assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), asset.version, 'actual loaded extension version must match the installed artifact')
  let page
  if (!pair) {
    const loadedCode = await worker.evaluate(() => {
      const modules = Object.values(globalThis).filter(value => value?.isParcelRequire).flatMap(value => Object.values(value.cache))
      const bridge = modules.find(value => value.exports?.BrowserBridge)?.exports.BrowserBridge
      return { browser_bridge:!!bridge, creation_claim:!!bridge?.prototype.createTab.toString().includes('task_tab') }
    })
    mark('Worker before normal unpacked-extension reload (' + asset.version + '): ' + JSON.stringify(loadedCode))
    // Replacing an unpacked extension directory requires Chrome's normal Reload
    // operation; a new manifest alone does not prove the running worker changed.
    const manager = await browser.newPage()
    await manager.goto('chrome://extensions')
    const replacement = browser.waitForEvent('serviceworker', { predicate:next => next !== worker && new URL(next.url()).host === id, timeout:20000 })
    await manager.evaluate(async id => {
      await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode:true })
      await chrome.developerPrivate.reload(id, { failQuietly:false, populateErrorForUnpacked:true })
    }, id)
    page = await browser.newPage()
    await page.goto('chrome-extension://' + id + '/' + asset.panel)
    worker = await replacement
    assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), asset.version)
    assert.equal(await worker.evaluate(() => Object.values(globalThis).filter(value => value?.isParcelRequire)
      .flatMap(value => Object.values(value.cache)).some(value => value.exports?.BrowserBridge?.prototype.createTab.toString().includes('task_tab'))),
      asset.version === '1.0.0', 'reloaded worker runs the installed version of task-tab code')
    await manager.close()
  }
  if (!page) {
    page = await browser.newPage()
    await page.goto('chrome-extension://' + id + '/' + asset.panel)
  }
  await page.evaluate(() => { window.acceptanceEvents = []; chrome.runtime.onMessage.addListener(m => window.acceptanceEvents.push(m)) })
  if (pair) {
    const secret = (await fs.readFile(path.join(data, 'ws_secret'), 'utf8')).trim()
    assert.ok((await page.evaluate(secret => chrome.runtime.sendMessage({ type:'ws.setSecret', secret }), secret)).ok)
  } else {
    assert.ok((await page.evaluate(() => chrome.runtime.sendMessage({ type:'ws.getPairingStatus' }))).paired, 'browser profile kept pairing')
  }
  return { page, id, worker }
}

async function chat(page, threadId, message) {
  await page.evaluate(() => { window.acceptanceEvents.length = 0 })
  await eventually(async () => {
    const reply = await page.evaluate(({ threadId, message }) => chrome.runtime.sendMessage({ type:'chat.send', threadId, message }), { threadId, message })
    return reply?.ok
  }, 'paired extension sent chat')
  await page.waitForFunction(thread => window.acceptanceEvents.some(e => e.type === 'chat.done' && e.thread_id === thread), threadId, { timeout: 35000 })
}

let providerCalls = 0
let toolRequested = false
let toolReceived = false
const taskTabIds = []
let sourceLookups = 0
let currentSourceLookup = ''
function toolPayload(message) {
  const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
}
const provider = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/owned-task-source')) {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<title>Owned task source</title><p>Owned task source evidence ' + req.url + '</p>')
    return
  }
  if (req.method === 'GET' && req.url === '/owned-release-tab') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<title>Owned release test tab</title>')
    return
  }
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object:'list', data:[{ id:'owned', object:'model' }] }))
    return
  }
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks))
    if (!body.stream) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices:[{ index:0, message:{ role:'assistant', content:'Owned acceptance title' }, finish_reason:'stop' }] }))
      return
    }
    providerCalls++
    res.setHeader('content-type', 'text/event-stream')
    const emit = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id:'owned', object:'chat.completion.chunk', choices:[{ index:0, delta, finish_reason:finish }] }) + '\n\n')
    const last = body.messages.at(-1)
    const userText = JSON.stringify(body.messages.findLast(message => message.role === 'user')?.content)
    const call = (name, args, id) => {
      assert.ok(body.tools?.some(tool => tool.function?.name === name), name + ' advertised by installed companion')
      emit({ role:'assistant', tool_calls:[{ index:0, id, type:'function', function:{ name, arguments:JSON.stringify(args) } }] })
      emit({}, 'tool_calls')
    }
    if (userText.includes('acceptance task tab lifecycle')) {
      const payload = last.role === 'tool' ? toolPayload(last) : null
      if (payload) assert.equal(payload.success, true, last.tool_call_id)
      if (last.role === 'user') call('run_progress_propose', { items:[{ text:'Read and archive owned temporary sources' }] }, 'owned-task-plan')
      else if (last.tool_call_id === 'owned-task-plan') call('create_tab', { url:'http://127.0.0.1:' + provider.address().port + '/owned-task-source-one', active:false }, 'owned-task-create-one')
      else if (last.tool_call_id === 'owned-task-create-one') {
        assert.ok(Number.isSafeInteger(payload.data.id)); assert.equal(payload.data.task_tab, undefined)
        taskTabIds.push(payload.data.id); call('get_page_text', { tabId:payload.data.id }, 'owned-task-read-one')
      } else if (last.tool_call_id === 'owned-task-read-one') {
        assert.equal(payload.data.evidence_capture.capture_status, 'captured')
        call('close_tab', { tabId:taskTabIds[0] }, 'owned-task-close-one')
      } else if (last.tool_call_id === 'owned-task-close-one') call('create_tab', { url:'http://127.0.0.1:' + provider.address().port + '/owned-task-source-two', active:false }, 'owned-task-create-two')
      else if (last.tool_call_id === 'owned-task-create-two') {
        assert.ok(Number.isSafeInteger(payload.data.id)); taskTabIds.push(payload.data.id)
        call('get_page_text', { tabId:payload.data.id }, 'owned-task-read-two')
      } else if (last.tool_call_id === 'owned-task-read-two') {
        assert.equal(payload.data.evidence_capture.capture_status, 'captured')
        emit({ role:'assistant', content:'owned acceptance reply: task sources read' }); emit({}, 'stop')
      } else throw Error('Unexpected installed task-page phase: ' + last.tool_call_id)
      res.end('data: [DONE]\n\n'); return
    }
    if (userText.includes('acceptance saved sources')) {
      if (last.role === 'user') {
        currentSourceLookup = 'owned-sources-' + ++sourceLookups
        call('browser_sources', {}, currentSourceLookup)
      } else if (last.tool_call_id === currentSourceLookup) {
        const sources = toolPayload(last); assert.equal(sources.success, true)
        const archived = sources.data.sources.filter(source => source.url.includes('/owned-task-source'))
        assert.equal(archived.length, 2)
        for (const source of archived) { assert.equal(source.state, 'closed'); assert.ok(source.observation_ids.length) }
        call('browser_sources', { observation_id:archived[0].observation_ids[0] }, currentSourceLookup + '-evidence')
      } else if (last.tool_call_id === currentSourceLookup + '-evidence') {
        const evidence = toolPayload(last); assert.equal(evidence.success, true)
        assert.ok(evidence.data.observation.content.includes('Owned task source evidence'))
        emit({ role:'assistant', content:'owned acceptance reply: archived evidence retained' }); emit({}, 'stop')
      } else throw Error('Unexpected installed source lookup phase: ' + last.tool_call_id)
      res.end('data: [DONE]\n\n'); return
    }
    if (last.role === 'tool' && last.tool_call_id === 'owned-list-tabs') toolReceived = JSON.stringify(last.content).includes('/owned-release-tab')
    if (!toolRequested && last.role === 'user' && JSON.stringify(last.content).includes('acceptance upgraded tool')) {
      assert.ok(body.tools?.some(t => t.function?.name === 'list_tabs'), 'list_tabs advertised by installed companion')
      toolRequested = true
      emit({ role:'assistant', tool_calls:[{ index:0, id:'owned-list-tabs', type:'function', function:{ name:'list_tabs', arguments:'{}' } }] })
      emit({}, 'tool_calls')
    } else {
      emit({ role:'assistant', content:'owned acceptance reply' })
      emit({}, 'stop')
    }
    res.end('data: [DONE]\n\n')
  } catch (error) { console.error(error.message); res.writeHead(500); res.end() }
})

async function verifySnapshot(peer, threadId, projectId, userText) {
  const projects = await peer.send('project.list')
  assert.ok(projects.projects.some(project => project.id === projectId && project.name === 'Owned upgrade project'))
  const threads = await peer.send('thread.list')
  assert.equal(threads.threads.find(thread => thread.id === threadId)?.project_id, projectId)
  const history = await peer.send('thread.select', { thread_id:threadId })
  assert.ok(history.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes(userText)))
  assert.ok(history.messages.some(message => message.role === 'assistant' && JSON.stringify(message.content).includes('owned acceptance reply')))
}

async function main() {
  assert.equal(await fetch(origin + '/healthz').then(() => true, () => false), false, 'runner must have no existing daemon')
  await fs.mkdir(data, { recursive:true })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  await fs.writeFile(path.join(data, 'config.json'), JSON.stringify({
    port:23401, llm:{ base_url:'http://127.0.0.1:' + provider.address().port + '/v1', api_key:'sk-owned-test', model_name:'owned', context_window:8000 },
    auto_approved_domains:['127.0.0.1'],
  }))
  let peer
  let workError
  try {
    const old = await install('baseline', '0.9.1')
    await start()
    peer = await connect()
    const before = await peer.send('activity.state')
    assert.ok(before.ok)
    const settings = await peer.send('activity.configure', { expected_revision:before.state.revision, patch:{ interval_ms:12000 } })
    assert.ok(settings.ok && settings.state.config.interval_ms === 12000)
    const threadId = (await peer.send('thread.create', { alias:'Owned upgrade thread' })).thread.id
    const projects = await peer.send('project.list')
    const made = await peer.send('project.create', { expected_revision:projects.revision, operation_id:randomUUID(), user_gesture:true, name:'Owned upgrade project' })
    const projectId = made.project?.id
    assert.ok(projectId)
    const assigned = await peer.send('thread.project.set', { expected_revision:made.revision, operation_id:randomUUID(), user_gesture:true, thread_id:threadId, project_id:projectId })
    assert.equal(assigned.type, 'project.changed')
    const oldBrowser = await openExtension(old, true)
    await chat(oldBrowser.page, threadId, 'acceptance baseline')
    await verifySnapshot(peer, threadId, projectId, 'acceptance baseline')
    await peer.close(); peer = null
    await browser.close(); browser = null
    await stop()
    await fs.cp(data, backup, { recursive:true, errorOnExist:true })
    mark('0.9.1 fixture created through installed companion and real extension; backup copied after graceful stop')

    const upgraded = await install('candidate', '1.0.0')
    await start()
    await connect(false)
    peer = await connect()
    await verifySnapshot(peer, threadId, projectId, 'acceptance baseline')
    const current = await peer.send('activity.state')
    assert.ok(current.ok && current.state.config.interval_ms === 12000)
    assert.ok(!current.state.config.extraction_prompt)
    const updated = await peer.send('activity.configure', { expected_revision:current.state.revision, patch:{ extraction_prompt:'Owned release fixture' } })
    assert.ok(updated.ok && updated.state.config.extraction_prompt === 'Owned release fixture')
    await peer.close(); peer = null
    const newBrowser = await openExtension(upgraded, false)
    assert.equal(newBrowser.id, oldBrowser.id)
    const ownedTab = await browser.newPage()
    await ownedTab.goto('http://127.0.0.1:' + provider.address().port + '/owned-release-tab')
    await chat(newBrowser.page, threadId, 'acceptance upgraded tool')
    assert.ok(toolRequested && toolReceived, 'provider saw completion of the browser tool call')
    await newBrowser.worker.evaluate(() => {
      const parse = JSON.parse, send = WebSocket.prototype.send
      globalThis.ownedTaskFrames = []
      const remember = frame => { if (globalThis.ownedTaskFrames.length < 32) globalThis.ownedTaskFrames.push(frame) }
      JSON.parse = function(...args) {
        const value = Reflect.apply(parse, this, args)
        if (value?.type === 'tool.execute' && value.tool_call_id?.startsWith('owned-task-')) remember({
          direction:'request', id:value.tool_call_id, tool:value.tool_name, task_context:!!value.task_context,
          execution_id:typeof value.task_context?.execution_id === 'string', cleanup:!!value.params?.__task_tab_cleanup,
          valid_owner:typeof value.task_context?.thread_id === 'string' && !!value.task_context.thread_id && value.task_context.thread_id.length <= 128 && /^[a-f0-9-]{36}$/.test(value.task_context?.execution_id),
          keep_open:value.params?.keep_open === true,
        })
        return value
      }
      WebSocket.prototype.send = function(value) {
        try {
          const frame = parse(value)
          if (frame.type === 'tool.result' && frame.tool_call_id?.startsWith('owned-task-')) remember({
            direction:'result', id:frame.tool_call_id, success:frame.result?.success,
            creation_claim:!!frame.result?.data?.task_tab, provenance:frame.result?.data?.provenance?.capture_status,
            url_scheme:typeof frame.result?.data?.url === 'string' ? frame.result.data.url.split(':')[0] : undefined,
          })
        } catch { /* observation never alters dispatch */ }
        return Reflect.apply(send, this, [value])
      }
      globalThis.restoreOwnedTaskFrames = () => { JSON.parse = parse; WebSocket.prototype.send = send }
    })
    await chat(newBrowser.page, threadId, 'acceptance task tab lifecycle')
    assert.equal(taskTabIds.length, 2)
    try {
      await eventually(() => browser.pages().every(page => !page.url().includes('/owned-task-source')), 'owned temporary pages closed after evidence capture')
    } catch (error) {
      const tabState = await newBrowser.page.evaluate(ids => chrome.tabs.query({}).then(tabs => tabs.filter(tab => ids.includes(tab.id))
        .map(tab => ({ id:tab.id, active:tab.active, pinned:tab.pinned, audible:tab.audible, status:tab.status }))), taskTabIds)
      const evidenceDir = path.join(data, 'business-evidence-v1'), saved = []
      for (const name of await fs.readdir(evidenceDir).catch(() => [])) {
        const file = JSON.parse(await fs.readFile(path.join(evidenceDir, name), 'utf8'))
        for (const source of file.task_pages || []) saved.push({ tab_id:source.tab_id, state:source.state, reason:source.reason, observations:source.observation_ids.length })
      }
      const frames = await newBrowser.worker.evaluate(() => globalThis.ownedTaskFrames)
      const observer = await connect(), threads = await observer.send('thread.list')
      const thread = threads.threads.find(thread => thread.id === threadId)
      await observer.close()
      console.error('Owned task tab snapshot:', JSON.stringify({ tabs:tabState, sources:saved, frames,
        run:{ execution_id:!!thread?.last_run_execution_id, terminal:thread?.last_run_terminal ?? 'unset-or-normal' } }))
      throw error
    }
    await newBrowser.worker.evaluate(() => globalThis.restoreOwnedTaskFrames())
    assert.equal(ownedTab.isClosed(), false, 'pre-existing user page survives task cleanup')
    assert.ok(ownedTab.url().endsWith('/owned-release-tab'))
    await chat(newBrowser.page, threadId, 'acceptance saved sources')
    mark('Actual installed extension archived both task sources; early/final tab closure and evidence lookup passed; original user page retained')
    peer = await connect()
    await verifySnapshot(peer, threadId, projectId, 'acceptance upgraded tool')
    await peer.close(); peer = null
    await stop()
    await eventually(async () => !(await newBrowser.page.evaluate(() => chrome.runtime.sendMessage({type:'chat.send', threadId:'owned-absent', message:'disconnected probe'}))).ok, 'extension observes disconnect')
    await start()
    peer = await connect()
    assert.equal((await peer.send('activity.state')).state.config.extraction_prompt, 'Owned release fixture')
    await chat(newBrowser.page, threadId, 'acceptance reconnected')
    await chat(newBrowser.page, threadId, 'acceptance saved sources after reconnect')
    await peer.close(); peer = null
    await browser.close(); browser = null
    await stop()
    mark('1.0.0 preserved projects, history, settings and pairing; real browser tool round trip and reconnect passed')

    await fs.rename(data, path.join(root, 'upgraded-data'))
    await fs.cp(backup, data, { recursive:true, errorOnExist:true })
    const restored = await install('baseline', '0.9.1')
    await start()
    peer = await connect()
    await verifySnapshot(peer, threadId, projectId, 'acceptance baseline')
    const restoredHistory = await peer.send('thread.select', { thread_id:threadId })
    assert.ok(!restoredHistory.messages.some(message => JSON.stringify(message.content).includes('acceptance upgraded tool')))
    assert.equal((await peer.send('activity.state')).state.config.interval_ms, 12000)
    const restoredBrowser = await openExtension(restored, false)
    assert.equal(restoredBrowser.id, oldBrowser.id)
    await chat(restoredBrowser.page, threadId, 'acceptance restored')
    mark('0.9.1 restored from backup, upgrade-only messages absent, original extension still pairs')
    assert.ok(providerCalls >= 5)
  } catch (error) {
    workError = error
    throw error
  } finally {
    await peer?.close()
    await browser?.close()
    try { await stop() } catch (error) {
      if (!workError) throw error
      console.error('Owned daemon cleanup also failed:', error.message)
    } finally { provider.close() }
  }
}

main().catch(error => { console.error(error.stack); provider.closeAllConnections(); provider.close(); process.exitCode = 1 })
