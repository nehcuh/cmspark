#!/usr/bin/env node
/**
 * Fetch cmspark-whisper runtime into companion/dist/bin (or --dest).
 * Used by build-windows-exe.ps1 / package.sh when local binary is missing.
 *
 * Usage:
 *   node companion/scripts/fetch-whisper-binary.mjs
 *   node companion/scripts/fetch-whisper-binary.mjs --arch win-x64 --dest companion/dist/bin
 *   node companion/scripts/fetch-whisper-binary.mjs --force
 *
 * Env:
 *   CMSPARK_WHISPER_AUTO_FETCH=0  — exit 2 without downloading (packaging opt-out)
 */
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const companionRoot = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url)

// Prefer compiled JS under dist when present (after tsc); else tsx/register not available —
// packaging always runs after tsc in build-windows-exe.ps1.
async function loadDownloadModule() {
  const distJs = path.join(companionRoot, "dist", "voice", "whisper-binary-download.js")
  if (existsSync(distJs)) {
    return require(distJs)
  }
  // Dev: try ts via dynamic import of source through ts-node if registered
  try {
    return require(path.join(companionRoot, "src", "voice", "whisper-binary-download.ts"))
  } catch {
    console.error(
      "[fetch-whisper-binary] ERROR: compile companion first (npx tsc) so dist/voice/whisper-binary-download.js exists",
    )
    process.exit(1)
  }
}

function parseArgs(argv) {
  const out = { arch: null, dest: null, stage: null, force: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--arch" && argv[i + 1]) out.arch = argv[++i]
    else if (a === "--dest" && argv[i + 1]) out.dest = argv[++i]
    else if (a === "--stage" && argv[i + 1]) out.stage = argv[++i]
    else if (a === "--force") out.force = true
    else if (a === "-h" || a === "--help") {
      console.log(`Usage: node fetch-whisper-binary.mjs [--arch win-x64] [--dest DIR] [--stage DIR] [--force]`)
      process.exit(0)
    }
  }
  if (!out.dest) {
    out.dest = path.join(companionRoot, "dist", "bin")
  }
  if (!out.arch) {
    const { resolveWhisperArch } = require(path.join(companionRoot, "dist", "voice", "binary-resolve.js"))
    out.arch = resolveWhisperArch()
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { downloadWhisperBinary, probeWhisperBinaryInstall } = await loadDownloadModule()
  const { loadWhisperBinaryManifest } = require(
    path.join(companionRoot, "dist", "voice", "whisper-binary-manifest.js"),
  )

  const manifest = loadWhisperBinaryManifest(path.join(companionRoot, "assets", "whisper-binary.manifest.json"))
  const entry = manifest.binaries[args.arch]
  if (!entry) throw new Error(`no Whisper binary manifest entry for ${args.arch}`)
  function stageFiles() {
    if (!args.stage) return
    mkdirSync(args.stage, { recursive: true })
    const names = entry.kind === "file" ? entry.files.map(f => f.name) : entry.extract.files.map(f => f.dest)
    for (const name of names) copyFileSync(path.join(args.dest, name), path.join(args.stage, name))
  }

  mkdirSync(args.dest, { recursive: true })
  if (!args.force && probeWhisperBinaryInstall(args.dest, args.arch, manifest).status === "ready") {
    stageFiles()
    console.log(`[fetch-whisper-binary] already ready: ${args.arch}`)
    return
  }
  if (process.env.CMSPARK_WHISPER_AUTO_FETCH === "0") {
    console.error("[fetch-whisper-binary] verified runtime missing and automatic download disabled")
    process.exit(2)
  }

  console.log(`[fetch-whisper-binary] arch=${args.arch} dest=${args.dest}`)
  const result = await downloadWhisperBinary({
    arch: args.arch,
    destDir: args.dest,
    skipIfReady: !args.force,
    bundledArchivePath: args.arch === "win-arm64"
      ? path.join(companionRoot, "vendor", "whisper", path.basename(new URL(entry.url).pathname))
      : undefined,
    onProgress: (p) => {
      if (p.phase === "download" && p.totalBytes > 0) {
        const pct = Math.min(100, Math.floor((100 * p.receivedBytes) / p.totalBytes))
        if (pct % 20 === 0) {
          process.stdout.write(`\r[fetch-whisper-binary] download ${pct}%`)
        }
      }
    },
  })
  stageFiles()
  console.log("")
  console.log(`[fetch-whisper-binary] OK primary=${result.primaryPath}`)
  console.log(`[fetch-whisper-binary] version=${result.version}`)
}

main().catch((err) => {
  console.error("[fetch-whisper-binary] ERROR:", err?.message || err)
  process.exit(1)
})
