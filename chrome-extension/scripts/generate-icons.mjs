// Generate crisp extension and app icons from the shared CMspark geometry.
import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { renderMark, encodePNG, markSvg } from "../../scripts/lib/brand-icon.mjs"
const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets")
if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true })

// Chrome extension icons (connection mark)
for (const size of [16, 32, 48, 64, 128]) {
  const pixels = renderMark(size, "green")
  const png = encodePNG(size, size, pixels)
  const out = join(assetsDir, `icon${size}.png`)
  writeFileSync(out, png)
  console.log(`  icon${size}.png (${png.length} bytes)`)
}

// Also write the base icon.png (128px master)
const master128 = encodePNG(128, 128, renderMark(128, "green"))
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
  const png = encodePNG(size, size, renderMark(size, "green", true))
  writeFileSync(join(iconsetDir, name), png)
  console.log(`  ${name} (${png.length} bytes)`)
}

console.log("\nConnection icon generation complete!")

writeFileSync(join(assetsDir, "brand-mark.svg"), markSvg())
