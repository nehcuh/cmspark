import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import AdmZip from "adm-zip"
import { downloadWhisperBinary, WhisperBinaryDownloadError } from "../src/voice/whisper-binary-download"
import type { WhisperBinaryManifest } from "../src/voice/whisper-binary-manifest"

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "whisper-bundled-gpu-"))
  const exe = Buffer.from("pinned native executable fixture")
  const zip = new AdmZip()
  zip.addFile("cmspark-whisper-win-x64.exe", exe)
  const archive = zip.toBuffer()
  const archivePath = path.join(root, "runtime.zip")
  writeFileSync(archivePath, archive)
  const manifest: WhisperBinaryManifest = { schemaVersion: 1, binaries: {
    "win-x64-vulkan": {
      kind: "zip", version: "test", url: "https://example.invalid/runtime.zip",
      size: archive.length, sha256: digest(archive), extract: { stripPrefix: "", files: [{
        src: "cmspark-whisper-win-x64.exe", dest: "cmspark-whisper-win-x64.exe",
        size: exe.length, sha256: digest(exe),
      }] },
    },
  } }
  return { root, exe, archivePath, manifest }
}

test("explicit GPU component installation uses a pinned bundled archive without network", async () => {
  const f = fixture()
  try {
    const result = await downloadWhisperBinary({
      arch: "win-x64-vulkan", destDir: path.join(f.root, "installed"), manifest: f.manifest,
      bundledArchivePath: f.archivePath,
      fetchImpl: async () => { throw new Error("network must not be used") },
    })
    assert.deepEqual(readFileSync(result.primaryPath), f.exe)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("damaged bundled GPU archive is refused before extraction or network fallback", async () => {
  const f = fixture()
  try {
    const damaged = readFileSync(f.archivePath)
    damaged[0] = damaged[0]! ^ 1
    writeFileSync(f.archivePath, damaged)
    await assert.rejects(downloadWhisperBinary({
      arch: "win-x64-vulkan", destDir: path.join(f.root, "installed"), manifest: f.manifest,
      bundledArchivePath: f.archivePath,
      fetchImpl: async () => { throw new Error("must refuse local corruption") },
    }), (e: unknown) => e instanceof WhisperBinaryDownloadError && e.reason === "hash-mismatch")
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
