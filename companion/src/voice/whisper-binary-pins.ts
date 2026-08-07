// Path B M1 — per-arch SHA256 pins for shipped cmspark-whisper binaries.
// Updated by: bash companion/scripts/build-cmspark-whisper.sh --write-pins
// ADR-023 L5: hash mismatch → Disable local STT (no silent PATH fallback).

export type WhisperPinnedArch = "darwin-arm64" | "darwin-x64" | "win-x64" | "linux-x64"

/**
 * Expected SHA256 (lowercase hex) of the packaged binary for each arch.
 * Missing key → resolve may allowUnpinned in dev; production packages should pin.
 */
export const WHISPER_BINARY_SHA256: Partial<Record<WhisperPinnedArch, string>> = {
  "darwin-arm64": "40bca494d49af736058eb3f33cbcebaa020eacf6d0087b623f334946e1ab2128",
  // filled by build-cmspark-whisper.sh --write-pins on each Tier-1 host
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
 * - Pin present → enforce digest (unless CMSPARK_WHISPER_UNPINNED=1).
 * - Pin missing → allowUnpinned (dev / incomplete package).
 * - CMSPARK_WHISPER_UNPINNED=1 → skip pin, allow unpinned (loud log at call site).
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
    allowUnpinned: pin == null,
    forceUnpinned: false,
  }
}
