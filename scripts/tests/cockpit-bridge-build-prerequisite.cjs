// GHA Windows build-only prerequisite. Never runs/registers the resulting host.
'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const os = require('node:os'), cp = require('node:child_process'), crypto = require('node:crypto')
function main() {
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64')
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.RUNNER_OS, 'Windows')
  const repo = path.resolve(__dirname, '../..')
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-cockpit-build-')))
  const identity = fs.lstatSync(root)
  assert.ok(identity.isDirectory() && !identity.isSymbolicLink())
  const sameRoot = () => {
    const current = fs.lstatSync(root)
    return current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino
  }
  let cleanupAllowed = true
  try {
    const data = path.join(root, 'data'), temp = path.join(root, 'temp'), output = path.join(root, 'bin')
    fs.mkdirSync(data); fs.mkdirSync(temp); fs.mkdirSync(output)
    const env = require('./cockpit-bridge-child-env.cjs')(process.env, {
      root, data, temp, compiled: path.join(repo, 'companion/.test-dist/src'),
    })
    const powershell = path.join(env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
    // Same PS5.1 builder and sanitized env as registration; no Out-Null parent
    // consumes its compiler success stream. Public source/compiler output only.
    cleanupAllowed = false
    const result = cp.spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File',
      path.join(repo, 'scripts/build-cockpit-native-bridge.ps1'), '-OutputDirectory', output],
    { cwd: repo, env, windowsHide: true, stdio: 'inherit' })
    assert.ok(!result.error); assert.equal(result.status, 0); assert.equal(result.signal, null)
    assert.ok(sameRoot())
    const binary = path.join(output, 'cmspark-cockpit-bridge.exe'), digest = path.join(output, 'cmspark-cockpit-bridge.sha256')
    const before = fs.lstatSync(binary), digestStat = fs.lstatSync(digest)
    assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size > 0)
    assert.ok(digestStat.isFile() && !digestStat.isSymbolicLink() && digestStat.nlink === 1 && digestStat.size === 65)
    const hash = crypto.createHash('sha256'), fd = fs.openSync(binary, 'r'), buffer = Buffer.alloc(65536)
    try {
      const opened = fs.fstatSync(fd)
      assert.equal(opened.dev, before.dev); assert.equal(opened.ino, before.ino); assert.equal(opened.size, before.size)
      let at = 0
      while (at < before.size) {
        const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, before.size - at), at)
        assert.ok(n > 0); hash.update(buffer.subarray(0, n)); at += n
      }
      assert.equal(fs.readSync(fd, buffer, 0, 1, at), 0)
      const after = fs.lstatSync(binary), end = fs.fstatSync(fd)
      for (const stat of [after, end]) {
        assert.ok(stat.isFile() && stat.nlink === 1)
        for (const key of ['dev', 'ino', 'size', 'mtimeMs']) assert.equal(stat[key], before[key])
      }
      assert.ok(!after.isSymbolicLink())
      const digestFd = fs.openSync(digest, 'r'), text = Buffer.alloc(66)
      try {
        const openedDigest = fs.fstatSync(digestFd)
        for (const key of ['dev', 'ino', 'size', 'mtimeMs']) assert.equal(openedDigest[key], digestStat[key])
        assert.ok(openedDigest.isFile() && openedDigest.nlink === 1)
        let n = 0, read
        while (n < text.length && (read = fs.readSync(digestFd, text, n, text.length - n, n)) > 0) n += read
        assert.equal(n, 65)
        for (const stat of [fs.lstatSync(digest), fs.fstatSync(digestFd)]) {
          assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1)
          for (const key of ['dev', 'ino', 'size', 'mtimeMs']) assert.equal(stat[key], digestStat[key])
        }
        assert.equal(text.subarray(0, n).toString('utf8'), hash.digest('hex') + '\n')
      } finally { fs.closeSync(digestFd) }
    } finally { fs.closeSync(fd) }
    cleanupAllowed = true
  } finally {
    // Retain every build refusal: a failed shell close is not proof that every
    // compiler descendant has ended. Only a verified successful build retires.
    if (cleanupAllowed) { assert.ok(sameRoot()); fs.rmSync(root, { recursive: true, force: false }) }
  }
  process.stdout.write('COCKPIT_BRIDGE_FIXED_BUILD_COMPLETE\n')
}
if (require.main === module) {
  try { main() } catch { process.stderr.write('COCKPIT_BRIDGE_FIXED_BUILD_REFUSED\n'); process.exitCode = 1 }
}
module.exports = { main }
