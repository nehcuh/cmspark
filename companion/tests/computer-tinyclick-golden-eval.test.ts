// WP5 I3 ① — tinyclick-golden-eval 判定逻辑单测（进门禁）。
// fixture 取 scripts/spike/s3-golden/golden.json 真实子集（真实 command/gt/token 数），
// frozen 锚取 g1-envelope-result.json（hybrid）与 -int8.json 真实冻结值：
//   hybrid：f-icon-en HIT 3.2px/673.6ms；f-ok-en MISS 809px；f-play-en MISS 151px
//   int8  ：f-ok-en HIT 3.6px/1141.3ms；f-icon-en HIT 1.0px/1141.6ms

import test from "node:test";
import assert from "node:assert/strict";

import {
  ENVELOPE_SKIP_PREFIX,
  GOLDEN_DIST_TOLERANCE_PX,
  GOLDEN_LATENCY_BASELINE_FACTOR,
  GOLDEN_LATENCY_FACTOR,
  distToGtCenter,
  evaluateGoldenCase,
  indexFrozenAnchors,
  isEnvelopeIn,
  summarizeGolden,
  type FrozenAnchor,
  type GoldenCase,
  type GoldenObservation,
} from "../src/computer/tinyclick-golden-eval";
import { MAX_PROMPT_TOKENS } from "../src/computer/tinyclick-locator";

// --- fixtures（golden.json 真实子集；input_ids 只用到 length，按真实 token 数填充） ---

function goldenCase(
  id: string,
  command: string,
  gt: { cx: number; cy: number; w: number; h: number },
  tokenCount: number,
  lang: string,
): GoldenCase {
  return {
    id,
    group: "fixture",
    lang,
    image: "fixture.jpg",
    command,
    gt,
    input_ids: new Array(tokenCount).fill(0),
  };
}

const F_OK_EN = goldenCase("f-ok-en", "click on the ok button", { cx: 884, cy: 602, w: 120, h: 44 }, 15, "en");
const F_PLAY_EN = goldenCase("f-play-en", "click on the play button in the center of the window", { cx: 480, cy: 320, w: 120, h: 60 }, 21, "en");
const F_ICON_EN = goldenCase("f-icon-en", "click on the blue square icon", { cx: 482, cy: 172, w: 24, h: 24 }, 16, "en");
const D_DESK_EN = goldenCase("d-deskchrome-en", "click on the google chrome icon on the desktop", { cx: 26, cy: 243, w: 32, h: 40 }, 19, "en");
const F_HELP_ZH = goldenCase("f-help-zh", "点击左下角的帮助按钮", { cx: 76, cy: 602, w: 120, h: 44 }, 33, "zh");
const F_PLAY_ZH = goldenCase("f-play-zh", "点击窗口正中间的播放按钮", { cx: 480, cy: 320, w: 120, h: 60 }, 38, "zh");
const F_LONG_ZH = goldenCase("f-long-zh", "请点击窗口中间偏上位置那一段用于验证长命令定位能力的中文说明文字", { cx: 366, cy: 218, w: 700, h: 36 }, 78, "zh");
const S_BT_ZH = goldenCase("s-bt-zh", "点击左侧的蓝牙和其他设备", { cx: 84, cy: 182, w: 160, h: 30 }, 38, "zh");

/** hybrid 臂真实 frozen 锚。 */
const HYBRID: Record<string, FrozenAnchor> = {
  "f-ok-en": { hit: false, distPx: 809, totalMs: 684.2 },
  "f-play-en": { hit: false, distPx: 151, totalMs: 679 },
  "f-icon-en": { hit: true, distPx: 3.2, totalMs: 673.6 },
  "d-deskchrome-en": { hit: false, distPx: 815.1, totalMs: 665.1 },
};
/** int8 臂真实 frozen 锚。 */
const INT8: Record<string, FrozenAnchor> = {
  "f-ok-en": { hit: true, distPx: 3.6, totalMs: 1141.3 },
  "f-icon-en": { hit: true, distPx: 1.0, totalMs: 1141.6 },
};

