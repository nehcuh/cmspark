// Generate portal-style tray icons for the Companion
// Same vortex shape as extension icon, but color-coded for status
import { writeFileSync, mkdirSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { deflateSync } from "zlib"

const __dirname = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(__dirname, "..", "assets")

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = ((h ^ (h >> 13)) * 1274126177) | 0
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff
}

function smoothNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  return hash(ix, iy) * (1 - sx) * (1 - sy) + hash(ix + 1, iy) * sx * (1 - sy) +
         hash(ix, iy + 1) * (1 - sx) * sy + hash(ix + 1, iy + 1) * sx * sy
}

function fbm(x, y, oct = 3) {
  let v = 0, a = 1, f = 1, m = 0
  for (let i = 0; i < oct; i++) { v += smoothNoise(x * f, y * f) * a; m += a; a *= 0.5; f *= 2 }
  return v / m
}

function renderTrayPortal(size, colorScheme) {
  const buf = Buffer.alloc(size * size * 4)
  const cx = size / 2, cy = size / 2
  const rx = size * 0.36, ry = size * 0.40

  const palettes = {
    green:  { r: [20, 60],  g: [200, 255], b: [10, 90],  glow: [30, 255, 50] },
    red:    { r: [200, 255], g: [20, 60],  b: [10, 40],  glow: [255, 50, 30] },
    yellow: { r: [220, 255], g: [180, 230], b: [10, 50], glow: [255, 220, 40] },
  }
  const pal = palettes[colorScheme]

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = (py * size + px) * 4
      const nx = (px - cx) / rx, ny = (py - cy) / ry
      const dist = Math.sqrt(nx * nx + ny * ny)
      const angle = Math.atan2(ny, nx)
      const mask = 1 - smoothstep(0.82, 1.08, dist)

      if (mask <= 0) {
        const gd = Math.sqrt(((px - cx) / (rx * 1.5)) ** 2 + ((py - cy) / (ry * 1.5)) ** 2)
        const ag = Math.max(0, 0.25 - gd * 0.2)
        buf[idx] = Math.floor(pal.glow[0] * ag)
        buf[idx + 1] = Math.floor(pal.glow[1] * ag)
        buf[idx + 2] = Math.floor(pal.glow[2] * ag)
        buf[idx + 3] = Math.floor(ag * 180)
        continue
      }

      const swirlN = size > 48 ? 6 : (size > 32 ? 4 : 3)
      const swirl = Math.sin(angle * swirlN + dist * 2.5 * Math.PI + fbm(nx * 2.5 + 7.3, ny * 2.5 + 3.1) * 5) * 0.5 + 0.5
      const edgeBright = smoothstep(0.15, 0.55, dist)
      const centerDim = 1 - smoothstep(0, 0.2, dist) * 0.6
      const edgeFade = 1 - smoothstep(0.75, 1.0, dist) * 0.4
      const intensity = (0.25 + swirl * 0.45 + edgeBright * 0.3) * centerDim * edgeFade * mask
      const mix = swirl * 0.7 + fbm(nx * 2.5 + 7.3, ny * 2.5 + 3.1) * 0.3

      buf[idx]     = Math.min(255, Math.floor((pal.r[0] + (pal.r[1] - pal.r[0]) * mix) * intensity))
      buf[idx + 1] = Math.min(255, Math.floor((pal.g[0] + (pal.g[1] - pal.g[0]) * mix) * intensity))
      buf[idx + 2] = Math.min(255, Math.floor((pal.b[0] + (pal.b[1] - pal.b[0]) * mix) * intensity))
      buf[idx + 3] = Math.min(255, Math.floor(mask * 255))
    }
  }
  return buf
}

function encodePNG(w, h, rgba) {
  const rows = []
  for (let y = 0; y < h; y++) {
    rows.push(Buffer.from([0]), Buffer.from(rgba.slice(y * w * 4, (y + 1) * w * 4)))
  }
  const raw = Buffer.concat(rows)
  const compressed = deflateSync(raw, { level: 9 })
  const chunks = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.writeUInt8(8, 8); ihdr.writeUInt8(6, 9)
  chunks.push(chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0)))
  return Buffer.concat(chunks)
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii"), l = Buffer.alloc(4)
  l.writeUInt32BE(data.length)
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0)
  return Buffer.concat([l, t, data, c])
}

function crc32(buf) {
  let crc = 0xffffffff
  const tbl = new Int32Array(256)
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); tbl[i] = c }
  for (let i = 0; i < buf.length; i++) crc = tbl[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true })

for (const color of ["green", "red", "yellow"]) {
  const pixels = renderTrayPortal(16, color)
  const png = encodePNG(16, 16, pixels)
  const out = join(assetsDir, `tray-icon-${color}.png`)
  writeFileSync(out, png)
  console.log(`  tray-icon-${color}.png (${png.length} bytes)`)
}

console.log("\nPortal tray icons generated!")
