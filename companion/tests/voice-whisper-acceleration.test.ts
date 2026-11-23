import test, { type TestContext } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  inspectWhisperAcceleration,
  parseWhisperBackendEvidence,
  parseWindowsWhisperAdapters,
  selectWindowsWhisperRuntime,
} from "../src/voice/whisper-acceleration"
import type { WhisperBinaryManifest } from "../src/voice/whisper-binary-manifest"

const nvidia = { Name: "NVIDIA GeForce RTX 4080 SUPER", PNPDeviceID: "PCI\\VEN_10DE&DEV_2702", AdapterRAM: 4293918720, ConfigManagerErrorCode: 0, DriverVersion: "32.0.16.1088" }
const amd = { Name: "AMD Radeon RX 7700 XT", PNPDeviceID: "PCI\\VEN_1002&DEV_747E", ConfigManagerErrorCode: 0 }
const intel = { Name: "Intel Arc A750", PNPDeviceID: "PCI\\VEN_8086&DEV_56A1", ConfigManagerErrorCode: 0 }
const virtual = { Name: "OrayIddDriver Device", PNPDeviceID: "ROOT\\DISPLAY\\0000", ConfigManagerErrorCode: 0 }
const disabled = { Name: "NVIDIA GeForce RTX 3080", PNPDeviceID: "PCI\\VEN_10DE&DEV_2206", ConfigManagerErrorCode: 22 }

test("Windows inventory preserves physical and virtual adapters and corrects NVIDIA VRAM", () => {
  const adapters = parseWindowsWhisperAdapters(
    JSON.stringify([virtual, nvidia, amd, intel]),
    "00000000:01:00.0, NVIDIA GeForce RTX 4080 SUPER, 16376",
  )
  assert.deepEqual(adapters, [
    { name: "OrayIddDriver Device", kind: "virtual", vendor: "other" },
    { name: "NVIDIA GeForce RTX 4080 SUPER", kind: "physical", vendor: "nvidia", driverVersion: "32.0.16.1088", vramMB: 16376 },
    { name: "AMD Radeon RX 7700 XT", kind: "physical", vendor: "amd" },
    { name: "Intel Arc A750", kind: "physical", vendor: "intel" },
  ])
})

test("NVIDIA VRAM is omitted when identical names make the report ambiguous", () => {
  const adapters = parseWindowsWhisperAdapters(
    JSON.stringify([nvidia, { ...nvidia, PNPDeviceID: "PCI\\VEN_10DE&DEV_2702&SUBSYS_FFFF" }]),
    "00000000:01:00.0, NVIDIA GeForce RTX 4080 SUPER, 16376\n00000000:02:00.0, NVIDIA GeForce RTX 4080 SUPER, 8192",
  )
  assert.equal(adapters.length, 2)
  assert.ok(adapters.every((adapter) => adapter.vramMB === undefined))
})

function runtimeFixture(t: TestContext) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "whisper-acceleration-test-"))
  t.after(() => rmSync(dataDir, { recursive: true, force: true }))
  const manifest: WhisperBinaryManifest = { schemaVersion: 1, binaries: {} }
  for (const backend of ["cuda", "vulkan"] as const) {
    const dir = path.join(dataDir, "bin", "whisper", "win-x64", backend)
    mkdirSync(dir, { recursive: true })
    const files = [`cmspark-whisper-${backend}.exe`, `ggml-${backend}.dll`].map((name) => {
      const bytes = Buffer.from(name)
      writeFileSync(path.join(dir, name), bytes)
      return { name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), url: `https://example.test/${name}` }
    })
    manifest.binaries[`win-x64-${backend}`] = { kind: "file", files, version: "test" }
  }
  return { dataDir, manifest, platform: "win32" as const, arch: "x64" }
}

function hardware(rows: unknown, cudaDriver = true, vulkanLoader = true) {
  return { adapters: parseWindowsWhisperAdapters(JSON.stringify(rows)), cudaDriver, vulkanLoader, inventoryAvailable: true }
}

