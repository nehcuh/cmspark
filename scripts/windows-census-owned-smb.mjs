// #650 CI fixture metadata only. SMB creation/removal remains in the fixed
// Windows workflow; this helper never invokes PowerShell or deletes a path.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateOwnedUncShare } from './windows-census.mjs'

function directoryPath(temp, name, run, attempt) {
  validateOwnedUncShare('\\\\127.0.0.1\\' + name, run, attempt)
  return path.join(fs.realpathSync.native(temp), name)
}
function snapshot(directory) {
  const stat = fs.lstatSync(directory, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) throw Error('invalid directory identity')
  return { path: fs.realpathSync.native(directory), dev: stat.dev.toString(), ino: stat.ino.toString() }
}
export function createOwnedUncDirectory(temp, name, run, attempt) {
  try {
    const directory = directoryPath(temp, name, run, attempt)
    fs.mkdirSync(directory, { recursive: false, mode: 0o700 })
    return snapshot(directory)
  } catch { throw Error('CENSUS_OWNED_SMB_SETUP_FAILED') }
}
export function verifyOwnedUncDirectory(temp, name, run, attempt, identity, binding) {
  try {
    const directory = directoryPath(temp, name, run, attempt)
    if (!identity || Object.keys(identity).sort().join(',') !== 'dev,ino,path' ||
      typeof identity.dev !== 'string' || typeof identity.ino !== 'string' ||
      BigInt(identity.dev) < 0n || BigInt(identity.ino) <= 0n ||
      BigInt(identity.dev).toString() !== identity.dev || BigInt(identity.ino).toString() !== identity.ino ||
      identity.path !== directory || !binding || binding.name !== name || binding.path !== directory) throw Error('invalid binding')
    const current = snapshot(directory)
    if (current.path !== identity.path || current.dev !== identity.dev || current.ino !== identity.ino) throw Error('changed directory')
    return directory
  } catch { throw Error('CENSUS_OWNED_SMB_IDENTITY_INVALID') }
}
export function createOwnedShortDirectory(temp, name, run, attempt, identity) {
  try {
    const parent = directoryPath(temp, name, run, attempt)
    verifyOwnedUncDirectory(temp, name, run, attempt, identity, { name, path: parent })
    const directory = path.join(parent, 'canonical short alias owned')
    fs.mkdirSync(directory, { recursive: false, mode: 0o700 })
    const child = snapshot(directory)
    verifyOwnedUncDirectory(temp, name, run, attempt, identity, { name, path: parent })
    return child
  } catch { throw Error('CENSUS_OWNED_SHORT_ROOT_INVALID') }
}
function main() {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Windows') throw Error('CENSUS_OWNED_SMB_SETUP_FAILED')
  const [mode, name, currentName, currentPath, dev, ino] = process.argv.slice(2)
  const { RUNNER_TEMP: temp, GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt } = process.env
  if (mode === 'create' && process.argv.length === 4) {
    console.log(JSON.stringify(createOwnedUncDirectory(temp, name, run, attempt)))
  } else if (mode === 'create-short' && process.argv.length === 6) {
    const directory = directoryPath(temp, name, run, attempt)
    console.log(JSON.stringify(createOwnedShortDirectory(temp, name, run, attempt, { path: directory, dev: currentName, ino: currentPath })))
  } else if (mode === 'verify' && process.argv.length === 8) {
    const directory = directoryPath(temp, name, run, attempt)
    verifyOwnedUncDirectory(temp, name, run, attempt, { path: directory, dev, ino }, { name: currentName, path: currentPath })
  } else throw Error('CENSUS_OWNED_SMB_SETUP_FAILED')
}
let direct = false
try { direct = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)) } catch { /* import-only */ }
if (direct) {
  try { main() } catch (error) {
    console.error(['CENSUS_OWNED_SMB_IDENTITY_INVALID', 'CENSUS_OWNED_SHORT_ROOT_INVALID'].includes(error?.message) ? error.message : 'CENSUS_OWNED_SMB_SETUP_FAILED')
    process.exitCode = 1
  }
}
