import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { tokens } from "../src/sidepanel/ui/tokens"

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

// GitHub: #323 — empty-state imprint is a red calf robot (brandRed token),
// independent from the danger family. Pure T1 presentation.

test("#323 brandRed is a distinct terracotta token, never the danger hex", () => {
  const brand: string = tokens.brandRed
  assert.equal(tokens.brandRed, "#c96033")
  assert.ok(brand !== tokens.danger)
  assert.ok(brand !== tokens.dangerSoft)
  assert.ok(brand.toLowerCase() !== "#dc2626")
  // Registered once in tokens.ts, not a duplicate of an existing semantic red.
  const tokenFile = src("src/sidepanel/ui/tokens.ts")
  assert.equal((tokenFile.match(/brandRed:/g) ?? []).length, 1)
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
