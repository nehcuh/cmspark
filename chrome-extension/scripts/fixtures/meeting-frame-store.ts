// Runs on the disposable browser origin created by test-desktop-meeting-mix.py.
import { listMeetingFrames, readMeetingFrame, recordingStore, saveMeetingFrame, type ScreenRecording } from "../../src/sidepanel/voice/workbench-recording-store"

export async function exerciseRecordingUpgrade() {
  const old: ScreenRecording = { id: "legacy", started: 0, mime: "video/webm", chunks: 1,
    bytes: 3, elapsedMs: 17, state: "complete", detail: "" }
  await new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open("cmspark-screen-recordings", 1)
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore("recordings", { keyPath: "id" }).add(old)
      opening.result.createObjectStore("chunks", { keyPath: ["id", "sequence"] }).add({
        id: old.id, sequence: 0, data: new Blob(["old"]),
      })
    }
    opening.onsuccess = () => { opening.result.close(); resolve() }
    opening.onerror = () => reject(opening.error)
  })
  const recovered = (await recordingStore.list()).find(row => row.id === old.id)
  if (!recovered || await (await recordingStore.read(recovered)).text() !== "old") throw new Error("v1 migration lost recording")

  const meetingId = "budget"
  const make = (id: string) => recordingStore.save({ ...old, id, meetingId, state: "open" })
  await make("first"); await make("second")
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 10
  const jpeg = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/jpeg"))
  const small = 1024, full = 512 * 1024
  async function write(recordingId: string, frameId: string, size: number, meeting = meetingId) {
    const tag = new TextEncoder().encode(frameId)
    const blob = new Blob([jpeg, tag, new Uint8Array(size - jpeg.size - tag.length)], { type: "image/jpeg" })
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())
    return saveMeetingFrame({
      meetingId: meeting, recordingId, frameId, blob, sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join(""),
      timeMs: 1, width: 10, height: 10, mime: blob.type,
    })
  }
  const foreign = await write("first", "x", small, "foreign")
  const first = await write("first", "x", small)
  const duplicate = await write("first", "x", small)
  const count = await Promise.all(Array.from({ length: 240 }, (_, i) => write("second", "seq-" + i, small)))
  if (count.filter(v => v === "saved").length !== 238 || !count.includes("limit") || !count.includes("saved-last")) {
    throw new Error("Frame count exceeded or refused early")
  }
  const chosen = (await listMeetingFrames(meetingId)).find(f => f.recordingId === "second")!
  if (!await readMeetingFrame(meetingId, chosen) || await readMeetingFrame("another-meeting", chosen) ||
    await readMeetingFrame(meetingId, { ...chosen, sha256: "0".repeat(64) })) throw new Error("Source identity check failed")
  await recordingStore.remove("second")
  if (await readMeetingFrame(meetingId, chosen)) throw new Error("Deleted screenshot can still be selected for sending")
  const afterDelete = (await listMeetingFrames(meetingId)).length
  const stale = await write("second", "stale", small)
  await recordingStore.remove("first")
  await make("capacity")
  const bytes = await Promise.all(Array.from({ length: 65 }, (_, i) => write("capacity", "seq-" + i, full)))
  if (bytes.filter(v => v === "saved").length !== 63 || !bytes.includes("limit") || !bytes.includes("saved-last")) {
    throw new Error("Meeting byte budget exceeded or refused early")
  }
  await recordingStore.remove("capacity")
  return { recovered: recovered.id, afterDelete, foreign, stale, first, duplicate, complete: true }
}
