// WP5 I1 WI-1.7 — 三态文案集成验收（缺文件/错哈希/断网）。
// 走全链路断言：真实函数调用 → 结构化 code/reason → 文案映射 → 审计形状；
// 三态两两可区分（UI 可分别呈现）；全 reason 词表在文案表内有落点；
// 每态文案必须明示「其余定位层不受影响」（§C.2.4 降级叙事强制）。

import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { loadVerifiedFileBytes, ModelGateError } from "../src/computer/model-manifest"
import { downloadModelVariant, ModelDownloadError } from "../src/computer/model-download"
import { MODEL_STATE_MESSAGES, modelStateMessage } from "../src/computer/model-state-messages"
import type { ModelManifest } from "../src/computer/model-manifest"

// --- fixtures -----------------------------------------------------------------

const REV = "0e1356f0b7cfb416099207121f6a766818ab8a66"

function oneFileManifest(content: Buffer): ModelManifest {
  const h = (s: string) => createHash("sha256").update(s).digest("hex")
  return {
    schemaVersion: 1,
    models: {
      tinyclick: {
        repo: "Krystianz/TinyClick",
        revision: REV,
        license: "MIT",
        licenseCopyright: "Copyright (c) 2024 Samsung R&D Poland",
        baseModelNotice: { repo: "microsoft/Florence-2-base", license: "MIT" },
        provenance: {
          sourceFile: "model.safetensors",
          sourceSha256: h("source"),
          exportVendor: { configuration: h("c"), modeling: h("m"), processing: h("p") },
          exportedAt: "2026-07-20",
        },
        variants: {
          hybrid: {
            files: [
              {
                name: "m.onnx",
                url: `https://models.cmspark.invalid/tinyclick/${REV}/hybrid/m.onnx`,
                sha256: createHash("sha256").update(content).digest("hex"),
                size: content.byteLength,
              },
            ],
          },
        },
      },
    },
  } as ModelManifest
}

// --- 三态集成矩阵 ----------------------------------------------------------------

test("态1 缺文件：loadVerifiedFileBytes → model-file-missing（结构化，非裸 ENOENT）", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-states-"))
  try {
    const missing = path.join(dir, "not-there.onnx")
    await assert.rejects(
      () => loadVerifiedFileBytes(missing, { sha256: "0".repeat(64), size: 1 }),
      (e) => {
        assert.ok(e instanceof ModelGateError)
        assert.strictEqual((e as ModelGateError).code, "model-file-missing")
        return true
      },
    )
    const msg = modelStateMessage("model-file-missing")
    assert.strictEqual(msg.title, "模型文件缺失")
    assert.strictEqual(msg.action, "下载模型")
    assert.ok(msg.detail.includes("不受影响"), "缺文件态必须明示其余层不受影响")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("态2 错哈希：篡改 1 字节 → model-hash-mismatch + 拒绝加载文案", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-states-"))
  try {
    const content = Buffer.from("model bytes payload")
    const filePath = path.join(dir, "m.onnx")
    const sha256 = createHash("sha256").update(content).digest("hex")
    const tampered = Buffer.from(content)
    tampered[3] = tampered[3]! ^ 0x01
    writeFileSync(filePath, tampered)
    await assert.rejects(
      () => loadVerifiedFileBytes(filePath, { sha256, size: content.byteLength }),
      (e) => {
        assert.ok(e instanceof ModelGateError)
        assert.strictEqual((e as ModelGateError).code, "model-hash-mismatch")
        return true
      },
    )
    const msg = modelStateMessage("model-hash-mismatch")
    assert.ok(msg.title.includes("校验失败"))
    assert.ok(msg.detail.includes("篡改"))
    assert.ok(msg.detail.includes("拒绝加载"))
    assert.ok(msg.detail.includes("不受影响"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("态3 断网：downloadModelVariant → network-error + unavailable 审计 + 降级文案", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cmspark-states-"))
  try {
    const content = Buffer.alloc(128, 1)
    const manifest = oneFileManifest(content)
    const events: { event: string; payload: Record<string, unknown> }[] = []
    const offlineFetch = (async () => {
      throw new Error("getaddrinfo ENOTFOUND models.cmspark.invalid")
    }) as unknown as typeof fetch
    await assert.rejects(
      () =>
        downloadModelVariant(
          { manifest, modelId: "tinyclick", variant: "hybrid", destDir: dir },
          { fetchImpl: offlineFetch, diskFreeBytes: async () => null, log: (e, p) => events.push({ event: e, payload: p }) },
        ),
      (e) => {
        assert.ok(e instanceof ModelDownloadError)
        assert.strictEqual((e as ModelDownloadError).reason, "network-error")
        return true
      },
    )
    // 审计事件形状（§C.2.4 层不可用叙事）
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0]!.event, "computeruse.model.unavailable")
    assert.strictEqual(events[0]!.payload.reason, "network-error")
    // 文案
    const msg = modelStateMessage("network-error")
    assert.ok(msg.title.includes("下载失败"))
    assert.strictEqual(msg.action, "重试下载")
    assert.ok(msg.detail.includes("不受影响"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- 三态互区分 + 词表完整性 --------------------------------------------------------

test("三态 code 与文案 title 两两不同（UI 可分别呈现）", () => {
  const codes = ["model-file-missing", "model-hash-mismatch", "network-error"]
  assert.strictEqual(new Set(codes).size, 3)
  const titles = codes.map((c) => modelStateMessage(c).title)
  assert.strictEqual(new Set(titles).size, 3)
})

test("文案表覆盖下载侧全部 ModelUnavailableReason + 加载侧 gate code", () => {
  const expected = [
    // ModelUnavailableReason（model-download.ts 词表）
    "model-unknown",
    "variant-unknown",
    "mirror-scheme-denied",
    "disk-budget-exceeded",
    "disk-full",
    "http-error",
    "network-error",
    "hash-mismatch",
    "size-mismatch",
    "oversize-stream",
    // ModelGateError.code 加载/manifest 侧（model-manifest.ts）
    "model-file-missing",
    "model-hash-mismatch",
    "model-size-mismatch",
    "manifest-invalid",
    "manifest-source-remote",
  ]
  for (const reason of expected) {
    assert.ok(MODEL_STATE_MESSAGES[reason], `文案表缺 reason: ${reason}`)
  }
})

test("全部文案 detail 均含「不受影响」降级叙事（§C.2.4 强制）", () => {
  for (const [reason, msg] of Object.entries(MODEL_STATE_MESSAGES)) {
    assert.ok(msg.detail.includes("不受影响"), `${reason} 的 detail 缺降级叙事`)
  }
})

test("未知 reason → 兜底文案不崩溃", () => {
  const msg = modelStateMessage("some-future-reason")
  assert.strictEqual(msg.title, "模型层不可用")
  assert.ok(msg.detail.includes("some-future-reason"))
})
