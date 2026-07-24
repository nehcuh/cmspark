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


// --- WI-3.4 三层开关交互文案（MODEL_SWITCH_COPY 存在性 + 关键短语断言） ----------------

import { MODEL_SWITCH_COPY } from "../src/computer/model-state-messages"
import { LICENSE_DOOR_TEXT } from "../src/computer/model-license"

test("MODEL_SWITCH_COPY：全字段齐备非空（WI-4.4 增五字段）", () => {
  for (const key of [
    "switchLabel",
    "switchHint",
    "masterOffHint",
    "appNotAllowedHint",
    "layerSemantics",
    "licenseDoorHint",
    "firstLoadTimeline",
    "switchRunningNote",
    "statusReadyEnabled",
    "statusReadyDisabled",
    "downloadInProgress",
    "licenseDeclinedNotice",
  ] as const) {
    assert.ok(typeof MODEL_SWITCH_COPY[key] === "string" && MODEL_SWITCH_COPY[key].length > 0, `${key} 为空`)
  }
})

test("三层依赖提示：①主开关关→不参与任何定位 ②app 未许可→对该 app 不参与", () => {
  assert.ok(MODEL_SWITCH_COPY.masterOffHint.includes("主开关"))
  assert.ok(MODEL_SWITCH_COPY.masterOffHint.includes("不参与任何定位"))
  assert.ok(MODEL_SWITCH_COPY.appNotAllowedHint.includes("coordinateAllowed"))
  assert.ok(MODEL_SWITCH_COPY.appNotAllowedHint.includes("不参与"))
})

test("③开关本体语义：L2 建议层 + 坐标候选 + 人工确认 + 未校准披露", () => {
  const s = MODEL_SWITCH_COPY.layerSemantics
  assert.ok(s.includes("L2"))
  assert.ok(s.includes("人工确认"), "命中仍需人工确认（G4）必须明示")
  assert.ok(s.includes("可能完全错误"), "未校准披露必须明示")
  assert.ok(s.includes("不受影响"), "降级叙事（§C.2.4）必须明示")
})

test("默认关闭语义：开关旁注与许可证门文案一致", () => {
  assert.ok(MODEL_SWITCH_COPY.switchHint.includes("默认关闭"))
  assert.ok(LICENSE_DOOR_TEXT.includes("默认关闭"), "LICENSE_DOOR_TEXT 须同为默认关闭叙事")
})

test("许可证门引导：许可确认 + 拒绝可永久跳过 + 降级叙事", () => {
  const s = MODEL_SWITCH_COPY.licenseDoorHint
  assert.ok(s.includes("许可证"))
  assert.ok(s.includes("拒绝"))
  assert.ok(s.includes("不受影响"))
})

test("时间线文案：首触 35s 上界 + 不计熔断 + 降级叙事（无未校准数字）", () => {
  const s = MODEL_SWITCH_COPY.firstLoadTimeline
  assert.ok(s.includes("35 秒"), "首触加载上界必须声明")
  assert.ok(s.includes("不受影响"))
  assert.ok(!/准确率|命中率|成功率/.test(s), "时间线文案不得夹带未校准性能数字")
})

test("开关文案不与 LICENSE_DOOR_TEXT 矛盾：人工确认条款双源一致", () => {
  assert.ok(LICENSE_DOOR_TEXT.includes("人工确认"))
  assert.ok(MODEL_SWITCH_COPY.layerSemantics.includes("人工确认"))
})


// --- WP5-I4 WI-4.4：P2 per-task 语义 + estop 引导 + 新文案字段 + 熔断词表 ------------

test("P2：layerSemantics 补 per-task 生效语义 + estop 引导（虚假保证消除）", () => {
  const s = MODEL_SWITCH_COPY.layerSemantics
  assert.ok(s.includes("当前任务结束后生效"), "per-task 生效语义必须明示（P2）")
  assert.ok(s.includes("Ctrl+Alt+End"), "estop 引导必须存在（P2）")
  assert.ok(s.includes("中止当前任务") || s.includes("中止任务"), "中止任务通道必须明示")
  // 原断言保持：L2/人工确认/未校准披露/降级叙事不受修订影响
  assert.ok(s.includes("人工确认"))
  assert.ok(s.includes("可能完全错误"))
  assert.ok(s.includes("不受影响"))
})

test("P2：switchRunningNote 任务运行中旁注 = per-task 生效 + estop 引导", () => {
  const s = MODEL_SWITCH_COPY.switchRunningNote
  assert.ok(s.includes("当前任务结束后生效"))
  assert.ok(s.includes("Ctrl+Alt+End"))
})

test("状态行文案：就绪双态 + 下载前缀 + 拒绝恒态（无未校准数字）", () => {
  assert.ok(MODEL_SWITCH_COPY.statusReadyEnabled.includes("人工确认"), "开启态仍须 G4 叙事")
  assert.ok(MODEL_SWITCH_COPY.statusReadyDisabled.includes("未开启"))
  assert.ok(MODEL_SWITCH_COPY.downloadInProgress.includes("下载"))
  assert.ok(MODEL_SWITCH_COPY.licenseDeclinedNotice.includes("永久跳过"))
  assert.ok(MODEL_SWITCH_COPY.licenseDeclinedNotice.includes("不受影响"))
  for (const s of [
    MODEL_SWITCH_COPY.statusReadyEnabled,
    MODEL_SWITCH_COPY.statusReadyDisabled,
    MODEL_SWITCH_COPY.licenseDeclinedNotice,
  ]) {
    assert.ok(!/准确率|命中率|成功率/.test(s), "状态行不得夹带未校准性能数字")
  }
})

test("熔断文案：circuit-breaker 词表条目（熔断广播 reason 有文案、降级叙事齐）", () => {
  const m = MODEL_STATE_MESSAGES["circuit-breaker"]
  assert.ok(m, "circuit-breaker 必须在词表（runtime 熔断广播 reason）")
  assert.ok(m!.title.includes("熔断"))
  assert.ok(m!.detail.includes("不受影响"), "降级叙事（§C.2.4）必须明示")
  assert.ok(m!.detail.includes("无自动恢复"), "M3 从严语义（无自动恢复）必须明示")
  assert.strictEqual(m!.action, "重置熔断")
})
