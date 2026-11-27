import * as fs from "node:fs"

// Chromium's streaming WebM Info precedes Tracks and Clusters, even when the
// recording spans many gigabytes. Never read or relocate the encoded frames.
const prefixLimit = 64 * 1024
const segmentId = 0x18538067
const infoId = 0x1549a966
const scaleId = 0x2ad7b1
const durationId = 0x4489
const defaultScale = 1_000_000 // nanoseconds per Segment Tick (Matroska TimestampScale)

function element(data: Buffer, start: number) {
  // EBML encodes an ID or size's byte count in the first set bit.
  const idWidth = Math.clz32(data[start] << 24) + 1
  if (idWidth > 4 || start + idWidth >= data.length) return
  const sizeStart = start + idWidth
  const sizeWidth = Math.clz32(data[sizeStart] << 24) + 1
  const payload = sizeStart + sizeWidth
  if (sizeWidth > 8 || payload > data.length) return
  let size = data[sizeStart] & (0xff >> sizeWidth)
  for (let i = sizeStart + 1; i < payload; i++) size = size * 256 + data[i]
  return { id: data.readUIntBE(start, idWidth), start, payload, end: payload + size }
}

function durationPatch(header: Buffer, elapsedMs: number) {
  const ebml = element(header, 0)
  if (ebml?.id !== 0x1a45dfa3 || ebml.end >= header.length) return
  const segment = element(header, ebml.end)
  if (segment?.id !== segmentId) return
  let info = element(header, segment.payload)
  while (info && info.id !== infoId && info.end < header.length) info = element(header, info.end)
  if (info?.id !== infoId || info.end > header.length) return

  let ticksNs = defaultScale
  let timestamp: ReturnType<typeof element>, duration: ReturnType<typeof element>
  for (let pos = info.payload; pos < info.end;) {
    const item = element(header, pos)
    if (!item || item.end > info.end) return
    if (item.id === scaleId) {
      const width = item.end - item.payload
      if (!width || width > 6) return
      timestamp = item
      ticksNs = header.readUIntBE(item.payload, width)
    } else if (item.id === durationId) duration = item
    pos = item.end
  }
  // A muxer may already have reserved a float for Duration.
  if (duration && ticksNs > 0) {
    const width = duration.end - duration.payload
    if (width !== 4 && width !== 8) return
    const bytes = Buffer.alloc(width)
    if (width === 4) bytes.writeFloatBE(elapsedMs * defaultScale / ticksNs)
    else bytes.writeDoubleBE(elapsedMs * defaultScale / ticksNs)
    return { offset: duration.payload, bytes }
  }
  // Chromium explicitly encodes the default TimestampScale in exactly seven
  // bytes. Omitting it keeps the same 1 ms ticks. An EBML float32 Duration
  // occupies those same seven bytes: all Segment offsets and media stay valid.
  // Integer milliseconds are exactly representable through Mini's three-hour cap.
  if (timestamp && ticksNs === defaultScale && timestamp.end - timestamp.start === 7) {
    const bytes = Buffer.from([0x44, 0x89, 0x84, 0, 0, 0, 0])
    bytes.writeFloatBE(elapsedMs, 3)
    return { offset: timestamp.start, bytes }
  }
}

export function finalizeWebmDuration(file: string, size: number, elapsedMs: number): void {
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs <= 0) return
  const fd = fs.openSync(file, "r+")
  try {
    const header = Buffer.alloc(Math.min(size, prefixLimit))
    const read = fs.readSync(fd, header, 0, header.length, 0)
    const patch = durationPatch(header.subarray(0, read), elapsedMs)
    if (!patch) return // Preserve the original header for an unfamiliar muxer.
    let written = 0
    while (written < patch.bytes.length) {
      const count = fs.writeSync(fd, patch.bytes, written, patch.bytes.length - written, patch.offset + written)
      if (!count) throw new Error("Unable to finalize WebM duration")
      written += count
    }
  } finally { fs.closeSync(fd) }
}
