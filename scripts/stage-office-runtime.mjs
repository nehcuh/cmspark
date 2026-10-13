#!/usr/bin/env node
// #611: retain the filesystem module/worker layout, engine resources and notices.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ENTRY = '@deepseek-ai/libreoffice-kit'
export const KIT_VERSION = '0.1.5'

export function officeTarget(platform) {
  const targets = {
    'macos-arm64': ['darwin', 'arm64'], 'macos-x64': ['darwin', 'x64'],
    'windows-x64': ['win32', 'x64'], 'windows-arm64': ['win32', 'arm64'],
    'linux-x64': ['linux', 'x64'], 'linux-arm64': ['linux', 'arm64'],
  }
  const target = targets[platform]
  if (!target) throw new Error(`Unsupported Office package platform: ${platform}`)
  const [os, arch] = target
  return { os, arch, engine: `${ENTRY}-${os === 'linux' ? 'wasm' : `${os}-${arch}`}` }
}

function safeAsset(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\0') || name.includes('\\') || path.isAbsolute(name)) {
    throw new Error('Invalid Office engine asset path')
  }
  const resolved = path.resolve(root, name)
  const relative = path.relative(root, resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Office engine asset escapes package')
  return resolved
}

export function verifyOfficeEngine(root, expectedName, target) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'prebuilds.json'), 'utf8'))
  const expectedPlatform = target.os === 'linux' ? 'wasm' : `${target.os}-${target.arch}`
  if (pkg.name !== expectedName || pkg.version !== KIT_VERSION || manifest.version !== KIT_VERSION ||
      manifest.schemaVersion !== 1 || manifest.status !== 'built' || manifest.platform !== expectedPlatform ||
      manifest.engine?.kind !== (target.os === 'linux' ? 'wasm' : 'native')) throw new Error('Office engine manifest mismatch')
  const files = manifest.files
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0) throw new Error('Office engine integrity inventory missing')
  for (const [name, hash] of Object.entries(files)) {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid Office engine integrity digest')
    const asset = safeAsset(root, name)
    if (!fs.lstatSync(asset).isFile()) throw new Error(`Office engine asset is not a regular file: ${name}`)
    const actual = createHash('sha256').update(fs.readFileSync(asset)).digest('hex')
    if (actual !== hash) throw new Error(`Office engine integrity mismatch: ${name}`)
  }
  for (const dir of ['sources', 'licenses']) {
    if (!fs.statSync(path.join(root, dir)).isDirectory() || !fs.readdirSync(path.join(root, dir)).length) throw new Error(`Office engine ${dir} missing`)
  }
  const engine = manifest.engine
  const needed = target.os === 'linux' ? ['loader', 'wasm', 'data', 'metadata'] : ['executable']
  for (const key of needed) {
    const file = safeAsset(root, engine[key])
    if (!fs.statSync(file).isFile() || !Object.hasOwn(files, engine[key])) throw new Error(`Office engine ${key} missing from integrity inventory`)
    if (key === 'executable' && target.os !== 'win32' && !(fs.statSync(file).mode & 0o111)) throw new Error('Office engine executable lacks execute permission')
  }
  if (target.os !== 'linux' && !fs.statSync(safeAsset(root, engine.programDirectory)).isDirectory()) throw new Error('Office engine program directory missing')
  return manifest
}

function platformMatches(values, value) {
  if (!values) return true
  if (values.includes(`!${value}`)) return false
  const positives = values.filter(v => !v.startsWith('!'))
  return !positives.length || positives.includes(value) || positives.includes('any')
}

function packageRoot(name, parent) {
  const require = createRequire(path.join(parent, 'package.json'))
  try { return path.dirname(require.resolve(`${name}/package.json`)) } catch {
    // Some dependency export maps intentionally hide package.json (e.g. koffi).
    let directory = path.dirname(require.resolve(name))
    for (;;) {
      const file = path.join(directory, 'package.json')
      if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).name === name) return directory
      const next = path.dirname(directory)
      if (next === directory) throw new Error(`Package root not found: ${name}`)
      directory = next
    }
  }
}

