import test from "node:test"
import assert from "node:assert/strict"
import { recommendWhisper } from "../src/voice/whisper-hardware"

test("hardware recommendation is a resource hint and has a safe unknown default", () => {
  assert.equal(recommendWhisper({ cpu: "test", logicalCores: 2, memoryGB: 4 }), "small")
  assert.equal(recommendWhisper({ cpu: "test", logicalCores: 4, memoryGB: 7 }), "small")
  assert.equal(recommendWhisper({ cpu: "test", logicalCores: 8, memoryGB: 16 }), "medium")
  assert.equal(recommendWhisper({ cpu: "unknown", logicalCores: 0, memoryGB: 0 }), "medium")
})
