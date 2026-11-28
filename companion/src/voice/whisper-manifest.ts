import { createSpeechModelManifest } from "./speech-model-manifest"

export { WhisperManifestError, fileEntrySchema, modelEntrySchema } from "./speech-model-manifest"
export type { SpeechModelManifest as WhisperManifest, SpeechModelFile as WhisperManifestFile, SpeechModelEntry as WhisperManifestModel } from "./speech-model-manifest"

export const {
  candidates: whisperManifestCandidates,
  resolvePath: resolveWhisperManifestPath,
  parse: parseWhisperManifest,
  load: loadWhisperManifest,
  files: getWhisperModelFiles,
} = createSpeechModelManifest("whisper")
