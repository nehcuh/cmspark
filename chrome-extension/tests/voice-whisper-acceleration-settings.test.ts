import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { Children, createElement, isValidElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { WhisperAccelerationSettings } from "../src/sidepanel/components/WhisperAccelerationSettings"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import type { VoiceModelState, VoiceWhisperAcceleration, VoiceWhisperGpuBackend } from "../src/sidepanel/types"
import { parseVoiceBinaryProgress, parseWhisperAcceleration, parseWhisperExecution } from "../src/sidepanel/voice/whisper-acceleration-state"

const acceleration: VoiceWhisperAcceleration = {
  supported: true,
  adapters: [
    { name: "OrayIddDriver", vendor: "other", kind: "virtual" },
    { name: "NVIDIA GeForce RTX 4080 SUPER", vendor: "nvidia", kind: "physical", vramMB: 16376 },
  ],
  runtimes: {
    cuda: { status: "ready", available: true },
    vulkan: { status: "ready", available: true },
  },
  plannedBackend: "cuda",
}

test("decodes optional state and preserves every valid adapter", () => {
  assert.equal(parseWhisperAcceleration(undefined), undefined)
  assert.deepEqual(parseWhisperAcceleration(acceleration), acceleration)
  assert.equal(parseWhisperAcceleration({ ...acceleration, plannedBackend: "metal" }), undefined)
  assert.equal(parseWhisperAcceleration({ ...acceleration, runtimes: { cuda: { status: "ready", available: true } } }), undefined)
})

test("bounds device data and excludes invalid adapter enums and unproven actual devices", () => {
  const invalid = parseWhisperAcceleration({
    ...acceleration,
    adapters: [
      { name: "d\x00" + "x".repeat(300), kind: "physical", vendor: "amd", driverVersion: " x\u202Ey ", vramMB: Infinity },
      { name: "lost", kind: "backend", vendor: "nvidia" },
      { name: "lost", kind: "physical", vendor: "invented" },
    ],
    latest: { backend: "cuda", device: " ", ms: 12, at: 1_795_408_020_000 },
    downloadingBackend: "metal",
  })
  assert.deepEqual(invalid?.adapters, [{
    name: "d " + "x".repeat(158), kind: "physical", vendor: "amd", driverVersion: "x y",
  }])
  assert.equal(invalid?.latest, undefined)
  assert.equal(invalid?.downloadingBackend, undefined)
  assert.equal(parseWhisperAcceleration({
    ...acceleration, latest: { backend: "cpu", ms: -1, at: 1_795_408_020_000 },
  })?.latest, undefined)
  assert.equal(parseWhisperAcceleration({
    ...acceleration, latest: { backend: "cpu", ms: 9, at: 9e15 },
  })?.latest, undefined)
  assert.deepEqual(parseWhisperAcceleration({
    ...acceleration, latest: { backend: "cpu", device: "ignored", ms: 9, at: 1_795_408_020_000, fallbackReason: "alien" },
  })?.latest, { backend: "cpu", ms: 9, at: 1_795_408_020_000 })
})

test("binary progress defaults an old frame to CPU and distinguishes named GPU downloads", () => {
  assert.deepEqual(parseVoiceBinaryProgress({ phase: "download", receivedBytes: 10, totalBytes: 100 }), {
    backend: "cpu", phase: "download", receivedBytes: 10, totalBytes: 100,
  })
  assert.deepEqual(parseVoiceBinaryProgress({ backend: "vulkan", phase: "verify", totalBytes: -1, receivedBytes: Infinity }), {
    backend: "vulkan", phase: "verify", receivedBytes: 0, totalBytes: 0,
  })
  assert.equal(parseVoiceBinaryProgress({ backend: "metal" }), undefined)
})

function modelState(update?: VoiceWhisperAcceleration): VoiceModelState {
  return {
    sttEngine: "local",
    localModelId: "medium",
    recommendedModelId: "medium",
    models: {},
    binary: { status: "ready" },
    diskBudgetMB: 4096,
    diskUsedMB: 0,
    ...(update ? { acceleration: update } : {}),
  }
}

const cudaExecution = {
  backend: "cuda", device: "NVIDIA GeForce RTX 4080 SUPER", ms: 1200, at: 1_795_408_020_000,
} as const

test("an execution receipt updates only the history of the currently selected voice engine", () => {
  for (const sttEngine of ["external", "browser"] as const) {
    const voiceModel = { ...modelState(acceleration), sttEngine, localModelId: "small" }
    const state = {
      ...initialState,
      voiceModel,
      voiceModelProgress: { modelId: "medium", file: "model.bin", receivedBytes: 5, totalBytes: 100 },
      voiceBinaryProgress: { backend: "vulkan", phase: "download" } as const,
    }
    const execution = parseWhisperExecution(cudaExecution)
    if (!execution) throw new Error("Expected the bounded execution receipt")
    const updated = agentReducer(state, { type: "SET_VOICE_ACCELERATION_EXECUTION", execution })
    assert.deepEqual(updated, {
      ...state,
      voiceModel: { ...voiceModel, acceleration: { ...acceleration, latest: cudaExecution } },
    })
    assert.equal(updated.voiceModelProgress, state.voiceModelProgress)
    assert.equal(updated.voiceBinaryProgress, state.voiceBinaryProgress)
  }
})

test("an execution receipt requires valid native evidence and an existing acceleration snapshot", () => {
  assert.equal(parseWhisperExecution({ ...cudaExecution, device: "\x00\u202E" }), undefined)
  const action = { type: "SET_VOICE_ACCELERATION_EXECUTION", execution: cudaExecution } as const
  assert.equal(agentReducer(initialState, action), initialState)
  const legacy = { ...initialState, voiceModel: modelState() }
  assert.equal(agentReducer(legacy, action), legacy)
  const unsupported = { ...initialState, voiceModel: modelState({ ...acceleration, supported: false }) }
  assert.equal(agentReducer(unsupported, action), unsupported)
})

test("stale execution receipts and full snapshots keep newer execution history", () => {
  const state = { ...initialState, voiceModel: modelState({ ...acceleration, latest: cudaExecution }) }
  const stale = { backend: "cpu", ms: 0, at: cudaExecution.at - 1 } as const
  assert.equal(agentReducer(state, { type: "SET_VOICE_ACCELERATION_EXECUTION", execution: stale }), state)
  const browser = { ...modelState({ ...acceleration, latest: stale }), sttEngine: "browser" as const }
  const updated = agentReducer(state, { type: "SET_VOICE_MODEL_STATE", modelState: browser })
  assert.deepEqual(updated.voiceModel, {
    ...browser,
    acceleration: { ...acceleration, latest: cudaExecution },
  })
})

test("GPU progress survives a ready CPU snapshot and clears on GPU completion or cancellation", () => {
  const progress = { backend: "cuda", phase: "download", receivedBytes: 25, totalBytes: 100 } as const
  const started = agentReducer(initialState, { type: "SET_VOICE_BINARY_PROGRESS", progress })
  const snapshot = agentReducer(started, {
    type: "SET_VOICE_MODEL_STATE", modelState: modelState({ ...acceleration, downloadingBackend: "cuda" }),
  })
  assert.deepEqual(snapshot.voiceBinaryProgress, progress)
  assert.equal(agentReducer(snapshot, {
    type: "SET_VOICE_BINARY_PROGRESS", progress: { backend: "cuda" },
  }).voiceBinaryProgress, progress)
  const cancelling = agentReducer(snapshot, {
    type: "SET_VOICE_BINARY_PROGRESS", progress: { backend: "cuda", phase: "cancelling" },
  })
  assert.equal(agentReducer(cancelling, { type: "SET_VOICE_BINARY_PROGRESS", progress }).voiceBinaryProgress?.phase, "cancelling")
  assert.equal(agentReducer(cancelling, {
    type: "SET_VOICE_MODEL_STATE", modelState: modelState(acceleration),
  }).voiceBinaryProgress, null)
  assert.equal(agentReducer(cancelling, {
    type: "SET_VOICE_MODEL_STATE", modelState: modelState(),
  }).voiceBinaryProgress, null)
})

test("a terminal state clears progress and keeps the named binary failure for settings", () => {
  const state = { ...initialState, voiceBinaryProgress: { backend: "cpu", phase: "download" } } as const
  const failed = agentReducer(state, {
    type: "SET_VOICE_BINARY_ERROR", error: { backend: "cpu", message: "校验失败" },
  })
  const settled = agentReducer(failed, {
    type: "SET_VOICE_MODEL_STATE", modelState: { ...modelState(), binary: { status: "not_found" } },
  })
  assert.equal(settled.voiceBinaryProgress, null)
  assert.deepEqual(settled.voiceBinaryError, { backend: "cpu", message: "校验失败" })
})

test("a cancelled legacy CPU install can be reattempted when the binary is still absent", () => {
  const cancelling = agentReducer(initialState, {
    type: "SET_VOICE_BINARY_PROGRESS", progress: { backend: "cpu", phase: "cancelling" },
  })
  const settled = agentReducer(cancelling, {
    type: "SET_VOICE_MODEL_STATE", modelState: { ...modelState(), binary: { status: "not_found" } },
  })
  assert.equal(settled.voiceBinaryProgress, null)
})

function render(
  state: VoiceWhisperAcceleration | undefined,
  extra: Partial<Parameters<typeof WhisperAccelerationSettings>[0]> = {},
) {
  return renderToStaticMarkup(createElement(WhisperAccelerationSettings, {
    acceleration: state, progress: null, error: null, modelDownloading: false,
    onInstall: () => {}, onCancel: () => {},
    ...extra,
  }))
}

test("renders representative Windows adapter evidence and keeps planned eligibility apart from history", () => {
  assert.equal(render(undefined), "")
  assert.equal(render({ ...acceleration, supported: false }), "")
  const before = render(acceleration)
  assert.match(before, /OrayIddDriver.*虚拟显示/)
  assert.match(before, /NVIDIA GeForce RTX 4080 SUPER.*16376 MiB/)
  assert.match(before, /下一次自动选择候选：CUDA/)
  assert.match(before, /最近一次执行：暂无记录/)
  assert.doesNotMatch(before, /当前.*GPU|GPU.*已启用/)

  const historical = render({
    ...acceleration,
    plannedBackend: "cpu",
    runtimes: { cuda: { status: "ready", available: false, reason: "cuda_driver_missing" },
      vulkan: { status: "ready", available: false, reason: "vulkan_loader_missing" } },
    latest: { backend: "cuda", device: "NVIDIA GeForce RTX 4080 SUPER", ms: 2110, at: 1_795_408_020_000 },
  })
  assert.match(historical, /下一次自动选择候选：CPU.*最近一次执行：CUDA · NVIDIA GeForce RTX 4080 SUPER/)
  assert.match(historical, /CUDA 显卡驱动不可用/)
  assert.match(historical, /Vulkan 加载器不可用/)
  assert.match(historical, /2110 ms/)
  assert.match(historical, /<time dateTime="2026-11-23T04:27:00.000Z">/)
})

test("renders CPU fallback, install and repair, and unverified AMD/Intel copy", () => {
  const pending = {
    ...acceleration,
    adapters: [{ name: "AMD Radeon", vendor: "amd", kind: "physical" }] as VoiceWhisperAcceleration["adapters"],
    plannedBackend: "cpu" as const,
    runtimes: {
      cuda: { status: "absent", available: false, reason: "no_nvidia_adapter" },
      vulkan: { status: "incomplete", available: false, reason: "runtime_incomplete" },
    } as VoiceWhisperAcceleration["runtimes"],
    latest: { backend: "cpu", fallbackReason: "vulkan_unproven", ms: 3000, at: 1_795_408_020_000 } as const,
  }
  const html = render(pending)
  assert.match(html, /CUDA.*未安装.*安装 CUDA/)
  assert.match(html, /Vulkan.*组件不完整或校验失败.*重新安装 Vulkan/)
  assert.match(html, /最近一次执行：CPU.*Vulkan 未能确认 GPU 执行，已回退 CPU/)
  assert.ok(html.includes("AMD / Intel 实机待验证"))
  assert.doesNotMatch(html, /AMD.*已验证|Intel.*已验证/)
  assert.match(render({
    ...pending, plannedBackend: "vulkan", runtimes: { ...pending.runtimes, vulkan: { status: "ready", available: true } },
  }), /下一次自动选择候选：Vulkan/)
})

test("renders backend-specific progress, cancellation and terminal failure", () => {
  const downloading = {
    ...acceleration,
    runtimes: { ...acceleration.runtimes, vulkan: { status: "absent", available: false } as const },
    downloadingBackend: "cuda" as const,
  }
  const html = render(downloading, { progress: { backend: "cuda", phase: "download", receivedBytes: 41, totalBytes: 100 } })
  assert.match(html, /CUDA 下载中 · 41%/)
  assert.match(html, /取消安装 CUDA/)
  assert.match(html, /disabled=""[^>]*>安装 Vulkan/)
  const receipt = render({ ...downloading, downloadingBackend: undefined }, { progress: { backend: "vulkan" } })
  assert.match(receipt, /正在准备安装 Vulkan/)
  assert.match(receipt, /取消安装 Vulkan/)
  assert.match(render(downloading, { progress: { backend: "cuda", phase: "cancelling" } }), /正在取消安装 CUDA/)
  assert.match(render(acceleration, { error: { backend: "cuda", message: "本机组件下载失败" } }), /CUDA：本机组件下载失败/)
})

test("a displayed GPU cancel button targets the same backend through the settings message", () => {
  function findButton(nodes: ReactNode): (() => void) | undefined {
    for (const node of Children.toArray(nodes)) {
      if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) continue
      if (node.type === "button" && Children.toArray(node.props.children).join("").includes("取消安装")) {
        return node.props.onClick
      }
      const nestedButton = findButton(node.props.children)
      if (nestedButton) return nestedButton
    }
  }

  const targets: Array<VoiceWhisperGpuBackend | undefined> = []
  for (const backend of ["cuda", "vulkan"] as const) {
    const row = WhisperAccelerationSettings({
      acceleration: { ...acceleration, downloadingBackend: backend },
      progress: null,
      error: null,
      modelDownloading: false,
      onInstall: () => {},
      onCancel: (target?: VoiceWhisperGpuBackend) => targets.push(target),
    })
    const click = findButton(row)
    if (!click) throw new Error(`Missing Cancel button for ${backend}`)
    click()
  }
  assert.deepEqual(targets, ["cuda", "vulkan"])
  const settings = readFileSync("src/sidepanel/components/SettingsSlideout.tsx", "utf8")
  assert.match(settings, /onCancel=\{\(backend\) => \{\s*clearVoiceErr\(\)\s*sendVoice\(\{ type: "voice\.binary\.cancel", backend \}\)/)
})
