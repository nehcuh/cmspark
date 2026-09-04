import path from "node:path"

/**
 * #260: diarize model subtree root — `<dataDir>/models/diarize`, whisper's
 * sibling. Both roots share ONE voice-models disk budget (sum of subtrees);
 * never account the parent models/ tree (would double-count Qwen etc.).
 */
export function diarizeModelsRootOf(dataDir: string): string {
  return path.join(dataDir, "models", "diarize")
}
