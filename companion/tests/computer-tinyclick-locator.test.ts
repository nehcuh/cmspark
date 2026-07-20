// WP5 I3 WI-3.1 — TinyClickLocator 包线代码化（G2）+ 坍缩抑制（G4）+
// confidence 缺省（G3）单测。session/tokenizer/decodeFrame 全 fake，断言
// 三类包线拒绝、坍缩检测、reason 词表直通与诚实失败路径。

import test from "node:test";
import assert from "node:assert/strict";

import {
  TinyClickLocator,
  TINYCLICK_REASON,
  type TinyClickLocatorDeps,
} from "../src/computer/tinyclick-locator";
import { ModelRuntimeError, type TinyClickFrame } from "../src/computer/tinyclick-runtime";
import type { TinyClickTokenizer } from "../src/computer/tinyclick-tokenizer";
import type { TinyClickLocateResult } from "../src/computer/tinyclick-session";
import type { CaptureMeta } from "../src/computer/types";

// --- fakes ------------------------------------------------------------------

function shotAt(path: string, sha256 = "sha-A"): CaptureMeta {
  return {
    hwnd: 1,
    rect: { x: 0, y: 0, width: 1280, height: 800 },
    client: { x: 0, y: 40, width: 1280, height: 760 },
    dpi: 96,
    path,
    sha256,
    black: false,
    fallbackUsed: false,
    osrBlackSuspected: false,
  };
}

function frameOf(width = 1280, height = 720): TinyClickFrame {
  return { rgba: new Uint8Array(width * height * 4), width, height };
}

/** 固定返回 n 个 token 的 fake tokenizer（包线预检只关心计数）。 */
function tokenizerOf(n: number): TinyClickTokenizer {
  return { encode: () => new Array(n).fill(1), vocabSize: () => 60000 };
}

class FakeSession {
  readonly calls: Array<{ command: string; frame: TinyClickFrame }> = [];
  constructor(private script: Array<{ point: { x: number; y: number } | null } | Error> = []) {}
  async locate(command: string, frame: TinyClickFrame): Promise<TinyClickLocateResult> {
    this.calls.push({ command, frame });
    const next = this.script.length > 0 ? this.script.shift()! : { point: { x: 100, y: 100 } };
    if (next instanceof Error) throw next;
    return {
      prompt: `what to do to execute the command? ${command}`,
      inputIds: [0, 1, 2],
      tokenIds: [50551, 50552],
      locBins: next.point ? [100, 100] : null,
      point: next.point,
      timings: { preprocessMs: 1, visionMs: 2, embedMs: 3, encoderMs: 4, decoderMs: 5, totalMs: 15 },
    };
  }
}

function locatorDeps(over: Partial<TinyClickLocatorDeps> = {}): TinyClickLocatorDeps {
  return {
    session: new FakeSession(),
    tokenizer: tokenizerOf(12),
    decodeFrame: async () => frameOf(),
    ...over,
  };
}

// --- 包线三类拒绝（G2，plan:455 明定各有测试） --------------------------------

test("包线：非 ASCII 命令 → skipped tinyclick-envelope:non-ascii，session 零调用", async () => {
  const session = new FakeSession();
  const loc = new TinyClickLocator(locatorDeps({ session }));
  const r = await loc.locate({ command: "点击确定按钮", shot: shotAt("a.png") });
  assert.deepEqual(r, { kind: "skipped", reason: TINYCLICK_REASON.NON_ASCII });
  assert.equal(session.calls.length, 0, "包线拒绝必须先于推理");
});

test("包线：prompt token >38 → skipped tinyclick-envelope:too-long，session 零调用（拒绝不截断，O-4）", async () => {
  const session = new FakeSession();
  const loc = new TinyClickLocator(locatorDeps({ session, tokenizer: tokenizerOf(39) }));
  const r = await loc.locate({ command: "click the ok button in the very long dialog", shot: shotAt("a.png") });
  assert.deepEqual(r, { kind: "skipped", reason: TINYCLICK_REASON.TOO_LONG });
  assert.equal(session.calls.length, 0, "超上限绝不截断后送推理");
});

test("包线：恰好 38 token 放行（38 是实测命中最大值，非越界）", async () => {
  const session = new FakeSession();
  const loc = new TinyClickLocator(locatorDeps({ session, tokenizer: tokenizerOf(38) }));
  const r = await loc.locate({ command: "click the ok button", shot: shotAt("a.png") });
  assert.equal(r.kind, "hit");
  assert.equal(session.calls.length, 1);
});

test("包线：帧宽 >1920 → skipped tinyclick-envelope:frame-too-wide，session 零调用", async () => {
  const session = new FakeSession();
  const loc = new TinyClickLocator(locatorDeps({ session, decodeFrame: async () => frameOf(3840, 2160) }));
  const r = await loc.locate({ command: "click the ok button", shot: shotAt("a.png") });
  assert.deepEqual(r, { kind: "skipped", reason: TINYCLICK_REASON.FRAME_TOO_WIDE });
  assert.equal(session.calls.length, 0);
});

// --- 命中与 confidence 契约（G3） ---------------------------------------------

test("命中：包线内英文命令 → hit，confidence 结构性缺省", async () => {
  const loc = new TinyClickLocator(locatorDeps());
  const r = await loc.locate({ command: "click the ok button", shot: shotAt("a.png") });
  assert.equal(r.kind, "hit");
  if (r.kind !== "hit") return;
  assert.deepEqual(r.point, { x: 100, y: 100 });
  assert.equal(r.timings.totalMs, 15);
  // G3：校准曲线落地前类型上无 confidence 字段（非填 0/填 1）。
  assert.equal("confidence" in r, false, "命中结果绝不可携带数值置信度");
});

