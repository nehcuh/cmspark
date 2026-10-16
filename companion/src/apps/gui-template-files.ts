// #686 fixed portable-local profile. This is admission metadata, not a file-read tool.
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"
import { TextDecoder } from "util"
import { DOMParser } from "@xmldom/xmldom"
import { parsePsJson, resolveWinScript, runPs, type PsRunner } from "../host-use/win/powershell"
import type { AppEntry } from "./types"

export const GUI_TEMPLATE_EXE_BYTES = 8546288
export const GUI_TEMPLATE_EXE_SHA256 = "c52c9ed2ec6d0b5b3f243b29f2124f98db56b6ba92bb42a9af2665709464b3cf"
const CONFIG_LIMIT = 64 * 1024
const FILE_LIMIT = 1024 * 1024
export interface GuiTemplateFileSnapshot {
  readonly canonicalExe: string
  readonly canonicalFile: string
  /** Private receipt binding only; never return to the model/config DTO. */
  readonly bindingIdentity: string
  readonly recheck: () => void
}
function refuse(): never { throw new Error("host_app template: unsupported or changed local file/profile") }
const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex")
function drivePath(value: string): boolean {
  return typeof value === "string" && value.length > 3 && value.length <= 259
    && /^[A-Za-z]:\\/.test(value) && !/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069/%!@"'<>|?*]/.test(value)
    && value.slice(3).split("\\").every(s => !!s && s !== "." && s !== ".." && !/[ .]$/.test(s) && !s.includes(":"))
}
/** No trim/expansion/normalization: reject argument/parser aliases before I/O. */
export function guiTemplateFilePathSupported(value: string): boolean {
  if (!drivePath(value) || !/^[A-Za-z]:\\[\p{L}\p{M}\p{Nd} _\-.()\[\]\\]+$/u.test(value)
    || !/\.txt$/i.test(value)) return false
  return value.slice(3).split("\\").every(s => {
    const stem = s.split(".")[0].replace(/ +$/, "")
    return !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)
  })
}
/** Only the pinned parser's session/workspace extension settings affect this admission. */
export function assertGuiTemplateProfileConfig(bytes: Buffer): void {
  if (!Buffer.isBuffer(bytes) || bytes.length > CONFIG_LIMIT) refuse()
  let xml: string
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes) } catch { refuse() }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml!) || /<\?xml[\s\S]*?encoding\s*=\s*(["'])(?!UTF-8\1)[^"']+\1/i.test(xml!)) refuse()
  let doc: ReturnType<DOMParser["parseFromString"]>
  try { doc = new DOMParser({ onError: () => refuse() }).parseFromString(xml!, "application/xml") } catch { refuse() }
  const root = doc!.documentElement
  if (!root || root.tagName !== "NotepadPlus" || root.namespaceURI) refuse()
  // Relevant nodes outside their exact parent chain are uncertain, rather than defaults.
  const groups = Array.from(root.getElementsByTagName("GUIConfigs"))
  if (groups.length > 1 || groups.some(g => g.parentNode !== root || g.namespaceURI)) refuse()
  const settings = Array.from(root.getElementsByTagName("GUIConfig"))
  const seen = new Set<string>()
  for (const setting of settings) {
    const name = setting.getAttribute("name")
    if (name !== "sessionExt" && name !== "workspaceExt") continue
    if (!groups[0] || setting.parentNode !== groups[0] || setting.namespaceURI || seen.has(name)) refuse()
    seen.add(name)
    if (setting.childNodes.length > 1) refuse()
    const node = setting.firstChild
    if (node && node.nodeType !== 3 && node.nodeType !== 4) refuse()
    const value = node?.nodeValue ?? ""
    // Do not trim or join mixed nodes: the target parser reads its first text value.
    const extension = value.startsWith(".") ? value.slice(1) : value
    if (/^txt$/i.test(extension)) refuse()
  }
}

/** Test-only explicit dependency seam; never accepted from transport/config. */
export interface GuiTemplateFileDeps {
  platform?: NodeJS.Platform
  fs?: Pick<typeof fs, "lstatSync" | "realpathSync" | "openSync" | "readSync" | "fstatSync" | "closeSync">
  runner?: PsRunner
  hashExe?: (file: string) => Promise<string>
}
// Directory entries can change while approval is open without replacing the
// directory or any approved leaf. Keep directory identity/type/permissions and
// creation time strict; file/profile metadata remains an exact snapshot.
const identity = (s: fs.BigIntStats): string => JSON.stringify((s.isDirectory()
  ? [s.dev, s.ino, s.mode, s.birthtimeNs]
  : [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs, s.birthtimeNs]).map(String))
function pathChain(value: string): string[] {
  const result: string[] = [value]
  let cursor = value
  while (true) { const parent = path.win32.dirname(cursor); if (parent === cursor) break; result.push(parent); cursor = parent }
  return result.reverse()
}
const defaultHash = async (file: string): Promise<string> => {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

export async function prepareGuiTemplateFiles(entry: AppEntry, rawFile: string, checkpoint: () => void, deps: GuiTemplateFileDeps = {}): Promise<GuiTemplateFileSnapshot> {
  checkpoint()
  // Copy config authority before first await; caller owns the event-stale latch.
  const exe = entry.exe?.path
  const expectedHash = entry.exe?.sha256
  if ((deps.platform ?? process.platform) !== "win32" || entry.kind !== "gui" || !entry.token.startsWith("win.app.")
    || entry.aumid || entry.bundleId || !exe || !drivePath(exe) || (expectedHash !== undefined && expectedHash.toLowerCase() !== GUI_TEMPLATE_EXE_SHA256)
    || !guiTemplateFilePathSupported(rawFile)) refuse()
  const io = deps.fs ?? fs
  const runner = deps.runner ?? runPs
  const checkedAwait = async <T>(operation: () => Promise<T>): Promise<T> => {
    checkpoint()
    try { const value = await operation(); checkpoint(); return value } catch (error) { checkpoint(); throw error }
  }
  // GetDriveType/reparse checks precede Node path I/O, including mapped-drive paths.
  const locality = async (exePath: string, filePath: string): Promise<readonly string[]> => {
    const raw = await checkedAwait(() => runner(resolveWinScript("apps-template-files.ps1"), ["-ExePath", exePath, "-FilePath", filePath]))
    if (Buffer.byteLength(raw, "utf8") > 4096) refuse()
    const reply = parsePsJson<{ ok?: unknown; programFiles?: unknown }>(raw, "apps-template-files")
    if (reply.ok !== true || !Array.isArray(reply.programFiles) || !reply.programFiles.length || reply.programFiles.length > 2
      || reply.programFiles.some(v => typeof v !== "string" || !drivePath(v))) refuse()
    return Object.freeze([...reply.programFiles]) as string[]
  }
  const known = await locality(exe, rawFile)
  const canonicalExe = io.realpathSync(exe).toString()
  const canonicalFile = io.realpathSync(rawFile).toString()
  if (!drivePath(canonicalExe) || !guiTemplateFilePathSupported(canonicalFile)) refuse()
  const knownAgain = await locality(canonicalExe, canonicalFile)
  if (JSON.stringify(known) !== JSON.stringify(knownAgain)) refuse()
  const folder = path.win32.dirname(canonicalExe)
  for (const root of known) {
    const normalized = root.toLowerCase().replace(/\\+$/, "")
    if (folder.toLowerCase() === normalized || folder.toLowerCase().startsWith(normalized + "\\")) refuse()
  }
  const marker = path.win32.join(folder, "doLocalConf.xml")
  const config = path.win32.join(folder, "config.xml")
  const cloud = path.win32.join(folder, "cloud")
  const choice = path.win32.join(cloud, "choice")
  const observed = new Map<string, string | null>()
  const stat = (file: string, optional = false): fs.BigIntStats | null => {
    try { const s = io.lstatSync(file, { bigint: true }); if (s.isSymbolicLink()) refuse(); return s }
    catch (error) { if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
  }
  const recordChain = (file: string, optionalLeaf = false): fs.BigIntStats | null => {
    const chain = pathChain(file)
    let leaf: fs.BigIntStats | null = null
    for (let i = 0; i < chain.length; i++) {
      leaf = stat(chain[i], optionalLeaf && i === chain.length - 1)
      if (i < chain.length - 1 && !leaf?.isDirectory()) refuse()
      observed.set(chain[i], leaf ? identity(leaf) : null)
    }
    return leaf
  }
  const exeStat = recordChain(canonicalExe)
  const fileStat = recordChain(canonicalFile)
  const markerStat = recordChain(marker)
  const configStat = recordChain(config)
  if (!exeStat?.isFile() || exeStat.size !== BigInt(GUI_TEMPLATE_EXE_BYTES) || !fileStat?.isFile() || fileStat.size > FILE_LIMIT
    || !markerStat?.isFile() || !configStat?.isFile() || configStat.size > CONFIG_LIMIT) refuse()
  const cloudStat = recordChain(cloud, true)
  if (cloudStat && (!cloudStat.isDirectory() || recordChain(choice, true))) refuse()
  // Choice below a missing cloud directory is absent; record the parent identity instead.
  const readConfig = (): Buffer => {
    const fd = io.openSync(config, "r")
    try {
      const before = io.fstatSync(fd, { bigint: true })
      if (!before.isFile() || before.size > CONFIG_LIMIT || identity(before) !== observed.get(config)) refuse()
      const buffer = Buffer.alloc(CONFIG_LIMIT + 1)
      let offset = 0
      while (offset < buffer.length) { const n = io.readSync(fd, buffer, offset, buffer.length - offset, null); if (!n) break; offset += n }
      if (offset > CONFIG_LIMIT || BigInt(offset) !== before.size || identity(io.fstatSync(fd, { bigint: true })) !== identity(before)) refuse()
      return buffer.subarray(0, offset)
    } finally { io.closeSync(fd) }
  }
  const bytes = readConfig()
  assertGuiTemplateProfileConfig(bytes)
  const configHash = sha(bytes)
  const recheck = (): void => {
    checkpoint()
    if (io.realpathSync(exe).toString() !== canonicalExe || io.realpathSync(rawFile).toString() !== canonicalFile) refuse()
    for (const [file, expected] of observed) {
      const current = stat(file, expected === null)
      if ((current ? identity(current) : null) !== expected) refuse()
    }
    if (sha(readConfig()) !== configHash) refuse()
    checkpoint()
  }
  // Stream exactly the pinned executable; final identities guard replacement while hashing.
  const actualHash = await checkedAwait(() => (deps.hashExe ?? defaultHash)(canonicalExe))
  if (actualHash !== GUI_TEMPLATE_EXE_SHA256) refuse()
  recheck()
  const bindingIdentity = sha(JSON.stringify([canonicalExe, canonicalFile, [...observed], configHash, actualHash]))
  return Object.freeze({ canonicalExe, canonicalFile, bindingIdentity, recheck })
}
