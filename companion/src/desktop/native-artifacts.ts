import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { getAppRoot } from "../paths"
import type { DesktopNativeBinding } from "./host-launcher"
/** Build-time esbuild literal, populated only after signing final platform artifacts. */
declare const __CMSPARK_DESKTOP_INTEGRITY__: undefined | { host: string; addon: string; files: Record<string, string> }
export function verifyDesktopArtifacts(root: string, expected: { host: string; addon: string; files: Record<string, string> }) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error("DESKTOP_INTEGRITY")
  const base = fs.realpathSync(root)
  for (const [rel, sha] of Object.entries(expected.files)) {
    if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).some(v => !v || v === "." || v === "..") || !/^[0-9a-f]{64}$/.test(sha)) throw new Error("DESKTOP_INTEGRITY")
    let cursor = base
    for (const part of rel.split(/[\\/]/)) { cursor = path.join(cursor, part); if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error("DESKTOP_INTEGRITY") }
    const f = path.join(base, rel)
    if (!fs.statSync(f).isFile() || fs.realpathSync(f) !== f || createHash("sha256").update(fs.readFileSync(f)).digest("hex") !== sha) throw new Error("DESKTOP_INTEGRITY")
  }
  if (!expected.files[expected.host] || !expected.files[expected.addon]) throw new Error("DESKTOP_INTEGRITY")
  return { binary: path.join(base, expected.host), addon: path.join(base, expected.addon) }
}
export function resolveDesktopNative(): { binding: DesktopNativeBinding; binary: string } {
  if (typeof __CMSPARK_DESKTOP_INTEGRITY__ === "undefined" || !__CMSPARK_DESKTOP_INTEGRITY__) throw new Error("DESKTOP_NATIVE_UNAVAILABLE")
  // Existing package root is Resources/ on Mac and the flat distribution root on Windows.
  const bin = path.join(getAppRoot(), "bin")
  if (fs.lstatSync(bin).isSymbolicLink()) throw new Error("DESKTOP_INTEGRITY")
  const root = path.join(bin, "desktop-native")
  const verified = verifyDesktopArtifacts(root, __CMSPARK_DESKTOP_INTEGRITY__)
  return { binary: verified.binary, binding: createRequire(process.execPath)(verified.addon) as DesktopNativeBinding }
}
