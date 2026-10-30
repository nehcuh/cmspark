#!/usr/bin/env node
/**
 * Shared esbuild entry — SoT: esbuild-bundle-args.json
 * Used by package.json bundle:exe; package.sh / build-windows-exe.ps1 should
 * invoke the same externals list (or this script).
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, mkdtempSync, rmSync, rmdirSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { desktopIntegrity } from "./desktop-artifacts.mjs"
import { assertTrayBundleGraph, trayBuildDefines, verifyTrayPackage } from "./swift-tray-package-pin.mjs"
import { assertFreshTraySource } from "./swift-tray-source-freshness.mjs"
import { verifyWhisperPin } from "./whisper-pin-bundle-proof.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const companionRoot = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url)
const argsJson = require("./esbuild-bundle-args.json")

const externals = Array.isArray(argsJson.externals) ? argsJson.externals : []
const platform = argsJson.platform || "node"
const target = argsJson.target || "node22"

const requested = process.argv.slice(2)
const whisperVerification = requested.length === 1 && ["--verify-whisper-macos-arm64", "--verify-whisper-macos-x64"].includes(requested[0])
const whisperArch = whisperVerification ? requested[0].slice("--verify-whisper-macos-".length) : null
const packageTray = whisperVerification ? (whisperArch === "arm64" ? ["--packaged-macos-arm64-tray"] : []) : requested
const verifyStaging = packageTray[0] === "--verify-macos-arm64-tray"
if (packageTray.length && (packageTray.length !== 1 || !["--packaged-macos-arm64-tray", "--verify-macos-arm64-tray"].includes(packageTray[0]))) {
  throw new Error("Unrecognized bundle arguments")
}
if (packageTray.length && (process.platform !== "darwin" || process.arch !== "arm64")) {
  throw new Error("Packaged Swift tray requires macOS ARM64")
}
if (whisperVerification && (process.platform !== "darwin" || process.arch !== whisperArch)) {
  throw new Error("Whisper bundle verification requires the target macOS architecture")
}
if (packageTray.length) {
  const typescript = require("typescript")
  const tsconfig = path.join(companionRoot, "tsconfig.json")
  const config = typescript.readConfigFile(tsconfig, typescript.sys.readFile)
  if (config.error) throw new Error("TRAY_TSCONFIG_INVALID")
  const parsed = typescript.parseJsonConfigFileContent(config.config, typescript.sys, companionRoot)
  if (parsed.errors.length) throw new Error("TRAY_TSCONFIG_INVALID")
  const sourceFile = path.join(companionRoot, "src", "tray", "swift-tray-bridge.ts")
  const compiledFile = path.join(companionRoot, "dist", "tray", "swift-tray-bridge.js")
  assertFreshTraySource({ typescript, source: readFileSync(sourceFile, "utf8"),
    compiled: readFileSync(compiledFile, "utf8"), compilerOptions: parsed.options, fileName: sourceFile })
}
const staging = path.resolve(companionRoot, "..", "dist-package", "cmspark-macos-arm64")
const trayPath = verifyStaging ? path.join(staging, "cmspark-tray") : path.join(companionRoot, "dist", "cmspark-tray")
const trayDefines = packageTray.length ? trayBuildDefines(readFileSync(trayPath)) : {}

let desktopDefinition = "undefined"
if (["darwin", "win32"].includes(process.platform)) {
  const source = path.join(companionRoot, "dist", "desktop-native")
  const expected = JSON.parse(readFileSync(path.join(source, "integrity.json"), "utf8"))
  if (JSON.stringify(desktopIntegrity(source)) !== JSON.stringify(expected)) throw new Error("Desktop native artifacts changed after final signing")
  desktopDefinition = JSON.stringify(expected)
}
const argv = [
  path.join(companionRoot, "dist", "index.js"),
  "--bundle",
  `--define:__CMSPARK_DESKTOP_INTEGRITY__=${desktopDefinition}`,
  ...Object.entries(trayDefines).map(([key, value]) => `--define:${key}=${value}`),
  `--platform=${platform}`,
  `--target=${target}`,
  ...externals.map((e) => `--external:${e}`),
  `--outfile=${path.join(companionRoot, "dist", "cmspark-agent.js")}`,
]

/**
 * Resolve the esbuild CLI in a way that works on both Unix and Windows.
 *
 * - Unix (esbuild ≥0.25): `node_modules/esbuild/bin/esbuild` is a native
 *   Mach-O/ELF. Spawning it via `node` throws SyntaxError.
 * - Windows: that same path is a Node JS wrapper (no .exe). `spawnSync` of
 *   an extensionless file is ENOENT. The PE lives at
 *   `node_modules/@esbuild/win32-<arch>/esbuild.exe`.
 */
