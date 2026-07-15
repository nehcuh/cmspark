#!/usr/bin/env node
// Selector CI canary — verifies our NotebookLM selector registry still resolves
// against the live site. Catches UI drift before users hit it in production.
//
// Run manually:
//   node chrome-extension/scripts/check-selectors.mjs
//
// Or in CI: requires a headless Chrome with a logged-in NotebookLM profile.
// We use puppeteer-core if available; falls back to logging a warning + exit 0.

import { SELECTORS } from "../src/notebooklm/selectors.ts"

const NOTEBOOKLM_URL = "https://notebooklm.google.com/"

// Each strategy must have at least one CSS selector. We try each CSS selector
// against the page and report which ones miss. Text/aria/role fallbacks are
// exercised at runtime; this canary only checks the CSS layer (cheapest signal).
const cssChecks = Object.entries(SELECTORS).map(([name, strategy]) => ({
  name,
  selectors: strategy.css,
}))

console.log(`Checking ${cssChecks.length} selector strategies × ${cssChecks.reduce((n, c) => n + c.selectors.length, 0)} CSS rules`)
console.log("Target:", NOTEBOOKLM_URL)
console.log()

// Try to load puppeteer-core; if missing, emit JSON report and exit (manual review).
let puppeteer
try {
  puppeteer = await import("puppeteer-core")
} catch {
  console.log("WARN: puppeteer-core not installed. Emitting selector list for manual review.")
  console.log()
  for (const c of cssChecks) {
    console.log(`  ${c.name}:`)
    for (const sel of c.selectors) console.log(`    - ${sel}`)
  }
  console.log()
  console.log("To enable runtime checks: `npm i -D puppeteer-core` + configure CHROME_PATH / NOTEBOOKLM_PROFILE.")
  process.exit(0)
}

const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const userDataDir = process.env.NOTEBOOKLM_PROFILE
if (!userDataDir) {
  console.error("ERROR: NOTEBOOKLM_PROFILE env var must point to a Chrome user-data-dir logged into NotebookLM")
  process.exit(2)
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  userDataDir,
  headless: "new",
})
try {
  const page = await browser.newPage()
  await page.goto(NOTEBOOKLM_URL, { waitUntil: "networkidle2", timeout: 30000 })

  const results = []
  for (const c of cssChecks) {
    for (const sel of c.selectors) {
      let found = false
      try {
        found = await page.$(sel) !== null
      } catch (e) {
        // invalid selector
        found = false
      }
      results.push({ strategy: c.name, selector: sel, found })
    }
  }

  // Report
  const byStrategy = {}
  for (const r of results) {
    byStrategy[r.strategy] = byStrategy[r.strategy] || []
    byStrategy[r.strategy].push(r)
  }

  let anyMiss = false
  for (const [name, checks] of Object.entries(byStrategy)) {
    const anyFound = checks.some(c => c.found)
    const status = anyFound ? "OK" : "MISS"
    if (!anyFound) anyMiss = true
    console.log(`  [${status}] ${name}`)
    for (const c of checks) {
      console.log(`      ${c.found ? "✓" : "✗"}  ${c.selector}`)
    }
  }

  console.log()
  if (anyMiss) {
    console.error("FAIL: one or more strategies had zero matching CSS selectors.")
    console.error("NotebookLM UI may have changed — add new selectors to src/notebooklm/selectors.ts.")
    process.exit(1)
  }
  console.log("PASS: every strategy has at least one matching CSS selector.")
} finally {
  await browser.close()
}
