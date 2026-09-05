import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { tokens } from "../src/sidepanel/ui/tokens"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

// GitHub: #323 — empty-state imprint is a red calf robot (brandRed token),
// independent from the danger family. Pure T1 presentation.

// --- small colour-science helpers (CIEDE2000 + Machado 2009 deutan), so the
// "clearly distinguishable from danger" acceptance lives in code, not prose. ---
function hex2rgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}
function lin(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
function rgb2lab([r, g, b]: [number, number, number]) {
  const R = lin(r), G = lin(g), B = lin(b)
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return { L: 116 * f(Y) - 16, a: 500 * (f(X) - f(Y)), b: 200 * (f(Y) - f(Z)) }
}
function ciede2000(a: { L: number; a: number; b: number }, b: { L: number; a: number; b: number }) {
  const C1 = Math.hypot(a.a, a.b), C2 = Math.hypot(b.a, b.b), Cb = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))))
  const ap1 = a.a * (1 + G), ap2 = b.a * (1 + G)
  const Cp1 = Math.hypot(ap1, a.b), Cp2 = Math.hypot(ap2, b.b)
  let hp1 = ap1 === 0 && a.b === 0 ? 0 : (Math.atan2(a.b, ap1) * 180) / Math.PI
  let hp2 = ap2 === 0 && b.b === 0 ? 0 : (Math.atan2(b.b, ap2) * 180) / Math.PI
  if (hp1 < 0) hp1 += 360
  if (hp2 < 0) hp2 += 360
  const dL = b.L - a.L, dCp = Cp2 - Cp1
  let dhp = 0
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * Math.PI) / 360)
  const Lbp = (a.L + b.L) / 2, Cbp = (Cp1 + Cp2) / 2
  let hbp = 0
  if (Cp1 * Cp2 !== 0) {
    hbp = (hp1 + hp2) / 2
    if (Math.abs(hp1 - hp2) > 180) {
      if (hp1 + hp2 < 360) hbp += 180
      else hbp -= 180
    }
  }
  const T =
    1 -
    0.17 * Math.cos(((hbp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbp - 63) * Math.PI) / 180)
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2))
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)))
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2))
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T
  const Rt = -Math.sin((2 * dTheta * Math.PI) / 180) * Rc
  return Math.sqrt(
    Math.pow(dL / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh),
  )
}
/** Machado 2009 severity-1.0 deuteranopia (Chrome DevTools simulation). */
const MACHADO_DEUTAN = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
]
function machadoDeutan(h: string): [number, number, number] {
  const [r, g, b] = hex2rgb(h).map(lin)
  const out = MACHADO_DEUTAN.map((row) => row[0] * r + row[1] * g + row[2] * b)
  const delin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
  return out.map((c) => Math.round(Math.min(1, Math.max(0, delin(c))) * 255)) as [number, number, number]
}
const dE00 = (x: string, y: string) => ciede2000(rgb2lab(hex2rgb(x)), rgb2lab(hex2rgb(y)))

function testBrandDistance(hex: string) {
  const danger = "#dc2626"
  const normal = dE00(hex, danger)
  const deutan = ciede2000(rgb2lab(machadoDeutan(hex)), rgb2lab(machadoDeutan(danger)))
  assert.ok(normal >= 10, `normal ΔE00 ${normal.toFixed(1)} should be ≥ 10 (clearly visible)`)
  assert.ok(deutan >= 5, `Machado-deutan ΔE00 ${deutan.toFixed(1)} should be ≥ 5 (color-blind readable)`)
}

test("#323 brandRed is a distinct terracotta token, never the danger hex", () => {
  const brand: string = tokens.brandRed
  assert.equal(brand, "#d97757")
  assert.ok(brand !== tokens.danger)
  assert.ok(brand !== tokens.dangerSoft)
  assert.ok(brand.toLowerCase() !== "#dc2626")
  // Registered once in tokens.ts, not a duplicate of an existing semantic red.
  const tokenFile = src("src/sidepanel/ui/tokens.ts")
  assert.equal((tokenFile.match(/brandRed:/g) ?? []).length, 1)
})

test("#323 brandRed vs danger passes normal AND deuteranopia distance gates", () => {
  // Acceptance from #323: brand red must be clearly distinguishable from
  // danger for both normal vision and the most common red-green deficiency.
  testBrandDistance(tokens.brandRed)
})


test("#323 CompanionMark is the only empty-state imprint usage", () => {
  const chat = src("src/sidepanel/components/ChatView.tsx")
  // CompanionMark imported once and rendered once (EmptyState only).
  assert.equal((chat.match(/CompanionMark/g) ?? []).length, 2) // import + <CompanionMark …/>
  const emptyFn = chat.slice(chat.indexOf("function EmptyState"), chat.indexOf("const markdownCSS"))
  assert.match(emptyFn, /<CompanionMark size=\{\d+\}\s*\/>/)
})

test("#323 mark keeps filled-stamp geometry, aria-hidden, no armed-state bits", () => {
  const icons = src("src/sidepanel/ui/icons.tsx")
  const mark = icons.slice(
    icons.indexOf("export function CompanionMark"),
    icons.indexOf("export function IconSend"),
  )
  assert.match(mark, /aria-hidden/)
  assert.ok(!/dangerouslySetInnerHTML/.test(mark))
  assert.ok(!/armed|cruise|tier|mode|level|L[012]/.test(mark), "mark carries no state")
  // viewBox stays 92×92 and size stays a prop (fits #321 PR-4 92→48 rescale).
  assert.match(mark, /viewBox="0 0 92 92"/)
  assert.match(mark, /\{ size = \d+ \}/)
})

test("#323 mark draws calf features from tokens, no raw hex drift", () => {
  const icons = src("src/sidepanel/ui/icons.tsx")
  const mark = icons.slice(
    icons.indexOf("export function CompanionMark"),
    icons.indexOf("export function IconSend"),
  )
  // Body + horns + ears use the brandRed token (not a literal or danger).
  assert.ok((mark.match(/tokens\.brandRed/g) ?? []).length >= 4)
  assert.ok(!/#dc2626/i.test(mark))
  // Robot accent stays indigo; face marker is the calf muzzle.
  assert.match(mark, /tokens\.accent/)
  assert.match(mark, /ellipse cx="46"/)
  assert.match(mark, /rx="9"/)
})
