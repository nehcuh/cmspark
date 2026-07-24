// WP5-I4 WI-4.3 — model-admission 单测：六路拒绝/通过矩阵 + holder 写入点① +
// 并发单飞 + dispose 落地竞态 + per-task 配置翻转 + 符号级契约。
//
// 环境纪律：DATA_DIR 隔离 import 必须首行（config.ts 模块加载时定型）；
// session/tokenizer/decodeFrame 全 fake（不建真会话、不读真模型）。

import "./computer-model-test-env";

import test from "node:test";
import assert from "node:assert/strict";

import type { ComputerConfig } from "../src/config";
import {
  ADMISSION_REASON,
  resolveTinyClickAdmission,
  resolveTinyClickAdmissionSafe,
  type AdmissionSession,
  type TinyClickAdmissionDeps,
} from "../src/computer/model-admission";
import type { ComputerModelSessionHolder } from "../src/computer/model-handlers";
import { LICENSE_DOOR_TEXT_HASH } from "../src/computer/model-license";
import type { ModelManifest } from "../src/computer/model-manifest";
import type { RuntimeStatus, TinyClickFrame } from "../src/computer/tinyclick-runtime";
import type { TinyClickLocateResult } from "../src/computer/tinyclick-session";
import type { TinyClickTokenizer } from "../src/computer/tinyclick-tokenizer";
import type { CaptureMeta } from "../src/computer/types";

// --- fakes ---------------------------------------------------------------------

const ACCEPTED = {
  modelLicenseAcceptedAt: "2026-05-20T00:00:00.000Z",
  modelLicenseAcceptedTextHash: LICENSE_DOOR_TEXT_HASH,
} as const;

function cfg(over: Partial<ComputerConfig> = {}): ComputerConfig {
  return { coordinateEnabled: true, modelEnabled: true, ...ACCEPTED, ...over };
}

const ZERO_TIMINGS = {
  preprocessMs: 0,
  visionMs: 0,
  embedMs: 0,
  encoderMs: 0,
  decoderMs: 0,
  totalMs: 0,
};

interface FakeState {
  status: RuntimeStatus;
  faults: number;
  prepareCalls: number;
  disposeCalls: number;
  locateCommands: string[];
}

function makeFakeSession(opts: { status?: RuntimeStatus; prepareGate?: Promise<void> } = {}): {
  session: AdmissionSession;
  state: FakeState;
} {
  const state: FakeState = {
    status: opts.status ?? "warm",
    faults: 0,
    prepareCalls: 0,
    disposeCalls: 0,
    locateCommands: [],
  };
  const session: AdmissionSession = {
    async prepare() {
      state.prepareCalls++;
      if (opts.prepareGate) await opts.prepareGate;
    },
    async locate(command: string, _frame: TinyClickFrame): Promise<TinyClickLocateResult> {
      state.locateCommands.push(command);
      return {
        prompt: `prompt:${command}`,
        inputIds: [0, 1, 2],
        tokenIds: [2, 0],
        locBins: null,
        point: { x: 3, y: 4 },
        timings: ZERO_TIMINGS,
      };
    },
    getStatus: () => state.status,
    getFaults: () => state.faults,
    resetCircuitBreaker: () => {
      state.faults = 0;
    },
    async dispose() {
      state.disposeCalls++;
    },
  };
  return { session, state };
}

const fakeTokenizer: TinyClickTokenizer = {
  // 恒短编码（长度 3 ≤ 38 包线）：token 计数预检是 locator 单测的职责，本套件不覆盖
  encode: () => [0, 1, 2],
  vocabSize: () => 51200,
};

const fakeDecodeFrame = async (): Promise<TinyClickFrame> => ({
  rgba: new Uint8Array(4),
  width: 1,
  height: 1,
});

const SHOT = {
  hwnd: 1,
  rect: { x: 0, y: 0, width: 100, height: 80 },
  client: { x: 0, y: 0, width: 100, height: 72 },
  dpi: 96,
  path: "unused.png",
  sha256: "frame-sha-1",
  black: false,
  fallbackUsed: false,
  osrBlackSuspected: false,
} as CaptureMeta;

