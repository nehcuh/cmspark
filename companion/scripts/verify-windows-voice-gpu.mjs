#!/usr/bin/env node
// Real production-consumer acceptance. Explicit execution installs components only
// under --data-dir; it never opens the user's configuration or records a microphone.
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import assert from "node:assert/strict"

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i]?.startsWith("--") || !process.argv[i + 1]) throw new Error("Expected --name value arguments")
  args.set(process.argv[i].slice(2), process.argv[i + 1])
}
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Requires Windows x64 Node")
for (const key of ["data-dir", "model", "audio", "output"]) if (!args.has(key)) throw new Error(`Missing --${key}`)
const dataDir = path.resolve(args.get("data-dir"))
const modelPath = path.resolve(args.get("model"))
const audioPath = path.resolve(args.get("audio"))
fs.mkdirSync(dataDir, { recursive: true })
process.env.CMSPARK_DATA_DIR = dataDir
const require = createRequire(import.meta.url)
const companion = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const { downloadWhisperBinary } = require(path.join(companion, "dist/voice/whisper-binary-download.js"))
const { runWhisperTranscribe } = require(path.join(companion, "dist/voice/whisper-runner.js"))
const { loadWhisperBinaryManifest } = require(path.join(companion, "dist/voice/whisper-binary-manifest.js"))
const { inspectWhisperAcceleration } = require(path.join(companion, "dist/voice/whisper-acceleration.js"))
const manifest = loadWhisperBinaryManifest(path.join(companion, "assets/whisper-binary.manifest.json"))

for (const backend of ["cpu", "cuda", "vulkan"]) {
  await downloadWhisperBinary({
    arch: backend === "cpu" ? "win-x64" : `win-x64-${backend}`,
    destDir: path.join(dataDir, "bin/whisper/win-x64", backend === "cpu" ? "" : backend),
    manifest,
    ...(backend === "cuda" && args.has("cuda-archive") ? { bundledArchivePath: path.resolve(args.get("cuda-archive")) } : {}),
  })
}
const binaryPath = path.join(dataDir, "bin/whisper/win-x64/cmspark-whisper-win-x64.exe")
const base = { binaryPath, modelPath, audioPath, lang: args.get("lang") ?? "en", timeoutMs: 90_000 }
const execute = promisify(execFile)
async function hashFile(file) {
  const hash = createHash("sha256")
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes)
  return hash.digest("hex")
}
const results = []
for (const backend of ["cuda", "vulkan", "cpu"]) {
  const samples = []
  let sampling = false
  const sample = async () => {
    if (sampling || samples.length >= 180) return
    sampling = true
    try {
      const { stdout } = await execute("nvidia-smi", ["--query-gpu=name,utilization.gpu,memory.used", "--format=csv,noheader,nounits"], { timeout: 3000, windowsHide: true })
      samples.push({ at: Date.now(), csv: stdout.trim() })
    } finally { sampling = false }
  }
  await sample()
  const interval = setInterval(() => void sample().catch(() => {}), 250)
  let result
  try {
    result = await runWhisperTranscribe({ ...base, acceleration: { dataDir, strictBackend: backend } })
  } finally { clearInterval(interval) }
  assert.equal(result.execution?.backend, backend, `Missing actual ${backend} execution evidence`)
  assert.ok(result.text.trim().length >= 10, "Expected useful speech transcription")
  if (backend !== "cpu") assert.match(result.execution.device, /4080 SUPER/, "This acceptance must use the local RTX 4080 SUPER")
  results.push({ backend, ...result, gpuSamples: samples })
  console.log(`${backend}: ${result.ms}ms; actual=${result.execution.backend}; device=${result.execution.device ?? "CPU"}; ${result.text}`)
}

const automatic = await runWhisperTranscribe({ ...base, acceleration: { dataDir } })
assert.equal(automatic.execution?.backend, "cuda", "Automatic selection must prefer CUDA on the local NVIDIA device")
const automaticState = await inspectWhisperAcceleration({ dataDir })
assert.equal(automaticState.plannedBackend, "cuda")
assert.equal(automaticState.latest?.backend, "cuda")
assert.ok(automaticState.adapters.some((a) => a.kind === "physical" && /4080 SUPER/.test(a.name)))

// A process-local CUDA visibility mask exercises a real unavailable-device fallback.
// nvidia-smi/Windows inventory remain unchanged, and no system driver is altered.
const oldVisibleDevices = process.env.CUDA_VISIBLE_DEVICES
let fallback
try {
  process.env.CUDA_VISIBLE_DEVICES = "-1"
  fallback = await runWhisperTranscribe({ ...base, acceleration: { dataDir } })
} finally {
  if (oldVisibleDevices === undefined) delete process.env.CUDA_VISIBLE_DEVICES
  else process.env.CUDA_VISIBLE_DEVICES = oldVisibleDevices
}
assert.equal(fallback.execution?.backend, "cpu")
assert.match(fallback.execution.fallbackReason, /^cuda_(failed|unproven)$/)
assert.ok(fallback.text.length >= 10)

// Abort an actual native child, rather than a preflight/hash operation, then recover.
const controller = new AbortController()
let cancelledPid
let abortTimer
await assert.rejects(runWhisperTranscribe({
  ...base, signal: controller.signal, acceleration: { dataDir, strictBackend: "cuda" },
  execFileImpl(file, argv, options, callback) {
    const child = execFile(file, argv, options, callback)
    child.once("spawn", () => {
      cancelledPid = child.pid
      abortTimer = setTimeout(() => controller.abort(), 150)
    })
    return child
  },
}), (e) => e.code === "aborted")
clearTimeout(abortTimer)
assert.ok(cancelledPid, "Cancellation must reach a real spawned process")
assert.throws(() => process.kill(cancelledPid, 0), "Cancelled native process must have exited")
const recovered = await runWhisperTranscribe({ ...base, acceleration: { dataDir, strictBackend: "cuda" } })
assert.equal(recovered.execution?.backend, "cuda")
assert.ok(recovered.text.length >= 10)
const evidence = {
  generatedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`,
  model: { name: path.basename(modelPath), bytes: fs.statSync(modelPath).size, sha256: await hashFile(modelPath) },
  audio: { name: path.basename(audioPath), bytes: fs.statSync(audioPath).size, sha256: await hashFile(audioPath) },
  manifestSha256: await hashFile(path.join(companion, "assets/whisper-binary.manifest.json")),
  results, automatic: { result: automatic, state: automaticState }, fallback,
  cancellation: { actualChildStarted: true, exited: true, recovery: recovered },
  limitations: ["NVIDIA activity samples are host-wide, not per-process attribution.", "AMD and Intel physical devices were not available on this host.", "CLI process and model load run once per request; this does not measure recording/UI latency."],
}
fs.writeFileSync(path.resolve(args.get("output")), `${JSON.stringify(evidence, null, 2)}\n`)
