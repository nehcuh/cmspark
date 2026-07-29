// ADR-019 PR-2: user-env helpers + store snapshot wiring

import test from "node:test"
import assert from "node:assert/strict"
import {
  USER_ENV_MASK,
  isUserEnvErrorMessage,
  mapUserEnvError,
  normalizeUserEnvPublic,
  validateUserEnvKeyName,
} from "../src/sidepanel/utils/user-env-utils"
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"
import { requestInitialSidePanelData } from "../src/sidepanel/hooks/useWebSocket"

test("validateUserEnvKeyName accepts POSIX names", () => {
  assert.equal(validateUserEnvKeyName("DATAYES_TOKEN"), null)
  assert.equal(validateUserEnvKeyName("_private"), null)
  assert.equal(validateUserEnvKeyName("A1"), null)
})

test("validateUserEnvKeyName rejects invalid / reserved names", () => {
  assert.match(validateUserEnvKeyName("") || "", /变量名/)
  assert.match(validateUserEnvKeyName("1BAD") || "", /无效/)
  assert.match(validateUserEnvKeyName("has-dash") || "", /无效/)
  assert.match(validateUserEnvKeyName("CMSPARK_SHELL") || "", /保留/)
  assert.match(validateUserEnvKeyName("PATH") || "", /保留/)
  assert.match(validateUserEnvKeyName("LD_PRELOAD") || "", /保留/)
  assert.match(validateUserEnvKeyName("DEEPSEEK_API_KEY") || "", /保留/)
})

test("mapUserEnvError maps known codes to Chinese", () => {
  assert.match(mapUserEnvError("INVALID_KEY"), /变量名/)
  assert.match(mapUserEnvError("RESERVED_KEY"), /保留/)
  assert.match(mapUserEnvError("VALUE_TOO_LONG"), /过长/)
  assert.match(mapUserEnvError("TOO_MANY_KEYS"), /上限/)
  assert.match(mapUserEnvError("IO_ERROR"), /读写/)
  assert.equal(mapUserEnvError(undefined, "自定义错误"), "自定义错误")
  assert.equal(mapUserEnvError("UNKNOWN"), "环境变量操作失败")
})

test("isUserEnvErrorMessage routes by family or error_code", () => {
  assert.equal(isUserEnvErrorMessage({ family: "user_env" }), true)
  assert.equal(isUserEnvErrorMessage({ error_code: "RESERVED_KEY" }), true)
  assert.equal(isUserEnvErrorMessage({ code: "TOO_MANY_KEYS" }), true)
  assert.equal(isUserEnvErrorMessage({ error_code: "BIOMETRIC_DENIED" }), false)
  assert.equal(isUserEnvErrorMessage({}), false)
})

test("normalizeUserEnvPublic strips any value field and forces mask", () => {
  const pub = normalizeUserEnvPublic({
    keys: [
      { name: "DATAYES_TOKEN", masked: "***", value: "SHOULD_NEVER_LEAK" },
      { name: "OK", masked: "xxx" },
      { name: "", masked: "***" },
      null,
    ],
    count: 2,
    updated_at: "2026-07-29T00:00:00.000Z",
  })
  assert.equal(pub.keys.length, 2)
  assert.equal(pub.keys[0].name, "DATAYES_TOKEN")
  assert.equal(pub.keys[0].masked, USER_ENV_MASK)
  assert.equal(pub.keys[1].masked, USER_ENV_MASK)
  // Ensure we did not pass through a plaintext value property
  assert.equal("value" in (pub.keys[0] as object), false)
  assert.equal(pub.count, 2)
  assert.equal(pub.updated_at, "2026-07-29T00:00:00.000Z")
})

test("SET_USER_ENV stores public snapshot and clears error", () => {
  const withErr = agentReducer(initialState, {
    type: "SET_USER_ENV_ERROR",
    error: "保留名",
  })
  assert.equal(withErr.userEnvError, "保留名")
  const next = agentReducer(withErr, {
    type: "SET_USER_ENV",
    userEnv: {
      keys: [{ name: "DATAYES_TOKEN", masked: "***" }],
      count: 1,
    },
  })
  assert.equal(next.userEnv?.count, 1)
  assert.equal(next.userEnv?.keys[0].name, "DATAYES_TOKEN")
  assert.equal(next.userEnvError, null)
})

test("SET_USER_ENV_STATUS and SET_USER_ENV_ERROR are mutually exclusive feedback", () => {
  const ok = agentReducer(initialState, { type: "SET_USER_ENV_STATUS", status: "已保存" })
  assert.equal(ok.userEnvStatus, "已保存")
  assert.equal(ok.userEnvError, null)
  const err = agentReducer(ok, { type: "SET_USER_ENV_ERROR", error: "IO" })
  assert.equal(err.userEnvError, "IO")
  assert.equal(err.userEnvStatus, null)
})

test("requestInitialSidePanelData requests user_env.list", () => {
  const sent: object[] = []
  const ref = { current: false }
  const ok = requestInitialSidePanelData((m) => sent.push(m), ref)
  assert.equal(ok, true)
  assert.ok(sent.some((m: any) => m.type === "user_env.list"))
  // second call is no-op
  assert.equal(requestInitialSidePanelData((m) => sent.push(m), ref), false)
})
