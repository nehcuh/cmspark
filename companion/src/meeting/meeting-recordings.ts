import * as fs from "node:fs"
import * as path from "node:path"
import { DATA_DIR } from "../config"
import { isCaptureId } from "../voice/meeting-pcm-contract"
import { writePcmWavHeader } from "../voice/pcm-wav"
import { isSafeMeetingId } from "./meeting-store"

export function recordingDirectory(meeting: string, root = DATA_DIR): string {
  if (!isSafeMeetingId(meeting)) throw new Error("Invalid meeting")
  const dir = path.join(root, "meetings", meeting)
  if (!fs.existsSync(path.join(dir, "meta.json"))) throw new Error("Meeting not found")
  return path.join(dir, "recordings")
}

export function validRecordingName(name: string): boolean {
  const dot = name.lastIndexOf(".")
  return isCaptureId(name.slice(0, dot)) && ["wav", "mp4"].includes(name.slice(dot + 1))
}

export function listMeetingRecordings(id: string, root = DATA_DIR) {
  const dir = recordingDirectory(id, root)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(item => item.isFile() && validRecordingName(item.name))
    .map(({ name }) => {
      const stat = fs.statSync(path.join(dir, name))
      return { name, bytes: stat.size, started: stat.birthtimeMs || stat.mtimeMs }
    }).filter(file => file.bytes > 44).sort((a, b) => a.started - b.started)
}

/** One local WAV per explicit recording. Its header describes the contiguous prefix even after an interrupted session. */
export class MeetingWaveFile {
  private fd: number | undefined
  private length = 0
  private readonly header = Buffer.alloc(44)
  constructor(private meeting: string, private capture: string, private root = DATA_DIR) {
    if (!isCaptureId(capture)) throw new Error("Invalid capture")
  }

  append(pcm: Buffer): void {
    if (this.fd === undefined) {
      const dir = recordingDirectory(this.meeting, this.root)
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      this.fd = fs.openSync(path.join(dir, this.capture + ".wav"), "wx", 0o600)
    }
    try {
      this.write(pcm, 44 + this.length)
      writePcmWavHeader(this.header, this.length + pcm.length)
      this.write(this.header, 0)
      this.length += pcm.length
    } catch {
      throw new Error("save_failed")
    }
  }

  private write(buffer: Buffer, position: number): void {
    let offset = 0
    while (offset < buffer.length) {
      const wrote = fs.writeSync(this.fd!, buffer, offset, buffer.length - offset, position + offset)
      if (!wrote) throw new Error("save_failed")
      offset += wrote
    }
  }

  close(): void {
    if (this.fd !== undefined) { fs.closeSync(this.fd); this.fd = undefined }
  }
}