interface Harness {
  deps: TinyClickAdmissionDeps;
  calls: { manifest: number; tokenizer: number; sessionFactory: number };
  logs: Array<{ event: string; payload: Record<string, unknown> }>;
  fake: { session: AdmissionSession; state: FakeState };
  holder: ComputerModelSessionHolder;
}

function makeHarness(opts: { prepareGate?: Promise<void>; sessionStatus?: RuntimeStatus } = {}): Harness {
  const calls = { manifest: 0, tokenizer: 0, sessionFactory: 0 };
  const logs: Harness["logs"] = [];
  const fake = makeFakeSession({ status: opts.sessionStatus, prepareGate: opts.prepareGate });
  const holder: ComputerModelSessionHolder = { session: null };
  const deps: TinyClickAdmissionDeps = {
    manifestLoader: async () => {
      calls.manifest++;
      return {} as ModelManifest;
    },
    tokenizerLoader: async () => {
      calls.tokenizer++;
      return fakeTokenizer;
    },
    sessionFactory: () => {
      calls.sessionFactory++;
      return fake.session;
    },
    decodeFrame: fakeDecodeFrame,
    log: (event, payload) => logs.push({ event, payload }),
  };
  return { deps, calls, logs, fake, holder };
}

// --- 六路矩阵 ---------------------------------------------------------------------

test("① 开关关 → model-switch-off（不触构建）", async () => {
  const h = makeHarness();
  const out = await resolveTinyClickAdmission({ config: cfg({ modelEnabled: false }), holder: h.holder, deps: h.deps });
  assert.strictEqual(out.locator, null);
  assert.strictEqual(out.reason, ADMISSION_REASON.SWITCH_OFF);
  assert.strictEqual(h.calls.sessionFactory, 0);
});

test("② 已拒绝许可证 → model-license-declined（优先于 accepted 要素）", async () => {
  const h = makeHarness();
  const out = await resolveTinyClickAdmission({ config: cfg({ modelLicenseDeclined: true }), holder: h.holder, deps: h.deps });
  assert.strictEqual(out.locator, null);
  assert.strictEqual(out.reason, ADMISSION_REASON.LICENSE_DECLINED);
});

test("③a 未接受许可证 → model-license-not-accepted", async () => {
  const h = makeHarness();
  const config = cfg();
  delete config.modelLicenseAcceptedAt;
  delete config.modelLicenseAcceptedTextHash;
  const out = await resolveTinyClickAdmission({ config, holder: h.holder, deps: h.deps });
  assert.strictEqual(out.locator, null);
  assert.strictEqual(out.reason, ADMISSION_REASON.LICENSE_NOT_ACCEPTED);
});

test("③b 条款文本漂移（P1 哈希不符）→ model-license-not-accepted", async () => {
  const h = makeHarness();
  const out = await resolveTinyClickAdmission({
    config: cfg({ modelLicenseAcceptedTextHash: "000000000000" }),
    holder: h.holder,
    deps: h.deps,
  });
  assert.strictEqual(out.locator, null);
  assert.strictEqual(out.reason, ADMISSION_REASON.LICENSE_NOT_ACCEPTED);
});

test("④ 既有会话熔断 → model-circuit-disabled（复位只走设置页）", async () => {
  const h = makeHarness({ sessionStatus: "disabled" });
  h.holder.session = h.fake.session;
  const out = await resolveTinyClickAdmission({ config: cfg(), holder: h.holder, deps: h.deps });
  assert.strictEqual(out.locator, null);
  assert.strictEqual(out.reason, ADMISSION_REASON.CIRCUIT_DISABLED);
  assert.strictEqual(h.calls.sessionFactory, 0, "熔断会话不得触发重建");
});

test("外来会话（非 admission 构建，无 tokenizer 配对）→ model-session-foreign", async () => {
  const h = makeHarness(); // warm，但 holder 由测试直写（写入点③形态）
  h.holder.session = h.fake.session;
  const out = await resolveTinyClickAdmission({ config: cfg(), holder: h.holder, deps: h.deps });
  assert.strictEqual(out.locator, null);
  assert.strictEqual(out.reason, ADMISSION_REASON.SESSION_FOREIGN);
});