function skipped(reason = "tinyclick-envelope:non-ascii"): GoldenObservation {
  return { kind: "skipped", reason };
}
function errored(reason = "tinyclick-error"): GoldenObservation {
  return { kind: "error", reason };
}
function hitAt(x: number, y: number, totalMs = 700): GoldenObservation {
  return { kind: "hit", point: { x, y }, totalMs };
}

// --- isEnvelopeIn / distToGtCenter --------------------------------------------

test("isEnvelopeIn：ASCII+≤38 内；非 ASCII 或 >38 外；边界 38 在内", () => {
  assert.equal(isEnvelopeIn("click on the ok button", 15), true);
  assert.equal(isEnvelopeIn("x".repeat(200), MAX_PROMPT_TOKENS), true); // 恰 38
  assert.equal(isEnvelopeIn("x", MAX_PROMPT_TOKENS + 1), false); // 39
  assert.equal(isEnvelopeIn("点击窗口正中间的播放按钮", 38), false); // 38 tok 但非 ASCII
  assert.equal(isEnvelopeIn("请点击窗口中间偏上位置那一段用于验证长命令定位能力的中文说明文字", 78), false);
  assert.equal(isEnvelopeIn("ascii", 40, 50), true); // maxPromptTokens 可覆写
  // M3 收紧：C0 控制符与 DEL 属未测区域 → 包线外（可打印 0x20-0x7E 才在内）
  assert.equal(isEnvelopeIn("click\tok", 15), false);
  assert.equal(isEnvelopeIn("click ok\x7f", 15), false);
  assert.equal(isEnvelopeIn("click ~ok", 15), true); // 0x7E 边界在内
});

test("distToGtCenter：欧氏距离", () => {
  assert.equal(distToGtCenter(884, 602, F_OK_EN.gt), 0);
  assert.equal(distToGtCenter(887, 602, F_OK_EN.gt), 3);
  assert.equal(distToGtCenter(884 + 3, 602 + 4, F_OK_EN.gt), 5);
});

// --- 规则 1：包线外 100% 拒绝 ---------------------------------------------------

test("envelope-out：skipped 且 reason 前缀正确 → pass（zh 代表 4 case）", () => {
  for (const c of [F_HELP_ZH, F_PLAY_ZH, F_LONG_ZH, S_BT_ZH]) {
    const v = evaluateGoldenCase(c, null, skipped());
    assert.equal(v.status, "pass", `${c.id}: ${v.detail}`);
  }
});

test("envelope-out：too-long 拒绝同样认前缀", () => {
  const v = evaluateGoldenCase(F_LONG_ZH, null, skipped("tinyclick-envelope:too-long"));
  assert.equal(v.status, "pass");
});

test("envelope-out：任何漏放（hit/error/错 reason）即 FAIL", () => {
  assert.equal(evaluateGoldenCase(F_HELP_ZH, null, hitAt(76, 602)).status, "fail");
  assert.equal(evaluateGoldenCase(F_HELP_ZH, null, errored()).status, "fail");
  assert.equal(evaluateGoldenCase(F_HELP_ZH, null, skipped("model-disabled")).status, "fail");
  assert.equal(evaluateGoldenCase(F_LONG_ZH, HYBRID["f-ok-en"], hitAt(0, 0)).status, "fail");
});

// --- 规则 2：frozen HIT -----------------------------------------------------------

test("frozen HIT（hybrid f-icon-en 3.2px）：容差内 hit → pass", () => {
  // 预测点距 gt 中心 5.0px ≤ 3.2 + 2 = 5.2 → pass
  const v = evaluateGoldenCase(F_ICON_EN, HYBRID["f-icon-en"], hitAt(485, 172, 673));
  assert.equal(v.status, "pass", v.detail);
});

