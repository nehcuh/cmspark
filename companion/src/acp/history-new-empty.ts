// #732 private commit seam: only the still-empty O_EXCL temp held by this writer.
import * as fs from "fs"
import * as path from "path"
import { runPs, resolveWinScript } from "../host-use/win/powershell"
export type HistoryEmptyInitialization = "INITIALIZED" | "REFUSED" | "UNKNOWN"
const BASENAME = /^acp-history\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/
const exactIdentity = (s: fs.BigIntStats) => typeof s.dev === "bigint" && s.dev >= 0n && s.dev <= 0xffffffffn &&
  typeof s.ino === "bigint" && s.ino > 0n && s.ino <= 0xffffffffffffffffn
const same = (a: fs.BigIntStats, b: fs.BigIntStats) => exactIdentity(a) && exactIdentity(b) && a.dev === b.dev && a.ino === b.ino
export async function initializeHistoryEmpty(root: string, name: string, parentFd: number, fd: number,
  enabled: () => boolean): Promise<HistoryEmptyInitialization> {
  if (!enabled()) return "REFUSED"
  if (process.platform !== "win32" || typeof root !== "string" || !/^[A-Za-z]:\\/.test(root) || !path.isAbsolute(root) || root.includes("\0") ||
      path.resolve(root) !== root || typeof name !== "string" || !BASENAME.test(name) || !Number.isInteger(parentFd) || parentFd < 0 ||
      !Number.isInteger(fd) || fd < 0 || parentFd === fd) return "REFUSED"
  const file = path.join(root, name)
  try {
    const directory = fs.fstatSync(parentFd, { bigint: true }), empty = fs.fstatSync(fd, { bigint: true })
    const current = () => {
      const d = fs.fstatSync(parentFd, { bigint: true }), p = fs.lstatSync(root, { bigint: true })
      const f = fs.fstatSync(fd, { bigint: true }), n = fs.lstatSync(file, { bigint: true })
      return same(directory, d) && same(directory, p) && d.isDirectory() && p.isDirectory() && !p.isSymbolicLink() &&
        same(empty, f) && same(empty, n) && f.isFile() && n.isFile() && !n.isSymbolicLink() &&
        f.nlink === 1n && n.nlink === 1n && f.size === 0n && n.size === 0n && fs.realpathSync(root) === root
    }
    if (!current()) return "REFUSED"
    // Node22/libuv: dev=volume serial LowPart; ino=FileInternalInformation.IndexNumber.
    // Native helper repeats exactly these queries; no Number/rounding bridge is used.
    const wire = await runPs(resolveWinScript("acp-history-new-empty.ps1"),
      [root, name, directory.dev.toString(), directory.ino.toString(), empty.dev.toString(), empty.ino.toString()])
    if (!enabled()) return "REFUSED"
    if (!current()) return "REFUSED"
    if (typeof wire !== "string" || Buffer.byteLength(wire, "utf8") > 64) return "UNKNOWN"
    const value: unknown = JSON.parse(wire.trim())
    return value === "INITIALIZED" || value === "REFUSED" ? value : "UNKNOWN"
  } catch { return "UNKNOWN" }
}
