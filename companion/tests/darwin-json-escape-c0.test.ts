// Issue #69 F1: jsonEscape must cover all JSON-legal C0 control escapes.
//
// runReadMessage embeds a jsonEscape AppleScript handler in host.swift, and
// read-mail.applescript carries a byte-equivalent copy. A message containing an
// un-escaped C0 control char (e.g. \x08 backspace, \x0C form feed) previously
// produced invalid JSON on the wire (TS parseJsonSafe fails closed, but the mail
// becomes unreadable). The two handlers must stay byte-equivalent and cover the
// full JSON escape set: \" \\ CR LF TAB backspace form-feed.
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.join(process.cwd(), "src", "host-use", "darwin")

function readDarwin(name: string): string {
  const p = path.join(ROOT, name)
  return fs.readFileSync(p, "utf8")
}

/** Extract the ordered C0 char ids a jsonEscape handler escapes. */
function c0Ids(src: string): number[] {
  return [...src.matchAll(/character id (\d+)/g)].map((m) => Number(m[1]))
}

test("F1: host.swift embedded jsonEscape covers full JSON C0 set (\\b \\f added)", () => {
  const swift = readDarwin("host.swift")
  const handler = swift.slice(swift.indexOf("on jsonEscape"), swift.indexOf("end jsonEscape"))
  const ids = c0Ids(handler)
  // JSON-legal C0 escapes: 8 backspace, 9 tab, 10 LF, 12 form feed, 13 CR.
  for (const expect of [8, 9, 10, 12, 13]) {
    assert.ok(ids.includes(expect), `host.swift jsonEscape covers char id ${expect}`)
  }
})

test("F1: read-mail.applescript jsonEscape covers full JSON C0 set", () => {
  const as = readDarwin("read-mail.applescript")
  const handler = as.slice(as.indexOf("on jsonEscape"), as.indexOf("end jsonEscape"))
  const ids = c0Ids(handler)
  for (const expect of [8, 9, 10, 12, 13]) {
    assert.ok(ids.includes(expect), `read-mail.applescript jsonEscape covers char id ${expect}`)
  }
})

test("F1: host.swift and read-mail.applescript handlers are byte-equivalent (M3 lockstep)", () => {
  const swift = readDarwin("host.swift")
  const as = readDarwin("read-mail.applescript")
  const swiftHandler = swift.slice(swift.indexOf("on jsonEscape"), swift.indexOf("end jsonEscape"))
  const asHandler = as.slice(as.indexOf("on jsonEscape"), as.indexOf("end jsonEscape"))

  // Each C0 replacement is TWO consecutive delimiter steps in both files:
  //   delimiters to (character id N)
  //   delimiters to "\\<jsonEsc>"        (target literal)
  // host.swift embeds AppleScript in a Swift multiline string, so its file-level
  // backslashes are double the bare-applescript count (one extra Swift escape
  // layer). Strip that Swift layer before comparing the target literals, so both
  // files denote the same AppleScript values. Quote/backslash preamble steps are
  // identical in both (M3-verified) — the C0 pair sequence is the F1 surface.
  const swiftU = swiftHandler.replace(/\\\\/g, "\\")
  const pairSteps = (h: string) => {
    const steps = [...h.matchAll(/text item delimiters to (.+)$/gm)].map((m) => m[1].trim())
    const pairs: Array<[string, string]> = []
    for (let i = 0; i < steps.length; i++) {
      const idMatch = steps[i]!.match(/\(character id (\d+)\)/)
      if (idMatch && i + 1 < steps.length) pairs.push([idMatch[1]!, steps[i + 1]!])
    }
    return pairs
  }
  const swiftPairs = pairSteps(swiftU)
  const asPairs = pairSteps(asHandler)
  assert.equal(swiftPairs.length, asPairs.length, "same number of C0 replacement pairs")
  for (let i = 0; i < swiftPairs.length; i++) {
    assert.equal(swiftPairs[i]![0], asPairs[i]![0], `pair ${i} escapes char id`)
    assert.equal(swiftPairs[i]![1], asPairs[i]![1], `pair ${i} target literal (after Swift-layer strip)`)
  }
  const ids = swiftPairs.map((p) => p[0]).map(Number)
  assert.ok(ids.includes(8) && ids.includes(12), "backspace + form-feed present in lockstep handler")
})

