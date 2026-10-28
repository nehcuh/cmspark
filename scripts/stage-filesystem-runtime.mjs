#!/usr/bin/env node
// Stage only the official filesystem server's installed dependency graph.
// Package metadata is found through Node's per-parent lookup directories, not
// package exports: SDK's exported package.json is a type-only dist manifest.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ENTRY = '@modelcontextprotocol/server-filesystem'
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
const inside = (root, value) => { const rel = path.relative(root, value); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) }

class MissingPackage extends Error {}

function directory(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Filesystem runtime directory must be regular')
}

function regularTree(root, packageRoot = root) {
  directory(root)
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    // Nested packages are copied separately from their actual resolution roots.
    if (path.join(root, item.name) === path.join(packageRoot, 'node_modules')) continue
    const file = path.join(root, item.name)
    if (item.isSymbolicLink()) throw new Error('Filesystem runtime symlinks are not allowed')
    if (item.isDirectory()) regularTree(file, packageRoot)
    else if (!item.isFile()) throw new Error('Filesystem runtime special files are not allowed')
  }
}

// Reusing a package staged by another component must not erase its separately
// staged nested modules. Verify the entire ordinary payload, then leave it in
// place. A differing/missing/extra file or mode is a conflict, never a merge.
function verifyExistingPayload(source, output, sourceRoot = source, outputRoot = output) {
  directory(output)
  if ((fs.lstatSync(source).mode & 0o777) !== (fs.lstatSync(output).mode & 0o777)) throw new Error('Existing filesystem package payload conflicts with source')
  const names = root => fs.readdirSync(root).filter(name => !(root === sourceRoot || root === outputRoot) || name !== 'node_modules').sort()
  const expected = names(source), actual = names(output)
  const conflict = () => { throw new Error('Existing filesystem package payload conflicts with source') }
  if (expected.length !== actual.length || expected.some((name, i) => name !== actual[i])) conflict()
  for (const name of expected) {
    const input = path.join(source, name), target = path.join(output, name)
    const before = fs.lstatSync(input), after = fs.lstatSync(target)
    if (after.isSymbolicLink() || (before.mode & 0o777) !== (after.mode & 0o777)) conflict()
    if (before.isDirectory() && after.isDirectory()) verifyExistingPayload(input, target, sourceRoot, outputRoot)
    else if (!before.isFile() || !after.isFile() || !fs.readFileSync(input).equals(fs.readFileSync(target))) conflict()
  }
  if (output === outputRoot) {
    try { directory(path.join(output, 'node_modules')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
}

function dependencyMap(pkg) {
  const dependencies = new Map()
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const values = pkg[key]
    if (values === undefined) continue
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid filesystem runtime dependency metadata')
    for (const [name, version] of Object.entries(values)) {
      if (!PACKAGE_NAME.test(name) || typeof version !== 'string' || !version) throw new Error('Invalid filesystem runtime dependency declaration')
      if (key === 'dependencies') dependencies.set(name, false)
      else if (key === 'optionalDependencies') dependencies.set(name, true)
      else if (!dependencies.has(name)) dependencies.set(name, pkg.peerDependenciesMeta?.[name]?.optional === true)
    }
  }
  return dependencies
}

// Resolve missing descendants without creating them. A lexical destination can
// sit below an existing alias into source; mkdir must not precede that check.
function destinationBeforeCreate(value) {
  let ancestor = path.resolve(value)
  const missing = []
  while (true) {
    try { fs.lstatSync(ancestor); break } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = path.dirname(ancestor)
      if (parent === ancestor) throw error
      missing.unshift(path.basename(ancestor))
      ancestor = parent
    }
  }
  return path.join(fs.realpathSync(ancestor), ...missing)
}

export function stageFilesystemRuntime({ source, destination }) {
  source = fs.realpathSync(path.resolve(source))
  const modules = path.join(source, 'node_modules')
  directory(modules)
  destination = path.resolve(destination)
  if (inside(source, destination) || inside(destination, source)) throw new Error('Filesystem staging must not overlap its source')
  destination = destinationBeforeCreate(destination)
  if (inside(source, destination) || inside(destination, source)) throw new Error('Filesystem staging must not overlap its source')
  fs.mkdirSync(destination, { recursive: true })
  destination = fs.realpathSync(destination)
  if (inside(source, destination) || inside(destination, source)) throw new Error('Filesystem staging must not overlap its source')
  const outputModules = path.join(destination, 'node_modules')
  fs.mkdirSync(outputModules, { recursive: true })
  directory(outputModules)
  const visited = new Set(), packages = []

  function resolvePackage(name, parent) {
    if (!PACKAGE_NAME.test(name)) throw new Error('Invalid filesystem runtime package name')
    const lookup = createRequire(path.join(parent, 'package.json')).resolve.paths(name)
    if (!Array.isArray(lookup)) throw new Error('Filesystem dependency must be an installed package')
    for (const folder of lookup) {
      const root = path.join(folder, name)
      if (!inside(modules, root)) continue // Never borrow global/user/ancestor packages.
      let stat
      try { stat = fs.lstatSync(root) } catch (error) {
        if (error?.code === 'ENOENT') continue
        throw error
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Filesystem package root must be a regular directory')
      let component = modules
      for (const part of path.relative(modules, root).split(path.sep)) { component = path.join(component, part); directory(component) }
      const file = path.join(root, 'package.json')
      const metadata = fs.lstatSync(file)
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Filesystem package metadata must be a regular file')
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (pkg?.name !== name || typeof pkg.version !== 'string' || !pkg.version) throw new Error('Filesystem package identity mismatch')
      return { root, pkg }
    }
    throw new MissingPackage(`Required filesystem dependency is missing: ${name}`)
  }

  function copy(name, parent, optional = false) {
    let resolved
    try { resolved = resolvePackage(name, parent) } catch (error) {
      if (optional && error instanceof MissingPackage) return
      throw error
    }
    const { root, pkg } = resolved
    if (visited.has(root)) return
    visited.add(root)
    const dependencies = dependencyMap(pkg)
    regularTree(root)
    const relative = path.relative(modules, root)
    const output = path.join(outputModules, relative)
    // Existing output can contain packages staged by another component. Never
    // follow an output symlink, including a scope/ancestor symlink.
    let component = outputModules
    for (const part of relative.split(path.sep).slice(0, -1)) {
      component = path.join(component, part)
      if (!fs.existsSync(component)) fs.mkdirSync(component)
      directory(component)
    }
    if (fs.existsSync(output) || (() => { try { fs.lstatSync(output); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error } })()) {
      verifyExistingPayload(root, output)
    } else {
      fs.cpSync(root, output, { recursive: true, filter: item => item !== path.join(root, 'node_modules') })
    }
    packages.push({ name, version: pkg.version, path: `node_modules/${relative.split(path.sep).join('/')}` })
    for (const [dependency, isOptional] of dependencies) copy(dependency, root, isOptional)
  }

  copy(ENTRY, source)
  const entry = path.join(outputModules, ENTRY, 'dist', 'index.js')
  const stat = fs.lstatSync(entry)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Official filesystem MCP entry missing after staging')
  return { entry: `node_modules/${ENTRY}/dist/index.js`, packages }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--destination') throw new Error('Usage: stage-filesystem-runtime.mjs --source companion --destination staging')
    const result = stageFilesystemRuntime({ source: args[1], destination: args[3] })
    console.log(`Official filesystem MCP: ${result.packages.length} packages staged`)
  } catch (error) {
    console.error(`Filesystem staging failed: ${error.message}`)
    process.exitCode = 1
  }
}
