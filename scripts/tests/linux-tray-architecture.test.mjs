import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { linuxElfArchitecture, verifyLinuxTray } from '../verify-linux-tray.mjs'

function elf(machine) {
  const bytes = Buffer.alloc(64)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])
  bytes.writeUInt16LE(machine, 18)
  return bytes
}
test('Linux payload architecture comes from ELF bytes, including native ARM64', () => {
  assert.equal(linuxElfArchitecture(elf(62)), 'x64')
  assert.equal(linuxElfArchitecture(elf(183)), 'arm64')
  for (const bytes of [Buffer.alloc(0), Buffer.from('#!/bin/sh'), elf(3)]) {
    assert.throws(() => linuxElfArchitecture(bytes), /LINUX_ELF/)
  }
  const bigEndian = elf(183); bigEndian[5] = 2
  assert.throws(() => linuxElfArchitecture(bigEndian), /LINUX_ELF/)
})
test('package gate refuses an x64 tray in an ARM64 package and the reverse', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-linux-elf-'))
  const tray = path.join(root, 'node_modules/systray2/traybin/tray_linux_release')
  fs.mkdirSync(path.dirname(tray), { recursive: true })
  try {
    for (const [platform, machine, wrong] of [['linux-x64', 62, 183], ['linux-arm64', 183, 62]]) {
      fs.writeFileSync(path.join(root, 'node'), elf(machine), { mode: 0o755 })
      fs.writeFileSync(tray, elf(machine), { mode: 0o755 })
      verifyLinuxTray(root, platform)
      fs.writeFileSync(tray, elf(wrong))
      assert.throws(() => verifyLinuxTray(root, platform), /LINUX_ELF_ARCH_MISMATCH/)
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
