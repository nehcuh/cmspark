#!/usr/bin/env node
// Sidepanel visual-hygiene gate (#321 PR-1).
//
// Fails when the chat-shell scope files contain:
//   1. Raw color literals (hex / rgb() / rgba()) in CSS-property position —
//      colors must come from sidepanel/ui/tokens.ts (Sole hex source of truth).
//   2. The `tokens.x || "#fallback"` anti-pattern — tokens are `as const` and
//      always defined, so the fallback is dead code and a visual-drift source.
//   3. fontSize below 10px — chrome type floor (mono stdout/stderr tails may
//      keep 10px; below that needs a whitelist entry with a reason).
//
// Color-aware, NOT a dumb hex grep:
//   - Comments are stripped first, so issue references like `// #258` or
//     `/* #272 ... */` are never mistaken for color values.
//   - A literal only counts when it appears after a CSS property name
//     (color/background/border/boxShadow/fill/stroke/outline/scrollbar-color…)
//     on the same line, so identifiers, issue IDs, and non-style strings pass.
//   - Only the PR-1 scope files are scanned (see SCOPE below). tokens.ts
//     itself, tests, fixtures, and out-of-scope panels are not scanned.
//
// Whitelist: add an entry to WHITELIST with { file, lineIncludes, reason } to
// allow a specific line (e.g. a deliberate exception). Keep it empty unless a
// reviewer signs off on the exception.
//
// Run: node scripts/check-sidepanel-raw-colors.mjs   (from chrome-extension/)

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const EXT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

// PR-1 scope: chat shell + FocusBand + scene/run-busy/worker rows
// (#321 PR-2: former SceneStatusBar/RunBusyChip/WorkerScopeBar now live in
// FocusBand.tsx + SceneStatusRow.tsx) + ErrorBoundary (lives in App.tsx).
// Widen deliberately in later PRs.
const SCOPE = [
  "src/sidepanel/App.tsx",
  "src/sidepanel/components/ChatView.tsx",
  "src/sidepanel/components/FocusBand.tsx",
  "src/sidepanel/components/SceneStatusRow.tsx",
]

/** @type {{ file: string, lineIncludes: string, reason: string }[]} */
const WHITELIST = [
  // Example (keep commented out unless a reviewer approves the exception):
  // {
  //   file: "src/sidepanel/components/ChatView.tsx",
  //   lineIncludes: "fontSize: 9",
  //   reason: "why this exception is safe",
  // },
]

// CSS properties whose values are colors. Kebab and camelCase both covered by
// the case-insensitive match (boxShadow ↔ box-shadow).
const CSS_COLOR_PROP =
  /(?:color|background|border|box-?shadow|text-?shadow|fill|stroke|outline|caret-color|accent-color|scrollbar-color)\s*:/i

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/g
const TOKEN_FALLBACK = /\btokens\.\w+\s*\|\|/
const FONT_SIZE = /\bfont-?size\s*:\s*(\d+)(?:px)?\b/i

/**
 * Strip comments without touching string contents we still want to scan:
 * - block comments (state machine across lines)
 * - line comments: `//` starts a comment unless immediately preceded by `:`
 *   (keeps `https://…` URLs inside strings intact)
 */
function stripComments(text) {
  const lines = text.split("\n")
  let inBlock = false
  return lines.map((line) => {
    let out = ""
    let i = 0
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", i)
        if (end === -1) {
          i = line.length
        } else {
          inBlock = false
          i = end + 2
        }
        continue
      }
      if (line[i] === "/" && line[i + 1] === "*") {
        inBlock = true
        i += 2
        continue
      }
      if (line[i] === "/" && line[i + 1] === "/" && line[i - 1] !== ":") {
        break // rest of line is a comment
      }
      out += line[i]
      i++
    }
    return out
  })
}

/** True when `index` on `line` sits in CSS-property value position. */
function isCssContext(line, index) {
  return CSS_COLOR_PROP.test(line.slice(0, index))
}

function isWhitelisted(file, line) {
  return WHITELIST.some((w) => w.file === file && line.includes(w.lineIncludes))
}

const violations = []
const counts = { rawColors: 0, tokenFallbacks: 0, tinyFonts: 0 }

for (const file of SCOPE) {
  const path = join(EXT_ROOT, file)
  const stripped = stripComments(readFileSync(path, "utf8"))
  stripped.forEach((line, idx) => {
    const lineNo = idx + 1
    if (isWhitelisted(file, line)) return

    COLOR_LITERAL.lastIndex = 0
    let m
    while ((m = COLOR_LITERAL.exec(line)) !== null) {
      if (!isCssContext(line, m.index)) continue
      counts.rawColors++
      violations.push(`${file}:${lineNo}:${m.index + 1} raw color in CSS context: ${line.trim()}`)
    }

    if (TOKEN_FALLBACK.test(line)) {
      counts.tokenFallbacks++
      violations.push(`${file}:${lineNo} tokens.x || fallback anti-pattern: ${line.trim()}`)
    }

    const fm = FONT_SIZE.exec(line)
    if (fm && Number(fm[1]) < 10) {
      counts.tinyFonts++
      violations.push(`${file}:${lineNo} fontSize ${fm[1]} below 10px floor: ${line.trim()}`)
    }
  })
}

console.log(`sidepanel hygiene gate — scanned ${SCOPE.length} files (PR-1 scope)`)
console.log(
  `counts: rawColors=${counts.rawColors} tokenFallbacks=${counts.tokenFallbacks} tinyFonts=${counts.tinyFonts}`,
)

if (violations.length > 0) {
  console.error(`\n${violations.length} violation(s):`)
  for (const v of violations) console.error(`  ${v}`)
  console.error(
    "\nRoute colors through sidepanel/ui/tokens.ts (add a semantic token if missing), " +
      "drop dead `tokens.x ||` fallbacks, keep fontSize ≥ 10. " +
      "Reviewer-approved exceptions go in WHITELIST with a reason.",
  )
  process.exit(1)
}

console.log("OK — no raw colors, no token fallbacks, no sub-10px fonts in scope")
