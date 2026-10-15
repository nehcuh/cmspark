/** Fixed, build-only desktop package layout. This module never installs or launches a host. */
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
const names = platform => [platform === "win32" ? "cmspark-desktop.exe" : "cmspark-desktop", "desktop-launcher.node", "assets/index.html", "assets/app.css", "assets/app.js", ...(platform === "win32" ? ["licenses/WebView2.LICENSE.txt"] : [])]
export function desktopIntegrity(source, platform = process.platform) {
  if (platform !== "win32" && platform !== "darwin") throw new Error("DESKTOP_PLATFORM_UNSUPPORTED")
  const files = {}
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error("DESKTOP_ARTIFACT_REDIRECT")
  for (const rel of names(platform)) {
    let current = source
    for (const part of rel.split("/")) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw new Error("DESKTOP_ARTIFACT_REDIRECT") }
    const info = fs.statSync(current)
    if (!info.isFile()) throw new Error("DESKTOP_ARTIFACT_MISSING")
    files[rel] = createHash("sha256").update(fs.readFileSync(current)).digest("hex")
  }
  return { host: names(platform)[0], addon: "desktop-launcher.node", files }
}
export function stageDesktop(source, destination, platform = process.platform) {
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) throw new Error("DESKTOP_STAGE_REDIRECT")
  const expected = JSON.parse(fs.readFileSync(path.join(source, "integrity.json"), "utf8"))
  if (JSON.stringify(desktopIntegrity(source, platform)) !== JSON.stringify(expected)) throw new Error("DESKTOP_ARTIFACT_DRIFT")
  const target = path.join(destination, "bin", "desktop-native")
  // Never merge into an old tree containing extra resources or redirection.
  if (fs.existsSync(target)) throw new Error("DESKTOP_STAGE_ALREADY_EXISTS")
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.lstatSync(path.dirname(target)).isSymbolicLink()) throw new Error("DESKTOP_STAGE_REDIRECT")
  fs.mkdirSync(target)
  for (const rel of names(platform)) { const out = path.join(target, rel); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.copyFileSync(path.join(source, rel), out, fs.constants.COPYFILE_EXCL) }
  fs.copyFileSync(path.join(source, "integrity.json"), path.join(target, "integrity.json"), fs.constants.COPYFILE_EXCL)
  if (JSON.stringify(desktopIntegrity(target, platform)) !== JSON.stringify(expected)) throw new Error("DESKTOP_STAGE_DRIFT")
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [mode, source, target, platform] = process.argv.slice(2)
  if (mode === "stage" && source && target) stageDesktop(path.resolve(source), path.resolve(target), platform)
  else if (mode === "verify" && source) {
    const expected = JSON.parse(fs.readFileSync(path.join(source, "integrity.json"), "utf8"))
    if (JSON.stringify(desktopIntegrity(path.resolve(source), platform)) !== JSON.stringify(expected)) throw new Error("DESKTOP_ARTIFACT_DRIFT")
  } else throw new Error("Usage: desktop-artifacts.mjs stage <source> <package-root> [darwin|win32] | verify <root> [darwin|win32]")
}
