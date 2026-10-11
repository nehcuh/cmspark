import { createHash } from "node:crypto"

/** Stable opaque identity: config may contain credentials; never expose raw data. */
export function mcpAuthorizationDigest(value: unknown): string {
  const json = JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry)
  return createHash("sha256").update(json ?? "null").digest("hex")
}