test("Windows auto prioritizes CUDA, then Vulkan, then CPU", async (t) => {
  const fixture = runtimeFixture(t)
  const select = (rows: unknown, cudaDriver = true, vulkanLoader = true) =>
    selectWindowsWhisperRuntime({ ...fixture, detectHardware: async () => hardware(rows, cudaDriver, vulkanLoader) })
  assert.equal((await select([amd, nvidia, intel])).backend, "cuda")
  assert.equal((await select([amd, nvidia, intel], false)).backend, "vulkan")
  assert.equal((await select([amd, intel])).backend, "vulkan")
  assert.equal((await select([virtual, disabled])).backend, "cpu")
  assert.equal((await select([amd, intel], false, false)).backend, "cpu")
})

test("incomplete GPU installs are ineligible and file changes are reverified", async (t) => {
  const fixture = runtimeFixture(t)
  const opts = { ...fixture, detectHardware: async () => hardware([nvidia]) }
  const cudaDll = path.join(fixture.dataDir, "bin", "whisper", "win-x64", "cuda", "ggml-cuda.dll")
  const vulkanDll = path.join(fixture.dataDir, "bin", "whisper", "win-x64", "vulkan", "ggml-vulkan.dll")
  assert.equal((await selectWindowsWhisperRuntime(opts)).backend, "cuda")
  writeFileSync(cudaDll, "bad!-cuda.dll")
  assert.equal((await selectWindowsWhisperRuntime(opts)).backend, "vulkan")
  rmSync(vulkanDll)
  const snapshot = await inspectWhisperAcceleration(opts)
  assert.equal(snapshot.runtimes.cuda.status, "incomplete")
  assert.equal(snapshot.runtimes.vulkan.status, "incomplete")
  assert.equal(snapshot.plannedBackend, "cpu")
})

test("runtime selection and state probing yield to the event loop during GPU file verification", async (t) => {
  const fixture = runtimeFixture(t)
  const entry = fixture.manifest.binaries["win-x64-cuda"]
  assert.ok(entry?.kind === "file")
  const dependency = entry.files.find((file) => file.name === "ggml-cuda.dll")!
  const payload = Buffer.alloc(8 * 1024 * 1024, 17)
  writeFileSync(path.join(fixture.dataDir, "bin", "whisper", "win-x64", "cuda", dependency.name), payload)
  dependency.size = payload.length
  dependency.sha256 = createHash("sha256").update(payload).digest("hex")
  const opts = { ...fixture, detectHardware: async () => hardware([nvidia]) }
  let loopTurn = false
  setImmediate(() => { loopTurn = true })
  assert.equal((await selectWindowsWhisperRuntime(opts)).backend, "cuda")
  assert.equal(loopTurn, true, "automatic verification blocked the event loop")
  loopTurn = false
  setImmediate(() => { loopTurn = true })
  assert.equal((await inspectWhisperAcceleration(opts)).runtimes.cuda.status, "ready")
  assert.equal(loopTurn, true, "model-state verification blocked the event loop")
})

test("Windows ARM64 and other platforms do not probe GPU candidates", async () => {
  for (const [platform, arch] of [["win32", "arm64"], ["linux", "x64"], ["darwin", "arm64"]] as const) {
    const result = await inspectWhisperAcceleration({
      platform, arch, detectHardware: async () => { throw new Error("unsupported host probed") },
    })
    assert.equal(result.supported, false)
    assert.equal(result.plannedBackend, "cpu")
  }
})

test("Vulkan reports the runtime's chosen ordinal, independently from adapter order", () => {
  const diagnostics = [
    "ggml_vulkan: 0 = Intel Arc A750 (Intel Corporation) | uma: 0 | fp16: 1",
    "ggml_vulkan: 1 = AMD Radeon RX 7700 XT (AMD) | uma: 0 | fp16: 1",
    "whisper_model_load:      Vulkan1 total size =  1533.14 MB",
    "whisper_backend_init_gpu: using Vulkan1 backend",
  ].join("\r\n")
  assert.deepEqual(parseWhisperBackendEvidence("vulkan", diagnostics), { device: "AMD Radeon RX 7700 XT" })
  assert.equal(parseWhisperBackendEvidence("cuda", diagnostics), undefined)
  assert.equal(parseWhisperBackendEvidence("vulkan", diagnostics.replace("Vulkan1 total", "Vulkan0 total")), undefined)
  assert.equal(parseWhisperBackendEvidence("vulkan", diagnostics.replace("AMD Radeon RX 7700 XT", "llvmpipe")), undefined)
})
