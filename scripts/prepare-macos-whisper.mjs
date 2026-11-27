// Restore the release's sealed runtime before packaging, including on a clean CI runner.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { publish } from './whisper-generation.mjs'

const companion = fileURLToPath(new URL('../companion/', import.meta.url))
const archives = {
  'darwin-arm64': '2f0158471e846f2e38ccbd4ec02cdee48ebc28ab2db686c5481b60069d1f6a04',
  'darwin-x64': 'c61d43ab41c152c4d4c48eba1db509901c07b0a0216e6c498200eb3483226db1',
}
const [arch, dist = path.join(companion, 'dist')] = process.argv.slice(2)
if (!Object.hasOwn(archives, arch)) throw new Error('Unsupported macOS Whisper architecture')
const archive = path.join(companion, 'vendor/whisper', `whisper-${arch}-b5907.zip`)
if (createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== archives[arch]) {
  throw new Error(`Whisper archive digest mismatch for ${arch}`)
}

const store = path.join(dist, '.whisper-generations')
fs.mkdirSync(store, { recursive: true })
if (!fs.lstatSync(store).isDirectory()) throw new Error('Invalid Whisper generation store')
const current = path.join(dist, `whisper-current-${arch}`)
const manifest = path.join(current, 'manifest.json')
const expected = execFileSync('/usr/bin/tar', ['-xOf', archive, 'manifest.json'])
if (fs.existsSync(manifest) && expected.equals(fs.readFileSync(manifest))) {
  publish(current, store, current, arch)
} else {
  const generation = fs.mkdtempSync(path.join(store, `release-${arch}-`))
  try {
    execFileSync('/usr/bin/tar', ['-xf', archive, '-C', generation])
    publish(generation, store, current, arch)
  } catch (error) {
    fs.rmSync(generation, { recursive: true, force: true })
    throw error
  }
}
