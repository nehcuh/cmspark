/** One fixed-file failure observation. Never a native success or cleanup gate. */
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
export const MCP_SNAPSHOT_BYTES_825 = 128
export const MCP_SNAPSHOT_MAGIC_825 = 0x82577301
export type McpSnapshot825 = { status: 'UNKNOWN' } | { status: 'OBSERVED'; sampleOffsetMs: number; version: number; flags: number; envHr: number; controllerHr: number; callbackHr: number; callbackPresent: number; sendKind: number; sendSite: number; sendEdge: number; sendStage: number; sendResult: number; sendResultKnown: boolean }
const unknown = (): McpSnapshot825 => ({ status: 'UNKNOWN' })
const identity = (stat: fs.BigIntStats) => ({ dev: stat.dev, ino: stat.ino, birth: stat.birthtimeNs })
const same = (a: ReturnType<typeof identity>, b: ReturnType<typeof identity>) => a.dev === b.dev && a.ino === b.ino && a.birth === b.birth
const regular = (s: fs.BigIntStats) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && s.size === BigInt(MCP_SNAPSHOT_BYTES_825)
const number = (b: Buffer, word: number) => b.readUInt32LE(word * 4) + b.readUInt32LE((word + 1) * 4) * 0x100000000
function putNumber(b: Buffer, word: number, value: number) { b.writeUInt32LE(value >>> 0, word * 4); b.writeUInt32LE(Math.floor(value / 0x100000000), (word + 1) * 4) }

export function decodeMcpSnapshot825(seed: Buffer, result: Buffer, now = Date.now()): McpSnapshot825 {
 try {
  if (seed.length !== MCP_SNAPSHOT_BYTES_825 || result.length !== MCP_SNAPSHOT_BYTES_825 || !seed.subarray(0, 32).equals(result.subarray(0, 32))) return unknown()
  const at = (word: number) => result.readUInt32LE(word * 4), generation = at(3), target = number(result, 4), deadline = number(result, 6), sampled = number(result, 9), version = at(11)
  if (at(0) !== MCP_SNAPSHOT_MAGIC_825 || at(1) !== 1 || at(2) !== MCP_SNAPSHOT_BYTES_825 || !generation || generation === MCP_SNAPSHOT_MAGIC_825 || at(8) !== 1 || at(31) !== ((MCP_SNAPSHOT_MAGIC_825 ^ generation) >>> 0)) return unknown()
  if (![target, deadline, sampled, now, number(result, 22)].every(Number.isSafeInteger) || deadline - target !== 1500 || sampled < target || sampled - target > 250 || sampled >= deadline || sampled > now || number(result, 22) < sampled || number(result, 22) >= deadline || version > 65536 || version % 2) return unknown()
  for (let word = 24; word < 31; word++) if (at(word) !== 0) return unknown()
  const flags = at(12), kind = at(17), site = at(18), edge = at(19), stage = at(20)
  if (flags > 1023 || at(16) > 1 || kind > 2 || edge > 2 || stage > 6 || !kind && (site || edge || stage || at(21)) || kind === 1 && (site > 7 || edge !== 0) || kind === 2 && (site < 1 || site > 30)) return unknown()
  return { status: 'OBSERVED', sampleOffsetMs: sampled - target, version, flags, envHr: at(13), controllerHr: at(14), callbackHr: at(15), callbackPresent: at(16), sendKind: kind, sendSite: site, sendEdge: edge, sendStage: stage, sendResult: at(21), sendResultKnown: (flags & 512) !== 0 }
 } catch { return unknown() }
}

export async function prepareMcpSnapshot825(native: string, ownedRoot: string, deadline: number) {
 // Load only inside the original per-case data-dir setup; this module has no
 // config/service imports that can pre-empt that existing setup.
 const { ownedDirectoryIdentity, requireOwnedDirectory, copyOwnedAcceptanceAssets, OFFLINE_ACCEPTANCE_ASSETS_480 } = await import('../fixtures/desktop-480/native-acceptance-controller')
 const rootIdentity = ownedDirectoryIdentity(ownedRoot), directory = path.join(ownedRoot, 'mcp-snapshot-825'), source = path.join(native, 'acceptance/mcp')
 fs.mkdirSync(directory, { mode: 0o700 }); const directoryIdentity = ownedDirectoryIdentity(directory)
 const input = path.join(source, 'cmspark-desktop.exe'), stat = fs.lstatSync(input)
 if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('OWNED_MCP_SNAPSHOT_BINARY')
 const binary = path.join(directory, 'cmspark-desktop.exe'); fs.copyFileSync(input, binary, fs.constants.COPYFILE_EXCL)
 for (const name of OFFLINE_ACCEPTANCE_ASSETS_480) if (!fs.readFileSync(path.join(source, 'assets', name)).equals(fs.readFileSync(path.join(native, 'assets', name)))) throw Error('OWNED_MCP_SNAPSHOT_ASSETS')
 copyOwnedAcceptanceAssets(source, directory)
 requireOwnedDirectory(ownedRoot, rootIdentity); requireOwnedDirectory(directory, directoryIdentity)
 const file = path.join(directory, 'mcp-startup-825.bin'), seed = Buffer.alloc(MCP_SNAPSHOT_BYTES_825)
 let generation = randomBytes(4).readUInt32LE(0); if (!generation || generation === MCP_SNAPSHOT_MAGIC_825) generation = 1
 seed.writeUInt32LE(MCP_SNAPSHOT_MAGIC_825, 0); seed.writeUInt32LE(1, 4); seed.writeUInt32LE(MCP_SNAPSHOT_BYTES_825, 8); seed.writeUInt32LE(generation, 12)
 if (!Number.isSafeInteger(deadline) || deadline - Date.now() > 20000) throw Error('OWNED_MCP_SNAPSHOT_DEADLINE')
 putNumber(seed, 4, deadline - 1500); putNumber(seed, 6, deadline)
 const fd = fs.openSync(file, 'wx+', 0o600)
 try { fs.writeSync(fd, seed); const before = fs.fstatSync(fd, { bigint: true }); if (!regular(before) || !same(identity(before), identity(fs.lstatSync(file, { bigint: true })))) throw Error('OWNED_MCP_SNAPSHOT_FILE') }
 catch (error) { fs.closeSync(fd); throw error }
 const expected = identity(fs.fstatSync(fd, { bigint: true })); let closed = false
 return { binary, file, seed: Buffer.from(seed),
  read(): McpSnapshot825 {
   try {
    if (closed) return unknown()
    requireOwnedDirectory(ownedRoot, rootIdentity); requireOwnedDirectory(directory, directoryIdentity)
    const before = fs.lstatSync(file, { bigint: true }), opened = fs.fstatSync(fd, { bigint: true })
    if (!regular(before) || !regular(opened) || !same(expected, identity(before)) || !same(expected, identity(opened))) return unknown()
    const first = Buffer.alloc(MCP_SNAPSHOT_BYTES_825), second = Buffer.alloc(MCP_SNAPSHOT_BYTES_825)
    if (fs.readSync(fd, first, 0, first.length, 0) !== first.length || fs.readSync(fd, second, 0, second.length, 0) !== second.length || !first.equals(second)) return unknown()
    const after = fs.lstatSync(file, { bigint: true }), final = fs.fstatSync(fd, { bigint: true })
    if (!regular(after) || !regular(final) || !same(expected, identity(after)) || !same(expected, identity(final))) return unknown()
    return decodeMcpSnapshot825(seed, first)
   } catch { return unknown() }
  },
  close() { if (!closed) { closed = true; fs.closeSync(fd) } },
 }
}
