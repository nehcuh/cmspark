/**
 * Path B — whisper runtime binary manifest (ADR-023 L5).
 * In-repo pins for auto-download of cmspark-whisper + DLLs (not model weights).
 */

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"

const SHA256_RE = /^[0-9a-f]{64}$/

const sha256Schema = z.string().regex(SHA256_RE, "sha256 must be 64 lowercase hex")

const extractFileSchema = z.object({
  src: z.string().min(1),
  dest: z.string().min(1).refine((n) => !n.includes("..") && !n.includes("/") && !n.includes("\\"), {
    message: "dest must be basename-only",
  }),
  sha256: sha256Schema,
  size: z.number().int().positive(),
})

const zipBinarySchema = z.object({
  kind: z.literal("zip"),
  version: z.string().min(1),
  url: z.string().url().refine((u) => u.startsWith("https://"), { message: "url must be https" }),
  sha256: sha256Schema,
  size: z.number().int().positive(),
  extract: z.object({
    stripPrefix: z.string().default(""),
    files: z.array(extractFileSchema).min(1),
  }),
})

const fileEntrySchema = z.object({
  name: z.string().min(1).refine((n) => !n.includes("..") && !n.includes("/") && !n.includes("\\"), {
    message: "name must be basename-only",
  }),
  url: z.string().url().refine((u) => u.startsWith("https://"), { message: "url must be https" }),
  sha256: sha256Schema,
  size: z.number().int().positive(),
})

const fileBinarySchema = z.object({
  kind: z.literal("file"),
  version: z.string().min(1),
  files: z.array(fileEntrySchema).min(1),
})

const archEntrySchema = z.discriminatedUnion("kind", [zipBinarySchema, fileBinarySchema])

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  binaries: z.record(z.string(), archEntrySchema),
})

export type WhisperBinaryManifest = z.infer<typeof manifestSchema>
export type WhisperBinaryArchEntry = z.infer<typeof archEntrySchema>
export type WhisperBinaryZipEntry = z.infer<typeof zipBinarySchema>
export type WhisperBinaryFileEntry = z.infer<typeof fileBinarySchema>

const MANIFEST_BASENAME = "whisper-binary.manifest.json"

export class WhisperBinaryManifestError extends Error {
  readonly code: "manifest-missing" | "manifest-invalid"
  constructor(code: WhisperBinaryManifestError["code"], message: string) {
    super(message)
    this.name = "WhisperBinaryManifestError"
    this.code = code
  }
}

/** Candidate paths: assets next to companion package, SEA cwd, bundled. */
export function whisperBinaryManifestCandidates(fromDir: string = __dirname): string[] {
  return [
    path.join(fromDir, "..", "..", "assets", MANIFEST_BASENAME),
    path.join(fromDir, "..", "..", "..", "assets", MANIFEST_BASENAME),
    path.join(process.cwd(), "assets", MANIFEST_BASENAME),
    path.join(process.cwd(), "companion", "assets", MANIFEST_BASENAME),
    path.join(path.dirname(process.execPath), "assets", MANIFEST_BASENAME),
  ]
}

export function parseWhisperBinaryManifest(text: string): WhisperBinaryManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new WhisperBinaryManifestError(
      "manifest-invalid",
      `whisper-binary.manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const result = manifestSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new WhisperBinaryManifestError(
      "manifest-invalid",
      `whisper-binary.manifest.json schema validation failed: ${issues}`,
    )
  }
  return result.data
}

export function loadWhisperBinaryManifest(sourcePath?: string): WhisperBinaryManifest {
  if (sourcePath) {
    try {
      return parseWhisperBinaryManifest(readFileSync(sourcePath, "utf8"))
    } catch (err) {
      if (err instanceof WhisperBinaryManifestError) throw err
      throw new WhisperBinaryManifestError(
        "manifest-missing",
        `failed to read whisper binary manifest at ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  const candidates = whisperBinaryManifestCandidates()
  for (const p of candidates) {
    if (existsSync(p)) {
      return parseWhisperBinaryManifest(readFileSync(p, "utf8"))
    }
  }
  throw new WhisperBinaryManifestError(
    "manifest-missing",
    `whisper-binary.manifest.json not found; tried: ${candidates.join(" | ")}`,
  )
}

export function getWhisperBinaryArchEntry(
  arch: string,
  manifest: WhisperBinaryManifest = loadWhisperBinaryManifest(),
): WhisperBinaryArchEntry | null {
  const entry = manifest.binaries[arch]
  return entry ?? null
}

/** Primary executable basename for arch (cmspark-whisper-*). */
export function primaryWhisperBinaryDest(arch: string, entry: WhisperBinaryArchEntry): string {
  if (entry.kind === "zip") {
    const main = entry.extract.files.find((f) => f.dest.startsWith("cmspark-whisper-"))
    return main?.dest ?? entry.extract.files[0]!.dest
  }
  const main = entry.files.find((f) => f.name.startsWith("cmspark-whisper-"))
  return main?.name ?? entry.files[0]!.name
}

/** Expected SHA256 of primary exe (for pin alignment). */
export function primaryWhisperBinarySha256(arch: string, entry: WhisperBinaryArchEntry): string {
  if (entry.kind === "zip") {
    const main = entry.extract.files.find((f) => f.dest.startsWith("cmspark-whisper-"))
    return (main ?? entry.extract.files[0]!).sha256
  }
  const main = entry.files.find((f) => f.name.startsWith("cmspark-whisper-"))
  return (main ?? entry.files[0]!).sha256
}