test("frozen HIT：漂移超容差 → fail", () => {
  // 距 5.3px > 5.2 → fail
  const v = evaluateGoldenCase(F_ICON_EN, HYBRID["f-icon-en"], hitAt(482, 172 + 5.3, 673));
  assert.equal(v.status, "fail", v.detail);
});

test("frozen HIT（int8 f-ok-en 3.6px）：error/skipped 一律 fail（回归即失败）", () => {
  assert.equal(evaluateGoldenCase(F_OK_EN, INT8["f-ok-en"], errored()).status, "fail");
  assert.equal(evaluateGoldenCase(F_OK_EN, INT8["f-ok-en"], skipped("tinyclick-collapse")).status, "fail");
});

// --- 规则 4：延迟上界 -------------------------------------------------------------

test("frozen HIT：totalMs ≤ frozen×1.5 通过，超出 fail（legacy 无基线回退）", () => {
  const anchor = HYBRID["f-icon-en"]; // 673.6 → 上限 1010.4
  assert.equal(
    evaluateGoldenCase(F_ICON_EN, anchor, hitAt(483, 173, 1010.3)).status,
    "pass",
  );
  const over = evaluateGoldenCase(F_ICON_EN, anchor, hitAt(483, 173, 1010.5));
  assert.equal(over.status, "fail");
  assert.match(over.detail, /延迟超限/);
});

test("规则 4（F-1）：有本次 run 基线 → 基线×2.5 判定（机器无关，冻锚不再误伤热机）", () => {
  const anchor = HYBRID["f-icon-en"]; // frozen 673.6×1.5=1010.4
  // 热机场景：基线 1730 → 上限 4325；1717ms 在 legacy 下 fail、基线下 pass（评审 F-1 假阳性实例）
  const hot = evaluateGoldenCase(F_ICON_EN, anchor, hitAt(483, 173, 1717.1), { baselineMs: 1730 });
  assert.equal(hot.status, "pass", hot.detail);
  // 同基线下真回归（10×）仍 fail——比值臂不是放宽，是换参照系
  const regression = evaluateGoldenCase(F_ICON_EN, anchor, hitAt(483, 173, 4326), { baselineMs: 1730 });
  assert.equal(regression.status, "fail");
  assert.match(regression.detail, /基线 1730\.0ms ×2\.5/);
  // 安静机：基线 700 → 上限 1750
  assert.equal(
    evaluateGoldenCase(F_ICON_EN, anchor, hitAt(483, 173, 1750), { baselineMs: 700 }).status,
    "pass",
  );
  assert.equal(
    evaluateGoldenCase(F_ICON_EN, anchor, hitAt(483, 173, 1751), { baselineMs: 700 }).status,
    "fail",
  );
  // latencyBaselineFactor 可覆写
  assert.equal(
    evaluateGoldenCase(F_ICON_EN, anchor, hitAt(483, 173, 1500), { baselineMs: 700, latencyBaselineFactor: 2 }).status,
    "fail",
  );
});

// --- 规则 3：frozen MISS -----------------------------------------------------------

test("frozen MISS（hybrid f-ok-en）：error/skipped = 诚实 MISS → pass", () => {
  assert.equal(evaluateGoldenCase(F_OK_EN, HYBRID["f-ok-en"], errored()).status, "pass");
  assert.equal(
    evaluateGoldenCase(F_PLAY_EN, HYBRID["f-play-en"], skipped("tinyclick-collapse")).status,
    "pass",
  );
});

test("frozen MISS：production hit → 仅 report 不断言（延迟超也不 fail）", () => {
  const v = evaluateGoldenCase(D_DESK_EN, HYBRID["d-deskchrome-en"], hitAt(26, 243, 5000));
  assert.equal(v.status, "report", v.detail);
  assert.match(v.detail, /frozen MISS/);
});

