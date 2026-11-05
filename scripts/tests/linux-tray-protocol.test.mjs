import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { linuxElfArchitecture } from '../verify-linux-tray.mjs'

test('packaged native tray accepts the systray2 menu/update/exit protocol', { timeout: 15000 }, async () => {
  assert.equal(process.platform, 'linux')
  const root = process.env.CMSPARK_TEST_LINUX_STAGE
  assert.ok(root, 'CMSPARK_TEST_LINUX_STAGE is required')
  const binary = path.join(root, 'node_modules/systray2/traybin/tray_linux_release')
  assert.equal(linuxElfArchitecture(fs.readFileSync(binary)), process.arch)
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', errors = ''
  child.stdout.on('data', bytes => { output += bytes })
  child.stderr.on('data', bytes => { errors += bytes })
  const closed = once(child, 'close')
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(Error(`No tray ready: ${errors}`)), 10000)
      const ready = () => {
        if (output.split('\n').some(line => { try { return JSON.parse(line).type === 'ready' } catch { return false } })) {
          clearTimeout(deadline); child.stdout.off('data', ready); resolve()
        }
      }
      child.stdout.on('data', ready); ready()
      child.once('error', error => { clearTimeout(deadline); reject(error) })
    })
    child.stdin.write(JSON.stringify({ icon: fs.readFileSync(path.join(root, 'assets/cmspark.png')).toString('base64'), title: 'CMspark test', tooltip: 'Owned package protocol test', items: [{ title: 'Open Chrome', enabled: true, __id: 1 }] }) + '\n')
    child.stdin.write(JSON.stringify({ type: 'update-item', seq_id: 0, item: { title: 'Open Chrome', enabled: false, __id: 1 } }) + '\n')
    child.stdin.write('{"type":"exit"}\n')
    const [code, signal] = await closed
    assert.equal(signal, null, errors)
    assert.equal(code, 0, errors)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
})
