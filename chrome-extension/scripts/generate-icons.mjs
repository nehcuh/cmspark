// Generate portal-style icons inspired by Rick and Morty's interdimensional portal
// Bright neon green oval vortex with dark center, swirling energy, and glow
import { writeFileSync, mkdirSync, existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { deflateSync } from "zlib"

const __dirname = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(__dirname, "..", "assets")

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = ((h ^ (h >> 13)) * 1274126177) | 0
  h = h ^ (h >> 16)
  return (h & 0x7fffffff) / 0x7fffffff
}

function smoothNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const n00 = hash(ix, iy), n10 = hash(ix + 1, iy)
  const n01 = hash(ix, iy + 1), n11 = hash(ix + 1, iy + 1)
  return n00 * (1 - sx) * (1 - sy) + n10 * sx * (1 - sy) +
         n01 * (1 - sx) * sy + n11 * sx * sy
}

function fbmNoise(x, y, octaves = 3) {
  let val = 0, amp = 1, freq = 1, max = 0
  for (let i = 0; i < octaves; i++) {
    val += smoothNoise(x * freq, y * freq) * amp
    max += amp
    amp *= 0.5
    freq *= 2
  }
  return val / max
}

// ---------------------------------------------------------------------------
// Portal renderer
// ---------------------------------------------------------------------------

function renderPortal(size, colorScheme = "green") {
  const buf = Buffer.alloc(size * size * 4)
  const cx = size / 2, cy = size / 2

  // Portal is slightly taller than wide (oval) — 30% larger than v1
  const rx = size * 0.47
  const ry = size * 0.52

  // Color palettes — bright neon green (#39FF14 range)
  const palettes = {
    green:  { r: [40, 100], g: [230, 255], b: [20, 120], glow: [80, 255, 80] },
    red:    { r: [200, 255], g: [20, 60],   b: [10, 40],  glow: [255, 50, 30] },
    yellow: { r: [220, 255], g: [180, 230], b: [10, 50],  glow: [255, 220, 40] },
  }
  const pal = palettes[colorScheme]

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = (py * size + px) * 4

      // Normalized elliptical coords
      const nx = (px - cx) / rx
      const ny = (py - cy) / ry
      const dist = Math.sqrt(nx * nx + ny * ny)
      const angle = Math.atan2(ny, nx)

      // --- Portal shape (soft-edged oval) ---
      const portalMask = 1 - smoothstep(0.82, 1.08, dist)

      if (portalMask <= 0) {
        // Outside portal — subtle ambient glow
        const glowDist = Math.sqrt(((px - cx) / (rx * 1.5)) ** 2 + ((py - cy) / (ry * 1.5)) ** 2)
        const ambientGlow = Math.max(0, 0.25 - glowDist * 0.2)
        buf[idx]     = Math.floor(pal.glow[0] * ambientGlow)
        buf[idx + 1] = Math.floor(pal.glow[1] * ambientGlow)
        buf[idx + 2] = Math.floor(pal.glow[2] * ambientGlow)
        buf[idx + 3] = Math.floor(ambientGlow * 180)
        continue
      }

      // --- Swirl pattern (spiral arms radiating from center) ---
      const swirlCount = size > 48 ? 6 : (size > 32 ? 4 : 3)
      const spiralTwist = 2.5
      const swirlPhase = angle * swirlCount + dist * spiralTwist * Math.PI
      const noiseVal = fbmNoise(nx * 2.5 + 7.3, ny * 2.5 + 3.1, 3)
      const swirl = Math.sin(swirlPhase + noiseVal * 5) * 0.5 + 0.5

      // --- Radial brightness (bright ring near edge, dark center) ---
      const edgeBright = smoothstep(0.15, 0.55, dist)
      const centerDim = 1 - smoothstep(0, 0.15, dist) * 0.35
      const edgeFade = 1 - smoothstep(0.75, 1.0, dist) * 0.4

      // --- Composite intensity — boosted for brighter overall look ---
      const baseIntensity = 0.45 + swirl * 0.35 + edgeBright * 0.2
      const intensity = baseIntensity * centerDim * edgeFade * portalMask

      // --- Color with swirl-based variation ---
      const rRange = pal.r[1] - pal.r[0]
      const gRange = pal.g[1] - pal.g[0]
      const bRange = pal.b[1] - pal.b[0]

      const colorMix = swirl * 0.7 + noiseVal * 0.3

      buf[idx]     = Math.min(255, Math.floor((pal.r[0] + rRange * colorMix) * intensity))
      buf[idx + 1] = Math.min(255, Math.floor((pal.g[0] + gRange * colorMix) * intensity))
      buf[idx + 2] = Math.min(255, Math.floor((pal.b[0] + bRange * colorMix) * intensity))
      buf[idx + 3] = Math.min(255, Math.floor(portalMask * 255))
    }
  }

  return buf
}

// ---------------------------------------------------------------------------
// PNG encoder (RGBA)
// ---------------------------------------------------------------------------

function encodePNG(width, height, rgbaPixels) {
  const scanlines = []
  for (let y = 0; y < height; y++) {
    const row = rgbaPixels.slice(y * width * 4, (y + 1) * width * 4)
    scanlines.push(Buffer.from([0]))  // filter: None
    scanlines.push(row)
  }
  const raw = Buffer.concat(scanlines)
  const compressed = deflateSync(raw, { level: 9 })

  const chunks = []
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)   // bit depth
  ihdr.writeUInt8(6, 9)   // RGBA
  chunks.push(pngChunk("IHDR", ihdr))
  chunks.push(pngChunk("IDAT", compressed))
  chunks.push(pngChunk("IEND", Buffer.alloc(0)))

  return Buffer.concat(chunks)
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii")
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0)
  return Buffer.concat([len, t, data, crcBuf])
}

function crc32(buf) {
  let crc = 0xffffffff
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[i] = c
  }
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// ---------------------------------------------------------------------------
// Generate all icons
// ---------------------------------------------------------------------------

if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true })

// Chrome extension icons (portal green)
for (const size of [16, 32, 48, 64, 128]) {
  const pixels = renderPortal(size, "green")
  const png = encodePNG(size, size, pixels)
  const out = join(assetsDir, `icon${size}.png`)
  writeFileSync(out, png)
  console.log(`  icon${size}.png (${png.length} bytes)`)
}

// Also write the base icon.png (128px master)
const master128 = encodePNG(128, 128, renderPortal(128, "green"))
writeFileSync(join(assetsDir, "icon.png"), master128)
console.log(`  icon.png (${master128.length} bytes)`)

// Larger icons for macOS .icns (.iconset folder)
const iconsetDir = join(assetsDir, "CMspark.iconset")
if (!existsSync(iconsetDir)) mkdirSync(iconsetDir, { recursive: true })

const iconsetSizes = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
]
for (const [size, name] of iconsetSizes) {
  const png = encodePNG(size, size, renderPortal(size, "green"))
  writeFileSync(join(iconsetDir, name), png)
  console.log(`  ${name} (${png.length} bytes)`)
}

console.log("\nPortal icon generation complete!")
