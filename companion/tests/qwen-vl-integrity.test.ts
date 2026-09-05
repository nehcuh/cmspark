/**
 * #359 — Qwen3-VL release-pinned sha256 integrity.
 * Must import test-env first so mismatch disarm cannot touch ~/.cmspark-agent.
 */
import "./computer-model-test-env"
import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createHash } from "node:crypto"
import {
  loadQwenVlManifest,
  parseQwenVlManifest,
  rewriteQwenFileUrl,
  getQwenVlPinnedFiles,
  qwenVlWeightFiles,
  _setQwenVlManifestForTests,
  type QwenVlManifest,
} from "../src/computer/qwen-vl-manifest"
import {
  probeQwenPinnedFiles,
  probeQwenModelDir,
  qwenModelDir,
  clearQwenModelEnabledOnIntegrityFailure,
} from "../src/computer/qwen-vl-download"
import { QwenVlRuntime } from "../src/computer/qwen-vl-runtime"
import { QwenVlSession } from "../src/computer/qwen-vl-session"
import { clearConfigCache, getConfig, saveConfig } from "../src/config"

function sha(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex")
}

function miniManifest(files: { name: string; body: Buffer }[]): {
  manifest: QwenVlManifest
  files: { name: string; sha256: string; size: number; url: string }[]
} {
  const pinned = files.map((f) => ({
    name: f.name,
    sha256: sha(f.body),
    size: f.body.length,
    url: `https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct/resolve/main/${f.name}`,
  }))
  const variant = { hfRepo: "Qwen/Qwen3-VL-2B-Instruct", files: pinned }
  const manifest: QwenVlManifest = {
    schemaVersion: 1,
    pinnedRevision: "test",
    pinnedAt: "2026-09-05",
    variants: { "2b": variant, "4b": variant, "8b": variant },
  }
  return { manifest, files: pinned }
}

afterEach(() => {
  _setQwenVlManifestForTests(null)
})

test("in-repo qwen-vl.manifest.json pins 2b/4b/8b with weight sha256", () => {
  const m = loadQwenVlManifest()
  assert.equal(m.schemaVersion, 1)
  for (const v of ["2b", "4b", "8b"] as const) {
    const files = getQwenVlPinnedFiles(v, m)
    assert.ok(files.some((f) => f.name === "config.json"))
    const weights = qwenVlWeightFiles(files)
    assert.ok(weights.length >= 1, `${v} must pin safetensors`)
    for (const f of files) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/)
      assert.ok(f.size > 0)
      assert.ok(f.url.startsWith("https://huggingface.co/"))
    }
  }
  const w2 = qwenVlWeightFiles(getQwenVlPinnedFiles("2b", m))
  assert.equal(w2[0]!.name, "model.safetensors")
  assert.equal(w2[0]!.sha256, "7de1838c87a5349b016c26a1c3f7d2bc400a3d485f95ef39a7059ffd734977a0")
  assert.equal(w2[0]!.size, 4255140312)
})

test("manifest rejects non-https url (never a runtime-fetched pin)", () => {
  assert.throws(
    () =>
      parseQwenVlManifest(
        JSON.stringify({
          schemaVersion: 1,
          pinnedRevision: "x",
          pinnedAt: "x",
          variants: {
            "2b": {
              hfRepo: "Qwen/x",
              files: [
                {
                  name: "config.json",
                  url: "http://evil.example/config.json",
                  sha256: "a".repeat(64),
                  size: 1,
                },
              ],
            },
            "4b": {
              hfRepo: "Qwen/x",
              files: [
                { name: "config.json", url: "https://huggingface.co/x", sha256: "a".repeat(64), size: 1 },
              ],
            },
            "8b": {
              hfRepo: "Qwen/x",
              files: [
                { name: "config.json", url: "https://huggingface.co/x", sha256: "a".repeat(64), size: 1 },
              ],
            },
          },
        }),
      ),
    /https/,
  )
})

