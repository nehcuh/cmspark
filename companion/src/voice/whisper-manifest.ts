// Path B M0 — in-repo Whisper model manifest (download pins).
//
// Trust rules (aligned with computer/model-manifest discipline, simplified):
//   1. Manifest is committed under companion/assets/; runtime never fetches it.
//   2. Each file pin: { name basename-only, https url, sha256 64 hex, size }.
//   3. Refresh pins via: node scripts/pin-whisper-manifest.mjs
//
// Asset path resolution covers:
//   - companion/src/voice → companion/assets (dev/tsx)
//   - companion/dist/voice → companion/assets (tsc)
//   - companion/.test-dist/src/voice → companion/assets (tsconfig.test.json)
//   - packaged flat layout (assets next to bundle)

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"

export class WhisperManifestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "WhisperManifestError"
    this.code = code
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/
const sha256Schema = z.string().regex(SHA256_RE, "sha256 must be 64 lowercase hex")

/** Exported for the #260 diarize manifest — identical pin discipline. */
export const fileEntrySchema = z
  .object({
    name: z.string().min(1).regex(/^[^/\\]+$/, "name must be basename only"),
    url: z.string().refine((u) => u.startsWith("https://"), {
      message: "url must start with https://",
    }),
    sha256: sha256Schema,
    size: z.number().int().positive(),
  })
  .strict()

/** Exported for the #260 diarize manifest — identical pin discipline. */
export const modelEntrySchema = z
  .object({
    files: z.array(fileEntrySchema).min(1),
  })
  .strict()

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    models: z.record(modelEntrySchema),
  })
  .strict()

export type WhisperManifest = z.infer<typeof manifestSchema>
export type WhisperManifestFile = z.infer<typeof fileEntrySchema>
export type WhisperManifestModel = z.infer<typeof modelEntrySchema>

const MANIFEST_BASENAME = "whisper-models.manifest.json"

/** Candidate local paths for the in-repo asset (never network). */
export function whisperManifestCandidates(fromDir: string = __dirname): string[] {
  return [
    // companion/src/voice or companion/dist/voice → companion/assets
    path.join(fromDir, "..", "..", "assets", MANIFEST_BASENAME),
    // companion/.test-dist/src/voice → companion/assets
    path.join(fromDir, "..", "..", "..", "assets", MANIFEST_BASENAME),
    // packaged: assets next to compiled module dir
    path.join(fromDir, "assets", MANIFEST_BASENAME),
    path.join(fromDir, "..", "assets", MANIFEST_BASENAME),
  ]
}

export function resolveWhisperManifestPath(fromDir: string = __dirname): string {
  const candidates = whisperManifestCandidates(fromDir)
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new WhisperManifestError(
    "manifest-missing",
    `whisper-models.manifest.json not found; tried: ${candidates.join(" | ")}`,
  )
}

/** Parse + Zod-validate manifest JSON text. */
export function parseWhisperManifest(rawJson: string): WhisperManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch (err) {
    throw new WhisperManifestError(
      "manifest-invalid",
      `whisper-models.manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const result = manifestSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")
    throw new WhisperManifestError(
      "manifest-invalid",
      `whisper-models.manifest.json schema validation failed: ${issues}`,
    )
  }
  return result.data
}

/**
 * Load the packaged whisper model manifest from disk only (no network).
 * Throws WhisperManifestError if missing or corrupt.
 */
export function loadWhisperManifest(fromDir: string = __dirname): WhisperManifest {
  const sourcePath = resolveWhisperManifestPath(fromDir)
  let raw: string
  try {
    raw = readFileSync(sourcePath, "utf-8")
  } catch (err) {
    throw new WhisperManifestError(
      "manifest-missing",
      `failed to read whisper manifest at ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return parseWhisperManifest(raw)
}

/** Return files for a catalog id; throws if id absent from pinned manifest. */
export function getWhisperModelFiles(
  modelId: string,
  manifest: WhisperManifest = loadWhisperManifest(),
): WhisperManifestFile[] {
  const entry = manifest.models[modelId]
  if (!entry) {
    throw new WhisperManifestError(
      "model-missing",
      `whisper model id not in manifest: ${modelId}`,
    )
  }
  return entry.files
}
