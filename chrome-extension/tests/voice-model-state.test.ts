// Path B M0 Task 6 — extension voice.model store slice (mirror computer-model-state.test.ts).
// Pure node:test: state fold / progress clear / error bit / no optimistic updates.

import test from "node:test"
import assert from "node:assert/strict"

import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import type { AgentAction } from "../src/sidepanel/store/agentStore"
import type { VoiceModelState } from "../src/sidepanel/types"

function voiceState(over: Partial<VoiceModelState> = {}): VoiceModelState {
  return {
    sttEngine: "browser",
    localModelId: "medium",
    recommendedModelId: "medium",
    models: {
      small: { status: "absent" },
      medium: { status: "absent" },
      "large-v3-turbo": { status: "absent" },
    },
    binary: { status: "not_found" },
    diskBudgetMB: 4096,
    diskUsedMB: 0,
    whisperRoot: "/tmp/whisper",
    ...over,
  }
}

const PROGRESS = {
  modelId: "medium",
  file: "ggml-medium.bin",
  receivedBytes: 50,
  totalBytes: 100,
}

test("initialState:voice model 切片全 null(未查询态;无乐观更新起点)", () => {
  assert.equal(initialState.voiceModel, null)
  assert.equal(initialState.voiceModelProgress, null)
  assert.equal(initialState.voiceModelError, null)
})

test("SET_VOICE_MODEL_STATE:全形落盘", () => {
  const s = voiceState({
    sttEngine: "local",
    localModelId: "small",
    models: {
      small: { status: "ready", bytesOnDisk: 466_000_000 },
      medium: { status: "absent" },
      "large-v3-turbo": { status: "absent" },
    },
    binary: { status: "ready", path: "/opt/whisper-cli" },
    diskUsedMB: 444.5,
  })
  const next = agentReducer(initialState, { type: "SET_VOICE_MODEL_STATE", modelState: s })
  assert.deepEqual(next.voiceModel, s)
})

test("progress 镜像:下载中 state 保留进度,非下载中 state 清陈旧进度", () => {
  let s = agentReducer(initialState, { type: "SET_VOICE_MODEL_PROGRESS", progress: PROGRESS })
  assert.deepEqual(s.voiceModelProgress, PROGRESS)
  // Any model downloading → keep progress
  s = agentReducer(s, {
    type: "SET_VOICE_MODEL_STATE",
    modelState: voiceState({
      models: {
        small: { status: "absent" },
        medium: { status: "downloading" },
        "large-v3-turbo": { status: "absent" },
      },
    }),
  })
  assert.deepEqual(s.voiceModelProgress, PROGRESS)
  // Terminal statuses → clear stale progress
  for (const terminal of ["ready", "absent", "incomplete"] as const) {
    const t = agentReducer(s, {
      type: "SET_VOICE_MODEL_STATE",
      modelState: voiceState({
        models: {
          small: { status: "absent" },
          medium: { status: terminal },
          "large-v3-turbo": { status: "absent" },
        },
      }),
    })
    assert.equal(t.voiceModelProgress, null, `${terminal} 到达须清进度`)
    s = agentReducer(t, { type: "SET_VOICE_MODEL_PROGRESS", progress: PROGRESS })
  }
})

test("voice model 错误位:set/clear(family:voice.model 路由落点)", () => {
  let s = agentReducer(initialState, {
    type: "SET_VOICE_MODEL_ERROR",
    error: "voice.model.download requires source:\"settings\"",
  })
  assert.equal(s.voiceModelError, 'voice.model.download requires source:"settings"')
  s = agentReducer(s, { type: "SET_VOICE_MODEL_ERROR", error: null })
  assert.equal(s.voiceModelError, null)
})

test("无乐观更新:除 state 广播外,voiceModel 切片不被其它 action 改写", () => {
  const untouched: AgentAction[] = [
    { type: "SET_VOICE_MODEL_PROGRESS", progress: PROGRESS },
    { type: "SET_VOICE_MODEL_ERROR", error: "x" },
    { type: "SET_COMPUTER_MODEL_ERROR", error: "y" },
  ]
  for (const action of untouched) {
    const next = agentReducer(initialState, action)
    assert.equal(next.voiceModel, null, `${action.type} 不得写 voiceModel 切片(无乐观更新)`)
  }
  const on = agentReducer(initialState, {
    type: "SET_VOICE_MODEL_STATE",
    modelState: voiceState({ sttEngine: "local" }),
  })
  assert.equal(on.voiceModel?.sttEngine, "local")
})
