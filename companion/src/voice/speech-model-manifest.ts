// Model download pins are read from assets shipped with Companion.
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

export const modelEntrySchema = z
  .object({
    files: z.array(fileEntrySchema).min(1),
  })
  .strict()

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    models: z.record(z.string(), modelEntrySchema),
  })
  .strict()

export type SpeechModelManifest = z.infer<typeof manifestSchema>
export type SpeechModelFile = z.infer<typeof fileEntrySchema>
export type SpeechModelEntry = z.infer<typeof modelEntrySchema>

export function createSpeechModelManifest(kind: "whisper" | "diarize") {
  const basename = `${kind}-models.manifest.json`

  function candidates(fromDir: string = __dirname): string[] {
    return [
      path.join(fromDir, "..", "..", "assets", basename),
      path.join(fromDir, "..", "..", "..", "assets", basename),
      path.join(fromDir, "assets", basename),
      path.join(fromDir, "..", "assets", basename),
    ]
  }

  function resolvePath(fromDir: string = __dirname): string {
    const paths = candidates(fromDir)
    const found = paths.find(candidate => existsSync(candidate))
    if (found) return found
    throw new WhisperManifestError("manifest-missing", `${basename} not found; tried: ${paths.join(" | ")}`)
  }

  function parse(rawJson: string): SpeechModelManifest {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawJson)
    } catch (err) {
      throw new WhisperManifestError(
        "manifest-invalid",
        `${basename} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    const result = manifestSchema.safeParse(parsed)
    if (!result.success) {
      const issues = result.error.issues.slice(0, 5).map(i => `${i.path.join(".")}: ${i.message}`).join("; ")
      throw new WhisperManifestError("manifest-invalid", `${basename} schema validation failed: ${issues}`)
    }
    return result.data
  }

  function load(fromDir: string = __dirname): SpeechModelManifest {
    const sourcePath = resolvePath(fromDir)
    let raw: string
    try {
      raw = readFileSync(sourcePath, "utf-8")
    } catch (err) {
      throw new WhisperManifestError(
        "manifest-missing",
        `failed to read ${kind} manifest at ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return parse(raw)
  }

  function files(modelId: string, manifest: SpeechModelManifest = load()): SpeechModelFile[] {
    const entry = manifest.models[modelId]
    if (!entry) throw new WhisperManifestError("model-missing", `${kind} model id not in manifest: ${modelId}`)
    return entry.files
  }

  return { candidates, resolvePath, parse, load, files }
}
