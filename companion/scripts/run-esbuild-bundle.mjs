#!/usr/bin/env node
/**
 * Shared esbuild entry — SoT: esbuild-bundle-args.json
 * Used by package.json bundle:exe; package.sh / build-windows-exe.ps1 should
 * invoke the same externals list (or this script).
 */
import { spawnSync } from "node:child_process"
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

// esbuild ≥0.25 ships a native binary at bin/esbuild (not a JS wrapper).
// Invoking via process.execPath (node) throws SyntaxError on the Mach-O/PE.
const esbuildBin = path.join(companionRoot, "node_modules", "esbuild", "bin", "esbuild")
const r = spawnSync(esbuildBin, argv, {
  cwd: companionRoot,
  stdio: "inherit",
})
if (r.error) {
  console.error("[run-esbuild-bundle] failed to spawn esbuild:", r.error.message)
  process.exit(1)
}
process.exit(r.status ?? 1)
