// Path B M1 — per-arch SHA256 pins for shipped cmspark-whisper binaries.
// Updated by: bash companion/scripts/build-cmspark-whisper.sh --write-pins
// ADR-023 L5: hash mismatch → Disable local STT (no silent PATH fallback).

export type WhisperPinnedArch = "darwin-arm64" | "darwin-x64" | "win-x64" | "linux-x64"

/**
 * Expected SHA256 (lowercase hex) of the packaged binary for each arch.
 * Missing key → resolve may allowUnpinned in dev; production packages should pin.
 */
/**
 * Tier-1 pin matrix. Only darwin-arm64 is filled until CI builds other arches.
 * Missing keys: whisperPinResolveOpts → allowUnpinned=false (fail-closed production).
 * Fill via: bash companion/scripts/build-cmspark-whisper.sh --write-pins
 *
 * P2 note: do **not** invent hashes — wrong pins break real installs silently.
 */
export const WHISPER_BINARY_SHA256: Partial<Record<WhisperPinnedArch, string>> = {
  "darwin-arm64": "40bca494d49af736058eb3f33cbcebaa020eacf6d0087b623f334946e1ab2128",
  // "darwin-x64": "<sha256 from --write-pins>",
  // "win-x64": "<sha256 from --write-pins>",
  // "linux-x64": "<sha256 from --write-pins>",
}

/** Return pin for arch key, or null if unset / invalid. */
export function expectedWhisperSha256(arch: string): string | null {
  if (!arch || arch === "unsupported") return null
  const pin = WHISPER_BINARY_SHA256[arch as WhisperPinnedArch]
  if (typeof pin !== "string") return null
  const normalized = pin.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) return null
  return normalized
}

/**
 * Resolve options for resolveWhisperBinary from pins + env.
 * VOICE-02 (health-fanout P1): missing Tier-1 pin is **fail-closed** in production —
 * no silent unpinned accept. Opt-in only:
 * - CMSPARK_WHISPER_UNPINNED=1 → skip pin, allow unpinned (loud log at call site)
 * - Pin present → enforce digest
 * - Pin missing → allowUnpinned=false (binary_missing / hash path refuses)
 */
export function whisperPinResolveOpts(
  arch: string,
  env: NodeJS.ProcessEnv = process.env,
): { expectedSha256: string | null; allowUnpinned: boolean; forceUnpinned: boolean } {
  const forceUnpinned = env.CMSPARK_WHISPER_UNPINNED === "1"
  if (forceUnpinned) {
    return { expectedSha256: null, allowUnpinned: true, forceUnpinned: true }
  }
  const pin = expectedWhisperSha256(arch)
  return {
    expectedSha256: pin,
    // Fail closed when pin matrix incomplete (darwin-x64 / win-x64 / linux-x64 until pinned)
    allowUnpinned: false,
    forceUnpinned: false,
  }
}
