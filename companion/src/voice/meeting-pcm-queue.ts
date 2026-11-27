import { createHash } from "node:crypto"
import { MEETING_PCM as C, type PcmCredit } from "./meeting-pcm-contract"
import { writePcmWavHeader } from "./pcm-wav"

export class MeetingPcmProtocolError extends Error {
  constructor() { super("queue_protocol_error") }
}
type Accepted = { end: number; hash: string; offset: number; frames: number }
export type PcmSegment = { index: number; start: number; end: number; contextFrames: number; pcm: Buffer; wav: Buffer }

/** One bounded ring. Reservations, received/infer/persist-pending share its capacity.
 * No per-block history except eight reorder slots and sixteen hashes. */
export class MeetingPcmQueue {
  constructor(private readonly segmentFrames: number = C.segmentFrames,
    private readonly firstFrames: number = segmentFrames) {}
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
  private openingSpeech = false
  private openingQuietFrames = 0
  private openingPauseEnd: number | null = null

  // Inspect only the ordered first live window. A pause after speech can close
  // a batch early without removing quiet samples or changing the next offset.
  private observeOpeningBlock(block: Accepted): void {
    if (this.firstFrames >= this.segmentFrames || this.nextSegmentIndex !== 0 ||
        this.openingPauseEnd !== null || block.end > this.firstFrames) return
    let energy = 0
    for (let frame = block.offset; frame < block.end; frame++) {
      const sample = this.ring.readInt16LE(frame * C.sampleBytes)
      energy += sample * sample
    }
    const meanSquare = energy / block.frames
    if (meanSquare >= 320 * 320) this.openingSpeech = true
    this.openingQuietFrames = meanSquare < 128 * 128 ? this.openingQuietFrames + block.frames : 0
    // Prefer a complete pause early. After 1.6 s an inter-word gap can
    // safely finish the opening batch before the 64-block ceiling (2.56 s).
    const pauseFrames = C.rate * (block.end >= C.rate * 1.6 ? 0.16 : 0.32)
    if (this.openingSpeech && block.end >= C.rate && this.openingQuietFrames >= pauseFrames) {
      this.openingPauseEnd = block.end
    }
  }

  private context = Buffer.alloc(0)

  /** Scan the last two seconds once a full window is available. Prefer a pause
   * near its end. Unbroken speech gets a short look-back in the next WAV. */
  private speechBoundary(length: number): { length: number; carry: number } {
    const block = C.blockFrames
    const end = this.releasedEnd + length
    const minimum = Math.max(Math.min(length, C.rate), length / 2)
    let quiet = 0, lastPause = 0
    for (let at = end - Math.min(length, 2 * C.rate); at <= end - block; at += block) {
      let sum = 0, squares = 0
      for (let i = 0; i < block; i++) {
        const sample = this.ring.readInt16LE(((at + i) % C.capacityFrames) * C.sampleBytes)
        sum += sample
        squares += sample * sample
      }
      // Remove DC offset before comparing block energy.
      const variance = squares / block - (sum / block) ** 2
      quiet = variance < 128 ** 2 ? quiet + block : 0
      if (quiet >= 3 * block && at + block - this.releasedEnd >= minimum) lastPause = at + block
    }
    if (lastPause) return { length: lastPause - this.releasedEnd, carry: 0 }
    const carry = Math.min(C.rate * 0.8, Math.floor(this.segmentFrames / 5), this.segmentFrames - C.rate)
    return { length, carry: Math.max(0, carry) }
  }

  get receivedEnd() { return this.contiguousEnd }
  get committedEnd() { return this.releasedEnd }
  get finalEnd() { return this.targetEnd }
  get residentFrames() { return this.disposed ? 0 : this.allocatedEnd - this.releasedEnd }
  get atCapacity() { return this.residentFrames >= C.capacityFrames }
  get pendingSegments() { return this.disposed ? 0 : Math.ceil((this.contiguousEnd - this.releasedEnd) / this.segmentFrames) }
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
      this.observeOpeningBlock(item)
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
    const target = this.nextSegmentIndex === 0 ? (this.openingPauseEnd ?? this.firstFrames) : this.segmentFrames - this.context.length / C.sampleBytes
    const available = this.contiguousEnd - this.releasedEnd
    const final = this.targetEnd !== null && this.contiguousEnd === this.targetEnd && available <= target
    if (!available || (!final && available < target)) return null
    const boundary = final || (this.nextSegmentIndex === 0 && this.openingPauseEnd !== null)
      ? { length: Math.min(target, available), carry: 0 } : this.speechBoundary(target)
    const { length, carry } = boundary
    const contextFrames = this.context.length / C.sampleBytes
    const wav = Buffer.alloc(44 + (contextFrames + length) * C.sampleBytes)
    writePcmWavHeader(wav, wav.length - 44)
    this.context.copy(wav, 44)
    this.context.fill(0)
    const pcm = wav.subarray(44 + contextFrames * C.sampleBytes)
    const index = (this.releasedEnd % C.capacityFrames) * C.sampleBytes
    const first = Math.min(pcm.length, this.ring.length - index)
    this.ring.copy(pcm, 0, index, index + first)
    if (first < pcm.length) this.ring.copy(pcm, first, 0, pcm.length - first)
    this.context = Buffer.from(pcm.subarray(pcm.length - carry * C.sampleBytes))
    this.inflight = { index: this.nextSegmentIndex++, start: this.releasedEnd, end: this.releasedEnd + length, contextFrames, pcm, wav }
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
    segment.wav.fill(0)
    this.releasedEnd = segment.end
    this.inflight = null
  }

  retire(): void {
    if (this.inflight) this.inflight.wav.fill(0)
    this.inflight = null
    this.dispose()
  }

  dispose(): void {
    this.context.fill(0)
    this.disposed = true
    this.ring.fill(0)
    // A runner owns the one immutable copy until it actually settles.
    this.grants.clear(); this.reorder.clear(); this.recent.clear()
  }
}
