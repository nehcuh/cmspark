/** Failure-only copy of four already-open picker artifacts. No second tool and no scene scan. */
import fs from 'node:fs'
import path from 'node:path'
import {randomBytes} from 'node:crypto'

const TEXT_CAP = 262144
const TREE_CAP = 33554432
type Status = 'COPIED' | 'ABSENT' | 'OVERSIZE' | 'COPY_FAILED'
type Item = {status: Status; bytes: number}
const absent = (): Item => ({status: 'ABSENT', bytes: 0})
const oversize = (): Item => ({status: 'OVERSIZE', bytes: 0})
const failed = (): Item => ({status: 'COPY_FAILED', bytes: 0})
const limit = (code: Status) => Object.assign(new Error(code), {code})

let stderrChunks: Buffer[] = []
let stderrBytes = 0
let stderrDropped = false
let stderrSaw = false

export function resetPickerToolStderr476() {
  stderrChunks = []
  stderrBytes = 0
  stderrDropped = false
  stderrSaw = false
}

export function notePickerToolStderr476(chunk: Buffer) {
  if (!Buffer.isBuffer(chunk) || chunk.length === 0) return
  stderrSaw = true
  if (stderrDropped) return
  if (stderrBytes > TEXT_CAP - chunk.length) {
    stderrChunks = []
    stderrBytes = 0
    stderrDropped = true
    return
  }
  stderrChunks.push(Buffer.from(chunk))
  stderrBytes += chunk.length
}

function snapshotStderr(): {status: 'ABSENT' | 'OVERSIZE' | 'COPIED'; bytes: Buffer} {
  if (stderrDropped) return {status: 'OVERSIZE', bytes: Buffer.alloc(0)}
  if (!stderrSaw) return {status: 'ABSENT', bytes: Buffer.alloc(0)}
  return {status: 'COPIED', bytes: Buffer.concat(stderrChunks)}
}

function rmQuiet(target: string) {
  try { fs.rmSync(target, {recursive: true, force: true}) } catch { /* The caller records the failed copy. */ }
}

function contained(root: string, name: string) {
  const file = path.join(root, name)
  const relative = path.relative(root, file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw limit('COPY_FAILED')
  return file
}

function sameIdentity(a: fs.BigIntStats, b: fs.BigIntStats) {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs
}

function readBounded(file: string, expected: fs.BigIntStats, cap: number) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0))
  try {
    const opened = fs.fstatSync(fd, {bigint: true})
    if (!opened.isFile() || opened.nlink !== 1n || !sameIdentity(opened, expected)) throw limit('COPY_FAILED')
    if (opened.size > cap) throw limit('OVERSIZE')
    const size = Number(opened.size)
    const data = Buffer.allocUnsafe(size + 1)
    let offset = 0
    while (offset < data.length) {
      const count = fs.readSync(fd, data, offset, data.length - offset, offset)
      if (count === 0) break
      offset += count
    }
    if (offset > cap || fs.fstatSync(fd, {bigint: true}).size > cap) throw limit('OVERSIZE')
    if (offset > size) throw limit('COPY_FAILED')
    if (!sameIdentity(fs.lstatSync(file, {bigint: true}), opened)) throw limit('COPY_FAILED')
    return data.subarray(0, offset)
  } finally { fs.closeSync(fd) }
}

function copyText(source: string, target: string, checkRoot: () => void): Item {
  const stage = `${target}.staging-${randomBytes(8).toString('hex')}`
  try {
    checkRoot()
    const stat = fs.lstatSync(source, {bigint: true})
    if (stat.isSymbolicLink()) throw limit('OVERSIZE')
    if (!stat.isFile()) throw limit('COPY_FAILED')
    if (stat.size > TEXT_CAP) throw limit('OVERSIZE')
    const data = readBounded(source, stat, TEXT_CAP)
    checkRoot()
    fs.writeFileSync(stage, data, {flag: 'wx', mode: 0o600})
    fs.renameSync(stage, target)
    return {status: 'COPIED', bytes: data.length}
  } catch (error) {
    rmQuiet(stage)
    rmQuiet(target)
    const code = error && typeof error === 'object' && 'code' in error ? String((error as {code?: unknown}).code) : ''
    if (code === 'ENOENT') return absent()
    if (code === 'OVERSIZE') return oversize()
    return failed()
  }
}

