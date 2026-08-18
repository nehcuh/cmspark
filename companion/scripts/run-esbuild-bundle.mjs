#!/usr/bin/env node
/**
 * Shared esbuild entry — SoT: esbuild-bundle-args.json
 * Used by package.json bundle:exe; package.sh / build-windows-exe.ps1 should
 * invoke the same externals list (or this script).
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const companionRoot = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url)
const argsJson = require("./esbuild-bundle-args.json")

const externals = Array.isArray(argsJson.externals) ? argsJson.externals : []
const platform = argsJson.platform || "node"
const target = argsJson.target || "node22"

const argv = [
  path.join(companionRoot, "dist", "index.js"),
  "--bundle",
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

const r = spawnSync(spawnSpec.command, spawnSpec.args, {
  cwd: companionRoot,
  stdio: "inherit",
})
if (r.error) {
  console.error("[run-esbuild-bundle] failed to spawn esbuild:", r.error.message)
  process.exit(1)
}
process.exit(r.status ?? 1)
