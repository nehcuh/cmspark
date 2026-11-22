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
}

const rows = "recordings"
const parts = "chunks"
let opening: Promise<IDBDatabase> | undefined

function database(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise((resolve, reject) => {
    const open = indexedDB.open("cmspark-screen-recordings", 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore(rows, { keyPath: "id" })
      open.result.createObjectStore(parts, { keyPath: ["id", "sequence"] })
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
  remove(id: string) {
    return transaction([rows, parts], "readwrite", tx => {
      tx.objectStore(parts).delete(range(id))
      tx.objectStore(rows).delete(id)
      return () => undefined
    })
  },
}
