/**
 * Path B — download/install cmspark-whisper runtime binary (not model weights).
 * HTTPS + sha256 + atomic install. Zip (Windows) or multi-file (future arches).
 */

import { createHash } from "node:crypto"
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import path from "node:path"
import { execFileSync } from "node:child_process"
import * as os from "node:os"

import { DATA_DIR } from "../config"
import {
  defaultWhisperBinaryInstallDir,
  resolveWhisperArch,
  writeUserWhisperInstallManifest,
  type WhisperArch,
} from "./binary-resolve"
import {
  getWhisperBinaryArchEntry,
  loadWhisperBinaryManifest,
  primaryWhisperBinaryDest,
  primaryWhisperBinarySha256,
  type WhisperBinaryArchEntry,
  type WhisperBinaryManifest,
} from "./whisper-binary-manifest"
import { expectedWhisperSha256 } from "./whisper-binary-pins"

export { defaultWhisperBinaryInstallDir }

export type WhisperBinaryDownloadReason =
  | "unsupported_arch"
  | "manifest-missing"
  | "manifest-invalid"
  | "http-error"
  | "network-error"
  | "hash-mismatch"
  | "size-mismatch"
  | "extract-failed"
  | "scheme-denied"
  | "aborted"
  | "already-ready"
  | "pin-mismatch"

export class WhisperBinaryDownloadError extends Error {
  readonly reason: WhisperBinaryDownloadReason
  constructor(reason: WhisperBinaryDownloadReason, message: string) {
    super(message)
    this.name = "WhisperBinaryDownloadError"
    this.reason = reason
  }
}

export type WhisperBinaryDownloadProgress = {
  phase: "download" | "extract" | "verify"
  receivedBytes: number
  totalBytes: number
  file?: string
}

export type WhisperBinaryDownloadOpts = {
  arch?: WhisperArch | string
  /** Install directory (defaults to user cache). */
  destDir?: string
  signal?: AbortSignal
  onProgress?: (p: WhisperBinaryDownloadProgress) => void
  fetchImpl?: typeof fetch
  manifest?: WhisperBinaryManifest
  dataDir?: string
  /** Skip re-download when primary exe already matches pin+files. */
  skipIfReady?: boolean
}

export function packagingWhisperBinaryDir(companionRoot: string): string {
  return path.join(companionRoot, "dist", "bin")
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest("hex")
}