test("mirror origin rewrite does not change sha256/size", () => {
  const m = loadQwenVlManifest()
  const files = getQwenVlPinnedFiles("2b", m)
  const original = files.map((f) => ({ sha256: f.sha256, size: f.size, name: f.name }))
  const rewritten = files.map((f) => ({
    ...f,
    url: rewriteQwenFileUrl(f.url, "https://hf-mirror.com"),
  }))
  assert.ok(rewritten.some((f) => f.url.startsWith("https://hf-mirror.com/")))
  for (let i = 0; i < files.length; i++) {
    assert.equal(rewritten[i]!.sha256, original[i]!.sha256)
    assert.equal(rewritten[i]!.size, original[i]!.size)
  }
  const ms = rewriteQwenFileUrl(files[0]!.url, "https://www.modelscope.cn")
  assert.match(ms, /^https:\/\/www\.modelscope\.cn\//)
  assert.equal(files[0]!.sha256, original[0]!.sha256)
})

test("missing pinned file → model-file-missing, not ready", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-int-"))
  const weight = Buffer.from("WEIGHT-BYTES-OK")
  const { manifest, files } = miniManifest([
    { name: "config.json", body: Buffer.from('{"a":1}') },
    { name: "model.safetensors", body: weight },
  ])
  _setQwenVlManifestForTests(manifest)
  fs.writeFileSync(path.join(dir, "config.json"), '{"a":1}')
  const probe = probeQwenPinnedFiles(dir, files)
  assert.equal(probe.status, "error")
  assert.equal(probe.error, "model-file-missing")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("tampered safetensors → sha256-mismatch, not ready (not stat-only)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-int-"))
  const good = Buffer.from("WEIGHT-BYTES-OK")
  const bad = Buffer.from("WEIGHT-BYTES-NO")
  assert.equal(good.length, bad.length, "same size so stat-only would pass")
  const { manifest, files } = miniManifest([
    { name: "config.json", body: Buffer.from('{"a":1}') },
    { name: "model.safetensors", body: good },
  ])
  _setQwenVlManifestForTests(manifest)
  fs.writeFileSync(path.join(dir, "config.json"), '{"a":1}')
  fs.writeFileSync(path.join(dir, "model.safetensors"), bad)
  const probe = probeQwenPinnedFiles(dir, files)
  assert.equal(probe.status, "error")
  assert.equal(probe.error, "sha256-mismatch")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("matching pins → ready", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-int-"))
  const cfg = Buffer.from('{"a":1}')
  const weight = Buffer.from("WEIGHT-BYTES-OK")
  const { manifest, files } = miniManifest([
    { name: "config.json", body: cfg },
    { name: "model.safetensors", body: weight },
  ])
  _setQwenVlManifestForTests(manifest)
  fs.writeFileSync(path.join(dir, "config.json"), cfg)
  fs.writeFileSync(path.join(dir, "model.safetensors"), weight)
  const probe = probeQwenPinnedFiles(dir, files)
  assert.equal(probe.status, "ready")
  assert.equal(probe.sizeBytes, cfg.length + weight.length)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("worker load refuses tampered weights and does not infer", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-int-"))
  const cfg = Buffer.from('{"a":1}')
  const good = Buffer.from("WEIGHT-BYTES-OK")
  const bad = Buffer.from("WEIGHT-BYTES-NO")
  const { manifest } = miniManifest([
    { name: "config.json", body: cfg },
    { name: "model.safetensors", body: good },
  ])
  _setQwenVlManifestForTests(manifest)
  fs.writeFileSync(path.join(dir, "config.json"), cfg)
  fs.writeFileSync(path.join(dir, "model.safetensors"), bad)

  let loads = 0
  let infers = 0
  const rt = new QwenVlRuntime({
    variant: "2b",
    modelDir: dir,
    pythonBin: process.execPath,
    transport: {
      async load() {
        loads += 1
      },
      async infer() {
        infers += 1
        return { x: 1, y: 1 }
      },
      async dispose() {},
    },
  })
  await assert.rejects(() => rt.prepare(), /sha256-mismatch|integrity/)
  assert.equal(loads, 0, "transport.load must not run on mismatch")
  await assert.rejects(() => rt.infer({ imagePath: "x", command: "y", width: 1, height: 1 }), /not prepared/)
  assert.equal(infers, 0, "infer must not run")
  fs.rmSync(dir, { recursive: true, force: true })
})

test("empty dir is absent (production 2b without download)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-root-"))
  const probe = probeQwenModelDir("2b", tmp)
  assert.equal(probe.status, "absent")
  fs.rmSync(tmp, { recursive: true, force: true })
})

test("qwenModelDir still uses qwen3-vl-<variant>", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-root-"))
  assert.equal(path.basename(qwenModelDir("2b", tmp)), "qwen3-vl-2b")
  fs.rmSync(tmp, { recursive: true, force: true })
})

test("config.json alone against production pins is not ready (old probe regression)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-root-"))
  const dir = qwenModelDir("2b", tmp)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "config.json"), '{"architectures":["Qwen3VLForConditionalGeneration"]}')
  const probe = probeQwenModelDir("2b", tmp)
  assert.equal(probe.status, "error")
  assert.equal(probe.error, "model-file-missing")
  fs.rmSync(tmp, { recursive: true, force: true })
})

test("integrity failure clears modelEnabled (must not stay true)", () => {
  clearConfigCache()
  saveConfig({ computer: { coordinateEnabled: false, modelEnabled: true } } as any)
  clearConfigCache()
  assert.equal(getConfig().computer?.modelEnabled, true)
  clearQwenModelEnabledOnIntegrityFailure("2b", { status: "error", error: "sha256-mismatch" })
  clearConfigCache()
  assert.equal(getConfig().computer?.modelEnabled, false)
})

test("session.prepare missing weight → model-file-missing, no infer", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-int-"))
  const cfg = Buffer.from('{"a":1}')
  const weight = Buffer.from("WEIGHT-BYTES-OK")
  const { manifest } = miniManifest([
    { name: "config.json", body: cfg },
    { name: "model.safetensors", body: weight },
  ])
  _setQwenVlManifestForTests(manifest)
  fs.writeFileSync(path.join(dir, "config.json"), cfg)
  const sess = new QwenVlSession({
    variant: "2b",
    modelDir: dir,
    pythonBin: process.execPath,
  })
  await assert.rejects(() => sess.prepare(), (err: unknown) => {
    assert.ok(err && typeof err === "object" && "code" in err)
    assert.equal((err as { code: string }).code, "model-file-missing")
    return true
  })
  fs.rmSync(dir, { recursive: true, force: true })
})
