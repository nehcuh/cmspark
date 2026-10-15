import { MEETING_PCM as C, type CaptureIdentity, type CaptureStatus, type CapturePhase, type CaptureOutcome, type CaptureStopReason } from "./meeting-pcm-contract"
import { MeetingPcmQueue, type PcmSegment } from "./meeting-pcm-queue"
import type { SttServiceResult, SttStartRequest } from "./stt-session-service"

export type MeetingPcmCaptureDeps = {
  run: (segment: PcmSegment, request: SttStartRequest) => Promise<SttServiceResult>
  abortRun: () => void
  persist: (segment: PcmSegment, result: Extract<SttServiceResult, { ok: true }>) => boolean | void
  checkpoint: (status: CaptureStatus) => void
  send: (status: CaptureStatus) => void
  retired: () => void
  now?: () => number
}

/** Resource owner through capture, infer, persistence and real runner retirement. */
export class MeetingPcmCapture {
  readonly queue = new MeetingPcmQueue()
  private phase: CapturePhase = "starting"
  private outcome: CaptureOutcome | null = null
  private reason: CaptureStopReason | null = null
  private code: string | undefined
  private request: SttStartRequest | null = null
  private running = false
  private cancelled = false
  private saved = 0
  private processed = 0
  private jobCount = 0
  private ratio = 0
  private jobStarted = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private idle: ReturnType<typeof setTimeout> | null = null
  private drain: ReturnType<typeof setTimeout> | null = null
  private flush: ReturnType<typeof setTimeout> | null = null
  private cleanup: ReturnType<typeof setTimeout> | null = null
  private job: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number
  private readonly acks = new Map<number, CaptureStatus>()

  constructor(readonly identity: CaptureIdentity, readonly peerId: string, private readonly deps: MeetingPcmCaptureDeps, readonly speaker?: string) {
    this.now = deps.now ?? Date.now
    this.timer = this.later(() => this.fail("startup_timeout"), C.startupMs)
  }

  owns(peer: string, captureId: string, epoch: number): boolean {
    return peer === this.peerId && captureId === this.identity.capture_id && epoch === this.identity.capture_epoch
  }

  matchesRequest(request: SttStartRequest): boolean {
    return !this.request || ["modelId", "engine", "lang", "format", "sampleRate", "channels"].every(key => (this.request as any)[key] === (request as any)[key])
  }

  activate(request: SttStartRequest): CaptureStatus {
    if (this.phase !== "starting") return this.status()
    this.request = { ...request }
    if (this.timer) clearTimeout(this.timer)
    this.timer = this.later(() => this.stopAdmission("hard_limit"), C.captureMs)
    this.phase = "capturing"
    this.queue.reserve()
    this.armIdle()
    return this.status()
  }

  append(credit: number, offset: number, frames: number, pcm: Buffer): CaptureStatus {
    if (this.cancelled || !this.request || (this.phase !== "capturing" && this.phase !== "draining")) throw new Error("stale_capture")
    try {
      const result = this.queue.append(credit, offset, frames, pcm)
      if (result.duplicate && this.acks.has(credit)) return structuredClone(this.acks.get(credit)!)
      if (result.stale) throw new Error("stale_capture")
      if (this.phase === "capturing" && !this.reason) { this.armIdle(); this.queue.reserve() }
      if (this.queue.atCapacity && !this.reason) this.stopAdmission("capacity")
      if (this.queue.receivedEnd >= C.captureFrames && !this.reason) this.stopAdmission("hard_limit")
      if (this.queue.finalEnd === this.queue.receivedEnd && this.flush) { clearTimeout(this.flush); this.flush = null }
      void this.pump()
      const ack = { ...this.status(), credit_id: credit, accepted_through: offset + frames }
      this.acks.set(credit, structuredClone(ack))
      while (this.acks.size > C.recentAcks) this.acks.delete(this.acks.keys().next().value!)
      return ack
    } catch (error) {
      if (error instanceof Error && error.message === "stale_capture") throw error
      this.fail("queue_protocol_error")
      throw new Error("queue_protocol_error")
    }
  }

  seal(end: number, reason: CaptureStopReason): CaptureStatus {
    if (this.cancelled) return this.status()
    try { this.queue.seal(end) } catch { this.fail("queue_protocol_error"); return this.status() }
    this.reason ??= reason
    this.phase = "draining"
    if (this.idle) clearTimeout(this.idle)
    if (this.timer) clearTimeout(this.timer)
    this.idle = this.timer = null
    if (!this.drain) this.drain = this.later(() => this.fail("drain_timeout"), C.drainMs)
    if (this.queue.receivedEnd !== end && !this.flush) this.flush = this.later(() => this.fail("capture_flush_timeout"), C.flushMs)
    if (!this.checkpoint()) return this.status()
    if (!this.running && this.queue.complete) {
      this.phase = "finished"; this.outcome = this.reason === "user_stop" ? "complete" : "limited"
      if (!this.checkpoint()) return this.status()
      this.retire(); this.emit(); return this.status()
    }
    void this.pump()
    return this.status()
  }

  cancel(): CaptureStatus {
    if (this.phase === "finished" || this.phase === "failed" || (this.cancelled && this.code)) return this.status()
    this.outcome = "cancelled"
    this.cancelled = true
    this.phase = this.running ? "canceling" : "finished"
    this.queue.dispose()
    this.acks.clear()
    this.clearTimers()
    this.deps.abortRun()
    if (!this.checkpoint()) return this.status()
    if (this.running) this.cleanup = this.later(() => { this.phase = "retiring"; this.code = "cleanup_pending"; this.emit() }, C.cleanupMs)
    else this.retire()
    return this.status()
  }

