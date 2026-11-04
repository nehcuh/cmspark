const MAX_PART_LENGTH = 1024 * 1024
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
const MAX_WIRE_BYTES = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 1024 * 1024
const STAGING_TTL_MS = 120_000

/** Keep one bounded, connection-owned batch across all authenticated panels. */
export class FileUploadParts<Peer> {
  private batch?: {
    peer: Peer
    id: string
    threadId: string
    bytes: number
    parts: string[]
    timer: ReturnType<typeof setTimeout>
  }

  add(peer: Peer, message: Record<string, unknown>): void {
    const { upload_id: id, thread_id: threadId, index, data } = message
    if (!this.validId(id) || typeof threadId !== "string" || !threadId || threadId.length > 256 ||
      typeof data !== "string" || !data.length || data.length > MAX_PART_LENGTH) return
    if (!this.batch && index === 0) {
      const timer = setTimeout(() => this.close(peer), STAGING_TTL_MS)
      timer.unref()
      this.batch = { peer, id, threadId, bytes: 0, parts: [], timer }
    }
    const batch = this.batch
    if (!batch || batch.peer !== peer || batch.id !== id || batch.threadId !== threadId) return
    const bytes = batch.bytes + Buffer.byteLength(data)
    if (index !== batch.parts.length || batch.parts.length >= Math.ceil(MAX_WIRE_BYTES / MAX_PART_LENGTH) || bytes > MAX_WIRE_BYTES) {
      this.close(peer)
      return
    }
    batch.parts.push(data)
    batch.bytes = bytes
  }

  take(peer: Peer, id: unknown, threadId: unknown, count: unknown): unknown[] | null {
    const batch = this.batch
    if (!batch || batch.peer !== peer || batch.id !== id || batch.threadId !== threadId) return null
    this.close(peer)
    if (batch.parts.length !== count) return null
    try {
      const files: unknown = JSON.parse(batch.parts.join(""))
      return Array.isArray(files) ? files : null
    } catch {
      return null
    }
  }

  close(peer: Peer): void {
    if (this.batch?.peer !== peer) return
    clearTimeout(this.batch.timer)
    this.batch = undefined
  }

  private validId(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f-]{36}$/.test(value)
  }
}
