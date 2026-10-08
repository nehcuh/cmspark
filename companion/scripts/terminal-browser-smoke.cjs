// Manual browser→real PTY fixture. Run from repo root after companion build.
// Loopback only, synthetic HMAC secret, no LLM/production agent/private source.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http')
const root = process.cwd(), load = name => require(path.join(root, name))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-terminal-browser-'))
process.env.CMSPARK_DATA_DIR = path.join(dir, 'data')
const config = load('companion/dist/config.js'), pty = load('companion/dist/pty/session.js')
const { handleTerminalMessage } = load('companion/dist/pty/handler.js')
const { recordEmbedIntent } = load('companion/dist/acp/open-local-terminal.js')
const { ThreadManager } = load('companion/dist/threads/thread-manager.js')
const { WebSocketServer } = load('companion/node_modules/ws')
const esbuild = load('companion/node_modules/esbuild')
const secret = crypto.randomBytes(32).toString('hex')
const outputDir = path.join(dir, 'web'); fs.mkdirSync(outputDir)
esbuild.buildSync({ entryPoints: [path.join(root, 'companion/scripts/browser-fixtures/terminal-page.tsx')], bundle: true,
  platform: 'browser', format: 'iife', target: 'chrome116', jsx: 'automatic', outfile: path.join(outputDir, 'page.js'),
  nodePaths: [path.join(root, 'chrome-extension/node_modules')], define: { 'process.env.NODE_ENV': '"production"' } })
const log = value => console.log(JSON.stringify({ at: new Date().toISOString(), ...value }))
;(async () => {
  await config.initDataDir(); config.saveConfig({ embedded_terminal: { enabled: true }, acp: { enabled: false, servers: [] }, mcp: { servers: [] } })
  const threadManager = new ThreadManager(), thread = threadManager.create('controlled PTY browser fixture')
  threadManager.update(thread.id, { workspace_root: dir })
  // On Mac use a clean /bin/sh without login profile or user agent startup.
  if (process.platform === 'darwin') recordEmbedIntent(thread.id, { cwd: dir, file: '/bin/sh', args: ['-i'] })
  const services = { threadManager }
  let port, lastPid = 0
  const server = http.createServer((req, res) => {
    if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403); return res.end() }
    if (req.url === '/page.js' || req.url === '/page.css') {
      res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'application/javascript'); return res.end(fs.readFileSync(path.join(outputDir, req.url.slice(1))))
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><title>CMspark controlled PTY test</title><link rel="stylesheet" href="/page.css"><style>body{margin:0;background:#111;color:#eee;font-family:system-ui}#controls{padding:10px}button{padding:8px;margin:4px}#root{height:75vh}pre{white-space:pre-wrap;font-size:12px}</style><div id="controls"><strong>Controlled fixture — real PTY; no agent/LLM</strong><span id="transport"></span><button id="start">Open controlled terminal</button><button id="approve" disabled>Approve fixture L2</button><button id="drop">Drop socket for 1 second</button><button id="narrow">Resize terminal to 650px</button><pre id="confirmation"></pre></div><div id="root"></div><script>window.fixture=${JSON.stringify({ port, secret })}</script><script src="/page.js"></script>`)
  })
  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws, req) => {
    if (req.headers.origin !== `http://127.0.0.1:${port}`) return ws.close(1008)
    const nonce = crypto.randomBytes(32).toString('hex'); let authenticated = false, confirm
    const send = frame => { if (frame.type === 'terminal.opened') { lastPid = frame.pid; log({ event: frame.type, pid: lastPid }) }
      else if (['terminal.attached', 'terminal.closed'].includes(frame.type)) log({ event: frame.type, pid: lastPid, code: frame.code })
      if (ws.readyState === 1) ws.send(JSON.stringify(frame)) }
    ws.on('error', () => {}); ws.on('close', () => { pty.detachPtyByPeer(ws); confirm?.({ approved: false }); log({ event: 'socket.closed', pid: lastPid }) })
    ws.on('message', async bytes => {
      try {
        const frame = JSON.parse(bytes.toString())
        if (!authenticated) {
          const expected = crypto.createHmac('sha256', secret).update(nonce).digest('hex')
          if (frame.type !== 'auth.handshake' || frame.proof !== expected) return ws.close(1008)
          authenticated = true; send({ type: 'auth.ok', protocol_version: 1 }); return
        }
        if (frame.type === 'system.ping') return send({ type: 'system.pong' })
        if (frame.type === 'fixture.approve') { confirm?.({ approved: true }); confirm = undefined; return }
        if (frame.type === 'fixture.drop') { ws.close(); return }
        if (!frame.type.startsWith('terminal.')) return
        if (frame.type === 'terminal.input') log({ event: 'input', bytes: Buffer.from(frame.b64, 'base64').length })
        if (frame.type === 'terminal.resize') log({ event: 'resize', cols: frame.cols, rows: frame.rows })
        const result = await handleTerminalMessage(frame.type, frame, services, { surface: 'panel', originWs: ws, sendToExtension: send,
          requestConfirmation: details => new Promise(resolve => { confirm = resolve; send({ type: 'fixture.confirm', code: details.code }) }) }, 'panel')
        send(result)
      } catch (error) { log({ event: 'error', message: error.message }) }
    })
    send({ type: 'auth.challenge', nonce, protocol_version: 1 })
  })
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port
    const url = `http://127.0.0.1:${port}/?thread_id=${thread.id}`
    log({ event: 'ready', url, fixtureDir: dir })
    // In-process test channel only. Never print the ephemeral pairing secret.
    process.send?.({ event: 'ready', url, secret, fixtureDir: dir })
  })
  const stop = () => { pty.killAllPty(); for (const ws of wss.clients) ws.terminate(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit() }
  process.on('SIGTERM', stop); process.on('SIGINT', stop)
})().catch(error => { console.error(error); fs.rmSync(dir, { recursive: true, force: true }); process.exitCode = 1 })
