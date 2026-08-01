// Model admission for Qwen3-VL experimental layer.

import "./computer-model-test-env"

import test from "node:test"
import assert from "node:assert/strict"

import type { ComputerConfig } from "../src/config"
import {
  ADMISSION_REASON,
  resolveModelAdmission,
  resolveModelAdmissionSafe,
  type AdmissionSession,
  type ModelAdmissionDeps,
} from "../src/computer/model-admission"
import type { ComputerModelSessionHolder } from "../src/computer/model-handlers"
import { LICENSE_DOOR_TEXT_HASH } from "../src/computer/model-license"
import type { QwenVlLocateResult } from "../src/computer/qwen-vl-session"

const ACCEPTED = {
  modelLicenseAcceptedAt: "2026-05-20T00:00:00.000Z",
  modelLicenseAcceptedTextHash: LICENSE_DOOR_TEXT_HASH,
} as const

function cfg(over: Partial<ComputerConfig> = {}): ComputerConfig {
  return { coordinateEnabled: true, modelEnabled: true, modelVariant: "2b", ...ACCEPTED, ...over }
}

function makeFakeSession(opts: { status?: "idle" | "ready" | "disabled" | "loading"; prepareGate?: Promise<void> } = {}) {
  const state = {
    status: opts.status ?? ("ready" as const),
    faults: 0,
    prepareCalls: 0,
    disposeCalls: 0,
  }
  const session: AdmissionSession = {
    async prepare() {
      state.prepareCalls++
      if (opts.prepareGate) await opts.prepareGate
      state.status = "ready"
    },
    async locate(_command: string, _imagePath: string, _w: number, _h: number): Promise<QwenVlLocateResult> {
      return { point: { x: 3, y: 4 }, ms: 1 }
    },
    getStatus: () => state.status,
    getFaults: () => state.faults,
    resetCircuitBreaker: () => {
      state.faults = 0
      if (state.status === "disabled") state.status = "ready"
    },
    async dispose() {
      state.disposeCalls++
    },
  }
  return { session, state }
}

function makeHarness(opts: { prepareGate?: Promise<void>; sessionStatus?: "idle" | "ready" | "disabled" | "loading" } = {}) {
  const calls = { sessionFactory: 0 }
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = []
  const fake = makeFakeSession({ status: opts.sessionStatus, prepareGate: opts.prepareGate })
  const holder: ComputerModelSessionHolder = { session: null }
  const deps: ModelAdmissionDeps = {
    sessionFactory: () => {
      calls.sessionFactory++
      return fake.session
    },
    log: (event, payload) => logs.push({ event, payload }),
  }
  return { deps, calls, logs, fake, holder }
}

test("① 开关关 → model-switch-off", async () => {
  const h = makeHarness()
  const out = await resolveModelAdmission({ config: cfg({ modelEnabled: false }), holder: h.holder, deps: h.deps })
  assert.strictEqual(out.locator, null)
  assert.strictEqual(out.reason, ADMISSION_REASON.SWITCH_OFF)
  assert.strictEqual(h.calls.sessionFactory, 0)
})

test("② 已拒绝许可证 → model-license-declined", async () => {
  const h = makeHarness()
  const out = await resolveModelAdmission({ config: cfg({ modelLicenseDeclined: true }), holder: h.holder, deps: h.deps })
  assert.strictEqual(out.locator, null)
  assert.strictEqual(out.reason, ADMISSION_REASON.LICENSE_DECLINED)
})

test("③ 未接受许可证 → model-license-not-accepted", async () => {
  const h = makeHarness()
  const config = cfg()
  delete config.modelLicenseAcceptedAt
  delete config.modelLicenseAcceptedTextHash
  const out = await resolveModelAdmission({ config, holder: h.holder, deps: h.deps })
  assert.strictEqual(out.locator, null)
  assert.strictEqual(out.reason, ADMISSION_REASON.LICENSE_NOT_ACCEPTED)
})

test("④ 既有会话熔断 → model-circuit-disabled", async () => {
  const h = makeHarness({ sessionStatus: "disabled" })
  h.holder.session = h.fake.session
  const out = await resolveModelAdmission({ config: cfg(), holder: h.holder, deps: h.deps })
  assert.strictEqual(out.locator, null)
  assert.strictEqual(out.reason, ADMISSION_REASON.CIRCUIT_DISABLED)
  assert.strictEqual(h.calls.sessionFactory, 0)
})

test("⑤ 全通过 → locator + holder 写入", async () => {
  const h = makeHarness()
  const out = await resolveModelAdmission({ config: cfg(), holder: h.holder, deps: h.deps })
  assert.ok(out.locator)
  assert.strictEqual(h.holder.session, h.fake.session)
  assert.strictEqual(h.fake.state.prepareCalls, 1)
  assert.ok(h.logs.some((l) => l.event === "computer.model.admission.ready"))
})

test("safe 包装：构建抛错 → model-build-failed 折叠", async () => {
  const holder: ComputerModelSessionHolder = { session: null }
  const out = await resolveModelAdmissionSafe({
    config: cfg(),
    holder,
    deps: {
      sessionFactory: () => {
        throw new Error("boom")
      },
    },
  })
  // factory throw is inside buildSession catch → BUILD_FAILED
  assert.strictEqual(out.locator, null)
  assert.strictEqual(out.reason, ADMISSION_REASON.BUILD_FAILED)
})

test("dispose 竞态：build 中关闭 → 不写 holder", async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => {
    release = r
  })
  const h = makeHarness({ prepareGate: gate })
  let enabled = true
  const p = resolveModelAdmission({
    config: cfg(),
    holder: h.holder,
    deps: { ...h.deps, stillEnabled: () => enabled },
  })
  enabled = false
  release()
  const out = await p
  assert.strictEqual(out.locator, null)
  assert.strictEqual(out.reason, ADMISSION_REASON.SWITCH_OFF)
  assert.strictEqual(h.holder.session, null)
  assert.strictEqual(h.fake.state.disposeCalls, 1)
})
