import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  rememberNativeVisionProbe,
  lookupNativeVisionProbe,
  clearNativeVisionProbe,
} from "../src/llm/native-vision-probe-cache"
import { resolveNativeVision, visionConfigForAnalyze } from "../src/llm/likely-multimodal"

test("probe cache hits only the same url+model", () => {
  clearNativeVisionProbe()
  rememberNativeVisionProbe("http://10.1.1.1/v1/", "custom-vlm", true)
  assert.equal(lookupNativeVisionProbe("http://10.1.1.1/v1", "custom-vlm"), true)
  assert.equal(lookupNativeVisionProbe("http://10.1.1.1/v1/", "other-model"), undefined)
  assert.equal(lookupNativeVisionProbe("http://10.2.2.2/v1", "custom-vlm"), undefined)
  clearNativeVisionProbe()
  assert.equal(lookupNativeVisionProbe("http://10.1.1.1/v1", "custom-vlm"), undefined)
})

test("resolveNativeVision auto uses in-memory probe for unknown model names", () => {
  clearNativeVisionProbe()
  rememberNativeVisionProbe("http://10.251.241.12/v1", "my-intranet-vlm", true)
  assert.equal(
    resolveNativeVision({
      modelName: "my-intranet-vlm",
      baseUrl: "http://10.251.241.12/v1",
      mode: "auto",
    }),
    true,
  )
  assert.equal(
    resolveNativeVision({
      modelName: "my-intranet-vlm",
      baseUrl: "https://api.deepseek.com/v1",
      mode: "auto",
    }),
    false,
  )
  clearNativeVisionProbe()
})

test("visionConfigForAnalyze uses probe cache not disk flags", () => {
  clearNativeVisionProbe()
  rememberNativeVisionProbe("http://10.1.1.1/v1", "custom-vlm", true)
  const cfg = visionConfigForAnalyze(
    {
      base_url: "http://10.1.1.1/v1",
      api_key: "sk-x",
      model_name: "custom-vlm",
      protocol: "openai",
    },
    { enabled: true, base_url: "http://127.0.0.1:11434/v1", api_key: "ollama", model_name: "llava:7b" },
  )
  assert.ok(cfg)
  assert.equal(cfg!.model_name, "custom-vlm")
  clearNativeVisionProbe()
})

test("config.test remembers probe in memory and does not saveConfig the bit", () => {
  const src = readFileSync(join(process.cwd(), "src/message-router/handlers/config.ts"), "utf8")
  assert.match(src, /rememberNativeVisionProbe/)
  assert.match(src, /delete normalized\.llm\.native_vision_detected/)
  assert.equal(/saveConfig\(\s*\{\s*llm:[\s\S]{0,80}native_vision_detected/.test(src), false)
})
