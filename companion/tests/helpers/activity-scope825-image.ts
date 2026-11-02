/** Owned CPU image producer, not a fabricated native OCR/capture receipt. */
import { deflateSync } from 'node:zlib'
export function scope825Png(width: number, height: number, pixel: (x: number, y: number) => number[] = () => [255, 255, 255, 255]): Buffer {
  const crc = (bytes: Buffer): number => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0) } return (value ^ 0xffffffff) >>> 0 }
  const chunk = (kind: string, data: Buffer): Buffer => { const type = Buffer.from(kind), header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(data.length); tail.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([header, type, data, tail]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  const rows = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
