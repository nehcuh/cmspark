// Build/stage only: SDK-typed UIA action DLL. No native execution at import or runtime build.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { desktopWindowsToolchain } from "./build-desktop-windows.mjs"

const basename = "computer-uia-no-focus.dll"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export function computerUiaNoFocusCompilePlan({ cl, root, output }) {
  const p = path.win32
  return [cl, ["/nologo", "/std:c++20", "/EHsc", "/utf-8", "/W4", "/WX", "/MT", "/LD", "/DUNICODE", "/D_UNICODE",
    p.join(root, "src/host-use/win/native/computer-uia-no-focus.cpp"), "/link", "/MACHINE:X64",
    "ole32.lib", "oleaut32.lib", "user32.lib", "uiautomationcore.lib", `/OUT:${p.join(output, basename)}`]]
}
function regular(file) {
  const value = fs.lstatSync(file)
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1) throw new Error("UIA_NO_FOCUS_FILE")
}
function directory(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const value = fs.lstatSync(dir)
  if (!value.isDirectory() || value.isSymbolicLink()) throw new Error("UIA_NO_FOCUS_DIRECTORY")
}
export function stageComputerUiaNoFocus(source, destination) {
  if (!path.isAbsolute(source) || !path.isAbsolute(destination) || path.basename(source) !== basename) throw new Error("UIA_NO_FOCUS_FILE")
  regular(source)
  directory(destination)
  const target = path.join(destination, basename)
  if (path.resolve(source) === path.resolve(target)) return
  try { regular(target); fs.unlinkSync(target) } catch (error) { if (error.code !== "ENOENT") throw error }
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  regular(target)
}
export function buildComputerUiaNoFocus({ root: sourceRoot = root, toolchain } = {}) {
  // Deliberate reproducible-build pin: the desktop SDK/header inputs and CI use 22.23.4.
  // This is a build-tool policy, not a runtime UIA requirement for all Node22 patches.
  if (process.platform !== "win32" || process.arch !== "x64" || process.version !== "v22.23.4") throw new Error("UIA_NO_FOCUS_BUILD_REQUIRES_WINDOWS_X64_NODE22_23_4")
  const source = path.join(sourceRoot, "src/host-use/win/native/computer-uia-no-focus.cpp")
  regular(source)
  const { cl, env } = toolchain ?? desktopWindowsToolchain()
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-uia-build-"))
  try {
    const [binary, args] = computerUiaNoFocusCompilePlan({ cl, root: sourceRoot, output })
    const result = spawnSync(binary, args, { env, cwd: output, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })
    if (result.error || result.status !== 0) {
      process.stderr.write(`${result.stdout || ""}${result.stderr || ""}`)
      throw new Error("UIA_NO_FOCUS_BUILD_FAILED")
    }
    stageComputerUiaNoFocus(path.join(output, basename), path.join(sourceRoot, "dist/host-scripts-win"))
  } finally { fs.rmSync(output, { recursive: true, force: true }) }
}
export function parseComputerUiaNoFocusArgs(args) {
  if (args.length === 0) return { mode: "build" }
  if (args.length === 2 && args[0] === "--stage" && path.isAbsolute(args[1])) return { mode: "stage", destination: args[1] }
  throw new Error("UIA_NO_FOCUS_BUILD_ARGS")
}
// Realpath binding prevents a test/import/substring argv from triggering compilation.
let direct = false
try { direct = !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)) } catch { /* import has no CLI entry */ }
if (direct) {
  const action = parseComputerUiaNoFocusArgs(process.argv.slice(2))
  if (action.mode === "stage") stageComputerUiaNoFocus(path.join(root, "dist/host-scripts-win", basename), action.destination)
  else buildComputerUiaNoFocus()
}
