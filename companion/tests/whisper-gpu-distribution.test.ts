import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import AdmZip from "adm-zip"
import { downloadWhisperBinary, probeWhisperBinaryInstallAsync, WhisperBinaryDownloadError } from "../src/voice/whisper-binary-download"
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

test("GPU full-file verification yields to timers and still detects changed DLL bytes", async () => {
  assert.equal(typeof probeWhisperBinaryInstallAsync, "function")
  const f = fixture()
  try {
    const bytes = Buffer.alloc(8 * 1024 * 1024, 17)
    const exePath = path.join(f.root, "cmspark-whisper-win-x64.exe")
    writeFileSync(exePath, bytes)
    const entry = f.manifest.binaries["win-x64-vulkan"]!
    if (entry.kind !== "zip") throw new Error("expected zip fixture")
    entry.extract.files[0]!.size = bytes.length
    entry.extract.files[0]!.sha256 = digest(bytes)
    let timerRan = false
    setImmediate(() => { timerRan = true })
    const ready = await probeWhisperBinaryInstallAsync(f.root, "win-x64-vulkan", f.manifest)
    assert.equal(ready.status, "ready")
    assert.equal(timerRan, true, "verification must let abort and WebSocket callbacks run")
    writeFileSync(path.join(f.root, "ggml-other.DLL"), "unpinned backend")
    assert.equal((await probeWhisperBinaryInstallAsync(f.root, "win-x64-vulkan", f.manifest)).status, "incomplete", "native loader must not see unpinned extra DLLs")
    rmSync(path.join(f.root, "ggml-other.DLL"))
    bytes[1] = 18
    writeFileSync(exePath, bytes)
    assert.equal((await probeWhisperBinaryInstallAsync(f.root, "win-x64-vulkan", f.manifest)).status, "incomplete")
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(probeWhisperBinaryInstallAsync(f.root, "win-x64-vulkan", f.manifest, controller.signal), (e: unknown) => e instanceof Error && e.name === "AbortError")
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("GPU installation cancellation before extraction never promotes a runtime", async () => {
  const f = fixture()
  const controller = new AbortController()
  try {
    await assert.rejects(downloadWhisperBinary({
      arch: "win-x64-vulkan", destDir: path.join(f.root, "installed"), manifest: f.manifest,
      bundledArchivePath: f.archivePath, signal: controller.signal,
      onProgress(p) { if (p.phase === "extract") controller.abort() },
    }), (e: unknown) => e instanceof WhisperBinaryDownloadError && e.reason === "aborted")
    assert.throws(() => readFileSync(path.join(f.root, "installed", "cmspark-whisper-win-x64.exe")))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("asynchronous CPU probing retains the independent executable pin", async () => {
  const f = fixture()
  try {
    f.manifest.binaries["win-x64"] = f.manifest.binaries["win-x64-vulkan"]!
    writeFileSync(path.join(f.root, "cmspark-whisper-win-x64.exe"), f.exe)
    const probe = await probeWhisperBinaryInstallAsync(f.root, "win-x64", f.manifest)
    assert.equal(probe.status, "incomplete", "a self-consistent manifest cannot override the CPU executable pin")
    assert.match(probe.message!, /primary pin mismatch/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("cancelling a partially staged GPU install removes its owned staging files", async () => {
  const f = fixture()
  const controller = new AbortController()
  try {
    const zip = new AdmZip(f.archivePath)
    const dependency = Buffer.from("pinned dependency")
    zip.addFile("ggml.dll", dependency)
    const archive = zip.toBuffer()
    writeFileSync(f.archivePath, archive)
    const entry = f.manifest.binaries["win-x64-vulkan"]!
    if (entry.kind !== "zip") throw new Error("expected zip fixture")
    entry.size = archive.length
    entry.sha256 = digest(archive)
    entry.extract.files.push({ src: "ggml.dll", dest: "ggml.dll", sha256: digest(dependency), size: dependency.length })
    const destDir = path.join(f.root, "installed")
    await assert.rejects(downloadWhisperBinary({
      arch: "win-x64-vulkan", destDir, manifest: f.manifest, bundledArchivePath: f.archivePath,
      signal: controller.signal,
      onProgress(p) { if (p.file === "ggml.dll") controller.abort() },
    }), (e: unknown) => e instanceof WhisperBinaryDownloadError && e.reason === "aborted")
    assert.equal(existsSync(path.join(destDir, ".install-staging")), false)
    assert.equal(existsSync(path.join(destDir, "cmspark-whisper-win-x64.exe")), false)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
