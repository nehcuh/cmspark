import { createHash, randomUUID } from "node:crypto"

const MAX_MINUTES_PREPARATIONS = 128
const MINUTES_PREPARATION_TTL_MS = 5 * 60 * 1000
const pending = new Map<string, { owner: string; fingerprint: string; expiresAt: number }>()

export function minutesConsentFingerprint(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex")
}

export function prepareMinutesConsent(owner: string, fingerprint: string): string {
  const now = Date.now()
  for (const [key, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(key)
  }
  if (pending.size >= MAX_MINUTES_PREPARATIONS) {
    const oldest = pending.keys().next().value
    if (oldest) pending.delete(oldest)
  }
  const token = randomUUID()
  pending.set(token, { owner, fingerprint, expiresAt: now + MINUTES_PREPARATION_TTL_MS })
  return token
}

export function consumeMinutesConsent(token: string, owner: string, fingerprint: string): boolean {
  const entry = pending.get(token)
  if (!entry || entry.owner !== owner) return false
  pending.delete(token)
  return entry.expiresAt > Date.now() && entry.fingerprint === fingerprint
}
