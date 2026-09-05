/**
 * In-repo Qwen3-VL integrity pins (#359 / CU-A).
 *
 * Trust rules (whisper-models.manifest.json discipline):
 *   1. Manifest is committed under companion/assets/; runtime never fetches it.
 *   2. Each file pin: { name basename-only, https url, sha256 64 hex, size }.
 *   3. Mirrors (hf-mirror / ModelScope) rewrite only the URL origin — sha256/size stay.
 *   4. Pins: weight *.safetensors sha256 from HuggingFace tree API `lfs.oid`
 *      (git-lfs blob sha256). Sidecars content-hashed from huggingface.co/resolve/main
 *      on 2026-09-05 (identical git blobs reused across variants).
 */

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { QwenVlVariant } from "./qwen-vl-catalog"

export class QwenVlManifestError extends Error {
  readonly code: "manifest-missing" | "manifest-invalid" | "variant-missing"
  constructor(code: QwenVlManifestError["code"], message: string) {
    super(message)
    this.name = "QwenVlManifestError"
    this.code = code
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/
const sha256Schema = z.string().regex(SHA256_RE, "sha256 must be 64 lowercase hex")

export const qwenVlFileEntrySchema = z
  .object({
    name: z.string().min(1).regex(/^[^/\\]+$/, "name must be basename only"),
    url: z.string().refine((u) => u.startsWith("https://"), { message: "url must start with https://" }),
    sha256: sha256Schema,
    size: z.number().int().positive(),
  })
  .strict()

const variantEntrySchema = z
  .object({
    hfRepo: z.string().min(1),
    files: z.array(qwenVlFileEntrySchema).min(1),
  })
  .strict()

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    pinnedRevision: z.string().min(1),
    pinnedAt: z.string().min(1),
    variants: z.object({
      "2b": variantEntrySchema,
      "4b": variantEntrySchema,
      "8b": variantEntrySchema,
    }),
  })
  .strict()

export type QwenVlManifestFile = z.infer<typeof qwenVlFileEntrySchema>
export type QwenVlManifest = z.infer<typeof manifestSchema>

const MANIFEST_BASENAME = "qwen-vl.manifest.json"
const HUGGINGFACE_HOST = "huggingface.co"

export const QWEN_VL_MANIFEST_BASENAME = MANIFEST_BASENAME

/** Candidate local paths (never network). */
export function qwenVlManifestCandidates(fromDir: string = __dirname): string[] {
  return [
    path.join(fromDir, "..", "..", "assets", MANIFEST_BASENAME),
    path.join(fromDir, "..", "..", "..", "assets", MANIFEST_BASENAME),
    path.join(fromDir, "assets", MANIFEST_BASENAME),
    path.join(fromDir, "..", "assets", MANIFEST_BASENAME),
    path.join(process.cwd(), "assets", MANIFEST_BASENAME),
    path.join(process.cwd(), "companion", "assets", MANIFEST_BASENAME),
  ]
}

export function resolveQwenVlManifestPath(fromDir: string = __dirname): string {
  const candidates = qwenVlManifestCandidates(fromDir)
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new QwenVlManifestError(
    "manifest-missing",
    `${MANIFEST_BASENAME} not found; tried: ${candidates.join(" | ")}`,
  )
}

export function parseQwenVlManifest(rawJson: string): QwenVlManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch (err) {
    throw new QwenVlManifestError(
      "manifest-invalid",
      `${MANIFEST_BASENAME} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const result = manifestSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")
    throw new QwenVlManifestError(
      "manifest-invalid",
      `${MANIFEST_BASENAME} schema validation failed: ${issues}`,
    )
  }
  return result.data
}

let testOverride: QwenVlManifest | null = null

/** Test seam only — never a production download-generated manifest. */
export function _setQwenVlManifestForTests(manifest: QwenVlManifest | null): void {
  testOverride = manifest
}

export function loadQwenVlManifest(fromDir: string = __dirname): QwenVlManifest {
  if (testOverride) return testOverride
  const sourcePath = resolveQwenVlManifestPath(fromDir)
  let raw: string
  try {
    raw = readFileSync(sourcePath, "utf-8")
  } catch (err) {
    throw new QwenVlManifestError(
      "manifest-missing",
      `failed to read Qwen-VL manifest at ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return parseQwenVlManifest(raw)
}

export function getQwenVlPinnedFiles(
  variant: QwenVlVariant,
  manifest: QwenVlManifest = loadQwenVlManifest(),
): QwenVlManifestFile[] {
  const entry = manifest.variants[variant]
  if (!entry) {
    throw new QwenVlManifestError("variant-missing", `Qwen-VL variant not in manifest: ${variant}`)
  }
  return entry.files
}

export function qwenVlWeightFiles(files: QwenVlManifestFile[]): QwenVlManifestFile[] {
  return files.filter((f) => f.name.endsWith(".safetensors"))
}

/**
 * Mirror rewrite: only the URL origin/host changes. sha256 and size on the pin
 * are never touched (HF / hf-mirror / a modelscope https origin).
 */
export function rewriteQwenFileUrl(url: string, endpoint: string): string {
  if (!endpoint) return url
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  if (u.hostname !== HUGGINGFACE_HOST) return url
  let ep: URL
  try {
    ep = new URL(endpoint)
  } catch {
    return url
  }
  if (ep.protocol !== "https:") return url
  u.protocol = ep.protocol
  u.host = ep.host
  return u.href
}
