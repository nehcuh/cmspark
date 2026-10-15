import { createHash } from "node:crypto"
import { MEETING_PCM as C, type PcmCredit } from "./meeting-pcm-contract"
import { writePcmWavHeader } from "./pcm-wav"

export class MeetingPcmProtocolError extends Error {
  constructor() { super("queue_protocol_error") }
}
type Accepted = { end: number; hash: string; offset: number; frames: number }
export type PcmSegment = { index: number; start: number; end: number; pcm: Buffer; wav: Buffer }

/** One bounded ring. Reservations, received/infer/persist-pending share its capacity.
 * No per-block history except eight reorder slots and sixteen hashes. */
export class MeetingPcmQueue {
  private readonly ring = Buffer.alloc(C.capacityFrames * C.sampleBytes)
  private readonly grants = new Map<number, PcmCredit>()
  private readonly reorder = new Map<number, Accepted>()
  private readonly recent = new Map<number, Accepted>()
  private allocatedEnd = 0
  private nextCredit = 1
  private releasedEnd = 0
  private contiguousEnd = 0
  private targetEnd: number | null = null
  private shortEnd: number | null = null
  private inflight: PcmSegment | null = null
  private nextSegmentIndex = 0
  private disposed = false

  get receivedEnd() { return this.contiguousEnd }
  get committedEnd() { return this.releasedEnd }
  get finalEnd() { return this.targetEnd }
  get residentFrames() { return this.disposed ? 0 : this.allocatedEnd - this.releasedEnd }
  get atCapacity() { return this.residentFrames >= C.capacityFrames }
  get pendingSegments() { return this.disposed ? 0 : Math.ceil((this.contiguousEnd - this.releasedEnd) / C.segmentFrames) }
  get inflightIndex() { return this.inflight?.index ?? null }
  get complete() { return this.targetEnd !== null && this.releasedEnd === this.targetEnd && !this.inflight }

  credits(): PcmCredit[] {
    return [...this.grants.values()].map(c => ({ ...c }))
  }

  reserve(): PcmCredit[] {
    if (this.disposed || this.targetEnd !== null || this.shortEnd !== null) return []
    const added: PcmCredit[] = []
    while (this.grants.size + this.reorder.size < C.credits && this.residentFrames < C.capacityFrames && this.allocatedEnd < C.captureFrames) {
      const max = Math.min(C.blockFrames, C.capacityFrames - this.residentFrames, C.captureFrames - this.allocatedEnd)
      const grant = { credit_id: this.nextCredit++, sample_offset: this.allocatedEnd, max_frames: max }
      this.allocatedEnd += max
      this.grants.set(grant.credit_id, grant)
      added.push({ ...grant })
    }
    return added
  }

  append(id: number, offset: number, frames: number, pcm: Buffer): { duplicate: boolean; stale: boolean } {
    if (this.disposed || !Number.isSafeInteger(id) || !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(frames) || frames <= 0 || frames > C.blockFrames || pcm.length !== frames * C.sampleBytes) throw new MeetingPcmProtocolError()
    const hash = createHash("sha256").update(pcm).digest("hex")
    const previous = this.recent.get(id)
    if (previous) {
      if (previous.offset !== offset || previous.frames !== frames || previous.hash !== hash) throw new MeetingPcmProtocolError()
      return { duplicate: true, stale: false }
    }
    const grant = this.grants.get(id)
    if (!grant) {
      if (id > 0 && id < this.nextCredit && offset < this.contiguousEnd) return { duplicate: false, stale: true }
      throw new MeetingPcmProtocolError()
    }
    if (offset !== grant.sample_offset || frames > grant.max_frames ||
        (this.targetEnd !== null && offset + frames > this.targetEnd) ||
        (this.shortEnd !== null && offset >= this.shortEnd)) throw new MeetingPcmProtocolError()
    if (frames < grant.max_frames) {
      // A short block can only be the final prefix. Already accepted later blocks
      // cannot be silently discarded to manufacture a different tail.
      if ([...this.reorder.keys()].some(start => start > offset)) throw new MeetingPcmProtocolError()
      this.shortEnd = offset + frames
    }
    const index = (offset % C.capacityFrames) * C.sampleBytes
    const first = Math.min(pcm.length, this.ring.length - index)
    pcm.copy(this.ring, index, 0, first)
    if (first < pcm.length) pcm.copy(this.ring, 0, first)
    const accepted = { end: offset + frames, offset, frames, hash }
    this.grants.delete(id)
    this.reorder.set(offset, accepted)
    this.recent.set(id, accepted)
    while (this.recent.size > C.recentAcks) this.recent.delete(this.recent.keys().next().value!)
    while (this.reorder.has(this.contiguousEnd)) {
      const item = this.reorder.get(this.contiguousEnd)!
      this.reorder.delete(this.contiguousEnd)
      this.contiguousEnd = item.end
    }
    return { duplicate: false, stale: false }
  }

  seal(end: number): void {
    if (this.disposed || !Number.isSafeInteger(end) || end < this.contiguousEnd || end > this.allocatedEnd ||
        (this.shortEnd !== null && end !== this.shortEnd) ||
        (this.targetEnd !== null && this.targetEnd !== end) ||
        [...this.reorder.values()].some(a => a.end > end)) throw new MeetingPcmProtocolError()
    this.targetEnd = end
    for (const [id, grant] of this.grants) if (grant.sample_offset >= end) this.grants.delete(id)
    // Unused reservations after the announced tail are not received PCM.
    this.allocatedEnd = end
  }

  take(): PcmSegment | null {
    if (this.disposed || this.inflight) return null
    const length = Math.min(C.segmentFrames, this.contiguousEnd - this.releasedEnd)
    if (!length || (length < C.segmentFrames && (this.targetEnd === null || this.contiguousEnd !== this.targetEnd))) return null
    // The sole immutable worker allocation includes its WAV header. pcm is a
    // view, not a second segment copy; the existing runner can consume wav as-is.
    const wav = Buffer.alloc(44 + length * C.sampleBytes)
    writePcmWavHeader(wav, length * C.sampleBytes)
    const pcm = wav.subarray(44)
    const index = (this.releasedEnd % C.capacityFrames) * C.sampleBytes
    const first = Math.min(pcm.length, this.ring.length - index)
    this.ring.copy(pcm, 0, index, index + first)
    if (first < pcm.length) this.ring.copy(pcm, first, 0, pcm.length - first)
    this.inflight = { index: this.nextSegmentIndex++, start: this.releasedEnd, end: this.releasedEnd + length, pcm, wav }
    return this.inflight
  }

  commit(segment: PcmSegment): void {
    if (this.disposed || this.inflight !== segment) throw new MeetingPcmProtocolError()
    for (let n = segment.start; n < segment.end;) {
      const pos = (n % C.capacityFrames) * C.sampleBytes
      const frames = Math.min(segment.end - n, C.capacityFrames - n % C.capacityFrames)
      this.ring.fill(0, pos, pos + frames * C.sampleBytes)
      n += frames
    }
    segment.pcm.fill(0)
    this.releasedEnd = segment.end
    this.inflight = null
  }

  retire(): void {
    if (this.inflight) this.inflight.wav.fill(0)
    this.inflight = null
    this.dispose()
  }

  dispose(): void {
    this.disposed = true
    this.ring.fill(0)
    // A runner owns the one immutable copy until it actually settles.
    this.grants.clear(); this.reorder.clear(); this.recent.clear()
  }
}