// --- 规则 5（M2 fail-closed）：frozen 锚缺失 ---------------------------------------

test("frozen null + envelope-in → FAIL（fail-closed，不静默降级 report）；envelope-out 规则仍生效", () => {
  const v = evaluateGoldenCase(F_OK_EN, null, hitAt(884, 602));
  assert.equal(v.status, "fail", v.detail);
  assert.match(v.detail, /锚缺失/);
  assert.equal(evaluateGoldenCase(F_HELP_ZH, null, skipped()).status, "pass");
  assert.equal(evaluateGoldenCase(F_HELP_ZH, null, hitAt(76, 602)).status, "fail");
});

// --- M2 回归：锚按 id 键取（重排不静默错锚）+ 锚文件损坏检测 ------------------------

test("indexFrozenAnchors：位置索引重排后仍按 id 正确取锚", () => {
  // 模拟 golden.json 增删重排：位置键与 id 的对应关系被打乱
  const reordered = {
    "0": { id: "f-icon-en", ...HYBRID["f-icon-en"] },
    "1": { id: "f-ok-en", ...HYBRID["f-ok-en"] },
    "7": { id: "f-play-en", ...HYBRID["f-play-en"] },
  };
  const map = indexFrozenAnchors(reordered);
  assert.equal(map.size, 3);
  assert.equal(map.get("f-ok-en")!.hit, false);
  assert.equal(map.get("f-icon-en")!.hit, true);
  assert.equal(map.get("f-icon-en")!.distPx, 3.2);
  // 按 id 取锚后，f-icon-en 拿到的是 HIT 锚（重排前位置 8），hit 达标 → pass
  const v = evaluateGoldenCase(F_ICON_EN, map.get("f-icon-en")!, hitAt(483, 173, 673));
  assert.equal(v.status, "pass", v.detail);
  // 若仍按位置索引取（旧行为），f-icon-en 会错配到 f-ok-en 的 MISS 锚 → report 漏检
  assert.notEqual(map.get("f-icon-en")!.hit, HYBRID["f-ok-en"].hit);
});

test("indexFrozenAnchors：id 缺失或重复即 throw（脚本侧 exit 2）", () => {
  assert.throws(
    () => indexFrozenAnchors({ "0": { hit: true, distPx: 1, totalMs: 100 } }),
    /缺 id/,
  );
  assert.throws(
    () =>
      indexFrozenAnchors({
        "0": { id: "f-ok-en", ...HYBRID["f-ok-en"] },
        "1": { id: "f-ok-en", ...HYBRID["f-ok-en"] },
      }),
    /重复/,
  );
});

// --- 汇总 ------------------------------------------------------------------------

test("summarizeGolden：fail===0 即 ok，report 不阻塞", () => {
  const verdicts = [
    evaluateGoldenCase(F_ICON_EN, HYBRID["f-icon-en"], hitAt(483, 173, 673)),
    evaluateGoldenCase(F_HELP_ZH, null, skipped()),
    evaluateGoldenCase(D_DESK_EN, HYBRID["d-deskchrome-en"], hitAt(26, 243)),
  ];
  const s = summarizeGolden(verdicts);
  assert.deepEqual(s, { total: 3, pass: 2, fail: 0, report: 1, ok: true });

  const bad = summarizeGolden([
    ...verdicts,
    evaluateGoldenCase(F_ICON_EN, HYBRID["f-icon-en"], errored()),
  ]);
  assert.equal(bad.fail, 1);
  assert.equal(bad.ok, false);
});

test("常量契约：容差/系数/前缀", () => {
  assert.equal(GOLDEN_DIST_TOLERANCE_PX, 2);
  assert.equal(GOLDEN_LATENCY_FACTOR, 1.5);
  assert.equal(GOLDEN_LATENCY_BASELINE_FACTOR, 2.5);
  assert.equal(ENVELOPE_SKIP_PREFIX, "tinyclick-envelope:");
});
