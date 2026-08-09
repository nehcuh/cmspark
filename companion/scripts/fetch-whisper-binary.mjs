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
import { existsSync, mkdirSync } from "node:fs"

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
  const out = { arch: process.platform === "win32" ? "win-x64" : null, dest: null, force: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--arch" && argv[i + 1]) out.arch = argv[++i]
    else if (a === "--dest" && argv[i + 1]) out.dest = argv[++i]
    else if (a === "--force") out.force = true
    else if (a === "-h" || a === "--help") {
      console.log(`Usage: node fetch-whisper-binary.mjs [--arch win-x64] [--dest DIR] [--force]`)
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
  if (process.env.CMSPARK_WHISPER_AUTO_FETCH === "0") {
    console.error("[fetch-whisper-binary] CMSPARK_WHISPER_AUTO_FETCH=0 — skip")
    process.exit(2)
  }
  const args = parseArgs(process.argv.slice(2))
  const { downloadWhisperBinary, probeWhisperBinaryInstall } = await loadDownloadModule()
  const { loadWhisperBinaryManifest } = require(
    path.join(companionRoot, "dist", "voice", "whisper-binary-manifest.js"),
  )

  mkdirSync(args.dest, { recursive: true })
  if (!args.force) {
    try {
      const manifest = loadWhisperBinaryManifest(
        path.join(companionRoot, "assets", "whisper-binary.manifest.json"),
      )
      const probe = probeWhisperBinaryInstall(args.dest, args.arch, manifest)
      if (probe.status === "ready") {
        console.log(`[fetch-whisper-binary] already ready: ${probe.primaryPath}`)
        process.exit(0)
      }
    } catch {
      /* continue download */
    }
  }

  console.log(`[fetch-whisper-binary] arch=${args.arch} dest=${args.dest}`)
  const result = await downloadWhisperBinary({
    arch: args.arch,
    destDir: args.dest,
    skipIfReady: !args.force,
    onProgress: (p) => {
      if (p.phase === "download" && p.totalBytes > 0) {
        const pct = Math.min(100, Math.floor((100 * p.receivedBytes) / p.totalBytes))
        if (pct % 20 === 0) {
          process.stdout.write(`\r[fetch-whisper-binary] download ${pct}%`)
        }
      }
    },
  })
  console.log("")
  console.log(`[fetch-whisper-binary] OK primary=${result.primaryPath}`)
  console.log(`[fetch-whisper-binary] version=${result.version}`)
}

main().catch((err) => {
  console.error("[fetch-whisper-binary] ERROR:", err?.message || err)
  process.exit(1)
})
