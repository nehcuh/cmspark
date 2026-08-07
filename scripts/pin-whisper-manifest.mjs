#!/usr/bin/env node
/**
 * Dev helper: refresh companion/assets/whisper-models.manifest.json pins from
 * Hugging Face ggerganov/whisper.cpp (LFS oid = content sha256 + size).
 *
 * Usage:
 *   node scripts/pin-whisper-manifest.mjs
 *   node scripts/pin-whisper-manifest.mjs --check   # exit 1 if drift vs on-disk
 *
 * Runtime never calls this — manifest is load-only from the committed asset.
 *
 * Pins (Git LFS oid == sha256 of file bytes):
 *   ggml-small.bin, ggml-medium.bin, ggml-large-v3-turbo.bin
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const OUT = path.join(ROOT, "companion", "assets", "whisper-models.manifest.json")

const REPO = "ggerganov/whisper.cpp"
const REVISION = "main"

/** Catalog id → HF filename under repo root. */
const MODELS = {
  small: "ggml-small.bin",
  medium: "ggml-medium.bin",
  "large-v3-turbo": "ggml-large-v3-turbo.bin",
}

const checkOnly = process.argv.includes("--check")

async function fetchTreeEntry(filename) {
  const url = `https://huggingface.co/api/models/${REPO}/tree/${REVISION}?recursive=false`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`HF tree API ${res.status}: ${url}`)
  }
  const items = await res.json()
  const hit = items.find((it) => it.path === filename)
  if (!hit) {
    throw new Error(`file not found on HF tree: ${filename}`)
  }
  // Prefer LFS oid (content sha256). Fall back to HEAD x-linked-etag.
  if (hit.lfs?.oid && hit.lfs?.size != null) {
    return { sha256: hit.lfs.oid, size: hit.lfs.size }
  }
  return fetchViaHead(filename)
}

async function fetchViaHead(filename) {
  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${filename}`
  const res = await fetch(url, { method: "HEAD", redirect: "follow" })
  if (!res.ok) {
    throw new Error(`HEAD ${res.status}: ${url}`)
  }
  const sizeHdr =
    res.headers.get("x-linked-size") || res.headers.get("content-length")
  const etag =
    res.headers.get("x-linked-etag") || res.headers.get("etag") || ""
  const sha = etag.replaceAll('"', "").toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    throw new Error(`could not resolve sha256 for ${filename} (etag=${etag})`)
  }
  const size = Number(sizeHdr)
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`could not resolve size for ${filename}`)
  }
  return { sha256: sha, size }
}

async function main() {
  const models = {}
  for (const [id, name] of Object.entries(MODELS)) {
    process.stderr.write(`pin: ${id} → ${name} ... `)
    const { sha256, size } = await fetchTreeEntry(name)
    process.stderr.write(`${sha256.slice(0, 12)}… size=${size}\n`)
    models[id] = {
      files: [
        {
          name,
          url: `https://huggingface.co/${REPO}/resolve/${REVISION}/${name}`,
          sha256,
          size,
        },
      ],
    }
  }

  const manifest = {
    schemaVersion: 1,
    models,
  }
  const text = `${JSON.stringify(manifest, null, 2)}\n`

  if (checkOnly) {
    if (!existsSync(OUT)) {
      console.error(`missing ${OUT}`)
      process.exit(1)
    }
    const onDisk = readFileSync(OUT, "utf-8")
    const a = createHash("sha256").update(onDisk).digest("hex")
    const b = createHash("sha256").update(text).digest("hex")
    // Compare parsed content (ignore trailing whitespace noise)
    const diskObj = JSON.parse(onDisk)
    if (JSON.stringify(diskObj) !== JSON.stringify(manifest)) {
      console.error("whisper-models.manifest.json DRIFT vs Hugging Face pins")
      console.error(`  on-disk hash: ${a}`)
      console.error(`  fresh hash:   ${b}`)
      process.exit(1)
    }
    console.log("OK: whisper-models.manifest.json matches HF pins")
    return
  }

  writeFileSync(OUT, text, "utf-8")
  console.log(`wrote ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
