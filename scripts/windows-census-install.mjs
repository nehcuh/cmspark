// #650 fixed locked prerequisites, inside the existing private install capture.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { childEnvironment } from './windows-census.mjs'

export async function installLockedDependencies({ root, env, npmCli } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || !env || typeof env !== 'object' ||
    typeof env.GIT_CONFIG_GLOBAL !== 'string' || !path.isAbsolute(env.GIT_CONFIG_GLOBAL) ||
    path.basename(env.GIT_CONFIG_GLOBAL) !== 'empty.gitconfig' || env.GIT_CONFIG_NOSYSTEM !== '1') throw Error('CENSUS_INSTALL_ENV_INVALID')
  const clean = childEnvironment(env, root, path.dirname(env.GIT_CONFIG_GLOBAL))
  const names = Object.keys(env)
  if (names.length !== Object.keys(clean).length || Object.entries(clean).some(([key, value]) => {
    const matches = names.filter(name => name.toLowerCase() === key.toLowerCase())
    return matches.length !== 1 || env[matches[0]] !== value
  })) throw Error('CENSUS_INSTALL_ENV_INVALID')
  // Both fixed children need the same still-owned empty Git input; no values are read.
  let directory, config
  const same = (a, b) => a.dev === b.dev && a.ino === b.ino
  try {
    directory = fs.lstatSync(path.dirname(clean.GIT_CONFIG_GLOBAL), { bigint: true })
    config = fs.lstatSync(clean.GIT_CONFIG_GLOBAL, { bigint: true })
  } catch { throw Error('CENSUS_INSTALL_ENV_INVALID') }
  const validateGitInput = () => {
    try {
      const dir = fs.lstatSync(path.dirname(clean.GIT_CONFIG_GLOBAL), { bigint: true })
      const current = fs.lstatSync(clean.GIT_CONFIG_GLOBAL, { bigint: true })
      if (!dir.isDirectory() || dir.isSymbolicLink() || !same(dir, directory) ||
        !current.isFile() || current.isSymbolicLink() || !same(current, config) || current.nlink !== 1n || current.size !== 0n ||
        current.mtimeNs !== config.mtimeNs || current.ctimeNs !== config.ctimeNs ||
        (process.platform !== 'win32' && (current.mode & 0o077n) !== 0n)) throw Error('changed input')
    } catch { throw Error('CENSUS_INSTALL_ENV_INVALID') }
  }
  validateGitInput()
  // Only the owned test seam supplies npmCli; the CLI exposes no override.
  const npm = npmCli ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (typeof npm !== 'string' || !path.isAbsolute(npm) || !fs.existsSync(npm)) throw Error('CENSUS_INSTALL_CLI_MISSING')
  for (const directory of ['companion', 'chrome-extension']) {
    const result = await new Promise(resolve => {
      let error = null
      validateGitInput() // Final synchronous admission immediately before this child.
      const child = spawn(process.execPath, [npm, 'ci'], { cwd: path.join(root, directory), env: clean, windowsHide: true, stdio: 'inherit' })
      child.on('error', e => { error = ['ENOENT', 'EACCES', 'EPERM'].includes(e.code) ? e.code : 'UNCLASSIFIED' })
      child.once('close', (code, signal) => resolve({ package: directory, code, signal: signal ? ['SIGTERM', 'SIGKILL', 'SIGABRT'].includes(signal) ? signal : 'UNCLASSIFIED' : null, spawn_error: error }))
    })
    // Fixed sub-command status stays in private install stdout, not progress.
    console.log('CENSUS_650_INSTALL ' + JSON.stringify(result))
    if (result.code !== 0 || result.signal || result.spawn_error) return Number.isInteger(result.code) && result.code > 0 && result.code <= 255 ? result.code : 1
  }
  return 0
}

let direct = false
try { direct = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)) } catch { /* import-only stays inert */ }
if (direct) {
  const run = async () => {
    if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Windows' || process.argv.length !== 2) throw Error('CENSUS_INSTALL_OWNED_WINDOWS_CI_REQUIRED')
    const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
    return installLockedDependencies({ root, env: process.env })
  }
  run().then(code => { process.exitCode = code }, () => { console.error('CENSUS_INSTALL_FAILED'); process.exitCode = 1 })
}
