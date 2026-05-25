// Generate placeholder icons for Plasmo's gen-assets directory
import { writeFileSync, mkdirSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { deflateSync } from "zlib"

const __dirname = dirname(fileURLToPath(import.meta.url))
const genAssetsDir = join(__dirname, "..", ".plasmo", "gen-assets")

function makePNG(size) {
  const scanlines = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      row.push(74, 144, 217)
    }
    scanlines.push(Buffer.from(row))
  }
  const raw = Buffer.concat(scanlines)
  const compressed = deflateSync(raw)

  const result = []
  result.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0)
  ihdrData.writeUInt32BE(size, 4)
  ihdrData.writeUInt8(8, 8)
  ihdrData.writeUInt8(2, 9)
  ihdrData.writeUInt8(0, 10)
  ihdrData.writeUInt8(0, 11)
  ihdrData.writeUInt8(0, 12)
  result.push(makeChunk("IHDR", ihdrData))

  result.push(makeChunk("IDAT", compressed))
  result.push(makeChunk("IEND", Buffer.alloc(0)))

  return Buffer.concat(result)
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii")
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBuffer, data])
  const crc = crc32(crcInput)
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc >>> 0, 0)
  return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

function crc32(buf) {
  let crc = 0xffffffff
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

if (!existsSync(genAssetsDir)) {
  mkdirSync(genAssetsDir, { recursive: true })
}

for (const size of [16, 32, 48, 64, 128]) {
  const png = makePNG(size)
  const outputPath = join(genAssetsDir, `icon${size}.plasmo.png`)
  writeFileSync(outputPath, png)
  console.log(`Generated icon${size}.plasmo.png (${png.length} bytes)`)
}

console.log("Icon generation complete.")
