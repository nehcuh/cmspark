// WP5 I3 ① TinyClick golden harness —— 纯判定逻辑（零 Node 依赖，门禁内单测）。
//
// 数据来源：
//   - cases   : scripts/spike/s3-golden/golden.json（19 case，含 gt 与冻结 input_ids）
//   - 锚定臂  : scripts/spike/s3-golden/g1-envelope-result.json      （hybrid/fp32 冻结结果）
//               scripts/spike/s3-golden/g1-envelope-result-int8.json （int8 冻结结果）
//
// 判定纪律（frozen 锚定，不自造阈值）：
//   1. 包线外（非 ASCII 或 token 数 > 38）→ 必须 skipped 且 reason 前缀
//      `tinyclick-envelope:` —— 包线拒绝率要求 100%，任何漏放即 FAIL。
//   2. 包线内 + frozen HIT → 必须 hit，且预测点与 gt 中心距
//      ≤ frozen.distPx + GOLDEN_DIST_TOLERANCE_PX；否则 FAIL。
//      （frozen HIT + production error/miss/skipped 一律 FAIL——回归即失败。）
//   3. 包线内 + frozen MISS → 仅报告不断言：production hit 记 report，
//      production error/skipped 视为诚实 MISS 记 pass（不惩罚已知弱点）。
//   4. 包线内凡实际跑了推理（obs hit 且带 totalMs）→
//      totalMs ≤ frozen.totalMs × GOLDEN_LATENCY_FACTOR；超即 FAIL。
//   5. frozen 锚缺失（null）→ 包线内记 FAIL（fail-closed，WP5 I3 对抗修复 M2：
//      部分锚丢失不得静默降级为 report）；包线外规则仍然生效。
//
// 本模块只做纯函数判定；真实模型执行面在 scripts/verify-tinyclick-golden.js。

import { MAX_PROMPT_TOKENS } from "./tinyclick-locator";

/** 命中容差（px）：frozen distPx 之上允许的漂移余量。 */
export const GOLDEN_DIST_TOLERANCE_PX = 2;
/** 延迟上界系数：totalMs ≤ frozen.totalMs × 1.5。 */
export const GOLDEN_LATENCY_FACTOR = 1.5;
/** 包线拒绝 reason 前缀（与 tinyclick-locator TINYCLICK_REASON 三值同源）。 */
export const ENVELOPE_SKIP_PREFIX = "tinyclick-envelope:";

// --- 数据形状（与 golden.json / g1-envelope-result*.json 对齐） ------------------

export interface GoldenCase {
  id: string;
  group: string;
  lang: string;
  image: string;
  command: string;
  gt: { cx: number; cy: number; w: number; h: number };
  input_ids: number[];
}

export interface FrozenAnchor {
  hit: boolean;
  distPx: number;
  totalMs: number;
  promptTokens?: number;
}

/** 生产侧一次 locate 的观测结果（脚本由 TinyClickLocator 输出折叠而来）。 */
export type GoldenObservation =
  | { kind: "skipped"; reason: string }
  | { kind: "error"; reason: string }
  | { kind: "hit"; point: { x: number; y: number }; totalMs: number };

export interface GoldenEvalOptions {
  maxPromptTokens?: number;
  distTolerancePx?: number;
  latencyFactor?: number;
}

export interface GoldenVerdict {
  id: string;
  status: "pass" | "fail" | "report";
  detail: string;
}

export interface GoldenSummary {
  total: number;
  pass: number;
  fail: number;
  report: number;
  /** fail === 0（report 不阻塞门禁）。 */
  ok: boolean;
}

// --- 纯函数 ----------------------------------------------------------------------

/** 与 tinyclick-locator.ts isAscii 同一规则（全字符 ∈ U+0000..U+007F）。 */
function isAscii(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[^\x00-\x7f]/.test(s);
}

/** 包线判定：ASCII 且 token 数 ≤ maxPromptTokens。 */
export function isEnvelopeIn(
  command: string,
  tokenCount: number,
  maxPromptTokens: number = MAX_PROMPT_TOKENS,
): boolean {
  return isAscii(command) && tokenCount <= maxPromptTokens;
}

/** 预测点到 gt 中心的欧氏距离（px）。 */
export function distToGtCenter(
  x: number,
  y: number,
  gt: { cx: number; cy: number },
): number {
  return Math.hypot(x - gt.cx, y - gt.cy);
}

/**
 * 单 case 判定。frozen 为对应臂（hybrid/int8）同 index 的冻结锚点，可 null。
 */
