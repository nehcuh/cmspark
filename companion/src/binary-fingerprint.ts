import * as fs from "fs"
import { createHash } from "crypto"

/** Hash and identify the same open file before a native helper is launched. */
export function readBinaryFingerprint(file: string) {
  const realpath = fs.realpathSync(file)
  const fd = fs.openSync(realpath, "r")
  try {
    const stat = fs.fstatSync(fd)
    const hash = createHash("sha256")
    const buffer = Buffer.alloc(64 * 1024)
    let count: number
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count))
    }
    return { digest: hash.digest("hex"), inode: stat.ino, dev: stat.dev, realpath }
  } finally {
    try { fs.closeSync(fd) } catch { /* best effort after the read */ }
  }
}

export function statInodeDev(file: string): { inode: number; dev: number } | null {
  try {
    const stat = fs.statSync(file)
    return { inode: stat.ino, dev: stat.dev }
  } catch {
    return null
  }
}