// --- 坍缩检测（G4，plan:455 同图多命令同点抑制） --------------------------------

test("坍缩：同帧异命令同点 ≤8px → 第二发抑制 tinyclick-collapse-detected", async () => {
  const session = new FakeSession([{ point: { x: 100, y: 100 } }, { point: { x: 105, y: 103 } }]);
  const loc = new TinyClickLocator(locatorDeps({ session }));
  const r1 = await loc.locate({ command: "click the ok button", shot: shotAt("a.png", "sha-SAME") });
  assert.equal(r1.kind, "hit");
  // hypot(5,3)≈5.83 ≤ 8，不同命令同帧同点 = 显著点坍缩
  const r2 = await loc.locate({ command: "press the cancel button", shot: shotAt("a.png", "sha-SAME") });
  assert.deepEqual(r2, { kind: "skipped", reason: TINYCLICK_REASON.COLLAPSE });
});

test("坍缩边界：异命令恰好 8px（≤ 容差）→ 抑制", async () => {
  const session = new FakeSession([{ point: { x: 100, y: 100 } }, { point: { x: 108, y: 100 } }]);
  const loc = new TinyClickLocator(locatorDeps({ session }));
  await loc.locate({ command: "click the ok button", shot: shotAt("a.png", "sha-SAME") });
  const r = await loc.locate({ command: "press the cancel button", shot: shotAt("a.png", "sha-SAME") });
  assert.deepEqual(r, { kind: "skipped", reason: TINYCLICK_REASON.COLLAPSE });
});

test("坍缩不误伤：同命令同点（用户连点同一按钮合法）→ 不抑制", async () => {
  const session = new FakeSession([{ point: { x: 100, y: 100 } }, { point: { x: 100, y: 100 } }]);
  const loc = new TinyClickLocator(locatorDeps({ session }));
  await loc.locate({ command: "click the ok button", shot: shotAt("a.png", "sha-SAME") });
  const r = await loc.locate({ command: "click the ok button", shot: shotAt("a.png", "sha-SAME") });
  assert.equal(r.kind, "hit", "同命令重复不构成坍缩");
});

test("坍缩不误伤：跨帧（异 frameSha）同点 → 不抑制", async () => {
  const session = new FakeSession([{ point: { x: 100, y: 100 } }, { point: { x: 100, y: 100 } }]);
  const loc = new TinyClickLocator(locatorDeps({ session }));
  await loc.locate({ command: "click the ok button", shot: shotAt("a.png", "sha-A") });
  const r = await loc.locate({ command: "press the cancel button", shot: shotAt("b.png", "sha-B") });
  assert.equal(r.kind, "hit", "跨帧追踪窗口不延伸（对抗面 4 纪律）");
});

test("坍缩不误伤：异命令但距离 >8px → 不抑制", async () => {
  const session = new FakeSession([{ point: { x: 100, y: 100 } }, { point: { x: 120, y: 100 } }]);
  const loc = new TinyClickLocator(locatorDeps({ session }));
  await loc.locate({ command: "click the ok button", shot: shotAt("a.png", "sha-SAME") });
  const r = await loc.locate({ command: "press the cancel button", shot: shotAt("a.png", "sha-SAME") });
  assert.equal(r.kind, "hit");
});

// --- reason 词表直通与诚实失败（WI-3.2 chain 映射输入） -------------------------

test("runtime 不可用三 code 直通：model-disabled / model-not-ready / tinyclick-busy → skipped 同名 reason", async () => {
  for (const code of ["model-disabled", "model-not-ready", "tinyclick-busy"]) {
    const session = new FakeSession([new ModelRuntimeError(code, "x")]);
    const loc = new TinyClickLocator(locatorDeps({ session }));
    const r = await loc.locate({ command: "click the ok button", shot: shotAt("a.png") });
    assert.deepEqual(r, { kind: "skipped", reason: code }, `code=${code} 应直通为 skipped`);
  }
});

test("推理故障折叠：infer-timeout → error tinyclick-error（链继续降级）", async () => {
  const session = new FakeSession([new ModelRuntimeError("infer-timeout", "x")]);
  const loc = new TinyClickLocator(locatorDeps({ session }));
  const r = await loc.locate({ command: "click the ok button", shot: shotAt("a.png") });
  assert.deepEqual(r, { kind: "error", reason: TINYCLICK_REASON.ERROR });
});

test("非坐标输出诚实失败：point=null → error tinyclick-error（不编造坐标）", async () => {
  const session = new FakeSession([{ point: null }]);
  const loc = new TinyClickLocator(locatorDeps({ session }));
  const r = await loc.locate({ command: "click the ok button", shot: shotAt("a.png") });
  assert.deepEqual(r, { kind: "error", reason: TINYCLICK_REASON.ERROR });
});

test("解码失败诚实化：decodeFrame throw → error tinyclick-error（不外抛）", async () => {
  const loc = new TinyClickLocator(
    locatorDeps({
      decodeFrame: async () => {
        throw new Error("png decode failed");
      },
    }),
  );
  const r = await loc.locate({ command: "click the ok button", shot: shotAt("a.png") });
  assert.deepEqual(r, { kind: "error", reason: TINYCLICK_REASON.ERROR });
});
