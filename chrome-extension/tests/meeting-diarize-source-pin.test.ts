// #260 source pin — the client-side 3-dim acoustic feature formula stays dead.
// Diarize 声学路径唯一入口是 embedding（PCM 上传 → companion ONNX）；
// meeting-audio-import.ts 不得再长回 features 提取（双实现消除，spec §5）。

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(
  join(process.cwd(), "src/sidepanel/voice/meeting-audio-import.ts"),
  "utf8",
)

test("meeting-audio-import.ts contains no client feature extraction (#260)", () => {
  assert.equal(src.includes("extractSegmentFeatures"), false, "feature extractor resurrected")
  assert.equal(src.includes("DiarizeFeature"), false, "feature type resurrected")
  assert.equal(src.includes("features"), false, "any features field/word resurrected")
})

test("segment payload stays {index, wav, t0Sec, t1Sec} — PCM lives inside wav", () => {
  assert.match(src, /index: number/)
  assert.match(src, /t0Sec: number/)
  assert.match(src, /t1Sec: number/)
})