function copyTree(source: string, target: string, stage: string, checkRoot: () => void): Item {
  try {
    checkRoot()
    const rootStat = fs.lstatSync(source)
    if (rootStat.isSymbolicLink()) throw limit('OVERSIZE')
    if (!rootStat.isDirectory()) throw limit('COPY_FAILED')
    const rootReal = fs.realpathSync(source)
    fs.mkdirSync(stage, {recursive: true, mode: 0o700})
    let total = 0
    const walk = (relative: string) => {
      const from = relative ? path.join(source, relative) : source
      const stat = fs.lstatSync(from, {bigint: true})
      if (stat.isSymbolicLink()) throw limit('OVERSIZE')
      const real = fs.realpathSync(from)
      if (real !== path.join(rootReal, relative)) throw limit('OVERSIZE')
      const to = relative ? path.join(stage, relative) : stage
      if (stat.isDirectory()) {
        if (relative) fs.mkdirSync(to, {recursive: true, mode: 0o700})
        const checkDirectory = () => {
          const current = fs.lstatSync(from, {bigint: true})
          if (!current.isDirectory() || !sameIdentity(current, stat) || fs.realpathSync(from) !== real) throw limit('COPY_FAILED')
        }
        for (const name of fs.readdirSync(from)) {
          checkDirectory()
          walk(path.join(relative, name))
        }
        checkDirectory()
        return
      }
      if (!stat.isFile()) throw limit('OVERSIZE')
      if (stat.size > TREE_CAP - total) throw limit('OVERSIZE')
      const data = readBounded(from, stat, TREE_CAP - total)
      total += data.length
      if (total > TREE_CAP) throw limit('OVERSIZE')
      fs.mkdirSync(path.dirname(to), {recursive: true, mode: 0o700})
      fs.writeFileSync(to, data, {flag: 'wx', mode: 0o600})
    }
    walk('')
    checkRoot()
    fs.renameSync(stage, target)
    return {status: 'COPIED', bytes: total}
  } catch (error) {
    rmQuiet(stage)
    rmQuiet(target)
    const code = error && typeof error === 'object' && 'code' in error ? String((error as {code?: unknown}).code) : ''
    if (code === 'ENOENT') return absent()
    if (code === 'OVERSIZE') return oversize()
    return failed()
  }
}

export function preservePickerFailureEvidence476(uiOwner?: {scene?: {root?: string}}, cwd = process.cwd()) {
  const dest = path.join(cwd, 'picker-failure-evidence')
  fs.mkdirSync(dest, {recursive: true, mode: 0o700})
  if (!fs.lstatSync(dest).isDirectory()) throw limit('COPY_FAILED')
  const manifest = path.join(dest, 'evidence-status.json')
  try {
    if (fs.lstatSync(manifest).isFile()) fs.rmSync(path.join(dest, 'Result.xcresult'), {recursive: true, force: true})
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let root: string | undefined
  let rootIdentity: fs.BigIntStats | undefined
  try {
    const candidate = uiOwner?.scene?.root
    if (candidate) {
      const stat = fs.lstatSync(candidate, {bigint: true})
      if (stat.isDirectory()) {
        const resolved = fs.realpathSync(candidate)
        if (sameIdentity(stat, fs.lstatSync(resolved, {bigint: true}))) {
          root = resolved
          rootIdentity = stat
        }
      }
    }
  } catch { root = undefined }
  const checkRoot = () => {
    if (!root || !rootIdentity) throw limit('COPY_FAILED')
    const current = fs.lstatSync(root, {bigint: true})
    if (!current.isDirectory() || !sameIdentity(current, rootIdentity) || fs.realpathSync(root) !== root) throw limit('COPY_FAILED')
  }
  const files: Record<string, Item> = {}
  const treeStage = path.join(path.dirname(dest), `.picker-xcresult-staging-${randomBytes(8).toString('hex')}`)
  if (!root) {
    for (const name of ['Result.xcresult', 'xcode.stdout', 'xcode.stderr']) {
      fs.rmSync(path.join(dest, name), {recursive: true, force: true})
    }
  }
  files['Result.xcresult'] = root ? copyTree(contained(root, 'Result.xcresult'), path.join(dest, 'Result.xcresult'), treeStage, checkRoot) : absent()
  files['xcode.stdout'] = root ? copyText(contained(root, 'xcode.stdout'), path.join(dest, 'xcode.stdout'), checkRoot) : absent()
  files['xcode.stderr'] = root ? copyText(contained(root, 'xcode.stderr'), path.join(dest, 'xcode.stderr'), checkRoot) : absent()
  const tool = snapshotStderr()
  const toolTarget = path.join(dest, 'xcresulttool-stderr.txt')
  if (tool.status === 'COPIED') {
    const stage = `${toolTarget}.staging-${randomBytes(8).toString('hex')}`
    try {
      fs.writeFileSync(stage, tool.bytes, {flag: 'wx', mode: 0o600})
      fs.renameSync(stage, toolTarget)
      files['xcresulttool-stderr.txt'] = {status: 'COPIED', bytes: tool.bytes.length}
    } catch {
      rmQuiet(stage)
      rmQuiet(toolTarget)
      files['xcresulttool-stderr.txt'] = failed()
    }
  } else {
    rmQuiet(toolTarget)
    files['xcresulttool-stderr.txt'] = tool.status === 'OVERSIZE' ? oversize() : absent()
  }
  const statusStage = `${manifest}.staging-${randomBytes(8).toString('hex')}`
  try {
    fs.writeFileSync(statusStage, JSON.stringify({schema: 1, files}), {flag: 'wx', mode: 0o600})
    fs.renameSync(statusStage, manifest)
  } finally { rmQuiet(statusStage) }
}
