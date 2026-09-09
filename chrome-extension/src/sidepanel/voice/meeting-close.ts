type MeetingTransport = {
  send: (message: Record<string, unknown>, callback: (reply: any) => void) => void
  subscribe: (listener: (message: any) => void) => () => void
  timeoutMs?: number
}

/** Existing WS contract: id correlates the request; meeting_id owns the data. */
export function createMeetingPersistence({ send, subscribe, timeoutMs = 10_000 }: MeetingTransport) {
  let sequence = 0
  const replacements = new Map<string, number>()
  const writes: { meetingId: string; sequence: number; done: Promise<boolean>; confirmed: boolean; error?: Error }[] = []

  const request = (meetingId: string, type: string, responseType: string, fields: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
    const requestId = `meeting-rpc-${crypto.randomUUID()}`
    let settled = false
    let unsubscribe = () => {}
    const finish = (error?: Error, value?: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      error ? reject(error) : resolve(value)
    }
    const timer = setTimeout(() => finish(new Error("保存确认超时，请保持面板并重试")), timeoutMs)
    unsubscribe = subscribe(message => {
      if (message.id !== requestId) return
      if (message.type === "meeting.error" || message.type === "error") {
        finish(new Error(message.message || message.error || "会议保存失败"))
      } else if (message.type === responseType) {
        if (message.meeting?.id !== meetingId || !Array.isArray(message.meeting.transcript)) {
          finish(new Error("会议保存回执与当前会议不匹配"))
        } else finish(undefined, message.meeting)
      }
    })
    try {
      send({ ...fields, type, v: 1, id: requestId, meeting_id: meetingId }, reply => {
        if (reply?.ok === false) finish(new Error(reply.error || "Companion 未连接，请重连后重试"))
      })
    } catch {
      finish(new Error("无法连接 Companion，请重连后重试"))
    }
  })

  return {
    request,
    write(meetingId: string, type: "meeting.append_transcript" | "meeting.set_transcript", fields: Record<string, unknown>): Promise<boolean> {
      const number = ++sequence
      const record = { meetingId, sequence: number, done: Promise.resolve(false), confirmed: false, error: undefined as Error | undefined }
      record.done = request(meetingId, type, "meeting.updated", fields).then(meeting => {
        // Require the exact appended line as well as its unique request receipt.
        if (type === "meeting.append_transcript" && meeting.transcript.at(-1)?.text !== String(fields.text || "").trim()) {
          throw new Error("转写写入回执不包含本次内容")
        }
        if (type === "meeting.set_transcript") replacements.set(meetingId, Math.max(number, replacements.get(meetingId) || 0))
        record.confirmed = true
        return true
      }).catch(cause => {
        record.error = cause instanceof Error ? cause : new Error("转写保存失败")
        return false
      })
      writes.push(record)
      return record.done
    },
    hasUnconfirmedWrites(meetingId: string): boolean {
      const replacedThrough = replacements.get(meetingId) || 0
      return writes.some(write => write.meetingId === meetingId && write.sequence > replacedThrough && !write.confirmed)
    },
    async waitForWrites(meetingId: string): Promise<void> {
      const owned = writes.filter(write => write.meetingId === meetingId)
      await Promise.all(owned.map(write => write.done))
      const replacedThrough = replacements.get(meetingId) || 0
      const failed = owned.find(write => write.sequence > replacedThrough && write.error)
      if (failed) throw new Error(`${failed.error!.message}。转写仍保留，请点击“保存转写”后重试收起`)
    },
  }
}

export type MeetingPersistence = ReturnType<typeof createMeetingPersistence>

/** Actual write receipts establish durability; a correlated read/end completes close. */
export async function confirmMeetingClose(options: {
  id: string
  persistence: MeetingPersistence
  endRecording?: boolean
}): Promise<void> {
  const { id, persistence } = options
  await persistence.waitForWrites(id)
  await persistence.request(id, "meeting.get", "meeting.get_result")
  if (options.endRecording !== false) await persistence.request(id, "meeting.end", "meeting.ended")
}