function resolveEsbuildSpawn() {
  const wrapper = path.join(companionRoot, "node_modules", "esbuild", "bin", "esbuild")
  const winArch = process.arch === "ia32" ? "ia32" : process.arch
  const winExe = path.join(
    companionRoot,
    "node_modules",
    `@esbuild/win32-${winArch}`,
    "esbuild.exe",
  )

  if (process.platform === "win32" && existsSync(winExe)) {
    return { command: winExe, args: argv }
  }

  if (!existsSync(wrapper)) {
    throw new Error(
      `esbuild not found at ${wrapper} (run npm install in companion/)`,
    )
  }

  // Shebang (`#!`) ⇒ JS wrapper; otherwise treat as a native binary.
  const head = readFileSync(wrapper).subarray(0, 2)
  const isJsWrapper = head.length >= 2 && head[0] === 0x23 && head[1] === 0x21
  if (isJsWrapper) {
    return { command: process.execPath, args: [wrapper, ...argv] }
  }
  return { command: wrapper, args: argv }
}

let spawnSpec
try {
  spawnSpec = resolveEsbuildSpawn()
} catch (err) {
  console.error("[run-esbuild-bundle] failed to resolve esbuild:", err instanceof Error ? err.message : err)
  process.exit(1)
}

// A private metadata path belongs only to this invocation. The graph check and
// literal comparison are build-time controls, not a runtime trust sidecar.
const metadataDir = packageTray.length || whisperVerification ? mkdtempSync(path.join(tmpdir(), "cmspark-tray-bundle-")) : null
const metadataFile = metadataDir ? path.join(metadataDir, "meta.json") : null
const outputFile = (verifyStaging || whisperVerification) && metadataDir ? path.join(metadataDir, "cmspark-agent.js") : path.join(companionRoot, "dist", "cmspark-agent.js")
let exitCode
try {
  if (verifyStaging || whisperVerification) {
    const outputArg = spawnSpec.args.findIndex(arg => arg.startsWith("--outfile="))
    if (outputArg < 0) throw new Error("TRAY_BUNDLE_OUTPUT_MISSING")
    spawnSpec.args[outputArg] = `--outfile=${outputFile}`
  }
  if (metadataFile) spawnSpec.args.push(`--metafile=${metadataFile}`)
  const r = spawnSync(spawnSpec.command, spawnSpec.args, { cwd: companionRoot, stdio: "inherit" })
  if (r.error) console.error("[run-esbuild-bundle] failed to spawn esbuild:", r.error.message)
  exitCode = r.error ? 1 : (r.status ?? 1)
  if (exitCode === 0 && metadataFile) {
    const metafile = JSON.parse(readFileSync(metadataFile, "utf8"))
    const outputKey = path.relative(companionRoot, outputFile).split(path.sep).join("/")
    const bundleBytes = readFileSync(outputFile)
    if (packageTray.length) {
      assertTrayBundleGraph(metafile, outputKey, "dist/tray/swift-tray-bridge.js")
      verifyTrayPackage(bundleBytes, readFileSync(trayPath))
      if (verifyStaging && !bundleBytes.equals(readFileSync(path.join(staging, "cmspark-agent.js")))) {
        throw new Error("TRAY_STAGING_BUNDLE_MISMATCH")
      }
    }
    if (whisperVerification) {
      const pin = verifyWhisperPin({ typescript: require("typescript"), root: companionRoot, metafile,
        bundle: readFileSync(path.join(companionRoot, "dist", "cmspark-agent.js")), replay: bundleBytes,
        arch: `darwin-${whisperArch}` })
      console.log(pin)
    }
  }
} finally {
  if (metadataFile && metadataDir) {
    rmSync(metadataFile, { force: true })
    if (verifyStaging || whisperVerification) rmSync(outputFile, { force: true })
    rmdirSync(metadataDir)
  }
}
process.exit(exitCode)