function sha256FileSync(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

/** Probe install dir readiness against manifest extract/files pins. */
export function probeWhisperBinaryInstall(
  destDir: string,
  arch: string,
  manifest?: WhisperBinaryManifest,
): { status: "ready" | "absent" | "incomplete"; message?: string; primaryPath?: string } {
  let entry: WhisperBinaryArchEntry | null
  try {
    entry = getWhisperBinaryArchEntry(arch, manifest ?? loadWhisperBinaryManifest())
  } catch (err) {
    return {
      status: "absent",
      message: err instanceof Error ? err.message : String(err),
    }
  }
  if (!entry) {
    return { status: "absent", message: `no binary manifest entry for ${arch}` }
  }
  const primary = primaryWhisperBinaryDest(arch, entry)
  const primaryPath = path.join(destDir, primary)
  if (!existsSync(primaryPath)) {
    return { status: "absent", message: `missing ${primary}` }
  }

  const files =
    entry.kind === "zip"
      ? entry.extract.files.map((f) => ({ name: f.dest, sha256: f.sha256, size: f.size }))
      : entry.files.map((f) => ({ name: f.name, sha256: f.sha256, size: f.size }))

  for (const f of files) {
    const p = path.join(destDir, f.name)
    if (!existsSync(p)) {
      return { status: "incomplete", message: `missing ${f.name}`, primaryPath }
    }
    try {
      const st = statSync(p)
      if (st.size !== f.size) {
        return {
          status: "incomplete",
          message: `size mismatch ${f.name}: ${st.size} != ${f.size}`,
          primaryPath,
        }
      }
      const digest = sha256FileSync(p)
      if (digest !== f.sha256) {
        return {
          status: "incomplete",
          message: `hash mismatch ${f.name}`,
          primaryPath,
        }
      }
    } catch (err) {
      return {
        status: "incomplete",
        message: err instanceof Error ? err.message : String(err),
        primaryPath,
      }
    }
  }

  // Cross-check pin matrix when present
  const pin = expectedWhisperSha256(arch)
  if (pin) {
    const digest = sha256FileSync(primaryPath)
    if (digest !== pin) {
      return {
        status: "incomplete",
        message: `primary pin mismatch for ${arch}`,
        primaryPath,
      }
    }
  }

  return { status: "ready", primaryPath }
}

async function downloadToFile(
  url: string,
  destPath: string,
  expectedSize: number,
  expectedSha256: string,
  opts: {
    signal?: AbortSignal
    onProgress?: WhisperBinaryDownloadOpts["onProgress"]
    fetchImpl?: typeof fetch
  },
): Promise<void> {
  if (!url.startsWith("https://")) {
    throw new WhisperBinaryDownloadError("scheme-denied", `refusing non-https url: ${url}`)
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(url, { signal: opts.signal, redirect: "follow" })
  } catch (err) {
    if (opts.signal?.aborted) {
      throw new WhisperBinaryDownloadError("aborted", "download aborted")
    }
    throw new WhisperBinaryDownloadError(
      "network-error",
      err instanceof Error ? err.message : String(err),
    )
  }
  if (!res.ok || !res.body) {
    throw new WhisperBinaryDownloadError(
      "http-error",
      `HTTP ${res.status} for ${url}`,
    )
  }
  await mkdir(path.dirname(destPath), { recursive: true })
  const partPath = `${destPath}.part`
  const hash = createHash("sha256")
  let received = 0
  const ws = createWriteStream(partPath)
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream)
  body.on("data", (chunk: Buffer) => {
    received += chunk.length
    hash.update(chunk)
    opts.onProgress?.({
      phase: "download",
      receivedBytes: received,
      totalBytes: expectedSize,
      file: path.basename(destPath),
    })
  })
  try {
    await pipeline(body, ws)
  } catch (err) {
    try {
      rmSync(partPath, { force: true })
    } catch {
      /* ignore */
    }
    if (opts.signal?.aborted) {
      throw new WhisperBinaryDownloadError("aborted", "download aborted")
    }
    throw new WhisperBinaryDownloadError(
      "network-error",
      err instanceof Error ? err.message : String(err),
    )
  }
  if (received !== expectedSize) {
    try {
      rmSync(partPath, { force: true })
    } catch {
      /* ignore */
    }
    throw new WhisperBinaryDownloadError(
      "size-mismatch",
      `downloaded ${received} bytes, expected ${expectedSize}`,
    )
  }
  const digest = hash.digest("hex")
  if (digest !== expectedSha256) {
    try {
      rmSync(partPath, { force: true })
    } catch {
      /* ignore */
    }
    throw new WhisperBinaryDownloadError(
      "hash-mismatch",
      `sha256 mismatch for ${path.basename(destPath)}`,
    )
  }
  await rename(partPath, destPath)
}

