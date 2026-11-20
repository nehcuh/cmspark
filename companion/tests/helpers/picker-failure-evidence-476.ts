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

function sameIdentity(a: fs.Stats, b: fs.Stats) {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs
}

function readBounded(file: string, expected: fs.Stats, cap: number) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0))
  try {
    const opened = fs.fstatSync(fd)
    if (!opened.isFile() || opened.nlink !== 1 || !sameIdentity(opened, expected)) throw limit('COPY_FAILED')
    if (opened.size > cap) throw limit('OVERSIZE')
    const data = Buffer.allocUnsafe(opened.size + 1)
    let offset = 0
    while (offset < data.length) {
      const count = fs.readSync(fd, data, offset, data.length - offset, offset)
      if (count === 0) break
      offset += count
    }
    if (offset > cap || fs.fstatSync(fd).size > cap) throw limit('OVERSIZE')
    if (offset > opened.size) throw limit('COPY_FAILED')
    if (!sameIdentity(fs.lstatSync(file), opened)) throw limit('COPY_FAILED')
    return data.subarray(0, offset)
  } finally { fs.closeSync(fd) }
}

function copyText(source: string, target: string): Item {
  const stage = `${target}.staging-${randomBytes(8).toString('hex')}`
  try {
    const stat = fs.lstatSync(source)
    if (stat.isSymbolicLink()) throw limit('OVERSIZE')
    if (!stat.isFile()) throw limit('COPY_FAILED')
    if (stat.size > TEXT_CAP) throw limit('OVERSIZE')
    const data = readBounded(source, stat, TEXT_CAP)
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

function copyTree(source: string, target: string, stage: string): Item {
  try {
    const rootStat = fs.lstatSync(source)
    if (rootStat.isSymbolicLink()) throw limit('OVERSIZE')
    if (!rootStat.isDirectory()) throw limit('COPY_FAILED')
    const rootReal = fs.realpathSync(source)
    fs.mkdirSync(stage, {recursive: true, mode: 0o700})
    let total = 0
    const walk = (relative: string) => {
      const from = relative ? path.join(source, relative) : source
      const stat = fs.lstatSync(from)
      if (stat.isSymbolicLink()) throw limit('OVERSIZE')
      const real = fs.realpathSync(from)
      if (real !== path.join(rootReal, relative)) throw limit('OVERSIZE')
      const to = relative ? path.join(stage, relative) : stage
      if (stat.isDirectory()) {
        if (relative) fs.mkdirSync(to, {recursive: true, mode: 0o700})
        const checkDirectory = () => {
          const current = fs.lstatSync(from)
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
      if (stat.size > TREE_CAP || total > TREE_CAP - stat.size) throw limit('OVERSIZE')
      const data = readBounded(from, stat, TREE_CAP - total)
      total += data.length
      if (total > TREE_CAP) throw limit('OVERSIZE')
      fs.mkdirSync(path.dirname(to), {recursive: true, mode: 0o700})
      fs.writeFileSync(to, data, {flag: 'wx', mode: 0o600})
    }
    walk('')
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
  let root: string | undefined
  try {
    const candidate = uiOwner?.scene?.root
    if (candidate) {
      const stat = fs.lstatSync(candidate)
      if (stat.isDirectory() && !stat.isSymbolicLink()) root = fs.realpathSync(candidate)
    }
  } catch { root = undefined }
  const files: Record<string, Item> = {}
  const treeStage = path.join(path.dirname(dest), `.picker-xcresult-staging-${randomBytes(8).toString('hex')}`)
  if (!root) {
    for (const name of ['Result.xcresult', 'xcode.stdout', 'xcode.stderr']) {
      fs.rmSync(path.join(dest, name), {recursive: true, force: true})
    }
  }
  files['Result.xcresult'] = root ? copyTree(contained(root, 'Result.xcresult'), path.join(dest, 'Result.xcresult'), treeStage) : absent()
  files['xcode.stdout'] = root ? copyText(contained(root, 'xcode.stdout'), path.join(dest, 'xcode.stdout')) : absent()
  files['xcode.stderr'] = root ? copyText(contained(root, 'xcode.stderr'), path.join(dest, 'xcode.stderr')) : absent()
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
  fs.writeFileSync(path.join(dest, 'evidence-status.json'), JSON.stringify({schema: 1, files}))
}
