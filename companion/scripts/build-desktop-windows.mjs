import { desktopBootstrapObservationFixture773 } from './desktop-bootstrap-observation-fixture.mjs'
import { desktopMcpObservationFixture } from './desktop-mcp-observation-fixture.mjs'
import { desktopConfirmationObservationFixture } from './desktop-confirmation-observation-fixture.mjs'
import { desktopTerminalFixture } from "./desktop-terminal-fixture.mjs"
import {copyDesktopAssets} from "./desktop-assets.mjs"
// #480 build-only SDK acquisition. No production download, installer or PATH fallback.
import fs from "node:fs"
import { desktopMcpFixture, desktopMetadataFixture, desktopDialogFixture, desktopResourceFixture, desktopWorkspaceFixture, desktopLocalFixture, desktopArchiveFixture } from "./desktop-mcp-fixture.mjs"
import path from "node:path"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"

const NODE_VERSION = "22.23.4"
const MAX_INPUT_BYTES = 32 * 1024 * 1024
const MAX_EXTRACT_BYTES = 64 * 1024 * 1024
export const DESKTOP_WINDOWS_INPUTS = Object.freeze({
  headers: Object.freeze({ url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-headers.tar.gz`,
    sha256: "dc4028dc105e27e5295119dd9da076fca71d5216113e097813f0fb30f59241a5" }),
  nodeLib: Object.freeze({ url: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.lib`,
    sha256: "c243185f2347870cadb637c909bf123fc703dc65dbfa769b17ec45a4b661d782" }),
  webview: Object.freeze({ url: "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4258.31/microsoft.web.webview2.1.0.4258.31.nupkg",
    sha256: "56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9" }),
})
const headerMembers = ["node_api.h", "node_api_types.h", "js_native_api.h", "js_native_api_types.h"].map(v => `node-v${NODE_VERSION}/include/node/${v}`)
const webviewMembers = ["build/native/include/WebView2.h", "build/native/x64/WebView2LoaderStatic.lib", "LICENSE.txt"]

// Derived from the four members of the archive pinned in DESKTOP_WINDOWS_INPUTS.
const RUNTIME_HEADER_SHA256 = Object.freeze({
  "node_api.h": "2d4560831e525b47b060ec8a0864ab73993df9e20215ce9f0fe7b24cd31af32a",
  "node_api_types.h": "088766b3cf1f0cd9b292c361ad30f7a04e7cc6db35a20ca52c572c1adf9635e7",
  "js_native_api.h": "624b39a85f0fe332f7cc1eb537e98f0e119be8503c742265fef6bdd53893adc8",
  "js_native_api_types.h": "c63d227f42878411e2a291ce81e0adf83ce57b81c0ea806740108b979b741156",
})

