// #480 build-only SDK acquisition. No production download, installer or PATH fallback.
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"

const NODE_VERSION = "22.23.2"
const MAX_INPUT_BYTES = 32 * 1024 * 1024
const MAX_EXTRACT_BYTES = 64 * 1024 * 1024
export const DESKTOP_WINDOWS_INPUTS = Object.freeze({
  headers: Object.freeze({ url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-headers.tar.gz`,
    sha256: "daaf13ec5d45a38bbcfcff06d0723f72a6813b89ab27bb5af2ac8e1f6259dde0" }),
  nodeLib: Object.freeze({ url: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.lib`,
    sha256: "ac15f1e9d7c8279353723a77f6319967f1a41c06026521094a8234c2e6fbe052" }),
  webview: Object.freeze({ url: "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4258.31/microsoft.web.webview2.1.0.4258.31.nupkg",
    sha256: "56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9" }),
})
const headerMembers = ["node_api.h", "node_api_types.h", "js_native_api.h", "js_native_api_types.h"].map(v => `node-v${NODE_VERSION}/include/node/${v}`)
const webviewMembers = ["build/native/include/WebView2.h", "build/native/x64/WebView2LoaderStatic.lib", "LICENSE.txt"]

export function verifyDesktopSdkBytes(id, bytes) {
  const spec = Object.hasOwn(DESKTOP_WINDOWS_INPUTS, id) ? DESKTOP_WINDOWS_INPUTS[id] : undefined
  if (!spec || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_INPUT_BYTES ||
      createHash("sha256").update(bytes).digest("hex") !== spec.sha256) throw new Error("DESKTOP_SDK_INTEGRITY")
  return bytes
}
function regular(file) {
  const s = fs.lstatSync(file)
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw new Error("DESKTOP_SDK_FILE_IDENTITY")
  return s
}
function ownedDirectory(dest) {
  fs.mkdirSync(dest, { recursive: true })
  const output = fs.lstatSync(dest)
  if (!output.isDirectory() || output.isSymbolicLink()) throw new Error("DESKTOP_SDK_DIRECTORY")
  const base = fs.realpathSync(dest)
  const cache = path.join(base, ".desktop-sdk-build")
  try { fs.mkdirSync(cache, { mode: 0o700 }) } catch (error) { if (error.code !== "EEXIST") throw error }
  if (!fs.lstatSync(cache).isDirectory() || fs.lstatSync(cache).isSymbolicLink()) throw new Error("DESKTOP_SDK_DIRECTORY")
  return cache
}
async function download(id, cache) {
  const file = path.join(cache, `${id}-${DESKTOP_WINDOWS_INPUTS[id].sha256}`)
  if (fs.existsSync(file)) {
    const stat = regular(file)
    if (!stat.size || stat.size > MAX_INPUT_BYTES) throw new Error("DESKTOP_SDK_INPUT_LIMIT")
    return verifyDesktopSdkBytes(id, fs.readFileSync(file))
  }
  const response = await fetch(DESKTOP_WINDOWS_INPUTS[id].url, { redirect: "error", signal: AbortSignal.timeout(60_000) })
  if (!response.ok || !response.body) throw new Error("DESKTOP_SDK_DOWNLOAD")
  const length = Number(response.headers.get("content-length"))
  if (length > MAX_INPUT_BYTES) { await response.body.cancel(); throw new Error("DESKTOP_SDK_INPUT_LIMIT") }
  const chunks = []; let count = 0
  for await (const chunk of response.body) {
    count += chunk.length
    if (count > MAX_INPUT_BYTES) throw new Error("DESKTOP_SDK_INPUT_LIMIT")
    chunks.push(chunk)
  }
  const bytes = verifyDesktopSdkBytes(id, Buffer.concat(chunks))
  // Exclusive cache publication: never replace or follow an existing path.
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 })
  return bytes
}
function checked(binary, args, options = {}) {
  const { buildDiagnostic = false, ...spawnOptions } = options
  const r = spawnSync(binary, args, { encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024, ...spawnOptions })
  if (r.error || r.status !== 0) {
    // Never print the vcvars environment capture (it may contain inherited CI data).
    if (buildDiagnostic) process.stderr.write(`${r.stdout || ""}${r.stderr || ""}`)
    throw new Error("DESKTOP_NATIVE_BUILD_COMMAND_FAILED")
  }
  return r.stdout || ""
}
export function extractDesktopSdk(id, bytes, cache) {
  verifyDesktopSdkBytes(id, bytes)
  const members = id === "headers" ? headerMembers : id === "webview" ? webviewMembers : null
  if (!members) throw new Error("DESKTOP_SDK_ARCHIVE_KIND")
  const dest = fs.mkdtempSync(path.join(cache, `${id}-`))
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || process.env.SYSTEMROOT || "", "System32", "tar.exe") : "/usr/bin/tar"
  if (!path.isAbsolute(tar) || !fs.existsSync(tar)) throw new Error("DESKTOP_SDK_TAR_UNAVAILABLE")
  // Feed verified bytes, not a mutable archive filename. Extract only fixed members.
  checked(tar, ["-xf", "-", "-C", dest, ...members], { input: bytes })
  const found = []; let total = 0
  function walk(directory) {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) throw new Error("DESKTOP_SDK_EXTRACT_IDENTITY")
      if (stat.isDirectory()) walk(file)
      else { regular(file); found.push(path.relative(dest, file).split(path.sep).join("/")); total += stat.size }
      if (found.length > members.length || total > MAX_EXTRACT_BYTES) throw new Error("DESKTOP_SDK_EXTRACT_LIMIT")
    }
  }
  walk(dest)
  if (JSON.stringify(found.sort()) !== JSON.stringify([...members].sort())) throw new Error("DESKTOP_SDK_EXTRACT_MEMBERS")
  return dest
}