function extractZipWithTar(zipPath: string, outDir: string): void {
  mkdirSync(outDir, { recursive: true })
  try {
    execFileSync("tar", ["-xf", zipPath, "-C", outDir], {
      stdio: "pipe",
      windowsHide: true,
    })
  } catch (err) {
    throw new WhisperBinaryDownloadError(
      "extract-failed",
      `tar extract failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

function findExtractedFile(root: string, relativeSrc: string, stripPrefix: string): string | null {
  const normalized = relativeSrc.replace(/\\/g, "/")
  const withPrefix = (stripPrefix + normalized).replace(/\\/g, "/").replace(/^\/+/, "")
  const direct = path.join(root, ...withPrefix.split("/"))
  if (existsSync(direct)) return direct
  // Fallback: walk for basename match under stripPrefix folder
  const base = path.basename(normalized)
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = path.join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (name === base) return full
    }
  }
  return null
}

async function installFromZip(
  entry: Extract<WhisperBinaryArchEntry, { kind: "zip" }>,
  destDir: string,
  opts: WhisperBinaryDownloadOpts,
): Promise<string> {
  const tmpRoot = path.join(os.tmpdir(), `cmspark-whisper-bin-${process.pid}-${Date.now()}`)
  mkdirSync(tmpRoot, { recursive: true })
  const zipPath = path.join(tmpRoot, "payload.zip")
  const extractDir = path.join(tmpRoot, "extract")
  try {
    await downloadToFile(entry.url, zipPath, entry.size, entry.sha256, {
      signal: opts.signal,
      onProgress: opts.onProgress,
      fetchImpl: opts.fetchImpl,
    })
    opts.onProgress?.({ phase: "extract", receivedBytes: 0, totalBytes: entry.extract.files.length })
    extractZipWithTar(zipPath, extractDir)

    await mkdir(destDir, { recursive: true })
    const staging = path.join(destDir, ".install-staging")
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })

    let i = 0
    for (const f of entry.extract.files) {
      i++
      opts.onProgress?.({
        phase: "extract",
        receivedBytes: i,
        totalBytes: entry.extract.files.length,
        file: f.dest,
      })
      const found = findExtractedFile(extractDir, f.src, entry.extract.stripPrefix || "")
      if (!found) {
        throw new WhisperBinaryDownloadError("extract-failed", `zip missing ${f.src}`)
      }
      const buf = readFileSync(found)
      if (buf.length !== f.size) {
        throw new WhisperBinaryDownloadError(
          "size-mismatch",
          `extracted ${f.src} size ${buf.length} != ${f.size}`,
        )
      }
      const digest = createHash("sha256").update(buf).digest("hex")
      if (digest !== f.sha256) {
        throw new WhisperBinaryDownloadError("hash-mismatch", `extracted ${f.src} hash mismatch`)
      }
      writeFileSync(path.join(staging, f.dest), buf)
    }

    // Promote staging → dest (overwrite)
    for (const f of entry.extract.files) {
      const from = path.join(staging, f.dest)
      const to = path.join(destDir, f.dest)
      try {
        rmSync(to, { force: true })
      } catch {
        /* ignore */
      }
      renameSync(from, to)
    }
    rmSync(staging, { recursive: true, force: true })

    const primaryName = primaryWhisperBinaryDest(opts.arch ?? resolveWhisperArch(), entry)
    const primary = path.join(destDir, primaryName)
    opts.onProgress?.({
      phase: "verify",
      receivedBytes: 1,
      totalBytes: 1,
      file: path.basename(primary),
    })
    return primary
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

async function installFromFiles(
  entry: Extract<WhisperBinaryArchEntry, { kind: "file" }>,
  destDir: string,
  opts: WhisperBinaryDownloadOpts,
): Promise<string> {
  await mkdir(destDir, { recursive: true })
  const staging = path.join(destDir, ".install-staging")
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    for (const f of entry.files) {
      await downloadToFile(f.url, path.join(staging, f.name), f.size, f.sha256, {
        signal: opts.signal,
        onProgress: opts.onProgress,
        fetchImpl: opts.fetchImpl,
      })
    }
    for (const f of entry.files) {
      const from = path.join(staging, f.name)
      const to = path.join(destDir, f.name)
      try {
        rmSync(to, { force: true })
      } catch {
        /* ignore */
      }
      renameSync(from, to)
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  return path.join(destDir, primaryWhisperBinaryDest(opts.arch ?? resolveWhisperArch(), entry))
}

/**
 * macOS: stage cmspark-whisper from Homebrew whisper-cli + sibling dylibs.
 * Official zip auto-download is Windows-only; Darwin needs dynamic libs.
 */
export function installWhisperFromBrewDarwin(opts: {
  arch: string
  destDir: string
  signal?: AbortSignal
  onProgress?: (p: WhisperBinaryDownloadProgress) => void
}): { primaryPath: string; destDir: string; arch: string; version: string } {
  if (opts.signal?.aborted) {
    throw new WhisperBinaryDownloadError("aborted", "aborted")
  }
  const candidates = [
    process.env.CMSPARK_WHISPER_SRC,
    "/opt/homebrew/bin/whisper-cli",
    "/usr/local/bin/whisper-cli",
  ].filter((p): p is string => typeof p === "string" && p.length > 0)

  let src: string | null = null
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) {
        src = c
        break
      }
    } catch {
      /* continue */
    }
  }
  // Also try PATH via which
  if (!src) {
    try {
      const out = execFileSync("which", ["whisper-cli"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
      if (out && existsSync(out)) src = out
    } catch {
      /* no brew */
    }
  }
  if (!src) {
    throw new WhisperBinaryDownloadError(
      "unsupported_arch",
      "macOS 无在线组件包：请 brew install whisper-cpp 后重试「下载本机听写组件」，或使用 DMG 安装包内置组件",
    )
  }

  opts.onProgress?.({
    phase: "extract",
    receivedBytes: 0,
    totalBytes: 1,
    file: path.basename(src),
  })

  const destDir = path.resolve(opts.destDir)
  mkdirSync(destDir, { recursive: true, mode: 0o755 })
  const primaryName =
    opts.arch === "darwin-x64"
      ? "cmspark-whisper-darwin-x64"
      : "cmspark-whisper-darwin-arm64"
  const primaryPath = path.join(destDir, primaryName)
  // Realpath brew Cellar binary
  let realSrc = src
  try {
    realSrc = realpathSync(src)
  } catch {
    realSrc = src
  }
  writeFileSync(primaryPath, readFileSync(realSrc))
  try {
    execFileSync("chmod", ["+x", primaryPath])
  } catch {
    /* best-effort */
  }

  // Copy dylibs next to binary (@loader_path/...)
  const libDirs: string[] = []
  try {
    const whisperPrefix = execFileSync("brew", ["--prefix", "whisper-cpp"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (whisperPrefix) libDirs.push(path.join(whisperPrefix, "lib"))
  } catch {
    /* */
  }
  try {
    const ggmlPrefix = execFileSync("brew", ["--prefix", "ggml"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (ggmlPrefix) libDirs.push(path.join(ggmlPrefix, "lib"))
  } catch {
    /* */
  }
  libDirs.push("/opt/homebrew/lib", "/usr/local/lib")

  const copied = new Set<string>()
  for (const dir of libDirs) {
    if (!existsSync(dir)) continue
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!/^lib(whisper|ggml)/.test(name) || !name.endsWith(".dylib")) continue
      const from = path.join(dir, name)
      try {
        // follow symlink to real file once
        let real = from
        try {
          real = realpathSync(from)
        } catch {
          real = from
        }
        if (!statSync(real).isFile()) continue
        const base = path.basename(real)
        if (copied.has(base)) continue
        writeFileSync(path.join(destDir, base), readFileSync(real))
        copied.add(base)
        // soname shortcuts expected by install_name_tool rewrites / otool
        const sonames: string[] = []
        if (base.startsWith("libwhisper.")) sonames.push("libwhisper.1.dylib", "libwhisper.dylib")
        if (/^libggml\.[0-9]/.test(base)) sonames.push("libggml.0.dylib", "libggml.dylib")
        if (/^libggml-base\.[0-9]/.test(base))
          sonames.push("libggml-base.0.dylib", "libggml-base.dylib")
        for (const sn of sonames) {
          try {
            writeFileSync(path.join(destDir, sn), readFileSync(real))
          } catch {
            /* */
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  // Rewrite install names to @loader_path (same directory)
  try {
    const otool = execFileSync("otool", ["-L", primaryPath], { encoding: "utf8" })
    for (const line of otool.split("\n").slice(1)) {
      const dep = line.trim().split(/\s+/)[0]
      if (!dep || dep.startsWith("/usr/lib") || dep.startsWith("/System")) continue
      const depBase = path.basename(dep)
      if (existsSync(path.join(destDir, depBase))) {
        try {
          execFileSync(
            "install_name_tool",
            ["-change", dep, `@loader_path/${depBase}`, primaryPath],
            { stdio: "ignore" },
          )
        } catch {
          /* */
        }
      }
    }
    for (const name of readdirSync(destDir)) {
      if (!name.endsWith(".dylib")) continue
      const lib = path.join(destDir, name)
      try {
        execFileSync("install_name_tool", ["-id", `@loader_path/${name}`, lib], {
          stdio: "ignore",
        })
      } catch {
        /* */
      }
      try {
        const lotool = execFileSync("otool", ["-L", lib], { encoding: "utf8" })
        for (const line of lotool.split("\n").slice(1)) {
          const dep = line.trim().split(/\s+/)[0]
          if (!dep || dep.startsWith("/usr/lib") || dep.startsWith("/System")) continue
          if (dep.startsWith("@loader_path/")) continue
          const depBase = path.basename(dep)
          if (existsSync(path.join(destDir, depBase))) {
            try {
              execFileSync(
                "install_name_tool",
                ["-change", dep, `@loader_path/${depBase}`, lib],
                { stdio: "ignore" },
              )
            } catch {
              /* */
            }
          }
        }
      } catch {
        /* */
      }
    }
  } catch {
    /* install_name_tool optional if already linked */
  }

  opts.onProgress?.({
    phase: "verify",
    receivedBytes: 1,
    totalBytes: 1,
    file: primaryName,
  })

  // Smoke: binary must at least spawn (help may print backends to stderr)
  try {
    execFileSync(primaryPath, ["-h"], {
      cwd: destDir,
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // -h often exits non-zero after printing help; dyld failures include "Library not loaded"
    if (/Library not loaded|image not found|dyld/i.test(msg)) {
      throw new WhisperBinaryDownloadError(
        "extract-failed",
        `brew 组件安装后仍无法加载动态库：${msg}`,
      )
    }
  }

  writeUserWhisperInstallManifest(destDir, primaryName, "brew-whisper-cpp")

  return {
    primaryPath,
    destDir,
    arch: opts.arch,
    version: "brew-whisper-cpp",
  }
}

/**
 * Download + install whisper runtime for arch into destDir.
 * Returns absolute path to primary cmspark-whisper binary.
 */
export async function downloadWhisperBinary(
  opts: WhisperBinaryDownloadOpts = {},
): Promise<{ primaryPath: string; destDir: string; arch: string; version: string }> {
  const arch = opts.arch ?? resolveWhisperArch()
  if (arch === "unsupported") {
    throw new WhisperBinaryDownloadError("unsupported_arch", "whisper binary not available for this platform")
  }

  let manifest: WhisperBinaryManifest
  try {
    manifest = opts.manifest ?? loadWhisperBinaryManifest()
  } catch (err) {
    throw new WhisperBinaryDownloadError(
      "manifest-missing",
      err instanceof Error ? err.message : String(err),
    )
  }

  const entry = getWhisperBinaryArchEntry(arch, manifest)
  if (!entry) {
    // macOS: no GitHub auto-zip (dylib rpath). Install from Homebrew whisper-cli + libs.
    if (arch === "darwin-arm64" || arch === "darwin-x64") {
      return installWhisperFromBrewDarwin({
        arch,
        destDir:
          opts.destDir ??
          defaultWhisperBinaryInstallDir(arch, opts.dataDir ?? DATA_DIR),
        signal: opts.signal,
        onProgress: opts.onProgress,
      })
    }
    throw new WhisperBinaryDownloadError(
      "unsupported_arch",
      `no auto-download manifest entry for ${arch} (install via package or brew)`,
    )
  }

  const destDir =
    opts.destDir ??
    defaultWhisperBinaryInstallDir(arch, opts.dataDir ?? DATA_DIR)

  if (opts.skipIfReady !== false) {
    const probe = probeWhisperBinaryInstall(destDir, arch, manifest)
    if (probe.status === "ready" && probe.primaryPath) {
      return {
        primaryPath: probe.primaryPath,
        destDir,
        arch,
        version: entry.version,
      }
    }
  }

  // Pin matrix must match manifest primary (fail closed if both set and diverge)
  const pin = expectedWhisperSha256(arch)
  const manifestPrimary = primaryWhisperBinarySha256(arch, entry)
  if (pin && pin !== manifestPrimary) {
    throw new WhisperBinaryDownloadError(
      "pin-mismatch",
      `whisper-binary-pins.ts (${pin.slice(0, 12)}…) != manifest primary (${manifestPrimary.slice(0, 12)}…) for ${arch}`,
    )
  }

  let primaryPath: string
  if (entry.kind === "zip") {
    primaryPath = await installFromZip(entry, destDir, opts)
  } else {
    primaryPath = await installFromFiles(entry, destDir, opts)
  }

  const probe = probeWhisperBinaryInstall(destDir, arch, manifest)
  if (probe.status !== "ready" || !probe.primaryPath) {
    throw new WhisperBinaryDownloadError(
      "extract-failed",
      probe.message || "install probe failed after download",
    )
  }

  // Write small marker for UI/debug
  try {
    await writeFile(
      path.join(destDir, "INSTALL.json"),
      JSON.stringify(
        {
          arch,
          version: entry.version,
          installedAt: new Date().toISOString(),
          primary: path.basename(probe.primaryPath),
        },
        null,
        2,
      ),
      "utf8",
    )
  } catch {
    /* best-effort */
  }

  return {
    primaryPath: probe.primaryPath,
    destDir,
    arch,
    version: entry.version,
  }
}
