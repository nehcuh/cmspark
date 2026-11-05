import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function linuxElfArchitecture(bytes) {
  if (bytes.length < 64 || !bytes.subarray(0, 7).equals(Buffer.from([127, 69, 76, 70, 2, 1, 1]))) throw Error('LINUX_ELF_HEADER')
  const arch = { 62: 'x64', 183: 'arm64' }[bytes.readUInt16LE(18)]
  if (!arch) throw Error('LINUX_ELF_ARCHITECTURE')
  return arch
}
export function verifyLinuxTray(root, platform) {
  const arch = { 'linux-x64': 'x64', 'linux-arm64': 'arm64' }[platform]
  if (!arch) throw Error('LINUX_ELF_PLATFORM')
  for (const rel of ['node', 'node_modules/systray2/traybin/tray_linux_release']) {
    const file = path.join(root, rel)
    if (!fs.lstatSync(file).isFile() || linuxElfArchitecture(fs.readFileSync(file)) !== arch) throw Error(`LINUX_ELF_ARCH_MISMATCH: ${rel}`)
    fs.accessSync(file, fs.constants.X_OK)
  }
  console.log(`LINUX_TRAY_ARCHITECTURE_VERIFIED ${arch}`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) verifyLinuxTray(process.argv[2], process.argv[3])
