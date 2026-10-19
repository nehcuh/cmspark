// #480 build-only: no installation/default configuration/browser changes.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { desktopMcpFixture, desktopMetadataFixture, desktopDialogFixture, desktopResourceFixture, desktopArchiveFixture } from "./desktop-mcp-fixture.mjs"
import { desktopIntegrity } from "./desktop-artifacts.mjs"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dest = path.join(root, "dist", "desktop-native")
const generated = path.join(dest, "generated")
const target=process.argv.find(v=>v.startsWith("--target="))?.slice(9)
const actual=`${process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
if(target && target!==actual)throw new Error("DESKTOP_NATIVE_CROSS_BUILD_UNSUPPORTED")
function directory(dir) {
  try { fs.mkdirSync(dir, { recursive: true }) } catch (error) { if (error.code !== "EEXIST") throw error }
  const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("DESKTOP_BUILD_REDIRECT")
}
function replacement(file) {
  let stat;try{stat=fs.lstatSync(file)}catch(error){if(error.code!=="ENOENT")throw error}
  if(stat){if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error("DESKTOP_BUILD_REDIRECT");fs.unlinkSync(file)}
}
function write(file,content){replacement(file);fs.writeFileSync(file,content,{flag:"wx"})}
directory(dest);directory(generated)
if (!["darwin", "win32"].includes(process.platform)) throw new Error("Native platform build command not implemented for this OS")
if (process.version !== "v22.23.2") throw new Error("Pinned Node22.23.2 build runtime required")
const { prepareDesktopNodeHeaders, desktopAcceptanceVariant } = await import("./build-desktop-windows.mjs")
const headers = process.platform === "darwin" ? await prepareDesktopNodeHeaders({dest}) : undefined
// Erasable TypeScript is supported by pinned Node22.23.2. This is the sole editable method table.
const { DESKTOP_READ_METHODS, DESKTOP_RENDERER_METHODS, DESKTOP_NATIVE_METHODS, DESKTOP_METHOD_SET_VERSION } = await import(pathToFileURL(path.join(root, "src/desktop/capabilities.ts")))
if (!DESKTOP_READ_METHODS.every(v => typeof v === "string" && (/^[a-z]+\.[a-z]+$/.test(v) || v === "desktop.archive.list" || v === "desktop.archive.state" || v === "desktop.browser.status" || v === "desktop.browser.tasks"))) throw new Error("Invalid native method table")
if (DESKTOP_METHOD_SET_VERSION !== 8 || JSON.stringify(DESKTOP_NATIVE_METHODS) !== JSON.stringify([...DESKTOP_RENDERER_METHODS,"desktop.confirmation.decision","desktop.browser.retire"]) || JSON.stringify(DESKTOP_RENDERER_METHODS) !== JSON.stringify([...DESKTOP_READ_METHODS,"desktop.mcp.edit","desktop.mcp.save","desktop.thread.metadata.edit","desktop.thread.metadata.save","desktop.thread.create","desktop.thread.open","desktop.chat.send","desktop.chat.stop","desktop.resource.read","desktop.resource.import","desktop.resource.update","desktop.resource.remove","desktop.archive.set","desktop.browser.visibility"])) throw new Error("Invalid controller method table")
write(path.join(generated, "DesktopCapabilities.swift"), `// Generated from desktop/capabilities.ts. Do not edit.\nimport Foundation\nenum DesktopCapabilities { static let version = ${DESKTOP_METHOD_SET_VERSION}; static let methods: Set<String> = [${DESKTOP_RENDERER_METHODS.map(v => JSON.stringify(v)).join(",")} ] }\n`)
write(path.join(generated, "desktop-capabilities.h"), `/* Generated from desktop/capabilities.ts. Do not edit. */\nstatic const unsigned desktop_method_set_version = ${DESKTOP_METHOD_SET_VERSION};\nstatic const wchar_t *desktop_read_methods[] = {${DESKTOP_RENDERER_METHODS.map(v => "L" + JSON.stringify(v)).join(",")}};\n`)
directory(path.join(dest,"assets"))
for(const name of ["index.html","app.css","app.js"]){const target=path.join(dest,"assets",name);replacement(target);fs.copyFileSync(path.join(root,"src/desktop/assets",name),target,fs.constants.COPYFILE_EXCL)}
function run(bin, args) { const r=spawnSync(bin,args,{stdio:"inherit"});if(r.error||r.status!==0)process.exit(r.status||1) }
if(process.platform === "win32") {
 const { buildDesktopWindows }=await import("./build-desktop-windows.mjs")
 await buildDesktopWindows({root,dest,generated,testFixtures:process.argv.includes("--test-fixtures")})
} else {
replacement(path.join(dest,"desktop-launcher.node"));replacement(path.join(dest,"cmspark-desktop"))
run("/usr/bin/clang", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-shared", "-fPIC", "-undefined", "dynamic_lookup", "-I", headers, path.join(root, "src/desktop/native/launcher.c"), "-o", path.join(dest, "desktop-launcher.node")])
// Swift top-level executable statements require the main.swift filename for a multi-file build.
const main=path.join(generated,"main.swift");replacement(main);fs.copyFileSync(path.join(root,"src/desktop/native/DesktopHost.swift"),main)
run("/usr/bin/swiftc", ["-O", main, path.join(generated,"DesktopCapabilities.swift"), "-framework", "AppKit", "-framework", "WebKit", "-framework", "CryptoKit", "-o", path.join(dest,"cmspark-desktop")])
// Sign the final native bytes before the daemon embeds their expected hashes.
run("/usr/bin/codesign", ["--force", "--sign", "-", path.join(dest,"desktop-launcher.node")])
run("/usr/bin/codesign", ["--force", "--sign", "-", path.join(dest,"cmspark-desktop")])
if(process.argv.includes("--test-fixtures")) {
 for (const mode of ["visual", "hostile", "parent"]) {
  const fixtureDest=path.join(dest,"acceptance",mode),fixtureGenerated=path.join(generated,`acceptance-${mode}`)
  directory(path.join(dest,"acceptance"));directory(fixtureDest);directory(fixtureGenerated);directory(path.join(fixtureDest,"assets"))
  for(const name of ["index.html","app.css","app.js"]){const target=path.join(fixtureDest,"assets",name);replacement(target);fs.copyFileSync(path.join(root,"src/desktop/assets",name),target,fs.constants.COPYFILE_EXCL)}
  const original=fs.readFileSync(path.join(root,"src/desktop/native/DesktopHost.swift"),"utf8"),controller=fs.readFileSync(path.join(root,"tests/fixtures/desktop-480/native-acceptance.swift"),"utf8")
  const variant=desktopAcceptanceVariant("swift",original,controller);if(variant.inverse!==original)throw new Error("DESKTOP_ACCEPTANCE_SOURCE_DRIFT")
  const source=path.join(fixtureGenerated,"main.swift"),binary=path.join(fixtureDest,"cmspark-desktop");write(source,variant.source);replacement(binary)
  run("/usr/bin/swiftc",["-O","-D",mode==="hostile"?"D480_HOSTILE":mode==="parent"?"D480_PARENT":"D480_VISUAL",source,path.join(generated,"DesktopCapabilities.swift"),"-framework","AppKit","-framework","WebKit","-framework","CryptoKit","-o",binary])
  run("/usr/bin/codesign",["--force","--sign","-",binary])
 }
 for(const [family,formName]of[["mcp","native-form.js"],["metadata","metadata-form.js"],["dialog","dialog-form.js"],["resource","resource-form.js"],["archive","archive-form.js"]]){
 const mcpDest=path.join(dest,"acceptance",family),mcpGenerated=path.join(generated,"acceptance-"+family)
 directory(mcpDest);directory(mcpGenerated);directory(path.join(mcpDest,"assets"))
 for(const name of ["index.html","app.css","app.js"]){const target=path.join(mcpDest,"assets",name);replacement(target);fs.copyFileSync(path.join(root,"src/desktop/assets",name),target,fs.constants.COPYFILE_EXCL)}
 const mcpOriginal=fs.readFileSync(path.join(root,"src/desktop/native/DesktopHost.swift"),"utf8"),mcpFixture=fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/native-acceptance.swift"),"utf8"),mcpForm=fs.readFileSync(path.join(root,"tests/fixtures/desktop-476",formName),"utf8")
 const mcpVariant=(family==="archive"?desktopArchiveFixture("swift",mcpOriginal,mcpFixture,mcpForm,fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/archive-acceptance.swift"),"utf8")):family==="resource"?desktopResourceFixture("swift",mcpOriginal,fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/resource-acceptance.swift"),"utf8"),mcpForm):family==="dialog"?desktopDialogFixture("swift",mcpOriginal,mcpFixture,mcpForm,fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/dialog-acceptance.swift"),"utf8")):family==="metadata"?desktopMetadataFixture("swift",mcpOriginal,mcpFixture,mcpForm,fs.readFileSync(path.join(root,"tests/fixtures/desktop-476/metadata-acceptance.swift"),"utf8")):desktopMcpFixture("swift",mcpOriginal,mcpFixture,mcpForm));if(mcpVariant.inverse!==mcpOriginal)throw Error("DESKTOP_MCP_SOURCE_DRIFT")
 const mcpSource=path.join(mcpGenerated,"main.swift"),mcpBinary=path.join(mcpDest,"cmspark-desktop");write(mcpSource,mcpVariant.source);replacement(mcpBinary)
 run("/usr/bin/swiftc",["-O",mcpSource,path.join(generated,"DesktopCapabilities.swift"),"-framework","AppKit","-framework","WebKit","-framework","CryptoKit","-o",mcpBinary])
 run("/usr/bin/codesign",["--force","--sign","-",mcpBinary])
 }
 const parentProbe=path.join(dest,"acceptance","parent","desktop-parent-probe");replacement(parentProbe)
 run("/usr/bin/clang",["-std=c11","-Wall","-Wextra","-Werror","-DDESKTOP_FIXTURE_MAC_PARENT_PROBE",path.join(root,"tests/fixtures/desktop-480/windows-inheritance.c"),"-o",parentProbe])
 replacement(path.join(dest,"desktop-inheritance-probe"));replacement(path.join(dest,"inheritable-sentinel.node"))
 run("/usr/bin/clang",["-std=c11","-Wall","-Wextra","-Werror",path.join(root,"tests/fixtures/desktop-480/inheritance-probe.c"),"-o",path.join(dest,"desktop-inheritance-probe")])
 run("/usr/bin/clang",["-std=c11","-Wall","-Wextra","-Werror","-shared","-fPIC","-undefined","dynamic_lookup","-I",headers,path.join(root,"tests/fixtures/desktop-480/inheritable-sentinel.c"),"-o",path.join(dest,"inheritable-sentinel.node")])
 for (const [mode, define] of [["notify", "-DDESKTOP_FIXTURE_FAIL_NOTIFY"], ["worker", "-DDESKTOP_FIXTURE_FAIL_WORKER"], ["normal", undefined]]) {
  const output=path.join(dest,`desktop-construction-${mode}.node`);replacement(output)
  run("/usr/bin/clang",["-std=c11","-Wall","-Wextra","-Werror","-shared","-fPIC","-undefined","dynamic_lookup","-I",headers,...(define?[define]:[]),path.join(root,"tests/fixtures/desktop-480/construction-failure.c"),"-o",output])
 }
 for (const [name, define] of [["receiver", undefined], ["exit7", "-DDESKTOP_FIXTURE_EXIT"]]) {
  const output=path.join(dest,`desktop-construction-${name}`);replacement(output)
  run("/usr/bin/clang",["-std=c11","-Wall","-Wextra","-Werror",...(define?[define]:[]),path.join(root,"tests/fixtures/desktop-480/construction-receiver.c"),"-o",output])
 }
 const profileLines=fs.readFileSync(path.join(root,"src/desktop/native/DesktopHost.cpp"),"utf8").split("\n").filter(line=>line.includes("wchar_t temporary[MAX_PATH];"))
 if(profileLines.length!==1)throw new Error("DESKTOP_TEST_PROFILE_FRAGMENT_AMBIGUOUS")
 write(path.join(generated,"desktop-temp-path-fragment.inc"),profileLines[0]+"\n")
 replacement(path.join(dest,"desktop-temp-path-contract"))
 run("/usr/bin/clang++",["-std=c++20","-Wall","-Wextra","-Werror","-I",generated,path.join(root,"tests/fixtures/desktop-480/temp-path-contract.cpp"),"-o",path.join(dest,"desktop-temp-path-contract")])
}

}
write(path.join(dest,"integrity.json"),JSON.stringify(desktopIntegrity(dest),null,2)+"\n")