export async function prepareDesktopNodeHeaders({ dest }) {
  const cache = ownedDirectory(dest)
  const bytes = await download("headers", cache)
  return path.join(extractDesktopSdk("headers", bytes, cache), `node-v${NODE_VERSION}`, "include", "node")
}

export function desktopWindowsCompilePlan({ cl, root, output, headers, generated, sdk, nodeLib, testFixtures = false }) {
  const p = path.win32
  const addon = p.join(output, "desktop-launcher.node"), host = p.join(output, "cmspark-desktop.exe")
  return [
    [cl, ["/nologo", "/std:c11", "/W4", "/WX", "/MD", "/LD", "/DBUILDING_NODE_EXTENSION", "/DNODE_GYP_MODULE_NAME=desktop_launcher", `/I${headers}`, p.join(root, "src/desktop/native/launcher.c"), "/link", nodeLib, `/OUT:${addon}`]],
    [cl, ["/nologo", "/std:c++20", "/EHsc", "/DUNICODE", "/D_UNICODE", ...(testFixtures ? ["/DCMSPARK_DESKTOP_TEST_PHASES"] : []), `/I${p.join(sdk, "build/native/include")}`, `/I${generated}`, p.join(root, "src/desktop/native/DesktopHost.cpp"), "/link", "/SUBSYSTEM:WINDOWS", p.join(sdk, "build/native/x64/WebView2LoaderStatic.lib"), "version.lib", "windowsapp.lib", "winhttp.lib", "bcrypt.lib", "shlwapi.lib", "ole32.lib", "user32.lib", "advapi32.lib", `/OUT:${host}`]],
  ]
}
function toolchain() {
  const system = process.env.SystemRoot || process.env.SYSTEMROOT
  const pf = process.env["ProgramFiles(x86)"]
  if (!system || !pf) throw new Error("DESKTOP_WINDOWS_TOOLCHAIN_MISSING")
  const vswhere = path.join(pf, "Microsoft Visual Studio", "Installer", "vswhere.exe")
  const installation = checked(vswhere, ["-latest", "-version", "[17.0,19.0)", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"]).trim()
  if (!path.isAbsolute(installation) || /["%!\r\n]/.test(installation)) throw new Error("DESKTOP_WINDOWS_TOOLCHAIN_PATH")
  const vcvars = path.join(installation, "VC", "Auxiliary", "Build", "vcvarsall.bat")
  if (!fs.existsSync(vcvars)) throw new Error("DESKTOP_WINDOWS_TOOLCHAIN_MISSING")
  const captured = checked(path.join(system, "System32", "cmd.exe"), ["/d", "/v:off", "/s", "/c", `"call "${vcvars}" x64 >nul && set"`], { windowsVerbatimArguments: true })
  const env = { ...process.env }
  const allowed = new Set(["path", "include", "lib", "libpath", "vctoolsinstalldir", "windowssdkdir", "windowssdkversion", "ucrtversion", "universalcrtsdkdir"])
  for (const line of captured.split(/\r?\n/)) {
    const i = line.indexOf("="); if (i <= 0) continue
    const key = line.slice(0, i)
    if (allowed.has(key.toLowerCase())) {
      // Node sorts duplicate case-insensitive Windows env keys; remove old aliases.
      for (const old of Object.keys(env)) if (old.toLowerCase() === key.toLowerCase()) delete env[old]
      env[key] = line.slice(i + 1)
    }
  }
  const tools = Object.entries(env).find(([key]) => key.toLowerCase() === "vctoolsinstalldir")?.[1]
  if (!tools || !path.isAbsolute(tools)) throw new Error("DESKTOP_WINDOWS_TOOLCHAIN_PATH")
  const relative = path.relative(fs.realpathSync(installation), fs.realpathSync(tools))
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("DESKTOP_WINDOWS_TOOLCHAIN_PATH")
  const cl = path.join(tools, "bin", "Hostx64", "x64", "cl.exe")
  if (!fs.existsSync(cl)) throw new Error("DESKTOP_WINDOWS_TOOLCHAIN_MISSING")
  return { cl, env }
}
export async function buildDesktopWindows({ root, dest, generated, testFixtures = false }) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("DESKTOP_WINDOWS_BUILD_REQUIRES_X64")
  const { cl, env } = toolchain(), cache = ownedDirectory(dest), finalDest = path.dirname(cache)
  const [headers, webview, nodeLib] = await Promise.all([prepareDesktopNodeHeaders({ dest }), download("webview", cache), download("nodeLib", cache)])
  const sdk = extractDesktopSdk("webview", webview, cache), output = fs.mkdtempSync(path.join(cache, "objects-"))
  const lib = path.join(output, "node.lib"); fs.writeFileSync(lib, nodeLib, { flag: "wx", mode: 0o600 })
  for (const [binary, args] of desktopWindowsCompilePlan({ cl, root, output, headers, generated, sdk, nodeLib: lib, testFixtures })) checked(binary, args, { env, cwd: output, buildDiagnostic: true })
  if (testFixtures) {
    checked(cl, ["/nologo", "/std:c11", "/W4", "/WX", path.join(root, "tests", "fixtures", "desktop-480", "synchronize-handle-probe.c"), "/link", `/OUT:${path.join(output, "desktop-synchronize-handle-probe.exe")}`], { env, cwd: output, buildDiagnostic: true })
    regular(path.join(output, "desktop-synchronize-handle-probe.exe"))
    publish(path.join(output, "desktop-synchronize-handle-probe.exe"), path.join(finalDest, "desktop-synchronize-handle-probe.exe"))
  }
  for (const name of ["cmspark-desktop.exe", "desktop-launcher.node"]) publish(path.join(output, name), path.join(finalDest, name))
  const licenses = path.join(finalDest, "licenses")
  if (!fs.existsSync(licenses)) fs.mkdirSync(licenses)
  if (!fs.lstatSync(licenses).isDirectory() || fs.lstatSync(licenses).isSymbolicLink()) throw new Error("DESKTOP_SDK_DIRECTORY")
  publish(path.join(sdk, "LICENSE.txt"), path.join(licenses, "WebView2.LICENSE.txt"))
  // SDK inputs remain build-only; packaging stages a fixed manifest, never this cache.
}
function publish(source, destination) {
  regular(source)
  let existing
  try { existing = fs.lstatSync(destination) } catch (error) { if (error.code !== "ENOENT") throw error }
  if (existing) {
    regular(destination)
    fs.unlinkSync(destination)
  }
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
}
