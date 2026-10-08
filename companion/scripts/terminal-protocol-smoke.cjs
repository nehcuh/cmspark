// Real Mac PTY over authenticated loopback WS. This is NOT a browser UI test.
// Run from repo root after companion production build. No production agent/LLM.
const assert = require('node:assert/strict')
const { fork } = require('node:child_process')
const { createHmac } = require('node:crypto')
const path = require('node:path')
const { WebSocket } = require('../node_modules/ws')

const timeout = (promise, label, ms = 10000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)
  promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
})
const log = detail => console.log(JSON.stringify(detail))

async function main() {
  if (process.platform !== 'darwin') throw new Error('This controlled shell fixture requires macOS')
  const child = fork(path.resolve('companion/scripts/terminal-browser-smoke.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let diagnostic = '', sockets = []
  child.stdout.on('data', bytes => { diagnostic = (diagnostic + bytes).slice(-8000) })
  child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes).slice(-8000) })
  try {
    const fixture = await timeout(new Promise((resolve, reject) => {
      child.on('message', data => { if (data.event === 'ready') resolve(data) })
      child.once('exit', code => reject(new Error(`fixture exit ${code}: ${diagnostic}`)))
    }), 'fixture ready')
    const url = new URL(fixture.url), threadId = url.searchParams.get('thread_id')
    async function connect() {
      const ws = new WebSocket(`ws://${url.host}`, { origin: url.origin })
      sockets.push(ws)
      const frames = [], waiters = []
      ws.on('message', bytes => {
        const frame = JSON.parse(bytes.toString()); frames.push(frame)
        if (frame.type === 'auth.challenge') ws.send(JSON.stringify({ type: 'auth.handshake',
          proof: createHmac('sha256', fixture.secret).update(frame.nonce).digest('hex') }))
        for (const notify of [...waiters]) notify()
      })
      ws.on('error', () => {})
      const wait = (predicate, label) => timeout(new Promise(resolve => {
        const check = () => { const result = predicate(frames); if (result) { waiters.splice(waiters.indexOf(check), 1); resolve(result) } }
        waiters.push(check); check()
      }), label)
      await wait(frames => frames.find(frame => frame.type === 'auth.ok'), 'auth')
      return { ws, frames, wait, send: frame => ws.send(JSON.stringify(frame)),
        text: () => frames.filter(frame => frame.type === 'terminal.data').map(frame => Buffer.from(frame.b64, 'base64').toString()).join('') }
    }
    const first = await connect(), id = 'controlled.protocol.smoke'
    first.send({ type: 'terminal.open', id, thread_id: threadId, user_gesture: true, cols: 100, rows: 30 })
    const confirmation = await first.wait(frames => frames.find(frame => frame.type === 'fixture.confirm'), 'L2 confirmation')
    assert.match(confirmation.code, /open embedded PTY/)
    assert.equal(first.frames.some(frame => frame.type === 'terminal.opened'), false)
    first.send({ type: 'fixture.approve' })
    const opened = await first.wait(frames => frames.find(frame => frame.type === 'terminal.opened'), 'open')
    assert.equal(opened.platform, 'darwin'); assert.ok(opened.pid > 0)
    log({ check: 'L2 before native spawn', pass: true, pid: opened.pid })
    let inputSeq = 0
    const input = (peer, command) => peer.send({ type: 'terminal.input', id, seq: ++inputSeq, b64: Buffer.from(command).toString('base64') })
    const expectOutput = async (peer, value) => { await peer.wait(() => peer.text().includes(value), `output ${value}`) }
    input(first, "printf 'IO_%s_%s\\n' '中文' '🙂'\n")
    await expectOutput(first, 'IO_中文_🙂')
    first.send({ type: 'terminal.resize', id, cols: 83, rows: 27 })
    input(first, "printf 'SIZE_'; stty size\n")
    await expectOutput(first, 'SIZE_27 83')
    log({ check: 'UTF-8 input/output and native resize 27x83', pass: true })
    // Deliberately withhold ACK so real received output must replay after reconnect.
    const received = first.frames.filter(frame => frame.type === 'terminal.data')
    assert.ok(received.length > 0)
    const dropped = new Promise(resolve => first.ws.once('close', resolve))
    first.send({ type: 'fixture.drop' }); await timeout(dropped, 'socket drop')
    const next = await connect()
    const attach = () => next.send({ type: 'terminal.attach', id, resume_token: opened.resume_token, last_seq: 0 })
    attach()
    const attached = await next.wait(frames => frames.find(frame => frame.type === 'terminal.attached'), 'reattach')
    assert.equal(attached.pid, opened.pid)
    await next.wait(frames => received.every(old => frames.some(frame => frame.type === 'terminal.data' && frame.seq === old.seq && frame.b64 === old.b64)), 'unacked replay')
    attach()
    await next.wait(frames => frames.filter(frame => frame.type === 'terminal.attached').length === 2, 'duplicate attach')
    assert.equal(next.frames.some(frame => frame.type === 'terminal.error'), false)
    log({ check: 'same PID, unacked replay, duplicate authenticated attach', pass: true })
    next.send({ type: 'terminal.ack', id, seq: Math.max(...next.frames.filter(frame => frame.type === 'terminal.data').map(frame => frame.seq)) })
    input(next, "printf 'AFTER_%s\\n' 'REATTACH'\n")
    await expectOutput(next, 'AFTER_REATTACH')
    next.send({ type: 'terminal.close', id })
    await next.wait(frames => frames.find(frame => frame.type === 'terminal.closed'), 'close')
    // Allow the OS to reap the native child, with a bounded predicate instead of waiting on a daemon.
    await timeout(new Promise(resolve => {
      const probe = () => { try { process.kill(opened.pid, 0); setTimeout(probe, 20) } catch (error) { if (error.code === 'ESRCH') resolve(true); else throw error } }; probe()
    }), 'native process reaped', 3000)
    log({ check: 'input after reconnect, close and native PID reaped', pass: true })
  } finally {
    for (const ws of sockets) ws.terminate()
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill('SIGTERM')
      try { await timeout(exited, 'fixture cleanup', 3000) } catch { child.kill('SIGKILL'); await timeout(exited, 'forced cleanup', 3000) }
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