  fail(code: string): void {
    if (this.phase === "finished" || (this.cancelled && this.code)) return
    this.setFailure(code)
  }

  private setFailure(code: string): void {
    this.code = code; this.outcome = code === "network_unknown" ? "interrupted" : "failed"
    this.cancelled = true; this.phase = this.running ? "retiring" : "failed"
    this.queue.dispose(); this.acks.clear(); this.clearTimers(); this.deps.abortRun(); this.checkpoint()
    if (!this.running) this.retire()
    else this.cleanup = this.later(() => { this.code = "cleanup_pending"; this.emit() }, C.cleanupMs)
    this.emit()
  }

  status(): CaptureStatus {
    const pendingFrames = this.queue.receivedEnd - this.queue.committedEnd
    return {
      type: "meeting.capture.status", v: 1, queue_contract: 1, ...this.identity,
      phase: this.phase, input_open: this.phase === "capturing" && !this.reason,
      server_received_end: this.queue.receivedEnd, processed_end: this.processed,
      committed_end: this.queue.committedEnd, saved_text_segments: this.saved,
      resident_seconds: this.queue.residentFrames / C.rate, sealed_segments: this.queue.pendingSegments,
      inflight_segment: this.queue.inflightIndex, high_water: this.queue.residentFrames >= C.highWaterFrames,
      eta_seconds: this.jobCount < 2 ? null : Math.max(0, pendingFrames / C.rate * this.ratio - (this.running ? (this.now() - this.jobStarted) / 1000 : 0)),
      stop_reason: this.reason, completion: { outcome: this.outcome, prefix_complete: !this.cancelled && this.queue.complete },
      ...(this.code ? { code: this.code } : {}), credits: this.cancelled ? [] : this.queue.credits(),
    }
  }

  private async pump(): Promise<void> {
    if (this.running || this.cancelled || !this.request) return
    this.running = true
    try {
      for (let segment = this.queue.take(); segment; segment = this.queue.take()) {
        if (this.cancelled) break
        this.jobStarted = this.now()
        this.job = this.later(() => this.fail("infer_timeout"), C.jobMs)
        this.emit()
        const result = await this.deps.run(segment, this.request)
        // Cancellation cannot commit late ASR or release another owner's PCM.
        if (this.cancelled) { segment.wav.fill(0); break }
        if (!result.ok) { this.fail(result.code); segment.wav.fill(0); break }
        this.processed = segment.end
        let savedText: boolean | void
        try { savedText = this.deps.persist(segment, result) } catch { this.fail("save_failed"); segment.wav.fill(0); break }
        if (this.cancelled) { segment.wav.fill(0); break }
        if (savedText === true || (savedText === undefined && result.text?.trim())) this.saved++
        this.queue.commit(segment)
        if (this.now() - this.jobStarted >= C.jobMs) { this.fail("infer_timeout"); break }
        const ratio = (this.now() - this.jobStarted) / 1000 / ((segment.end - segment.start) / C.rate)
        this.ratio = this.jobCount++ ? 0.25 * ratio + 0.75 * this.ratio : ratio
        if (!this.reason) this.queue.reserve()
        if (!this.checkpoint()) break
        this.emit()
        if (this.now() - this.jobStarted >= C.jobMs) { this.fail("infer_timeout"); break }
        if (this.job) clearTimeout(this.job)
        this.job = null
      }
    } catch {
      this.fail("infer_failed")
    } finally {
      this.running = false
      if (this.cancelled) { this.phase = this.outcome === "cancelled" ? "finished" : "failed"; this.checkpoint(); this.retire() }
      else if (this.queue.complete) {
        this.phase = "finished"
        this.outcome = this.reason === "user_stop" ? "complete" : "limited"
        if (this.checkpoint()) this.retire()
      }
      this.emit()
    }
  }

  private stopAdmission(reason: CaptureStopReason) {
    if (this.cancelled || this.phase !== "capturing") return
    this.reason ??= reason; this.phase = "draining"
    if (this.timer) clearTimeout(this.timer); if (this.idle) clearTimeout(this.idle)
    this.timer = this.idle = null
    // Outstanding grants already reserve capacity. Let the real producer flush
    // its admitted prefix and announce N; receivedEnd is not that tail barrier.
    if (!this.flush) this.flush = this.later(() => this.fail("capture_flush_timeout"), C.flushMs)
    if (!this.drain) this.drain = this.later(() => this.fail("drain_timeout"), C.drainMs)
    this.checkpoint(); this.emit()
  }

  private armIdle() { if (this.idle) clearTimeout(this.idle); this.idle = this.later(() => this.fail("network_unknown"), C.idleMs) }
  private later(fn: () => void, ms: number) { const t = setTimeout(fn, ms); t.unref?.(); return t }
  private emit() { try { this.deps.send(this.status()) } catch { /* close/idle retires original lease */ } }
  private checkpoint(): boolean {
    try { this.deps.checkpoint(this.status()); return true }
    catch {
      // Neither completion nor cancellation is durable before its checkpoint.
      // An existing failure prevents recursive checkpoints and keeps its code.
      if (!this.cancelled || this.outcome === "cancelled") this.setFailure("save_failed")
      return false
    }
  }
  private clearTimers() {
    for (const key of ["timer", "idle", "drain", "flush", "cleanup", "job"] as const) { if (this[key]) clearTimeout(this[key]!); this[key] = null }
  }
  private retire() { this.clearTimers(); this.queue.retire(); this.acks.clear(); this.request = null; this.deps.retired() }
}
