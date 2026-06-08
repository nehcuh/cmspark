// Runtime path resolution — works in both dev (tsc output) and packaged (esbuild bundle) modes

import * as fs from "fs"
import * as path from "path"

let _appRoot: string | null = null

/**
 * Returns the application root directory.
 *
 * - Packaged mode: directory containing the bundled cmspark-agent.js + assets
 * - Dev mode: companion project root (one level up from dist/ or src/)
 */
export function getAppRoot(): string {
  if (_appRoot) return _appRoot

  const bundleDir = __dirname

  // Search upward for the directory containing assets/ + builtin-skills/
  const candidates = [
    bundleDir,                // Flat layout (zip package): assets/ next to .js
    path.resolve(bundleDir, ".."),  // .app bundle: .js in Resources/bin/, assets in Resources/
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "assets")) &&
        fs.existsSync(path.join(dir, "builtin-skills"))) {
      _appRoot = dir
      return _appRoot
    }
  }

  // Dev mode (tsc): __dirname is dist/ → go up to companion root
  if (fs.existsSync(path.join(bundleDir, "..", "builtin-skills"))) {
    _appRoot = path.resolve(bundleDir, "..")
    return _appRoot
  }

  // Dev mode (tsx): __dirname is src/ → go up to companion root
  if (fs.existsSync(path.join(bundleDir, "..", "..", "builtin-skills"))) {
    _appRoot = path.resolve(bundleDir, "..", "..")
    return _appRoot
  }

  // Fallback
  _appRoot = bundleDir
  return _appRoot
}

export function getSqlWasmPath(): string | undefined {
  const root = getAppRoot()
  const candidates = [
    path.join(root, "sql-wasm.wasm"),
    path.join(root, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
    path.join(process.cwd(), "sql-wasm.wasm"),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return undefined
}

export function getBuiltinSkillsSrc(): string {
  const root = getAppRoot()
  const pkg = path.join(root, "builtin-skills")
  if (fs.existsSync(pkg)) return pkg
  return path.join(root, "builtin-skills")
}

export function getAssetsDir(): string {
  return path.join(getAppRoot(), "assets")
}

export function getSwiftTrayPath(): string {
  return path.join(getAppRoot(), "cmspark-tray")
}

export function getTrayBuildScript(): string {
  const root = getAppRoot()
  // Dev: src/tray/build-tray.sh; Packaged: not available (pre-built)
  const dev = path.join(root, "src", "tray", "build-tray.sh")
  if (fs.existsSync(dev)) return dev
  return path.join(__dirname, "tray", "build-tray.sh")
}

export function getTrayCwd(): string {
  return getAppRoot()
}

/**
 * Returns the command tuple to re-spawn the companion process.
 * In packaged mode: [nodeBinary, cmspark-agent.js, ...subcommand]
 * In dev mode: [process.execPath, dist/index.js, ...subcommand]
 */
export function getSelfSpawnArgs(subcommand: string[]): { execPath: string; args: string[] } {
  const root = getAppRoot()
  const bundle = path.join(root, "cmspark-agent.js")
  if (fs.existsSync(bundle)) {
    return { execPath: process.execPath, args: [bundle, ...subcommand] }
  }
  // Dev fallback: index.js in dist
  const devEntry = path.join(root, "dist", "index.js")
  return { execPath: process.execPath, args: [devEntry, ...subcommand] }
}