export function evaluateGoldenCase(
  c: GoldenCase,
  frozen: FrozenAnchor | null,
  obs: GoldenObservation,
  opts: GoldenEvalOptions = {},
): GoldenVerdict {
  const maxTokens = opts.maxPromptTokens ?? MAX_PROMPT_TOKENS;
  const tol = opts.distTolerancePx ?? GOLDEN_DIST_TOLERANCE_PX;
  const latFactor = opts.latencyFactor ?? GOLDEN_LATENCY_FACTOR;

  // 规则 1：包线外 → 必须 skipped 且 reason 前缀命中。
  if (!isEnvelopeIn(c.command, c.input_ids.length, maxTokens)) {
    if (obs.kind === "skipped" && obs.reason.startsWith(ENVELOPE_SKIP_PREFIX)) {
      return { id: c.id, status: "pass", detail: `envelope-out 拒绝正确（${obs.reason}）` };
    }
    const got =
      obs.kind === "skipped"
        ? `skipped 但 reason=${obs.reason}`
        : obs.kind === "error"
          ? `error(${obs.reason})`
          : `hit(${obs.point.x},${obs.point.y})`;
    return {
      id: c.id,
      status: "fail",
      detail: `envelope-out 必须 skipped(${ENVELOPE_SKIP_PREFIX}*)，实际 ${got}`,
    };
  }

  // 包线内。
  if (frozen === null) {
    // 规则 5（M2 fail-closed）：锚缺失 = 门禁配置缺陷，记 FAIL 不静默降级。
    return {
      id: c.id,
      status: "fail",
      detail: "包线内 frozen 锚缺失——fail-closed（锚按 id 键取，失配即门禁缺陷）",
    };
  }

  if (frozen.hit) {
    // 规则 2：frozen HIT → 必须 hit 且距离达标。
    if (obs.kind !== "hit") {
      const got =
        obs.kind === "skipped" ? `skipped(${obs.reason})` : `error(${obs.reason})`;
      return {
        id: c.id,
        status: "fail",
        detail: `frozen HIT(${frozen.distPx}px) 但 production ${got}`,
      };
    }
    const dist = distToGtCenter(obs.point.x, obs.point.y, c.gt);
    const limit = frozen.distPx + tol;
    if (dist > limit) {
      return {
        id: c.id,
        status: "fail",
        detail: `frozen HIT 漂移超限：dist=${dist.toFixed(1)}px > ${limit.toFixed(1)}px`,
      };
    }
    // 规则 4：延迟上界。
    const msLimit = frozen.totalMs * latFactor;
    if (obs.totalMs > msLimit) {
      return {
        id: c.id,
        status: "fail",
        detail: `延迟超限：totalMs=${obs.totalMs.toFixed(1)} > ${msLimit.toFixed(1)}（×${latFactor}）`,
      };
    }
    return {
      id: c.id,
      status: "pass",
      detail: `HIT dist=${dist.toFixed(1)}px ≤ ${limit.toFixed(1)}px，${obs.totalMs.toFixed(0)}ms`,
    };
  }

  // 规则 3：frozen MISS → 仅报告；error/skipped 视为诚实 MISS 放行。
  if (obs.kind === "hit") {
    const dist = distToGtCenter(obs.point.x, obs.point.y, c.gt);
    const msLimit = frozen.totalMs * latFactor;
    const latNote =
      obs.totalMs > msLimit
        ? `（注意：延迟 ${obs.totalMs.toFixed(1)} > ${msLimit.toFixed(1)}，frozen-MISS 不断言）`
        : "";
    return {
      id: c.id,
      status: "report",
      detail: `frozen MISS，production hit dist=${dist.toFixed(1)}px ${latNote}`.trim(),
    };
  }
  const got =
    obs.kind === "skipped" ? `skipped(${obs.reason})` : `error(${obs.reason})`;
  return { id: c.id, status: "pass", detail: `frozen MISS，production ${got}（诚实 MISS）` };
}

/** 汇总：fail === 0 即门禁通过（report 不阻塞）。 */
export function summarizeGolden(verdicts: readonly GoldenVerdict[]): GoldenSummary {
  let pass = 0;
  let fail = 0;
  let report = 0;
  for (const v of verdicts) {
    if (v.status === "pass") pass += 1;
    else if (v.status === "fail") fail += 1;
    else report += 1;
  }
  return { total: verdicts.length, pass, fail, report, ok: fail === 0 };
}

/**
 * frozen 锚索引（WP5 I3 对抗修复 M2）：g1-envelope-result*.json 的 golden 段
 * 以位置索引为键，但每条自带 id——按 id 重建键取，golden.json 增删重排不再
 * 静默错锚。id 缺失或重复 = 锚文件损坏，throw（脚本侧捕获 → exit 2）。
 */
export function indexFrozenAnchors(
  frozenGolden: Readonly<Record<string, FrozenAnchor & { id?: string }>>,
): Map<string, FrozenAnchor> {
  const map = new Map<string, FrozenAnchor>();
  for (const [key, entry] of Object.entries(frozenGolden)) {
    if (entry === null || typeof entry !== "object" || typeof entry.id !== "string" || entry.id === "") {
      throw new Error(`frozen 锚条目缺 id（键 ${key}）——锚文件损坏`);
    }
    if (map.has(entry.id)) {
      throw new Error(`frozen 锚 id 重复（${entry.id}）——锚文件损坏`);
    }
    map.set(entry.id, entry);
  }
  return map;
}