// `pins` is supplied by the caller; the build entry point always supplies the
// closed table above. The generic seam permits inert fixtures to exercise the
// same reader without substituting the build's trust roots.
export function stageVerifiedRuntimeHeaders({ directory, cache, pins }) {
  const names = Object.keys(RUNTIME_HEADER_SHA256).sort()
  if (!pins || JSON.stringify(Object.keys(pins).sort()) !== JSON.stringify(names) ||
      names.some(name => !/^[0-9a-f]{64}$/.test(pins[name]))) throw new Error("DESKTOP_SDK_RUNTIME_PINS")
  const bytesByName = new Map(); let missing = false
  for (const [name, expected] of Object.entries(pins)) {
    let fd
    try {
      fd = fs.openSync(path.join(directory, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    } catch (error) {
      if (error.code === "ENOENT") { missing = true; continue }
      throw new Error("DESKTOP_SDK_RUNTIME_IDENTITY", { cause: error })
    }
    try {
      const stat = fs.fstatSync(fd)
      if (!stat.isFile() || stat.nlink !== 1 || stat.size <= 0 || stat.size > 1024 * 1024) throw new Error("DESKTOP_SDK_RUNTIME_IDENTITY")
      const bytes = Buffer.alloc(stat.size); let offset = 0
      while (offset < bytes.length) {
        const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset)
        if (!n) throw new Error("DESKTOP_SDK_RUNTIME_IDENTITY")
        offset += n
      }
      const after = fs.fstatSync(fd)
      if (!after.isFile() || after.nlink !== 1 || after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size ||
          createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("DESKTOP_SDK_RUNTIME_INTEGRITY")
      bytesByName.set(name, bytes)
    } finally { fs.closeSync(fd) }
  }
  if (missing) return null
  const output = fs.mkdtempSync(path.join(cache, "runtime-headers-"))
  for (const [name, bytes] of bytesByName) fs.writeFileSync(path.join(output, name), bytes, { flag: "wx", mode: 0o600 })
  return output
}

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

export async function prepareDesktopNodeHeaders({ dest, preferRuntimeHeaders = false }) {
  const cache = ownedDirectory(dest)
  const archive = path.join(cache, `headers-${DESKTOP_WINDOWS_INPUTS.headers.sha256}`)
  const archivePresent = () => {
    try { fs.lstatSync(archive); return true } catch (error) { if (error.code === "ENOENT") return false; throw error }
  }
  if (preferRuntimeHeaders && process.platform === "darwin" && process.version === `v${NODE_VERSION}` && !archivePresent()) {
    const directory = path.join(path.dirname(path.dirname(process.execPath)), "include", "node")
    const local = stageVerifiedRuntimeHeaders({ directory, cache, pins: RUNTIME_HEADER_SHA256 })
    // Do not bypass a cache entry that appeared while the local set was read.
    if (local && !archivePresent()) return local
  }
  const bytes = await download("headers", cache)
  return path.join(extractDesktopSdk("headers", bytes, cache), `node-v${NODE_VERSION}`, "include", "node")
}

export function desktopWindowsCompilePlan({ cl, root, output, headers, generated, sdk, nodeLib, testFixtures = false }) {
  const p = path.win32
  const addon = p.join(output, "desktop-launcher.node"), host = p.join(output, "cmspark-desktop.exe")
  return [
    [cl, ["/nologo", "/std:c11", "/W4", "/WX", "/MD", "/LD", "/DBUILDING_NODE_EXTENSION", "/DNODE_GYP_MODULE_NAME=desktop_launcher", `/I${headers}`, p.join(root, "src/desktop/native/launcher.c"), "/link", nodeLib, "bcrypt.lib", `/OUT:${addon}`]],
    [cl, ["/nologo", "/std:c++20", "/EHsc", "/utf-8", "/DUNICODE", "/D_UNICODE", ...(testFixtures ? ["/DCMSPARK_DESKTOP_TEST_PHASES"] : []), `/I${p.join(sdk, "build/native/include")}`, `/I${generated}`, p.join(root, "src/desktop/native/DesktopHost.cpp"), "/link", "/SUBSYSTEM:WINDOWS", p.join(sdk, "build/native/x64/WebView2LoaderStatic.lib"), "version.lib", "windowsapp.lib", "winhttp.lib", "bcrypt.lib", "shlwapi.lib", "ole32.lib", "user32.lib", "advapi32.lib", `/OUT:${host}`]],
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
  const { buildComputerUiaNoFocus } = await import("./build-computer-uia-no-focus.mjs")
  buildComputerUiaNoFocus({ root, toolchain: { cl, env } })
  const [headers, webview, nodeLib] = await Promise.all([prepareDesktopNodeHeaders({ dest }), download("webview", cache), download("nodeLib", cache)])
  const sdk = extractDesktopSdk("webview", webview, cache), output = fs.mkdtempSync(path.join(cache, "objects-"))
  const lib = path.join(output, "node.lib"); fs.writeFileSync(lib, nodeLib, { flag: "wx", mode: 0o600 })
  for (const [binary, args] of desktopWindowsCompilePlan({ cl, root, output, headers, generated, sdk, nodeLib: lib, testFixtures })) checked(binary, args, { env, cwd: output, buildDiagnostic: true })
  if (testFixtures) {
    checked(cl, ["/nologo", "/std:c11", "/W4", "/WX", path.join(root, "tests", "fixtures", "desktop-480", "synchronize-handle-probe.c"), "/link", `/OUT:${path.join(output, "desktop-synchronize-handle-probe.exe")}`], { env, cwd: output, buildDiagnostic: true })
    regular(path.join(output, "desktop-synchronize-handle-probe.exe"))
    publish(path.join(output, "desktop-synchronize-handle-probe.exe"), path.join(finalDest, "desktop-synchronize-handle-probe.exe"))
    checked(cl,["/nologo","/std:c11","/W4","/WX","/MD","/LD","/DBUILDING_NODE_EXTENSION","/DNODE_GYP_MODULE_NAME=desktop_malformed_bootstrap",`/I${headers}`,path.join(root,"tests/fixtures/desktop-480/windows-malformed-bootstrap.c"),"/link",lib,"bcrypt.lib",`/OUT:${path.join(output,"desktop-malformed-bootstrap.node")}`],{env,cwd:output,buildDiagnostic:true})
    publish(path.join(output,"desktop-malformed-bootstrap.node"),path.join(finalDest,"desktop-malformed-bootstrap.node"))
    const bootstrapControls=path.join(root,"tests/fixtures/desktop-480/windows-bootstrap-controls.c")
    checked(cl,["/nologo","/std:c11","/W4","/WX",bootstrapControls,"/link","bcrypt.lib",`/OUT:${path.join(output,"desktop-bootstrap-controls.exe")}`],{env,cwd:output,buildDiagnostic:true})
    checked(cl,["/nologo","/std:c11","/W4","/WX","/MD","/LD","/DBUILDING_NODE_EXTENSION","/DNODE_GYP_MODULE_NAME=desktop_bootstrap_refusal","/DDESKTOP_BOOTSTRAP_REFUSAL_ADDON",`/I${headers}`,bootstrapControls,"/link",lib,"bcrypt.lib",`/OUT:${path.join(output,"desktop-bootstrap-refusal.node")}`],{env,cwd:output,buildDiagnostic:true})
    for(const name of["desktop-bootstrap-controls.exe","desktop-bootstrap-refusal.node"])publish(path.join(output,name),path.join(finalDest,name))
    const acceptanceRoot=path.join(finalDest,"acceptance");fs.mkdirSync(acceptanceRoot,{recursive:true});if(!fs.lstatSync(acceptanceRoot).isDirectory()||fs.lstatSync(acceptanceRoot).isSymbolicLink())throw new Error("DESKTOP_ACCEPTANCE_DIRECTORY")
    for(const mode of ["visual","hostile","inheritance","parent"]){
      const directory=path.join(acceptanceRoot,mode);fs.mkdirSync(directory,{recursive:true});if(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink())throw new Error("DESKTOP_ACCEPTANCE_DIRECTORY")
      const assets=path.join(directory,"assets");fs.mkdirSync(assets,{recursive:true});if(!fs.lstatSync(assets).isDirectory()||fs.lstatSync(assets).isSymbolicLink())throw new Error("DESKTOP_ACCEPTANCE_DIRECTORY")
      copyDesktopAssets(root,assets)
      const original=fs.readFileSync(path.join(root,"src/desktop/native/DesktopHost.cpp"),"utf8"),fixture=fs.readFileSync(path.join(root,"tests/fixtures/desktop-480/native-acceptance.cpp"),"utf8"),variant=desktopAcceptanceVariant("cpp",original,fixture)
      if(variant.inverse!==original)throw new Error("DESKTOP_ACCEPTANCE_SOURCE_DRIFT")
      // visual is also the actual reconnect/relaunch binary; observation never selects a product build.
      const observed=mode==="inheritance"||mode==="visual"?desktopBootstrapObservationFixture773(variant.source):{source:variant.source,inverse:variant.source};if(observed.inverse!==variant.source)throw Error("BOOT773_BUILD_INVERSE");
      const source=path.join(output,`acceptance-${mode}.cpp`),binary=path.join(output,`acceptance-${mode}.exe`);fs.writeFileSync(source,observed.source,{flag:"wx"})
      checked(cl,["/nologo","/std:c++20","/EHsc", "/utf-8","/DUNICODE","/D_UNICODE","/DCMSPARK_DESKTOP_TEST_PHASES",mode==="hostile"?"/DD480_HOSTILE":mode==="inheritance"?"/DD480_INHERITANCE":mode==="parent"?"/DD480_PARENT":"/DD480_VISUAL",`/I${path.join(sdk,"build/native/include")}`,`/I${generated}`,`/I${path.join(root,"src/desktop/native")}`,source,"/link","/SUBSYSTEM:WINDOWS",path.join(sdk,"build/native/x64/WebView2LoaderStatic.lib"),"version.lib","windowsapp.lib","winhttp.lib","bcrypt.lib","shlwapi.lib","ole32.lib","user32.lib","advapi32.lib",`/OUT:${binary}`],{env,cwd:output,buildDiagnostic:true})
      publish(binary,path.join(directory,"cmspark-desktop.exe"))
    }
    for(const [family,formName]of[["mcp","native-form.js"],["metadata","metadata-form.js"],["dialog","dialog-form.js"],["resource","resource-form.js"],["workspace","workspace-form.js"],["local","local-form.js"],["archive","archive-form.js"]]){
    const mcpDirectory=path.join(acceptanceRoot,family);fs.mkdirSync(mcpDirectory,{recursive:true});if(!fs.lstatSync(mcpDirectory).isDirectory()||fs.lstatSync(mcpDirectory).isSymbolicLink())throw Error("DESKTOP_ACCEPTANCE_DIRECTORY")
    const mcpAssets=path.join(mcpDirectory,"assets");fs.mkdirSync(mcpAssets,{recursive:true});if(!fs.lstatSync(mcpAssets).isDirectory()||fs.lstatSync(mcpAssets).isSymbolicLink())throw Error("DESKTOP_ACCEPTANCE_DIRECTORY")
    copyDesktopAssets(root,mcpAssets)
    const mcpOriginal=fs.readFileSync(path.join(root,"src/desktop/native/DesktopHost.cpp"),"utf8"),mcpFixture=fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/native-acceptance.cpp"),"utf8"),mcpForm=fs.readFileSync(path.join(root,"tests/fixtures/desktop-476",formName),"utf8"),mcpVariant=(family==="archive"?desktopArchiveFixture("cpp",mcpOriginal,mcpFixture,mcpForm,fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/archive-acceptance.cpp"),"utf8")):family==="local"?desktopLocalFixture("cpp",mcpOriginal,fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/local-acceptance.cpp"),"utf8"),mcpForm):family==="workspace"?desktopWorkspaceFixture("cpp",mcpOriginal,fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/workspace-acceptance.cpp"),"utf8"),mcpForm):family==="resource"?desktopResourceFixture("cpp",mcpOriginal,fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/resource-acceptance.cpp"),"utf8"),mcpForm):family==="dialog"?desktopDialogFixture("cpp",mcpOriginal,mcpFixture,mcpForm,fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/dialog-acceptance.cpp"),"utf8")):family==="metadata"?desktopMetadataFixture("cpp",mcpOriginal,mcpFixture,mcpForm,fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/metadata-acceptance.cpp"),"utf8")):desktopMcpFixture("cpp",mcpOriginal,mcpFixture,mcpForm))
    if(mcpVariant.inverse!==mcpOriginal)throw Error("DESKTOP_MCP_SOURCE_DRIFT")
    const mcpObserved=family==="local"?desktopConfirmationObservationFixture(mcpVariant.source,"LOCAL"):family==="mcp"?desktopMcpObservationFixture(mcpVariant.source,mcpForm):null;if(mcpObserved&&mcpObserved.inverse!==mcpVariant.source)throw Error("DESKTOP_ACCEPTANCE_OBSERVATION_DRIFT")
    const mcpSource=path.join(output,`acceptance-${family}.cpp`),mcpBinary=path.join(output,`acceptance-${family}.exe`);fs.writeFileSync(mcpSource,mcpObserved?mcpObserved.source:mcpVariant.source,{flag:"wx"})
    checked(cl,["/nologo","/std:c++20","/EHsc", "/utf-8","/DUNICODE","/D_UNICODE",`/I${path.join(sdk,"build/native/include")}`,`/I${generated}`,`/I${path.join(root,"src/desktop/native")}`,mcpSource,"/link","/SUBSYSTEM:WINDOWS",path.join(sdk,"build/native/x64/WebView2LoaderStatic.lib"),"version.lib","windowsapp.lib","winhttp.lib","bcrypt.lib","shlwapi.lib","ole32.lib","user32.lib","advapi32.lib",`/OUT:${mcpBinary}`],{env,cwd:output,buildDiagnostic:true})
    publish(mcpBinary,path.join(mcpDirectory,"cmspark-desktop.exe"))
    }
    const terminalDirectory=path.join(acceptanceRoot,"terminal");fs.mkdirSync(terminalDirectory,{recursive:true});if(!fs.lstatSync(terminalDirectory).isDirectory()||fs.lstatSync(terminalDirectory).isSymbolicLink())throw Error("DESKTOP_ACCEPTANCE_DIRECTORY")
    const terminalAssets=path.join(terminalDirectory,"assets");fs.mkdirSync(terminalAssets,{recursive:true});if(!fs.lstatSync(terminalAssets).isDirectory()||fs.lstatSync(terminalAssets).isSymbolicLink())throw Error("DESKTOP_ACCEPTANCE_DIRECTORY");copyDesktopAssets(root,terminalAssets)
    const terminalOriginal=fs.readFileSync(path.join(root,"src/desktop/native/DesktopHost.cpp"),"utf8"),terminalController=fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/terminal-acceptance.cpp"),"utf8"),terminalForm=fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/terminal-form.js"),"utf8"),terminalVariant=desktopTerminalFixture("cpp",terminalOriginal,terminalController,terminalForm)
    if(terminalVariant.inverse!==terminalOriginal)throw Error("DESKTOP_TERMINAL_SOURCE_DRIFT")
    const terminalObserved=desktopConfirmationObservationFixture(terminalVariant.source,"TERMINAL");if(terminalObserved.inverse!==terminalVariant.source)throw Error("DESKTOP_CONFIRMATION_OBSERVATION_DRIFT")
    const terminalSource=path.join(output,"acceptance-terminal.cpp"),terminalBinary=path.join(output,"acceptance-terminal.exe");fs.writeFileSync(terminalSource,terminalObserved.source,{flag:"wx"})
    checked(cl,["/nologo","/std:c++20","/EHsc","/utf-8","/DUNICODE","/D_UNICODE",`/I${path.join(sdk,"build/native/include")}`,`/I${generated}`,`/I${path.join(root,"src/desktop/native")}`,terminalSource,"/link","/SUBSYSTEM:WINDOWS",path.join(sdk,"build/native/x64/WebView2LoaderStatic.lib"),"version.lib","windowsapp.lib","winhttp.lib","bcrypt.lib","shlwapi.lib","ole32.lib","user32.lib","advapi32.lib",`/OUT:${terminalBinary}`],{env,cwd:output,buildDiagnostic:true})
    publish(terminalBinary,path.join(terminalDirectory,"cmspark-desktop.exe"))
    const inherit=path.join(acceptanceRoot,"inheritance"),fixture=path.join(root,"tests/fixtures/desktop-480/windows-inheritance.c")
    checked(cl,["/nologo","/std:c11","/W4","/WX","/MD","/LD","/DBUILDING_NODE_EXTENSION","/DNODE_GYP_MODULE_NAME=desktop_inheritance","/DDESKTOP_FIXTURE_ADDON",`/I${headers}`,fixture,"/link",lib,"bcrypt.lib",`/OUT:${path.join(output,"desktop-inheritance.node")}`],{env,cwd:output,buildDiagnostic:true})
    checked(cl,["/nologo","/std:c11","/W4","/WX",fixture,"/link",`/OUT:${path.join(output,"desktop-inheritance.exe")}`],{env,cwd:output,buildDiagnostic:true})
    checked(cl,["/nologo","/std:c11","/W4","/WX","/DDESKTOP_FIXTURE_PARENT_LOCK_PROBE",fixture,"/link",`/OUT:${path.join(output,"desktop-parent-probe.exe")}`],{env,cwd:output,buildDiagnostic:true})
    publish(path.join(output,"desktop-parent-probe.exe"),path.join(acceptanceRoot,"parent","desktop-parent-probe.exe"))
    for(const name of ["desktop-inheritance.node","desktop-inheritance.exe"])publish(path.join(output,name),path.join(inherit,name))
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