export function stageOfficeRuntime({ source, destination, platform }) {
  const target = officeTarget(platform)
  source = fs.realpathSync(path.resolve(source))
  destination = path.resolve(destination)
  fs.mkdirSync(destination, {recursive:true})
  destination = fs.realpathSync(destination)
  const modules = path.join(source, 'node_modules')
  const lock = JSON.parse(fs.readFileSync(path.join(source, 'package-lock.json'), 'utf8'))
  const visited = new Set()
  const copied = []
  function copy(name, parent = source) {
    const root = packageRoot(name, parent)
    const relative = path.relative(modules, root)
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Office dependency outside node_modules: ${name}`)
    if (visited.has(root)) return
    visited.add(root)
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    if (!platformMatches(pkg.os, target.os) || !platformMatches(pkg.cpu, target.arch)) throw new Error(`Office dependency does not match target: ${name}`)
    if (name === ENTRY && pkg.version !== KIT_VERSION) throw new Error('Office entry version mismatch')
    const output = path.join(destination, 'node_modules', relative)
    if (output === root || output.startsWith(`${root}${path.sep}`)) throw new Error('Office staging destination overlaps source')
    if (name === target.engine) verifyOfficeEngine(root, name, target)
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.rmSync(output, { recursive: true, force: true })
    // Reconstruct nested modules from the selected graph, avoiding foreign optional
    // engines that may exist in a developer's multi-platform installation.
    fs.cpSync(root, output, { recursive: true, verbatimSymlinks: true,
      filter: item => item !== path.join(root, 'node_modules') })
    copied.push({ name, version: pkg.version, path: `node_modules/${relative.split(path.sep).join('/')}` })
    for (const dep of Object.keys(pkg.dependencies ?? {})) copy(dep, root)
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      // Published Linux uses WASM; exclude development-native packages and all foreign engines.
      if (name === ENTRY) { if (dep === target.engine) copy(dep, root); continue }
      let optionalRoot
      try {
        optionalRoot = packageRoot(dep, root)
        if (!fs.existsSync(path.join(optionalRoot, 'package.json'))) throw new Error('Resolved optional package is missing')
      } catch {
        const metadata = Object.entries(lock.packages ?? {}).find(([key]) => key === `node_modules/${dep}`)?.[1]
        if (!metadata || (platformMatches(metadata.os, target.os) && platformMatches(metadata.cpu, target.arch))) {
          throw new Error(`Required matching Office optional dependency missing: ${dep}`)
        }
        continue
      }
      const optional = JSON.parse(fs.readFileSync(path.join(optionalRoot, 'package.json'), 'utf8'))
      if (platformMatches(optional.os, target.os) && platformMatches(optional.cpu, target.arch)) copy(dep, root)
    }
  }
  copy(ENTRY)
  if (!copied.some(p => p.name === target.engine)) throw new Error(`Required Office engine missing: ${target.engine}`)
  const entry = path.join(destination, 'node_modules', ENTRY)
  for (const file of ['lib/index.js', 'lib/worker.js', 'lib/font-snapshot-worker.js', 'LICENSE', 'NOTICE']) {
    if (!fs.statSync(path.join(entry, file)).isFile()) throw new Error(`Office entry asset missing: ${file}`)
  }
  verifyOfficeEngine(path.join(destination, copied.find(p => p.name === target.engine).path), target.engine, target)
  const record = { kitVersion: KIT_VERSION, platform, engine: target.engine, packages: copied }
  fs.writeFileSync(path.join(destination, 'office-runtime.json'), JSON.stringify(record, null, 2) + '\n')
  return record
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const options = {}
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index]
      if (!['--source', '--destination', '--platform'].includes(key) || !args[index + 1]) throw new Error('Usage: stage-office-runtime.mjs --source companion --destination staging --platform macos-arm64')
      options[key.slice(2)] = args[index + 1]
    }
    if (!options.source || !options.destination || !options.platform) throw new Error('Missing Office staging arguments')
    const record = stageOfficeRuntime(options)
    console.log(`Office runtime ${record.kitVersion}: ${record.engine}, ${record.packages.length} packages staged and verified`)
  } catch (error) { console.error(`Office staging failed: ${error.message}`); process.exitCode = 1 }
}
