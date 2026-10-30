#!/usr/bin/env node
// Verify static Mach-O load commands in the staged whisper dependency graph.
// This does not authenticate the input or discover dependencies loaded by dlopen.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const fail = message => { throw new Error(`WHISPER_CLOSURE_${message}`) }
const within = (parent, child) => child.startsWith(parent + path.sep)
const dependency = /^\t([^\s\x00-\x1f\x7f][^\x00-\x1f\x7f]*) \(compatibility version [0-9]+\.[0-9]+\.[0-9]+, current version [0-9]+\.[0-9]+\.[0-9]+(?:, (?:weak|reexport|upward|lazy))?\)$/

function verify(stage, binaryName) {
  if (!/^cmspark-whisper-darwin-(?:arm64|x64)$/.test(binaryName)) fail('BINARY_NAME')
  const root = fs.realpathSync(stage)
  const lib = fs.realpathSync(path.join(root, 'lib'))
  const bin = fs.realpathSync(path.join(root, 'bin'))
  if (!within(root, lib) || !within(root, bin)) fail('STAGING_ESCAPE')
  const primary = fs.realpathSync(path.join(bin, binaryName))
  if (!within(bin, primary) || !fs.statSync(primary).isFile()) fail('PRIMARY_ESCAPE')
  const pending = [primary]
  const seen = new Set()
  while (pending.length) {
    const file = pending.pop()
    if (seen.has(file)) continue
    if (seen.size >= 256) fail('GRAPH_LIMIT')
    seen.add(file)
    const result = spawnSync('otool', ['-L', file], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } })
    if (result.error || result.status !== 0 || result.signal || typeof result.stdout !== 'string') fail('OTOOL_FAILED')
    const output = result.stdout
    if (!output.endsWith('\n') || output.endsWith('\n\n')) fail('OTOOL_FORMAT')
    const lines = output.slice(0, -1).split('\n')
    if (lines.shift() !== `${file}:` || !lines.length) fail('OTOOL_FORMAT')
    for (const line of lines) {
      const match = dependency.exec(line)
      if (!match) fail('OTOOL_FORMAT')
      const ref = match[1]
      if (ref.startsWith('/usr/lib/') || ref.startsWith('/System/Library/')) {
        if (path.posix.normalize(ref) !== ref) fail('SYSTEM_PATH')
        continue
      }
      if (!ref.startsWith('@loader_path/')) fail('UNSUPPORTED_DEPENDENCY')
      const target = fs.realpathSync(path.resolve(path.dirname(file), ref.slice('@loader_path/'.length)))
      if (!within(lib, target) || !fs.statSync(target).isFile()) fail('DEPENDENCY_ESCAPE')
      pending.push(target)
    }
  }
  return seen.size
}

try {
  if (process.argv.length !== 4) fail('ARGUMENTS')
  const count = verify(process.argv[2], process.argv[3])
  console.log(`Verified ${count} staged whisper Mach-O objects`)
} catch (error) {
  // Keep local paths and tool output out of the packaging diagnostic.
  console.error(error instanceof Error && /^WHISPER_CLOSURE_[A-Z_]+$/.test(error.message) ? error.message : 'WHISPER_CLOSURE_UNREADABLE')
  process.exitCode = 1
}