// Shared build-time discovery only; original DesktopHost/launcher plans remain unchanged.
export { toolchain as desktopWindowsToolchain }

/** Build-only same-source acceptance variant. Never included in the shipped manifest. */
export function desktopAcceptanceVariant(language, original, fixture) {
  if (!['swift', 'cpp'].includes(language) || typeof original !== 'string' || typeof fixture !== 'string') throw new Error('DESKTOP_ACCEPTANCE_SOURCE_INVALID')
  const cppParts = language === 'cpp' ? fixture.split(/^\/\/ D480_IMPLEMENTATION\r?\n/m) : null
  if (cppParts && (cppParts.length !== 2 || !cppParts[1].length)) throw new Error('DESKTOP_ACCEPTANCE_FIXTURE_INVALID')
  const patches = language === 'swift' ? [
    ['let parent=getppid();guard parent>1,isatty(STDIN_FILENO)==0 else{exit(11)}', 'd480AcceptanceSafetyWatchdog();let parent=getppid();guard parent>1,isatty(STDIN_FILENO)==0 else{exit(11)}'],
    ['func applicationDidFinishLaunching(_ notification: Notification) { connect() }', 'func applicationDidFinishLaunching(_ notification: Notification) { if !d480AcceptanceParentArm() { exit(71) };connect() }'],
    ['parentWatch?.setEventHandler { exit(1) }', 'parentWatch?.setEventHandler { d480AcceptanceParentObserved();exit(1) }'],
    ['phase="ready";authenticated=true;', 'phase="ready";authenticated=true;d480AcceptanceAuth(self);'],
    ['win.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)', 'win.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true);d480AcceptanceWindow(self)'],
    ['let wasAuthenticated=authenticated;retireLocal();retirePicker();browserRequest=nil;browserThread=nil;archiveTarget=nil;retireConfirmation(nil);socket=nil;', 'let wasAuthenticated=authenticated;d480AcceptanceWindowStop(self);retireLocal();retirePicker();browserRequest=nil;browserThread=nil;archiveTarget=nil;retireConfirmation(nil);socket=nil;'],
    ['func applicationWillTerminate(_ notification:Notification) { retireLocal();retireWorkspace();retireBrowser(true);retireArchive();retireDialog();retireConfirmation(false);socket?.cancel', 'func applicationWillTerminate(_ notification:Notification) { d480AcceptanceWindowStop(self);retireLocal();retireWorkspace();retireBrowser(true);retireArchive();retireDialog();retireConfirmation(false);socket?.cancel'],
    ['if allowed { retireLocal();retireWorkspace();retireBrowser(true);retireArchive();retireDialog();retireConfirmation(false);generation=nil;requests.removeAll();bundledScheme?.newDocument() };decisionHandler(allowed ? .allow:.cancel)', 'if allowed { retireLocal();retireWorkspace();retireBrowser(true);retireArchive();retireDialog();retireConfirmation(false);generation=nil;requests.removeAll();bundledScheme?.newDocument() };d480AcceptanceNavigation(self,navigationAction,allowed);decisionHandler(allowed ? .allow:.cancel)'],
    ['guard authenticated,webView.url?.absoluteString==origin else{return};retireArchive();generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!])', 'guard authenticated,webView.url?.absoluteString==origin else{return};retireArchive();generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!]);d480AcceptanceDocument(self)'],
    ['windowFeatures:WKWindowFeatures)->WKWebView? { nil }', 'windowFeatures:WKWindowFeatures)->WKWebView? { d480AcceptanceNewWindow(self);return nil }'],
    ['didReceive message:WKScriptMessage) {', 'didReceive message:WKScriptMessage) {\n        d480AcceptanceMessage(self,message)'],
    ['var out=f;if type=="desktop.chat.stop"', 'd480AcceptanceForward(self,f);var out=f;if type=="desktop.chat.stop"'],
  ] : [
    ['class Desktop {', '/* D480 acceptance declarations */\n'+cppParts[0]+'\nclass Desktop {\n friend class D480Acceptance;'],
    ['winrt::init_apartment(winrt::apartment_type::single_threaded);', 'D480Acceptance::safetyWatchdog();winrt::init_apartment(winrt::apartment_type::single_threaded);'],
    ['if(WaitForSingleObject(parent,INFINITE)==WAIT_OBJECT_0)TerminateProcess(GetCurrentProcess(),1);', 'if(WaitForSingleObject(parent,INFINITE)==WAIT_OBJECT_0){D480Acceptance::parentObserved();TerminateProcess(GetCurrentProcess(),1);}'],
    ['HANDLE input=bootstrap.pipe;', 'HANDLE input=bootstrap.pipe;D480Acceptance::InheritanceScope identityScope;D480Acceptance::preConsume(input);'],
    ['CloseHandle(input);bootstrap.pipe=nullptr;', 'CloseHandle(input);D480Acceptance::inputClosed(input);bootstrap.pipe=nullptr;'],
    ['d480_client_close(&bootstrap);', 'd480_client_close(&bootstrap);D480Acceptance::parentCleared(parent);'],
    ['if(!window)return 61;start_network();', 'if(!window)return 61;D480Acceptance::created(*this);start_network();'],
    ['SetForegroundWindow(window);}', 'SetForegroundWindow(window);D480Acceptance::window(*this);}'],
    ['phase=L"ready";ready=true;', 'phase=L"ready";ready=true;D480Acceptance::auth(*this);'],
    ['deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)', 'deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)D480Acceptance::document(*this);'],
    ['void renderer(std::wstring const& source,std::wstring const& body){', 'void renderer(std::wstring const& source,std::wstring const& body){D480Acceptance::message(*this,source,body);'],
    ['frame.Remove(L"generation");put(frame,L"id",id);send(frame);', 'D480Acceptance::forward(*this,frame);frame.Remove(L"generation");put(frame,L"id",id);send(frame);'],
    ['Callback<ICoreWebView2NewWindowRequestedEventHandler>([](ICoreWebView2*,ICoreWebView2NewWindowRequestedEventArgs* args)->HRESULT{args->put_Handled(TRUE);return S_OK;', 'Callback<ICoreWebView2NewWindowRequestedEventHandler>([this](ICoreWebView2*,ICoreWebView2NewWindowRequestedEventArgs* args)->HRESULT{args->put_Handled(TRUE);D480Acceptance::newWindow(*this);return S_OK;'],
    ['Callback<ICoreWebView2DownloadStartingEventHandler>([](ICoreWebView2*,ICoreWebView2DownloadStartingEventArgs* args)->HRESULT{args->put_Cancel(TRUE);return S_OK;}).Get(),&token);else{ExitProcess(55);', 'Callback<ICoreWebView2DownloadStartingEventHandler>([this](ICoreWebView2*,ICoreWebView2DownloadStartingEventArgs* args)->HRESULT{args->put_Cancel(TRUE);D480Acceptance::download(*this);return S_OK;}).Get(),&token);else{ExitProcess(55);'],
    ['RECT bounds{};GetClientRect(window,&bounds);controller->put_Bounds(bounds);return web->Navigate(document_url);', 'D480Acceptance::attach(*this);RECT bounds{};GetClientRect(window,&bounds);controller->put_Bounds(bounds);return web->Navigate(document_url);'],
    ['if(message==WM_SIZE&&self->controller)', 'if(message==WM_APP+100){D480Acceptance::settled(*self);return 0;}if(message==WM_SIZE&&self->controller)'],
  ]
  let source = original
  for (const [before, after] of patches) {
    if (source.split(before).length !== 2) throw new Error('DESKTOP_ACCEPTANCE_ANCHOR_AMBIGUOUS')
    source = source.replace(before, after)
  }
  const tail = language === 'swift' ? fixture : cppParts[1]
  if (typeof tail !== 'string' || !tail.length) throw new Error('DESKTOP_ACCEPTANCE_FIXTURE_INVALID')
  const suffix='\n/* D480 unshipped acceptance fixture */\n'+tail
  source += suffix
  let inverse = source.slice(0, -suffix.length)
  for (const [before, after] of [...patches].reverse()) {
    if (inverse.split(after).length !== 2) throw new Error('DESKTOP_ACCEPTANCE_INVERSE_AMBIGUOUS')
    inverse = inverse.replace(after, before)
  }
  if (inverse !== original) throw new Error('DESKTOP_ACCEPTANCE_SOURCE_DRIFT')
  return { source, inverse }
}
