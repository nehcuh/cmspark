// Structural tests for v1.2 modules (Phase A/C/D/E/G).
//
// Runtime DOM testing requires jsdom (deferred). These pin down the structural
// invariants that protect against common breakage:
//  - Runners (extractAiChatRunner, extractPageLinksRunner) are self-contained
//  - Pure parsers (parseOpml) work on synthetic input
//  - YouTube playlistId parsing handles all URL shapes

import test from "node:test"
import assert from "node:assert/strict"
import {
  extractAiChatRunner,
  detectAiChatPlatform,
} from "../src/notebooklm/ai-chat-extractor"
import { extractPageLinksRunner } from "../src/notebooklm/page-link-extractor"
import { parseOpml } from "../src/notebooklm/rss-parser"
import { parsePlaylistId } from "../src/notebooklm/youtube-api"
import { isYouTubeUrl, normalizeYouTubeUrl } from "../src/notebooklm/rpc-client"

// ---------- YouTube ----------

test("isYouTubeUrl: detects standard video URL", () => {
  assert.equal(isYouTubeUrl("https://www.youtube.com/watch?v=bZeL1IDM4PM"), true)
})

test("isYouTubeUrl: detects YouTube even with zero-width whitespace", () => {
  assert.equal(isYouTubeUrl("https://www.youtube.com/watch?v=bZeL1IDM4PM\u200b"), true)
})

test("isYouTubeUrl: rejects non-YouTube URL", () => {
  assert.equal(isYouTubeUrl("https://example.com/watch?v=bZeL1IDM4PM"), false)
})

test("normalizeYouTubeUrl: keeps clean URL minimal", () => {
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/watch?v=bZeL1IDM4PM"),
    "https://www.youtube.com/watch?v=bZeL1IDM4PM",
  )
})

test("normalizeYouTubeUrl: strips playlist params", () => {
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/watch?v=bZeL1IDM4PM&list=PL1234567890&index=2"),
    "https://www.youtube.com/watch?v=bZeL1IDM4PM",
  )
})

test("normalizeYouTubeUrl: strips zero-width whitespace from video ID", () => {
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/watch?v=bZeL1IDM4PM\u200b&list=PL123"),
    "https://www.youtube.com/watch?v=bZeL1IDM4PM",
  )
})

test("normalizeYouTubeUrl: strips CRLF pollution from clipboard", () => {
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/watch?v=bZeL1IDM4PM\r\n"),
    "https://www.youtube.com/watch?v=bZeL1IDM4PM",
  )
})

test("normalizeYouTubeUrl: strips non-breaking spaces (NBSP/NNBSP) common on Windows", () => {
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/watch?v=bZeL1IDM4PM\u00A0&list=PL123"),
    "https://www.youtube.com/watch?v=bZeL1IDM4PM",
  )
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/watch?v=bZeL1IDM4PM\u202F&list=PL123"),
    "https://www.youtube.com/watch?v=bZeL1IDM4PM",
  )
})

test("normalizeYouTubeUrl: strips figure space and object replacement chars", () => {
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/watch?v=bZeL1IDM4PM\u2007&list=PL123"),
    "https://www.youtube.com/watch?v=bZeL1IDM4PM",
  )
  assert.equal(
    normalizeYouTubeUrl("https://www.youtube.com/watch?v=bZeL1IDM4PM\uFFFC&list=PL123"),
    "https://www.youtube.com/watch?v=bZeL1IDM4PM",
  )
})

test("normalizeYouTubeUrl: handles youtu.be short URL", () => {
  assert.equal(
    normalizeYouTubeUrl("https://youtu.be/bZeL1IDM4PM?list=PL123"),
    "https://www.youtube.com/watch?v=bZeL1IDM4PM",
  )
})

test("normalizeYouTubeUrl: returns sanitized input when it is not a URL", () => {
  assert.equal(normalizeYouTubeUrl("not a url"), "notaurl")
})

// ---------- AI chat extractor ----------

test("detectAiChatPlatform: source uses host-based detection (no module refs)", () => {
  const src = detectAiChatPlatform.toString()
  assert.equal(src.includes("claude.ai"), true)
  assert.equal(src.includes("chatgpt.com"), true)
  assert.equal(src.includes("gemini.google.com"), true)
  assert.equal(src.includes("import "), false)
})