// --- 通过路径 ---------------------------------------------------------------------

test("⑥ 全通过：无会话 → 单飞懒建 + holder 写入点① + locator 可用（hit）", async () => {
  const h = makeHarness();
  const out = await resolveTinyClickAdmission({ config: cfg(), holder: h.holder, deps: h.deps });
  assert.ok(out.locator, "locator 应非 null");
  assert.strictEqual(out.reason, undefined);
  assert.strictEqual(h.calls.sessionFactory, 1);
  assert.strictEqual(h.fake.state.prepareCalls, 1, "I1 校验即加载须发生");
  assert.strictEqual(h.holder.session, h.fake.session, "写入点①：holder 落定会话");
  assert.ok(h.logs.some((l) => l.event === "computer.model.admission.ready"));
  // locator 端到端（fake 链）：包线预检 → decodeFrame → session.locate → hit
  const located = await out.locator!.locate({ command: "click OK", shot: SHOT });
  assert.strictEqual(located.kind, "hit");
  if (located.kind === "hit") assert.deepStrictEqual(located.point, { x: 3, y: 4 });
  assert.deepStrictEqual(h.fake.state.locateCommands, ["click OK"]);
});

test("既有健康会话快路径：二次 admission 不重建、locator 每任务新建", async () => {
  const h = makeHarness();
  const first = await resolveTinyClickAdmission({ config: cfg(), holder: h.holder, deps: h.deps });
  const second = await resolveTinyClickAdmission({ config: cfg(), holder: h.holder, deps: h.deps });
  assert.ok(first.locator && second.locator);
  assert.strictEqual(h.calls.sessionFactory, 1, "既有会话不得重建");
  assert.strictEqual(h.fake.state.prepareCalls, 1);
  assert.notStrictEqual(first.locator, second.locator, "坍缩历史任务级：locator 实例必须新建");
});

test("懒建失败（I1 复验/load-failed 形态）→ model-build-failed，holder 不写入 + loud log", async () => {
  const h = makeHarness();
  h.deps.sessionFactory = () => {
    h.calls.sessionFactory++;
    const bad = makeFakeSession();
    bad.session.prepare = async () => {
      throw new Error("model-hash-mismatch: vision_encoder.onnx");
    };
    return bad.session;
  };
  const out = await resolveTinyClickAdmission({ config: cfg(), holder: h.holder, deps: h.deps });
  assert.strictEqual(out.locator, null);
  assert.strictEqual(out.reason, ADMISSION_REASON.BUILD_FAILED);
  assert.strictEqual(h.holder.session, null, "失败不得写 holder（下任务重试）");
  assert.ok(h.logs.some((l) => l.event === "computer.model.admission.failed"), "失败须 loud log");
});

test("并发首建单飞：sessionFactory 只调一次，两调用方各得独立 locator", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const h = makeHarness({ prepareGate: gate });
  const p1 = resolveTinyClickAdmission({ config: cfg(), holder: h.holder, deps: h.deps });
  const p2 = resolveTinyClickAdmission({ config: cfg(), holder: h.holder, deps: h.deps });
  // 两调用都进入后放行构建
  await new Promise((r) => setImmediate(r));
  release();
  const [o1, o2] = await Promise.all([p1, p2]);
  assert.ok(o1.locator && o2.locator);
  assert.strictEqual(h.calls.sessionFactory, 1, "并发首建必须单飞");
  assert.notStrictEqual(o1.locator, o2.locator, "坍缩历史不跨任务共享");
  assert.strictEqual(h.holder.session, h.fake.session);
});

