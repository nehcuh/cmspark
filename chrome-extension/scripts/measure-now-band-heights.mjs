// #321 PR-2 round-2 (review NIT-1 + MAJOR): REAL layout measurement of the
// FocusBand acceptance pages. Loads each .shot-out/now-band-*.html in headless
// Chrome (--dump-dom runs the embedded measure snippet after layout) and asserts:
//   1. [data-focus-band] rendered height ≤ 80px (the PR's hard cap, now measured,
//      not just CSS-scanned) — scenarios without a band report height=null.
//   2. Scene scenario: the scene-name button keeps ≥120px of its own width —
//      the old bug crushed it to min-content (~20-40px,「场景：…」); with the
//      round-2 fix it either fits or tail-ellipsizes at its own cap (maxWidth 200).
// Exit 1 on any violation. Run after render-now-band-shots.mjs.

import { execFileSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const OUT = join(process.cwd(), ".shot-out")
const SCENARIOS = ["empty", "scene", "confirm"]

if (!existsSync(CHROME)) {
  console.error(`skip: Chrome not found at ${CHROME}`)
  process.exit(0)
}

let failed = false
const measures = {}

for (const name of SCENARIOS) {
  const file = join(OUT, `now-band-${name}.html`)
  if (!existsSync(file)) {
    console.error(`FAIL ${name}: missing ${file} — run render-now-band-shots.mjs first`)
    failed = true
    continue
  }
  const dom = execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--virtual-time-budget=500",
      "--dump-dom",
      `file://${file}`,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  )
  const m = dom.match(/<meta\s+name="focus-band-measure"\s+content="([^"]+)"/)
  if (!m) {
    console.error(`FAIL ${name}: measure meta not found (snippet did not run)`)
    failed = true
    continue
  }
  measures[name] = m[1]
  const height = Number(m[1].match(/height=(-?\d+)/)?.[1] ?? NaN)
  const nameW = Number(m[1].match(/scene-name-width=(-?\d+)/)?.[1] ?? NaN)
  if (!Number.isNaN(height) && height !== -1 && height > 80) {
    console.error(`FAIL ${name}: band height ${height}px > 80px hard cap`)
    failed = true
  }
  if (name === "scene") {
    if (Number.isNaN(nameW) || nameW < 120) {
      console.error(
        `FAIL scene: scene-name button width ${nameW}px — crushed below its own cap (old「场景：…」bug)`,
      )
      failed = true
    }
  }
  console.log(`${name}: ${m[1]}`)
}

if (failed) process.exit(1)
console.log("ok: all rendered FocusBand heights ≤80px; scene name not crushed")
