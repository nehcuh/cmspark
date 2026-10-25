const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')
const project = path.resolve(__dirname, '../..')
const companion = path.join(project, 'companion')
const local = createRequire(path.join(companion, 'package.json'))

test('#758 actual standalone bundle resolves staged notifier without node_modules; missing resources refuse', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'activity758-package-')))
  try {
    const entry = path.join(root, 'notification.cjs')
    await local('esbuild').build({ entryPoints: [path.join(companion, 'src/activity/notifications.ts')], outfile: entry, bundle: true, platform: 'node', target: 'node22', format: 'cjs' })
    // The existing independent bundle is the actual resolver producer. No fake ENOENT/error DTO.
    const missingDefault = async () => {
      for (const resourceRoot of [path.dirname(process.execPath), path.dirname(entry)]) {
        for (const name of ['snoretoast-x64.exe', 'snoretoast-x86.exe']) {
          assert.equal(fs.existsSync(path.join(resourceRoot, 'activity-bin', name)), false)
        }
      }
      const missing = error => error instanceof Error && error.code === 'MODULE_NOT_FOUND'
      assert.throws(() => createRequire(entry).resolve('node-notifier/package.json'), missing)
      const notification = require(entry)
      // The raw resolver's public contract remains unchanged.
      assert.throws(() => notification.resolveWindowsToast('x64'), missing)
      let executorCalls = 0
      const executor = async () => { executorCalls++; assert.fail('missing resolution must not execute a toast') }
      const typed = error => error instanceof Error && error.name === 'ActivityError' && error.code === 'NOTIFICATION_FAILED'
      await assert.rejects(notification.submitWindowsReminder(), typed)
      await assert.rejects(notification.submitWindowsReminder(executor), typed)
      await assert.rejects(notification.submitWindowsReminder(executor, undefined), typed)
      assert.equal(executorCalls, 0)
    }
    const invoke = () => execFileSync(process.execPath, ['-e', 'const n=require(process.argv[1]);process.stdout.write(n.resolveWindowsToast("x64"))', entry], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: root })
    assert.throws(invoke, error => String(error.stderr).includes('MODULE_NOT_FOUND'))
    await missingDefault()
    execFileSync(process.execPath, [path.join(project, 'scripts/stage-activity-notifier.mjs'), companion, root])
    assert.equal(invoke(), path.join(root, 'activity-bin/snoretoast-x64.exe'))
    const vendor = path.join(path.dirname(local.resolve('node-notifier/package.json')), 'vendor/snoreToast')
    for (const name of ['snoretoast-x64.exe', 'snoretoast-x86.exe', 'LICENSE']) assert.deepEqual(fs.readFileSync(path.join(root, 'activity-bin', name)), fs.readFileSync(path.join(vendor, name)))
    fs.rmSync(path.join(root, 'activity-bin'), { recursive: true })
    assert.throws(invoke, error => String(error.stderr).includes('MODULE_NOT_FOUND'))
    await missingDefault()
    assert.throws(() => execFileSync(process.execPath, [path.join(project, 'scripts/stage-activity-notifier.mjs'), root, path.join(root, 'bad')], { stdio: 'pipe' }))
    assert.equal(fs.existsSync(path.join(root, 'bad')), false)
    for (const producer of ['scripts/package.sh', 'scripts/build-windows-exe.ps1']) assert.match(fs.readFileSync(path.join(project, producer), 'utf8'), /stage-activity-notifier\.mjs/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
