import * as fs from "node:fs"
import * as path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import type { IncomingMessage, ServerResponse } from "node:http"
import { recordingDirectory } from "../meeting/meeting-recordings"
import { isCaptureId } from "../voice/meeting-pcm-contract"

type Owner = { meetingId: string; captureId: string }
type Video = Owner & { file: string; bytes: number }
const maxBlock = 2 * 1024 * 1024

/** Local browser recording. Publish the final name only after the recorder has flushed its last blob. */
export class MeetingVideoUpload {
  private video?: Video
  private monitor?: ChildProcess
  constructor(private root?: string) {}

  close() {
    this.monitor?.kill()
    this.monitor = undefined
    if (this.video) this.finish(this.video, true)
  }

  private finish(video: Video, partial: boolean) {
    if (video.bytes) fs.renameSync(video.file, path.join(path.dirname(video.file),
      video.captureId + (partial ? ".partial.webm" : ".webm")))
    else fs.rmSync(video.file, { force: true })
    this.video = undefined
  }

  async handle(req: IncomingMessage, res: ServerResponse, query: Map<string, string>, owner: Owner | null) {
    const meeting = query.get("meeting"), capture = query.get("capture"), action = query.get("action")
    const reply = (code: number, body: object) => {
      res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      res.end(JSON.stringify(body))
    }
    if (!meeting || !isCaptureId(capture)) { reply(400, { error: "无效的会议录制" }); return }
    try {
      if (action === "open" || action === "monitor") {
        if (owner?.meetingId !== meeting || owner.captureId !== capture) { reply(409, { error: "会议录制已结束" }); return }
        if (action === "monitor") {
          if (process.platform !== "linux" || this.monitor) { reply(409, { error: "系统声音不可用或正被录制" }); return }
          // PulseAudio's default output monitor also works with PipeWire's Pulse server.
          const child = spawn("/usr/bin/parec", ["--raw", "--device=@DEFAULT_MONITOR@", "--format=s16le", "--rate=16000", "--channels=1", "--latency-msec=60"], { stdio: ["ignore", "pipe", "ignore"] })
          this.monitor = child
          const failed = () => {
            if (!res.headersSent) reply(503, { error: "无法读取电脑声音，请检查声音输出和 pulseaudio-utils，或改为共享带声音的浏览器标签页" })
            else res.end()
          }
          res.on("close", () => { child.kill(); if (this.monitor === child) this.monitor = undefined })
          child.on("error", failed)
          child.on("close", () => { if (!res.writableEnded) failed() })
          child.stdout.once("readable", () => {
            if (res.destroyed || res.headersSent || !child.stdout.readableLength) return
            res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" })
            child.stdout.pipe(res)
          })
          return
        }
        if (this.video?.captureId === capture) { reply(409, { error: "视频已开始写入" }); return }
        if (this.video) this.finish(this.video, true)
        const directory = recordingDirectory(meeting, this.root)
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
        const file = path.join(directory, "." + capture + ".webm")
        fs.closeSync(fs.openSync(file, "wx", 0o600))
        this.video = { meetingId: meeting, captureId: capture, file, bytes: 0 }
      } else {
        const video = this.video
        if (!video || video.meetingId !== meeting || video.captureId !== capture) { reply(409, { error: "视频写入会话已结束" }); return }
        if (action === "append") {
          const offset = query.get("offset"), chunks: Buffer[] = []
          let length = 0
          for await (const chunk of req) {
            length += chunk.length
            if (length > maxBlock) { reply(413, { error: "视频分块太大" }); return }
            chunks.push(chunk)
          }
          if (this.video !== video || String(video.bytes) !== offset || !length) { reply(409, { error: "视频分块顺序已变更" }); return }
          fs.appendFileSync(video.file, Buffer.concat(chunks, length))
          video.bytes += length
        } else if (action === "finish" || action === "partial") {
          if (String(video.bytes) !== query.get("offset")) { reply(409, { error: "视频长度尚未确认" }); return }
          this.finish(video, action === "partial")
        } else if (action === "discard") this.finish(video, true)
        else { reply(400, { error: "无效的视频操作" }); return }
      }
      reply(200, { ok: true })
    } catch {
      reply(500, { error: "无法保存视频，请检查磁盘空间和会议目录" })
    }
  }
}
