// Path B M1 — per-arch SHA256 pins for shipped cmspark-whisper binaries.
// Updated by: bash companion/scripts/build-cmspark-whisper.sh --write-pins
// ADR-023 L5: hash mismatch → Disable local STT (no silent PATH fallback).

export type WhisperPinnedArch = "darwin-arm64" | "darwin-x64" | "win-x64" | "win-arm64" | "linux-x64" | "linux-arm64"

/**
 * Expected SHA256 (lowercase hex) of the packaged binary for each arch.
 * Missing key → resolve may allowUnpinned in dev; production packages should pin.
 */
/**
 * Tier-1 pin matrix. Missing keys: whisperPinResolveOpts → allowUnpinned=false
 * (fail-closed production). Fill via: bash companion/scripts/build-cmspark-whisper.sh --write-pins
 * or Get-FileHash on the staged cmspark-whisper-*.exe.
 *
 * P2 note: do **not** invent hashes — wrong pins break real installs silently.
 */
export const WHISPER_BINARY_SHA256: Partial<Record<WhisperPinnedArch, string>> = {
  // macOS 12+ CPU builds from b5907; see scripts/package-macos-whisper.py.
  "darwin-arm64": "0a350c600a91be8d7afa68aa046b9906802c02392f1f1a546768a6685059649d",
  "darwin-x64": "b911433748f8e6a2b8b2714a92059c948ad016b42505ec332f4083c58a44840b",
  // whisper.cpp v1.7.6 official whisper-bin-x64.zip → cmspark-whisper-win-x64.exe
  // Keep in lock-step with assets/whisper-binary.manifest.json (win-x64 extract primary).
  "win-x64": "b7c6dc2e999a80bc2d23cd4c76701211f392ae55d5cabdf0d45eb2ca4faf09af",
  // Official b5907 CPU release archives, verified against the binary manifest.
  "linux-arm64": "33f12cea6be50d77133f34c065c5cbf8bd85af585c037d8f03011b9f365a532c",
  "linux-x64": "83dc7b79be42a240583f83ee7f8ebfe7b5e06b527a8f217c18a1d4101d215dff",
  "win-arm64": "b8e5a6f508956ee37e2c1f607e2b11879ef9124850b6cf5a14a0eb6565387eb7",
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
