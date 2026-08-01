import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  DESCRIBE_TEXT_MAX_CHARS,
  formatOcrWordsAsDescribeText,
} from "../src/computer/ocr-describe"
import type { OcrWord } from "../src/computer/types"

function w(text: string, x: number, y: number, ww = 40, h = 16): OcrWord {
  return { text, x, y, w: ww, h }
}

describe("formatOcrWordsAsDescribeText", () => {
  it("returns empty for no words", () => {
    assert.equal(formatOcrWordsAsDescribeText([]), "")
  })

  it("groups same-row boxes into one line (left-to-right)", () => {
    // Intentionally out of x order in input
    const words = [w("B", 80, 10), w("A", 10, 12), w("C", 150, 11)]
    assert.equal(formatOcrWordsAsDescribeText(words), "A B C")
  })

  it("splits into multiple lines by vertical position", () => {
    const words = [
      w("line1-a", 10, 10),
      w("line1-b", 100, 12),
      w("line2-a", 10, 50),
      w("line2-b", 100, 52),
    ]
    assert.equal(formatOcrWordsAsDescribeText(words), "line1-a line1-b\nline2-a line2-b")
  })

  it("preserves CJK tokens without requiring space-separated anchors", () => {
    const words = [w("确定", 20, 20), w("取消", 80, 22)]
    const out = formatOcrWordsAsDescribeText(words)
    assert.ok(out.includes("确定"))
    assert.ok(out.includes("取消"))
  })

  it("truncates long bodies with an explicit marker", () => {
    const words: OcrWord[] = []
    for (let i = 0; i < 500; i++) {
      words.push(w(`word${i}xxxxxx`, (i % 10) * 50, Math.floor(i / 10) * 20))
    }
    const out = formatOcrWordsAsDescribeText(words, { maxChars: 200 })
    assert.ok(out.length < 400)
    assert.ok(out.includes("truncated"))
    assert.ok(out.length <= 200 + 80) // body cut + marker
  })

  it("default max matches exported constant", () => {
    assert.equal(DESCRIBE_TEXT_MAX_CHARS, 12_000)
  })
})
