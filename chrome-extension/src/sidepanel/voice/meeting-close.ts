type MeetingTransport = {
  send: (message: Record<string, unknown>, callback: (reply: any) => void) => void
  subscribe: (listener: (message: any) => void) => () => void
  timeoutMs?: number
}

/** Existing WS contract: id correlates the request; meeting_id owns the data. */
export function createMeetingPersistence({ send, subscribe, timeoutMs = 10_000 }: MeetingTransport) {
  let sequence = 0
  const replacements = new Map<string, number>()
  const writes: { meetingId: string; sequence: number; done: Promise<boolean>; confirmed: boolean; error?: Error; retryOriginal?: () => Promise<void> }[] = []

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
        if (!message.meeting?.id || (meetingId && message.meeting.id !== meetingId) || !Array.isArray(message.meeting.transcript)) {
          finish(new Error("会议保存回执与当前会议不匹配"))
        } else finish(undefined, message.meeting)
      }
    })
    try {
      send({ ...fields, type, v: 1, id: requestId, meeting_id: meetingId }, reply => {
        if (reply?.ok === false || reply?.sent === false) finish(new Error(reply.error || "Companion 未连接，请重连后重试"))
      })
    } catch {
      finish(new Error("无法连接 Companion，请重连后重试"))
    }
  })

  return {
    request,
    create(fields: Record<string, unknown> = {}) {
      return request("", "meeting.create", "meeting.created", fields)
    },
    write(meetingId: string, type: "meeting.append_transcript" | "meeting.set_transcript", fields: Record<string, unknown>): Promise<boolean> {
      const number = ++sequence
      const original = type === "meeting.append_transcript" && fields.source === "stt"
      const payload = original ? { ...fields, segment_id: crypto.randomUUID() } : fields
      const record: typeof writes[number] = { meetingId, sequence: number, done: Promise.resolve(false), confirmed: false }
      if (original) record.retryOriginal = async () => {
        const meeting = await request(meetingId, type, "meeting.updated", payload)
        if (!meeting.original_transcript?.some((line: any) => line.segment_id === payload.segment_id && line.text === String(payload.text).trim())) {
          throw new Error("原始识别存档尚未确认，已保留编辑稿；请重试保存转写")
        }
        record.confirmed = true
        record.error = undefined
      }
      record.done = (async () => {
        if (original) {
          const prior = writes.filter(write => write.meetingId === meetingId && write.retryOriginal)
          if (prior.length) await Promise.all(prior.map(write => write.done))
          if (prior.some(write => !write.confirmed)) throw new Error("前一段原始识别尚未保存；请点击“保存转写”恢复")
        }
        if (type === "meeting.set_transcript") {
          const originals = writes.filter(write => write.meetingId === meetingId && write.retryOriginal)
          if (originals.length) await Promise.all(originals.map(write => write.done))
          // A replacement must not mask failed raw-ASR writes. Stable segment
          // ids make explicit recovery safe even when only the first ACK was lost.
          for (const write of originals) if (!write.confirmed) await write.retryOriginal!()
        }
        return request(meetingId, type, "meeting.updated", payload)
      })().then(meeting => {
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

/** Generation may start only after both independent material writes are ACKed. */
export async function saveMeetingMaterials(options: {
  id: string
  text: string
  referenceNotes: string
  referenceName: string
  persistence: MeetingPersistence
  silenceCut?: boolean
}): Promise<string> {
  const { id, text, referenceNotes, referenceName, persistence } = options
  if (!await persistence.write(id, "meeting.set_transcript", { text, source: "user_edit", silence_cut: options.silenceCut === true })) {
    await persistence.waitForWrites(id)
    throw new Error("转写保存未确认，未开始生成；请重试保存")
  }
  await persistence.waitForWrites(id)
  const saved = await persistence.request(id, "meeting.set_reference", "meeting.updated", {
    reference_notes: referenceNotes, reference_name: referenceName,
  })
  if (saved.reference_notes !== referenceNotes || saved.reference_name !== referenceName) {
    throw new Error("参考笔记保存回执不一致，未开始生成")
  }
  // Use the ACKed canonical text, including any requested segmentation, so the
  // explicit generation snapshot cannot overwrite it with the uncut editor.
  return saved.transcript.map((line: { text: string; speaker?: string }) =>
    `${line.speaker ? `${line.speaker}: ` : ""}${line.text}`).join("\n").trim()
}

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
