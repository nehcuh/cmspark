import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../../', import.meta.url))
const source = path.join(root, 'companion/src/host-use/win/scripts')
const names = fs.readdirSync(source).filter(name => name.endsWith('.ps1')).sort()
assert.ok(names.includes('activity-windows.ps1'))
const packageText = fs.readFileSync(path.join(root, 'scripts/package.sh'), 'utf8')
const start = packageText.indexOf('    WIN_SCRIPTS_SRC=')
const end = packageText.indexOf('    node "${ROOT_DIR}/companion/scripts/build-computer-uia-no-focus.mjs"', start)
assert.ok(start >= 0 && end > start)
// Execute the actual production staging block, stopping before native DLL compilation.
const stageBlock = packageText.slice(start, end)
const installerText = fs.readFileSync(path.join(root, 'scripts/build-windows-installer.sh'), 'utf8')
const gateStart = installerText.indexOf('missing=0')
const gateEnd = installerText.indexOf('rm -f "${OUTFILE}"', gateStart)
assert.ok(gateStart >= 0 && gateEnd > gateStart)
// Execute the actual admission block; neither makensis nor an installer is executed.
const gateBlock = installerText.slice(gateStart, gateEnd)

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-host-scripts-752-'))
  const src = path.join(dir, 'companion/src/host-use/win/scripts')
  const staging = path.join(dir, 'staging')
  fs.mkdirSync(src, { recursive: true })
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.mkdirSync(staging)
  for (const name of names) fs.copyFileSync(path.join(source, name), path.join(src, name))
  fs.copyFileSync(path.join(root, 'scripts/verify-windows-host-scripts.mjs'), path.join(dir, 'scripts/verify-windows-host-scripts.mjs'))
  return { dir, src, staging, remove: () => fs.rmSync(dir, { recursive: true, force: true }) }
}
function shell(block, f) {
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP'])
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())))
  return spawnSync('bash', ['--noprofile', '--norc', '-euo', 'pipefail', '-c', block], {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
    env: { ...env, ROOT_DIR: f.dir.replaceAll('\\', '/'), STAGING: f.staging.replaceAll('\\', '/') },
  })
}
function exactStage(f) {
  const dest = path.join(f.staging, 'host-scripts-win')
  assert.deepEqual(fs.readdirSync(dest).sort(), names)
  for (const name of names) assert.deepEqual(fs.readFileSync(path.join(dest, name)), fs.readFileSync(path.join(source, name)), name)
}
function otherInstallerFiles(f) {
  const required = installerText.match(/for rel in ([^\r\n]+); do/)
  assert.ok(required)
  for (const relative of required[1].trim().split(/\s+/)) {
    const target = path.join(f.staging, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (relative === 'chrome-extension') fs.mkdirSync(target)
    else fs.writeFileSync(target, '')
  }
}
function copyScripts(f) {
  const dest = path.join(f.staging, 'host-scripts-win')
  fs.mkdirSync(dest)
  for (const name of names) fs.copyFileSync(path.join(f.src, name), path.join(dest, name))
  return dest
}

test('752 actual package staging ignores incomplete old dist and copies every current script', () => {
  const f = fixture()
  try {
    const dist = path.join(f.dir, 'companion/dist/host-scripts-win')
    fs.mkdirSync(dist, { recursive: true })
    fs.copyFileSync(path.join(f.src, 'computer-probe.ps1'), path.join(dist, 'computer-probe.ps1'))
    const result = shell(stageBlock, f)
    assert.equal(result.status, 0, result.stderr)
    exactStage(f)
  } finally { f.remove() }
})
test('752 actual package staging refuses old same-name bytes as a source of truth', () => {
  const f = fixture()
  try {
    const dist = path.join(f.dir, 'companion/dist/host-scripts-win')
    fs.mkdirSync(dist, { recursive: true })
    fs.writeFileSync(path.join(dist, 'activity-windows.ps1'), '# obsolete owned fixture, never executed\n')
    const result = shell(stageBlock, f)
    assert.equal(result.status, 0, result.stderr)
    exactStage(f)
  } finally { f.remove() }
})
test('752 actual NSIS gate rejects missing, incomplete, stale and extra script sets before compilation', () => {
  for (const failure of ['directory', 'activity', 'bytes', 'extra']) {
    const f = fixture()
    try {
      otherInstallerFiles(f)
      if (failure !== 'directory') {
        const dest = copyScripts(f)
        if (failure === 'activity') fs.unlinkSync(path.join(dest, 'activity-windows.ps1'))
        if (failure === 'bytes') {
          const ownedCopy = path.join(dest, 'computer-ocr.ps1')
          fs.chmodSync(ownedCopy, 0o600)
          fs.appendFileSync(ownedCopy, '# stale owned bytes\n')
        }
        if (failure === 'extra') fs.copyFileSync(path.join(f.src, 'computer-probe.ps1'), path.join(dest, 'obsolete.ps1'))
      }
      const result = shell(gateBlock, f)
      assert.equal(result.status, 1, failure + ': ' + result.stderr)
      assert.match(result.stderr, /WINDOWS_HOST_SCRIPTS_REFUSED/)
    } finally { f.remove() }
  }
})
test('752 actual NSIS gate admits the exact current source set without executing an installer', () => {
  const f = fixture()
  try {
    otherInstallerFiles(f)
    copyScripts(f)
    const result = shell(gateBlock, f)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /WINDOWS_HOST_SCRIPTS_VERIFIED/)
    exactStage(f)
  } finally { f.remove() }
})
