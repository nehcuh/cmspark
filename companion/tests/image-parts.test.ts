import test from "node:test"
import assert from "node:assert/strict"
import { estimateImagePartTokens, hydrateUserImageParts } from "../src/llm/image-parts"

const att = {
  kind: "image" as const,
  name: "截图 2026-08-17 15:58",
  mime: "image/png" as const,
  sha256: "abc",
  bytes: 100,
}

test("estimateImagePartTokens: default 1600; square 2800", () => {
  assert.equal(estimateImagePartTokens(), 1600)
  assert.equal(estimateImagePartTokens(1920, 1080), 1600)
  assert.equal(estimateImagePartTokens(1300, 1000), 1600)
  assert.equal(estimateImagePartTokens(1568, 1568), 2800)
})

test("hydrate: native loads parts newest-4; text-only strips", () => {
  const rebuilt = [
    { role: "user" as const, content: "a\n📎 one" },
    { role: "assistant" as const, content: "ok" },
    { role: "user" as const, content: "b\n📎 two" },
  ]
  const persisted = [
    { role: "user", content: "a\n📎 one", attachments: [{ ...att, name: "one", sha256: "1" }] },
    { role: "assistant", content: "ok" },
    { role: "user", content: "b\n📎 two", attachments: [{ ...att, name: "two", sha256: "2" }] },
  ]
  const readImage = (a: typeof att) => ({ base64: `b64-${a.sha256}`, mime: a.mime })

  const native = hydrateUserImageParts(rebuilt, persisted, { useNative: true, maxImages: 4, readImage })
  const last = native[2]
  assert.equal(last.role, "user")
  assert.ok(Array.isArray(last.content))
  assert.equal((last.content as any[]).some((p) => p.type === "image_url"), true)

  const stripped = hydrateUserImageParts(rebuilt, persisted, { useNative: false, maxImages: 4, readImage })
  assert.equal(typeof stripped[2].content, "string")
  assert.match(String(stripped[2].content), /📎/)
})

test("hydrate: missing sidecar → 图片丢失 stub", () => {
  const rebuilt = [{ role: "user" as const, content: "x\n📎 gone" }]
  const persisted = [{ role: "user", content: "x\n📎 gone", attachments: [att] }]
  const out = hydrateUserImageParts(rebuilt, persisted, {
    useNative: true, maxImages: 4, readImage: () => null,
  })
  assert.match(JSON.stringify(out[0].content), /图片丢失/)
})
