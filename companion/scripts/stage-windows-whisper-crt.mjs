// Deploy the VC runtime beside the native Whisper executable, including in the portable ZIP.
import fs from "node:fs"
import path from "node:path"
import { desktopWindowsToolchain } from "./build-desktop-windows.mjs"

const [arch, destination] = process.argv.slice(2)
if (!["x64", "arm64"].includes(arch) || !destination) throw new Error("expected x64|arm64 and a staging directory")
const { env } = desktopWindowsToolchain()
const redist = Object.entries(env).find(([key]) => key.toLowerCase() === "vctoolsredistdir")?.[1]
if (!redist) throw new Error("Microsoft VC redistributable directory missing from vcvarsall")
const archRoot = path.join(redist, arch)
const crt = fs.readdirSync(archRoot).find(name => /^Microsoft\.VC\d+\.CRT$/i.test(name))
if (!crt) throw new Error(`Microsoft VC redistributable missing for ${arch}`)
const source = path.join(archRoot, crt)
const files = fs.readdirSync(source).filter(name => name.toLowerCase().endsWith(".dll"))
for (const required of ["msvcp140.dll", "vcruntime140.dll"]) {
  if (!files.some(name => name.toLowerCase() === required)) throw new Error(`missing ${required} in ${source}`)
}
for (const name of files) fs.copyFileSync(path.join(source, name), path.join(destination, name))
console.log(`Staged ${crt} for Whisper (${arch}, ${files.length} DLLs)`)
