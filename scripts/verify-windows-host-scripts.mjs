#!/usr/bin/env node
// Build-time check only: never execute PowerShell or inspect an installed application.
import fs from 'node:fs'
import path from 'node:path'

const [source, destination, ...extra] = process.argv.slice(2)
try {
  if (!source || !destination || extra.length) throw new Error('INVALID_ARGUMENTS')
  const directory = root => {
    const stat = fs.lstatSync(root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('DIRECTORY_REQUIRED')
    return fs.readdirSync(root).filter(name => name.endsWith('.ps1')).sort()
  }
  const expected = directory(source), actual = directory(destination)
  if (fs.realpathSync(source) === fs.realpathSync(destination)) throw new Error('DISTINCT_DIRECTORIES_REQUIRED')
  if (!expected.length || !expected.includes('activity-windows.ps1')) throw new Error('SOURCE_INCOMPLETE')
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('SCRIPT_SET_MISMATCH')
  for (const name of expected) {
    const original = path.join(source, name), staged = path.join(destination, name)
    for (const file of [original, staged]) {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('REGULAR_NONEMPTY_SCRIPT_REQUIRED')
    }
    if (!fs.readFileSync(original).equals(fs.readFileSync(staged))) throw new Error('SCRIPT_BYTES_MISMATCH')
  }
  console.log('WINDOWS_HOST_SCRIPTS_VERIFIED ' + JSON.stringify({ files: expected.length, exactSourceBytes: true }))
} catch (error) {
  const known = new Set(['INVALID_ARGUMENTS', 'DIRECTORY_REQUIRED', 'DISTINCT_DIRECTORIES_REQUIRED', 'SOURCE_INCOMPLETE', 'SCRIPT_SET_MISMATCH', 'REGULAR_NONEMPTY_SCRIPT_REQUIRED', 'SCRIPT_BYTES_MISMATCH'])
  console.error('WINDOWS_HOST_SCRIPTS_REFUSED ' + (known.has(error?.message) ? error.message : 'UNREADABLE_SOURCE_OR_STAGE'))
  process.exitCode = 1
}
