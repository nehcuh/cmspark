// Path B M1 Task 2 — mapLocalSttError (SoT §6.5) + privacy ack v2 copy residual.

import test from "node:test"
import assert from "node:assert/strict"

import { mapLocalSttError } from "../src/sidepanel/voice/error-map"
import {
  VOICE_PRIVACY_ACK_V2_BODY,
  VOICE_PRIVACY_ACK_V2_CLAUSES,
  VOICE_PRIVACY_ACK_V2_STORAGE_KEY,
} from "../src/sidepanel/voice/privacy-copy"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"

test("mapLocalSttError §6.5 known codes", () => {
  assert.deepEqual(mapLocalSttError("empty_result"), {
    severity: "banner",
    message: "未识别到内容，请重试",
  })
  assert.deepEqual(mapLocalSttError("model_missing"), {
    severity: "banner",
    message: "本机模型未就绪，请先在设置下载",
  })
  assert.deepEqual(mapLocalSttError("binary_missing"), {
    severity: "banner",
    message: "本机听写组件不可用，请更新 Companion",
  })
  assert.deepEqual(mapLocalSttError("hash_fail"), {
    severity: "banner",
    message: "本机听写组件校验失败，请重装 Companion",
  })
  assert.deepEqual(mapLocalSttError("companion_disconnected"), {
    severity: "banner",
    message: "Companion 未连接，本机转写不可用",
  })
  assert.deepEqual(mapLocalSttError("session_busy"), {
    severity: "banner",
    message: "正在识别，请稍候或取消",
  })
  assert.deepEqual(mapLocalSttError("payload_too_large"), {
    severity: "banner",
    message: "录音过长或数据异常",
  })
  assert.deepEqual(mapLocalSttError("infer_timeout"), {
    severity: "banner",
    message: "识别超时，请缩短后重试",
  })
  assert.deepEqual(mapLocalSttError("resource_conflict"), {
    severity: "banner",
    message: "本机资源不足（可关闭实验模型后重试）",
  })
  assert.deepEqual(mapLocalSttError("oom"), {
    severity: "banner",
    message: "本机资源不足（可关闭实验模型后重试）",
  })
  assert.deepEqual(mapLocalSttError("aborted"), {
    severity: "silent",
    message: "",
  })
})

test("mapLocalSttError is case-insensitive; unknown → banner fallback", () => {
  assert.equal(mapLocalSttError("EMPTY_RESULT").message, "未识别到内容，请重试")
  const unk = mapLocalSttError("weird_code")
  assert.equal(unk.severity, "banner")
  assert.match(unk.message, /weird_code/)
  assert.equal(mapLocalSttError("").severity, "banner")
})

test("privacy ack v2: six clauses; local narrative must NOT sole-claim 不经过 Companion", () => {
  assert.equal(VOICE_PRIVACY_ACK_V2_CLAUSES.length, 6)
  assert.equal(VOICE_PRIVACY_ACK_V2_STORAGE_KEY, "voice_privacy_ack_v2")
  // SoT §5.1: local must not present M1-only residual as sole story
  assert.equal(/不经过\s*CMspark\s*Companion|不经过\s*Companion/.test(VOICE_PRIVACY_ACK_V2_BODY), false)
  // Must state Companion path + no auto-send + download + residual + browser cloud + v1 insufficient
  assert.match(VOICE_PRIVACY_ACK_V2_BODY, /Companion/)
  assert.match(VOICE_PRIVACY_ACK_V2_BODY, /临时/)
  assert.match(VOICE_PRIVACY_ACK_V2_BODY, /不自动发送/)
  assert.match(VOICE_PRIVACY_ACK_V2_BODY, /下载/)
  assert.match(VOICE_PRIVACY_ACK_V2_BODY, /交换|转储|零痕迹/)
  assert.match(VOICE_PRIVACY_ACK_V2_BODY, /浏览器|厂商|云/)
  assert.match(VOICE_PRIVACY_ACK_V2_BODY, /v1|此前/)
  assert.equal(/完全本地|完全离线|零风险|绝对隐私/.test(VOICE_PRIVACY_ACK_V2_BODY), false)
})

test("initialState voicePrivacyAckV2 defaults false; SET_VOICE_PRIVACY_ACK_V2 updates state", () => {
  assert.equal(initialState.voicePrivacyAckV2, false)
  assert.equal(initialState.voicePrivacyAckV1, false)

  // Stub chrome.storage so reducer side-effect does not throw in node:test
  const g = globalThis as { chrome?: { storage: { local: { set: (o: unknown) => void } } } }
  const prev = g.chrome
  const sets: unknown[] = []
  g.chrome = {
    storage: {
      local: {
        set: (o: unknown) => {
          sets.push(o)
        },
      },
    },
  }
  try {
    const next = agentReducer(initialState, { type: "SET_VOICE_PRIVACY_ACK_V2", ack: true })
    assert.equal(next.voicePrivacyAckV2, true)
    assert.equal(next.voicePrivacyAckV1, false)
    assert.deepEqual(sets[0], { voice_privacy_ack_v2: true })
    const off = agentReducer(next, { type: "SET_VOICE_PRIVACY_ACK_V2", ack: false })
    assert.equal(off.voicePrivacyAckV2, false)
    assert.deepEqual(sets[1], { voice_privacy_ack_v2: false })
  } finally {
    if (prev === undefined) delete g.chrome
    else g.chrome = prev
  }
})
