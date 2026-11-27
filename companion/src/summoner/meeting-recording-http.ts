import * as fs from "node:fs"
import * as path from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import { pipeline } from "node:stream"
import { listMeetingRecordings, recordingDirectory, validRecordingName } from "../meeting/meeting-recordings"

/** Called behind the ordinary overlay Host and session checks. Range support lets WebKit seek without buffering an entire meeting. */
export function serveMeetingRecordings(req: IncomingMessage, res: ServerResponse, query: Map<string, string>, root?: string) {
  const meeting = query.get("meeting") || ""
  const name = query.get("file")
  try {
    if (name === undefined) {
      const body = JSON.stringify({ recordings: listMeetingRecordings(meeting, root) })
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      res.end(body)
      return
    }
    if (!validRecordingName(name)) throw new Error("Invalid recording")
    const file = path.join(recordingDirectory(meeting, root), name)
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || !stat.size) throw new Error("Recording unavailable")
    const size = stat.size
    const headers: Record<string, string | number> = {
      "Content-Type": name.endsWith(".wav") ? "audio/wav" : "video/mp4",
      "Cache-Control": "private, no-store", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff",
    }
    if (query.get("download") === "1") headers["Content-Disposition"] = 'attachment; filename="' + name + '"'
    let start = 0, end = size - 1
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
      if (range?.[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])) }
      else if (range?.[2]) start = Math.max(0, size - Number(range[2]))
      if (!range || (!range[1] && !range[2]) || start >= size || start > end) {
        res.writeHead(416, { "Content-Range": "bytes */" + size }); res.end(); return
      }
      headers["Content-Range"] = "bytes " + start + "-" + end + "/" + size
    }
    headers["Content-Length"] = end - start + 1
    res.writeHead(req.headers.range ? 206 : 200, headers)
    if (req.method === "HEAD") res.end()
    else pipeline(fs.createReadStream(file, { start, end }), res, () => {})
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "会议录制文件不存在" }))
  }
}
