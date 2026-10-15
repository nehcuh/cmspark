import { isCaptureId, MEETING_PCM } from "./meeting-pcm-contract"

type Begin = { captureId: string; expires: number; observation: unknown; state: "observing" | "ready" | "accepted" | "closed"; observing?: Promise<boolean> }
/** One HTTP Begin correlator. Closed state retains only the last id, never a socket/RPC/audio cache. */
export class MeetingPcmHttpBegin {
  private pending: Begin | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(private readonly now = Date.now) {}
  async observe(captureId: unknown, current: () => unknown, observe: () => Promise<1 | null>): Promise<boolean> {
    if (!isCaptureId(captureId)) return false
    this.invalidateIfChanged(current())
    let entry = this.pending
    if (entry && (entry.state === "closed" || this.now() >= entry.expires)) {
      this.close(entry)
      if (entry.captureId === captureId) return false
      entry = null
    }
    if (entry && entry.captureId !== captureId) return false
    if (entry?.observation) return entry.observation === current()
    if (entry?.observing) return entry.observing
    entry = { captureId, expires: this.now() + MEETING_PCM.startupMs, observation: null, state: "observing" }
    this.pending = entry
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.close(entry!), MEETING_PCM.startupMs); this.timer.unref?.()
    const owned = entry
    owned.observing = (async () => {
      const supported = await observe()
      const actual = current()
      if (this.pending !== owned || owned.state === "closed" || this.now() >= owned.expires || supported !== 1 || !actual) { this.close(owned); return false }
      owned.observation = actual; owned.state = "ready"; return true
    })().catch(() => { this.close(owned); return false }).finally(() => { delete owned.observing })
    return owned.observing
  }
  binding(captureId: unknown, requestObservation: unknown, current: unknown): unknown {
    this.invalidateIfChanged(current)
    const entry = this.pending
    if (!entry || entry.state === "observing" || entry.state === "closed" || entry.captureId !== captureId ||
        this.now() >= entry.expires || !entry.observation || entry.observation !== requestObservation || entry.observation !== current) {
      if (entry && this.now() >= entry.expires) this.close(entry)
      return null
    }
    return entry.observation
  }
  accepted(captureId: unknown, observation: unknown) {
    const entry = this.pending
    if (entry && entry.captureId === captureId && entry.observation === observation && entry.state === "ready") entry.state = "accepted"
  }
  receiving(captureId: unknown, observation: unknown) {
    const entry = this.pending
    if (entry?.state === "accepted" && entry.captureId === captureId && entry.observation === observation) this.close(entry)
  }
  terminal(captureId: unknown, observation: unknown) {
    const entry = this.pending
    if (entry && entry.captureId === captureId && entry.observation === observation) this.close(entry)
  }
  invalidateIfChanged(current: unknown) {
    const entry = this.pending
    if (entry?.observation && entry.observation !== current) this.close(entry)
  }
  reset() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.pending = null }
  private close(entry: Begin) {
    if (this.pending !== entry) return
    entry.state = "closed"; entry.observation = null; delete entry.observing
    if (this.timer) clearTimeout(this.timer); this.timer = null
  }
}
