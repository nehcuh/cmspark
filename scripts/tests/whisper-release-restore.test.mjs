import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { publish, seal } from '../whisper-generation.mjs'

const prepareScript = fileURLToPath(new URL('../prepare-macos-whisper.mjs', import.meta.url))
for (const arch of ['darwin-arm64', 'darwin-x64']) {
  test(`restore upgrades a previous ${arch} generation and verifies it on reuse`, { skip: process.platform !== 'darwin' }, t => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-whisper-restore-'))
    t.after(() => fs.rmSync(dist, { recursive: true, force: true }))
    const store = path.join(dist, '.whisper-generations')
    const old = path.join(store, 'previous')
    const current = path.join(dist, `whisper-current-${arch}`)
    fs.mkdirSync(path.join(old, 'bin'), { recursive: true })
    fs.mkdirSync(path.join(old, 'lib'))
    fs.writeFileSync(path.join(old, 'bin', `cmspark-whisper-${arch}`), 'old CLI')
    for (const lib of ['libggml.1.dylib', 'libwhisper.1.dylib']) {
      fs.writeFileSync(path.join(old, 'lib', lib), 'old library')
    }
    seal(old, arch)
    publish(old, store, current, arch)
    const prepare = () => execFileSync(process.execPath, [prepareScript, arch, dist], { stdio: 'pipe' })
    prepare()
    const selected = fs.realpathSync(current)
    assert.notEqual(selected, fs.realpathSync(old))
    assert.equal(JSON.parse(fs.readFileSync(path.join(current, 'manifest.json'))).arch, arch)
    prepare()
    assert.equal(fs.realpathSync(current), selected)
    fs.appendFileSync(path.join(selected, 'lib/libwhisper.1.dylib'), 'damaged')
    assert.throws(prepare, /WHISPER_GENERATION_MANIFEST_MISMATCH/)
  })
}
