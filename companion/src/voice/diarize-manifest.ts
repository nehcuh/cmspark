import { createSpeechModelManifest } from "./speech-model-manifest"

export { WhisperManifestError as DiarizeManifestError } from "./speech-model-manifest"
export type { SpeechModelManifest as DiarizeManifest, SpeechModelFile as DiarizeManifestFile } from "./speech-model-manifest"

export const {
  candidates: diarizeManifestCandidates,
  resolvePath: resolveDiarizeManifestPath,
  parse: parseDiarizeManifest,
  load: loadDiarizeManifest,
  files: getDiarizeModelFiles,
} = createSpeechModelManifest("diarize")