test("F1: jsonEscape whitelist pass covers ALL remaining C0 via \\u00XX (issue title \"全部 C0\")", () => {
  const swift = readDarwin("host.swift")
  const as = readDarwin("read-mail.applescript")
  for (const [name, src] of [
    ["host.swift", swift.slice(swift.indexOf("on jsonEscape"), swift.indexOf("end jsonEscape"))],
    ["read-mail.applescript", as.slice(as.indexOf("on jsonEscape"), as.indexOf("end jsonEscape"))],
  ] as Array<[string, string]>) {
    // The whitelist loop guards every C0 not already JSON-escaped: it must test
    // cid < 32 and exclude exactly the JSON-legal escapes 8/9/10/12/13, then emit
    // a literal \u00XX (hex digits + rebuilt accumulator). This is what makes the
    // remaining 26 control chars (0x00-0x07, 0x0B, 0x0E-0x1F — issue names \x07)
    // produce valid JSON instead of failing closed.
    assert.ok(/repeat with c in s/.test(src), `${name}: per-char loop present`)
    assert.ok(/cid is less than 32/.test(src), `${name}: guards all C0`)
    assert.ok(
      /cid is not 8 and cid is not 9 and cid is not 10 and cid is not 12 and cid is not 13/.test(
        src,
      ),
      `${name}: JSON-legal escapes excluded from \\u00XX path`,
    )
    assert.match(src, /hexDigits to "0123456789abcdef"/)
    assert.match(src, /rebuilt to rebuilt & .*u00/)
  }
})


test("F1: host.swift Swift-embedded AppleScript escape levels are correct (M3 latent-bug guard)", () => {
  const swift = readDarwin("host.swift")
  const handler = swift.slice(swift.indexOf("on jsonEscape"), swift.indexOf("end jsonEscape"))
  // host.swift sits inside a Swift """ literal: file backslashes are DOUBLE the
  // AppleScript source they denote. The 换 \" step must denote a 3-backslash +
  // escaped-quote AppleScript delimiter, so host.swift's file line must carry SIX
  // backslashes (a bare 4-backslash + bare quote would compile to an AppleScript
  // syntax error — the M3 latent bug issue #69 F1 review caught and fixed).
  const delimLines = handler.split("\n").filter((l) => /text item delimiters to /.test(l))
  const quoteTarget = delimLines.find((l) => {
    const m = l.match(/to "((?:\\)*)"/)
    return m ? m[1].length === 6 : false
  })
  assert.ok(quoteTarget, "quote-replacement delimiter line found")
  // After one Swift-layer strip the six file backslashes become the three that
  // read-mail.applescript carries for the same 换 \" delimiter.
  const stripped = quoteTarget!.replace(/\\\\/g, "\\")
  assert.match(stripped, /delimiters to "\\\\\\"/)
  // Whole handler, after ONE Swift-layer strip, is executable-line-equivalent to
  // read-mail.applescript (no drift, quote step included).
  const as = readDarwin("read-mail.applescript")
  const asHandler = as.slice(as.indexOf("on jsonEscape"), as.indexOf("end jsonEscape"))
  const swiftU = handler.replace(/\\\\/g, "\\")
  const swiftLines = swiftU.split("\n").map((l) => l.trim()).filter(Boolean)
  const asLines = asHandler.split("\n").map((l) => l.trim()).filter(Boolean)
  const execRe = /^(set |repeat |end repeat|return |if |end if|else)/
  const swiftExec = swiftLines.filter((l) => execRe.test(l))
  const asExec = asLines.filter((l) => execRe.test(l))
  assert.equal(swiftExec.length, asExec.length, "same executable line count")
  for (let i = 0; i < swiftExec.length; i++) {
    assert.equal(swiftExec[i], asExec[i], `exec line ${i} equal after Swift strip`)
  }
})
