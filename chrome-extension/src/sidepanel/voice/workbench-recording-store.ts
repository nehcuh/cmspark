import type { FrameCaptureStatus } from "./meeting-frame-sampler"

export interface MeetingFrame {
  frameId: string
  meetingId: string
  recordingId: string
  timeMs: number
  width: number
  height: number
  mime: string
  sha256: string
  blob: Blob
}

export const FRAME_BYTES = 512 * 1024
const MEETING_BYTES = 32 * 1024 * 1024
const MEETING_FRAMES = 240

export interface ScreenRecording {
  id: string
  meetingId?: string
  started: number
  mime: string
  chunks: number
  bytes: number
  elapsedMs: number
  state: "open" | "complete" | "partial"
  detail: string
  frameStatus?: FrameCaptureStatus
}

const rows = "recordings"
const parts = "chunks"
const frames = "frames"
let opening: Promise<IDBDatabase> | undefined

function database(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise((resolve, reject) => {
    const open = indexedDB.open("cmspark-screen-recordings", 2)
    open.onupgradeneeded = event => {
      if (event.oldVersion < 1) {
        open.result.createObjectStore(rows, { keyPath: "id" })
        open.result.createObjectStore(parts, { keyPath: ["id", "sequence"] })
      }
      open.transaction!.objectStore(rows).createIndex("meeting", "meetingId")
      const store = open.result.createObjectStore(frames, { keyPath: ["recordingId", "frameId"] })
      store.createIndex("meeting", "meetingId")
      store.createIndex("size", ["meetingId", "byteSize"])
      store.createIndex("digest", ["recordingId", "sha256"], { unique: true })
    }
    open.onerror = () => { opening = undefined; reject(open.error) }
    open.onsuccess = () => {
      const db = open.result
      db.onversionchange = () => { db.close(); opening = undefined }
      resolve(db)
    }
  })
  return opening
}

async function transaction<T>(
  stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => () => T,
): Promise<T> {
  const db = await database()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let cause: DOMException | null = null
    tx.onerror = event => { cause = (event.target as IDBRequest).error }
    tx.onabort = () => reject(cause ?? tx.error ?? new Error("本地存储事务中断"))
    let result: () => T
    try { result = run(tx) }
    catch (error) {
      tx.abort()
      reject(error)
      return
    }
    tx.oncomplete = () => resolve(result())
  })
}

function range(id: string): IDBKeyRange {
  return IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])
}

export function listMeetingFrames(meetingId: string) {
  return transaction([frames, rows], "readonly", tx => {
    const owners = tx.objectStore(rows).index("meeting").getAll(meetingId) as IDBRequest<ScreenRecording[]>
    const request = tx.objectStore(frames).index("meeting").getAll(meetingId) as IDBRequest<MeetingFrame[]>
    return () => {
      const starts = new Map(owners.result.map(row => [row.id, row.started]))
      return request.result.filter(frame => starts.has(frame.recordingId)).sort((a, b) =>
        starts.get(a.recordingId)! - starts.get(b.recordingId)! || a.recordingId.localeCompare(b.recordingId) || a.timeMs - b.timeMs)
    }
  })
}

/** Check the recording and its frame in one fresh transaction before disclosure or citation playback. */
export async function readMeetingFrame(meetingId: string, source: Pick<MeetingFrame, "recordingId" | "frameId" | "timeMs" | "sha256">) {
  const match = await transaction([rows, frames], "readonly", tx => {
    const owner = tx.objectStore(rows).get(source.recordingId) as IDBRequest<ScreenRecording | undefined>
    const frame = tx.objectStore(frames).get([source.recordingId, source.frameId]) as IDBRequest<MeetingFrame | undefined>
    return () => owner.result?.meetingId === meetingId && frame.result?.meetingId === meetingId &&
      frame.result.sha256 === source.sha256 && frame.result.timeMs === source.timeMs ? frame.result : undefined
  })
  if (!match) return undefined
  const digest = await crypto.subtle.digest("SHA-256", await match.blob.arrayBuffer())
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
  return hash === source.sha256 ? match : undefined
}

export const RECORDING_REMOVALS = "cmspark-screen-recording-removed"

export type FrameWrite = "saved" | "duplicate" | "limit" | "saved-last" | "closed"

export function saveMeetingFrame(frame: MeetingFrame): Promise<FrameWrite> {
  if (!frame.blob.size || frame.blob.size > FRAME_BYTES || frame.blob.type !== frame.mime ||
      !Number.isInteger(frame.width) || !Number.isInteger(frame.height) ||
      Math.min(frame.width, frame.height) < 1 || Math.max(frame.width, frame.height) > 1600) {
    throw new Error("无效的会议画面")
  }
  return transaction([rows, frames], "readwrite", tx => {
    let outcome: FrameWrite = "closed"
    const store = tx.objectStore(frames)
    const owner = tx.objectStore(rows).get(frame.recordingId) as IDBRequest<ScreenRecording | undefined>
    owner.onsuccess = () => {
      if (owner.result?.meetingId !== frame.meetingId || owner.result?.state !== "open") return
      const prior = store.index("digest").getKey([frame.recordingId, frame.sha256])
      prior.onsuccess = () => {
        if (prior.result) { outcome = "duplicate"; return }
        let count = 1, bytes = frame.blob.size
        const sizes = store.index("size").openKeyCursor(range(frame.meetingId))
        sizes.onsuccess = () => {
          const cursor = sizes.result
          if (cursor) {
            bytes += (cursor.key as [string, number])[1]
            count++
            cursor.continue()
            return
          }
          if (count > MEETING_FRAMES || bytes > MEETING_BYTES) { outcome = "limit"; return }
          store.add({ ...frame, byteSize: frame.blob.size })
          outcome = count === MEETING_FRAMES || bytes === MEETING_BYTES ? "saved-last" : "saved"
        }
      }
    }
    return () => outcome
  })
}

export const recordingStore = {
  save(row: ScreenRecording) {
    return transaction([rows], "readwrite", tx => {
      tx.objectStore(rows).put(row)
      return () => undefined
    })
  },
  append(row: ScreenRecording, data: Blob, elapsedMs: number) {
    const next = { ...row, chunks: row.chunks + 1, bytes: row.bytes + data.size, elapsedMs }
    return transaction([rows, parts], "readwrite", tx => {
      tx.objectStore(parts).add({ id: row.id, sequence: row.chunks, data })
      tx.objectStore(rows).put(next)
      return () => next
    })
  },
  list() {
    return transaction([rows], "readonly", tx => {
      const request = tx.objectStore(rows).getAll() as IDBRequest<ScreenRecording[]>
      return () => request.result.sort((a, b) => b.started - a.started)
    })
  },
  async read(row: ScreenRecording): Promise<Blob> {
    const blobs = await transaction([parts], "readonly", tx => {
      const request = tx.objectStore(parts).getAll(range(row.id)) as IDBRequest<{ data: Blob }[]>
      return () => request.result.map(part => part.data)
    })
    if (!blobs.length) throw new Error("没有可恢复的录屏分块")
    return new Blob(blobs, { type: row.mime })
  },
  async remove(id: string) {
    await transaction([rows, parts, frames], "readwrite", tx => {
      tx.objectStore(frames).delete(IDBKeyRange.bound([id], [id, []]))
      tx.objectStore(parts).delete(range(id))
      tx.objectStore(rows).delete(id)
      return () => undefined
    })
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(RECORDING_REMOVALS)
      try { channel.postMessage(id) } finally { channel.close() }
    }
  },
}
