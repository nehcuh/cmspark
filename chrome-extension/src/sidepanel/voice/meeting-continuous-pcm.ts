/** Browser-only canonical streaming resampler and credit admission. No Chrome/Node API. */
export type MeetingCredit = { credit_id: number; sample_offset: number; max_frames: number }
export type MeetingBlock = { credit_id: number; sample_offset: number; frame_count: number; pcm: Uint8Array }

export class ContinuousMeetingResampler {
  private sourceIndex = -1
  private next = 0
  private previous = 0
  private rate = 0
  push(input: Float32Array, rate: number, emit: (sample: number) => boolean): void {
    if (!(rate > 0) || (this.rate && this.rate !== rate)) throw new Error("input_gap")
    this.rate = rate
    for (const current of input) {
      this.sourceIndex++
      while (this.next <= this.sourceIndex * 16000) {
        const fraction = this.next / 16000 - (this.sourceIndex - 1)
        const value = this.sourceIndex === 0 ? current : this.previous + fraction * (current - this.previous)
        this.next += rate
        if (!emit(value)) return
      }
      this.previous = current
    }
  }
}

export class MeetingPcmEncoder {
  private readonly resampler = new ContinuousMeetingResampler()
  private readonly grants = new Map<number, MeetingCredit>()
  private current: MeetingCredit | null = null
  private bytes: Uint8Array | null = null
  private frames = 0
  private lastUsed = 0
  private ended = false
  private end = 0
  rawFrames = 0
  constructor(private readonly block: (block: MeetingBlock) => void,
    private readonly sealed: (end: number, reason: string) => void) {}

  get admittedEnd() { return this.end }
  get closed() { return this.ended }

  grant(credits: MeetingCredit[]): void {
    if (this.ended) return
    if (!Array.isArray(credits) || credits.length > 8) throw new Error("queue_protocol_error")
    for (const c of credits) {
      if (!Number.isSafeInteger(c.credit_id) || c.credit_id <= 0 || c.sample_offset !== (c.credit_id - 1) * 640 ||
          !Number.isSafeInteger(c.max_frames) || c.max_frames <= 0 || c.max_frames > 640) throw new Error("queue_protocol_error")
      if (c.credit_id <= this.lastUsed || c.credit_id === this.current?.credit_id) continue
      const old = this.grants.get(c.credit_id)
      if (old && (old.sample_offset !== c.sample_offset || old.max_frames !== c.max_frames)) throw new Error("queue_protocol_error")
      if (!old && this.grants.size + (this.current ? 1 : 0) >= 8) throw new Error("queue_protocol_error")
      this.grants.set(c.credit_id, { ...c })
    }
  }

  push(input: Float32Array, rate: number): void {
    if (this.ended) return
    this.rawFrames += input.length
    this.resampler.push(input, rate, value => {
      if (this.ended) return false
      if (this.end >= 172800000) { this.seal("hard_limit"); return false }
      if (!this.current) {
        const next = [...this.grants.values()].find(c => c.sample_offset === this.end)
        if (!next) { this.seal("transport_backpressure"); return false }
        this.grants.delete(next.credit_id); this.current = next
        this.bytes = new Uint8Array(next.max_frames * 2); this.frames = 0
      }
      const clipped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0))
      new DataView(this.bytes!.buffer).setInt16(this.frames * 2, Math.round(clipped < 0 ? clipped * 32768 : clipped * 32767), true)
      this.frames++; this.end++
      if (this.frames === this.current.max_frames) this.flush()
      return true
    })
  }

  seal(reason: string): void {
    if (this.ended) return
    this.ended = true
    this.flush()
    this.grants.clear()
    this.sealed(this.end, reason)
  }

  private flush(): void {
    if (!this.current || !this.frames || !this.bytes) return
    const c = this.current, frames = this.frames
    const pcm = frames === c.max_frames ? this.bytes : this.bytes.slice(0, frames * 2)
    this.lastUsed = c.credit_id; this.current = null; this.bytes = null; this.frames = 0
    this.block({ credit_id: c.credit_id, sample_offset: c.sample_offset, frame_count: frames, pcm })
  }
}

/** Read-only summary copy for the two meeting views, independent of identity or permission. */
export function meetingSourceRangeLabel(summary: any): string {
  if (!summary || !Number.isSafeInteger(summary.committed_end) || summary.committed_end < 0) return "采集完整性未知；仅显示已保存文字"
  if (summary.sticky_incomplete) return `采集曾提前停止或取消，范围不完整；已存前缀到 ${(summary.committed_end / 16000).toFixed(1)} 秒`
  if (summary.outcome === "complete") return `已处理采集前缀到 ${(summary.committed_end / 16000).toFixed(1)} 秒；不代表整场声音均已采集`
  return `采集边界待确认；已存前缀到 ${(summary.committed_end / 16000).toFixed(1)} 秒`
}

export function meetingCaptureErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    contract_unavailable: "当前连接未确认连续会议能力，请更新后重新开始",
    network_unknown: "连接中断，未确认的音频范围不能视为完整；请重连查看已存原稿",
    stale_capture: "当前会议或录制已变化，请重新开始",
    queue_protocol_error: "音频排队信息不一致，录制已停止；已存原稿保留",
    startup_timeout: "麦克风或本机转写启动超时，请检查后重新开始",
    audio_retention_unsupported: "现有会议选择了保留原始音频，连续录制暂不支持此模式；原有选择未改变",
    capture_flush_timeout: "末尾音频未按时送达，不能视为完整转写",
    cleanup_pending: "正在等待转写资源结束，暂不能开始新的录制",
    save_failed: "原稿保存未确认，录制已停止，请保留现有文字并检查存储",
    drain_timeout: "排空超过处理期限，剩余音频未完成",
  }
  return messages[code] || "本机转写未完成，已保存前缀保留；请检查转写状态后重试"
}
export function meetingCaptureStopLabel(reason: string): string {
  return ({ capacity: "积压达到上限", hard_limit: "录制达到时限", input_gap: "检测到输入断续", permission_revoked: "麦克风权限已撤销",
    suspended: "音频采集已挂起", transport_backpressure: "音频发送积压", unload: "录制页面已关闭", user_stop: "已停止" } as Record<string, string>)[reason] || "录制已停止"
}