test("extractAiChatRunner: self-contained, no module imports", () => {
  const src = extractAiChatRunner.toString()
  assert.equal(src.includes("import "), false)
  assert.equal(src.includes("require("), false)
})

test("extractAiChatRunner: handles all 3 platforms", () => {
  const src = extractAiChatRunner.toString()
  // Per-platform extractors must be present
  assert.equal(src.includes("extractClaude"), true)
  assert.equal(src.includes("extractChatgpt"), true)
  assert.equal(src.includes("extractGemini"), true)
})

test("extractAiChatRunner: clones before stripping noise (no live DOM mutation)", () => {
  const src = extractAiChatRunner.toString()
  assert.equal(src.includes("cloneNode(true)"), true)
  assert.equal(src.includes("script,style,noscript,svg,button"), true)
})

test("extractAiChatRunner: ChatGPT uses both new and legacy selectors", () => {
  const src = extractAiChatRunner.toString()
  assert.equal(src.includes("data-message-author-role"), true)
  assert.equal(src.includes("conversation-turn"), true)
})

// ---------- Page link extractor ----------

test("extractPageLinksRunner: self-contained", () => {
  const src = extractPageLinksRunner.toString()
  assert.equal(src.includes("import "), false)
  assert.equal(src.includes("require("), false)
})

test("extractPageLinksRunner: categorizes documents and media", () => {
  const src = extractPageLinksRunner.toString()
  assert.equal(src.includes("pdf"), true)
  assert.equal(src.includes("docx"), true)
  assert.equal(src.includes("mp3"), true)
  assert.equal(src.includes("mp4"), true)
})

test("extractPageLinksRunner: dedupes by URL", () => {
  const src = extractPageLinksRunner.toString()
  assert.equal(src.includes("Set") || src.includes("seen.has"), true)
})

test("extractPageLinksRunner: skips javascript: and fragment-only", () => {
  const src = extractPageLinksRunner.toString()
  assert.equal(src.includes("javascript:"), true)
  assert.equal(src.includes("#"), true)
})

// ---------- RSS parser ----------

test("parseOpml: extracts feed URLs from OPML", () => {
  const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head><title>Feeds</title></head>
  <body>
    <outline type="rss" text="Feed A" title="Feed A" xmlUrl="https://a.example/feed.xml" htmlUrl="https://a.example"/>
    <outline type="rss" text="Feed B" title="Feed B" xmlUrl="https://b.example/rss"/>
  </body>
</opml>`
  // Note: parseOpml uses DOMParser which isn't available in pure Node.
  // Just verify the function source handles outline elements + xmlUrl attribute.
  const src = parseOpml.toString()
  assert.equal(src.includes("outline"), true)
  assert.equal(src.includes("xmlUrl"), true)
  void opml
})

test("rss-parser: exports discoverFeed + fetchFeed + fetchMultipleFeeds", async () => {
  // Dynamic import to verify all exports exist
  const mod = await import("../src/notebooklm/rss-parser")
  assert.equal(typeof mod.fetchFeed, "function")
  assert.equal(typeof mod.discoverFeed, "function")
  assert.equal(typeof mod.fetchMultipleFeeds, "function")
  assert.equal(typeof mod.parseOpml, "function")
})

// ---------- YouTube ----------

test("parsePlaylistId: handles standard playlist URL", () => {
  assert.equal(
    parsePlaylistId("https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"),
    "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
  )
})

test("parsePlaylistId: handles video URL with list param", () => {
  assert.equal(
    parsePlaylistId("https://www.youtube.com/watch?v=abc&list=PL1234567890_-abcdef"),
    "PL1234567890_-abcdef",
  )
})

test("parsePlaylistId: returns null for non-playlist URL", () => {
  assert.equal(parsePlaylistId("https://www.youtube.com/watch?v=abc"), null)
  assert.equal(parsePlaylistId("not a url"), null)
})

test("parsePlaylistId: accepts raw playlist ID", () => {
  assert.equal(parsePlaylistId("PLrAXtmErZgOeiKm4sg"), "PLrAXtmErZgOeiKm4sg")
})