test("per-task 配置翻转：关闭后重开 = 重建（无陈旧 WeakMap 会话复用）", async () => {
  const h = makeHarness();
  const on1 = await resolveTinyClickAdmission({ config: cfg(), holder: h.holder, deps: h.deps });
  assert.ok(on1.locator);
  // 模拟 disable handler（写入点②）：dispose + holder=null
  await h.holder.session!.dispose();
  h.holder.session = null;
  const off = await resolveTinyClickAdmission({ config: cfg({ modelEnabled: false }), holder: h.holder, deps: h.deps });
  assert.strictEqual(off.locator, null);
  assert.strictEqual(off.reason, ADMISSION_REASON.SWITCH_OFF);
  const h2 = makeHarness();
  h2.holder = h.holder; // 同一 holder 重建路径
  const on2 = await resolveTinyClickAdmission({ config: cfg(), holder: h.holder, deps: h2.deps });
  assert.ok(on2.locator, "重开应重新懒建成功");
  assert.strictEqual(h2.calls.sessionFactory, 1, "holder 空 = 新构建（旧会话 meta 不泄漏）");
  assert.notStrictEqual(on1.locator, on2.locator);
});

test("落地×关闭竞态：build 完成时开关已关 → dispose 新建会话、不写 holder", async () => {
  const h = makeHarness();
  const out = await resolveTinyClickAdmission({
    config: cfg(),
    holder: h.holder,
    deps: { ...h.deps, stillEnabled: () => false },
  });
  assert.strictEqual(out.locator, null);
  assert.strictEqual(out.reason, ADMISSION_REASON.SWITCH_OFF);
  assert.strictEqual(h.fake.state.disposeCalls, 1, "竞态落地的新建会话须立即 dispose");
  assert.strictEqual(h.holder.session, null, "竞态落地不得写 holder");
  assert.ok(h.logs.some((l) => l.event === "computer.model.admission.discarded"));
});

test("符号级契约（P8）：holder 写入点注释三处在案", async () => {
  // 契约本体是源码注释（model-handlers.ts ComputerModelSessionHolder 头注）；
  // 本测试锁 admission 侧行为面：admission 只在「全通过 + stillEnabled」后写
  // holder（写入点①），其余路径一律只读。由上方各用例的 holder.session 断言
  // 组合覆盖；此处补一条显式不变量：失败/拒绝路径 holder 恒 null。
  const h = makeHarness();
  for (const config of [
    cfg({ modelEnabled: false }),
    cfg({ modelLicenseDeclined: true }),
    cfg({ modelLicenseAcceptedTextHash: "badbadbadbad" }),
  ]) {
    await resolveTinyClickAdmission({ config, holder: h.holder, deps: h.deps });
    assert.strictEqual(h.holder.session, null, "拒绝路径不得写 holder");
  }
});

// --- P4：safe 包装器防御折叠（I4 对抗；server.ts 生产唯一调用点） ---------------------

test("P4：admission 评估意外抛出 → safe 包装器折叠为 {locator:null, model-admission-error} + loud log", async () => {
  // 配置对象 getter 抛错（resolve 内部纯读路径之外的意外面）——safe 必须视同
  // 拒绝而非让异常穿透 host_computer 任务起点（UIA/OCR/框选兜底链密闭）。
  const throwingCfg = Object.defineProperty({}, "modelEnabled", {
    get(): never {
      throw new Error("synthetic admission blow-up");
    },
  }) as ComputerConfig;
  const h = makeHarness();
  const out = await resolveTinyClickAdmissionSafe({ config: throwingCfg, holder: h.holder, deps: h.deps });
  assert.strictEqual(out.locator, null);
  assert.strictEqual(out.reason, ADMISSION_REASON.ADMISSION_ERROR);
  assert.strictEqual(h.holder.session, null, "异常折叠不得写 holder");
  const errLogs = h.logs.filter((l) => l.event === "computer.model.admission.error");
  assert.strictEqual(errLogs.length, 1, "loud log 留痕一次");
  assert.match(String(errLogs[0]!.payload.message), /synthetic admission blow-up/);
});

test("P4：safe 包装器正常路径零改语义（拒绝原因原样透传、无 error 日志）", async () => {
  const h = makeHarness();
  const out = await resolveTinyClickAdmissionSafe({
    config: cfg({ modelEnabled: false }),
    holder: h.holder,
    deps: h.deps,
  });
  assert.strictEqual(out.locator, null);
  assert.strictEqual(out.reason, ADMISSION_REASON.SWITCH_OFF, "拒绝原因词表原样透传");
  assert.ok(!h.logs.some((l) => l.event === "computer.model.admission.error"), "正常路径不触发 error 日志");
});
