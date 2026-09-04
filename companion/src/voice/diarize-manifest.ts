// #260 — in-repo diarize speaker-embedding model manifest (download pins).
//
// Same trust rules as whisper-manifest (basename-only names, https urls,
// sha256+size pins, manifest committed under companion/assets/, never fetched).
// Reuses the whisper manifest's zod schemas so the pin discipline cannot drift.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"

import {
  fileEntrySchema,
  modelEntrySchema,
  WhisperManifestError,
  type WhisperManifestFile,
} from "./whisper-manifest"

export { WhisperManifestError as DiarizeManifestError }
export type { WhisperManifestFile as DiarizeManifestFile }

const diarizeManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    models: z.record(modelEntrySchema),
  })
  .strict()

export type DiarizeManifest = z.infer<typeof diarizeManifestSchema>

const MANIFEST_BASENAME = "diarize-models.manifest.json"

/** Candidate local paths for the in-repo asset (never network). */
export function diarizeManifestCandidates(fromDir: string = __dirname): string[] {
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

export function resolveDiarizeManifestPath(fromDir: string = __dirname): string {
  const candidates = diarizeManifestCandidates(fromDir)
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new WhisperManifestError(
    "manifest-missing",
    `${MANIFEST_BASENAME} not found; tried: ${candidates.join(" | ")}`,
  )
}

/** Parse + Zod-validate diarize manifest JSON text. */
export function parseDiarizeManifest(rawJson: string): DiarizeManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch (err) {
    throw new WhisperManifestError(
      "manifest-invalid",
      `${MANIFEST_BASENAME} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const result = diarizeManifestSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")
    throw new WhisperManifestError(
      "manifest-invalid",
      `${MANIFEST_BASENAME} schema validation failed: ${issues}`,
    )
  }
  return result.data
}

/**
 * Load the packaged diarize model manifest from disk only (no network).
 * Throws WhisperManifestError if missing or corrupt.
 */
export function loadDiarizeManifest(fromDir: string = __dirname): DiarizeManifest {
  const sourcePath = resolveDiarizeManifestPath(fromDir)
  let raw: string
  try {
    raw = readFileSync(sourcePath, "utf-8")
  } catch (err) {
    throw new WhisperManifestError(
      "manifest-missing",
      `failed to read diarize manifest at ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return parseDiarizeManifest(raw)
}

/** Return files for a model id; throws if id absent from pinned manifest. */
export function getDiarizeModelFiles(
  modelId: string,
  manifest: DiarizeManifest = loadDiarizeManifest(),
): WhisperManifestFile[] {
  const entry = manifest.models[modelId]
  if (!entry) {
    throw new WhisperManifestError(
      "model-missing",
      `diarize model id not in manifest: ${modelId}`,
    )
  }
  return entry.files
}
