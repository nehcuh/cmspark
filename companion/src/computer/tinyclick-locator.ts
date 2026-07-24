// WP5 I3 WI-3.1 — TinyClick 实验定位层（locate-chain L2 的唯一依赖，防信任放大闸口）。
//
// 职责（plan:454-456 + envelope §2 冻结常量）：
//   - 包线约束代码化（G2，禁文档级约束）——三类层内拒绝，各带结构化原因：
//       ① 非可打印 ASCII 命令 → tinyclick-envelope:non-ascii
//         （envelope §2.2：全部命中 case 纯 ASCII，zh 系统性失效已 S-3 冻结；
//          代码判定无需语言检测器；M3 收紧 0x20-0x7E——控制符/DEL 属未测区域）
//       ② prompt token >38   → tinyclick-envelope:too-long
//         （MAX_PROMPT_TOKENS=38 是「实测命中最大值」型 fail-closed 上限——>38
//          从未被扫描，属拒绝未测区域；I1 O-4 围栏：拒绝不截断，截断即静默换语义）
//       ③ 帧宽 >1920         → tinyclick-envelope:frame-too-wide
//         （S-3：3840 桌面降 768² 后图标 ~14px，训练分布外）
//     直接指称约束（动词白名单+单句+单目标）定位为文档级 OOD 排除——句式扫描证明
//     句式与命中无单调关系（envelope §2.3），不代码化、不做命中承诺。
//   - prompt 官方配方：buildCommandPrompt（session 内部同款）。本层为 token 计数
//     预检自行编码一次——相对 ~700ms 推理，二次编码代价可忽略，换层间接口干净。
//   - 显著点坍缩检测（G4）：「同帧 sha → 建议点历史」任务级追踪；同帧 + 不同命令 +
//     建议点欧氏距离 ≤8px → 抑制建议，reason tinyclick-collapse-detected（坍缩是
//     模型在无明显目标时的自欺形态，呈给人审会放大信任）。同命令重复不抑制（用户
//     连点同一按钮是合法形态）；frameSha 缺省时不读不写历史（同帧不可判定，不误伤
//     ——对抗面 4 追踪窗口纪律）。实例即任务级生命周期：session 可跨任务共享，
//     locator 每任务新建，历史随实例消亡（跨任务零泄漏）。
//   - confidence 契约（G3）：校准曲线落地前命中结果结构性无 confidence 字段——
//     类型上不存在，非「填 0 / 填 1」；时间线据此显「未校准」而非数字。
//   - 失败语义：ModelRuntimeError 三 code 直通为 skipped reason（model-disabled /
//     model-not-ready / tinyclick-busy——层不可用，链继续）；其余异常、解码失败、
//     point=null（非坐标输出）→ tinyclick-error 诚实失败，不编造坐标。

import type { CaptureMeta } from "./types";
import type { InferTimings } from "./tinyclick-protocol";
import { ModelRuntimeError, type TinyClickFrame } from "./tinyclick-runtime";
import { buildCommandPrompt, type TinyClickTokenizer } from "./tinyclick-tokenizer";
import type { TinyClickLocateResult, TinyClickSession } from "./tinyclick-session";

/** envelope §2 冻结常量（I3 代码化锚点；改值 = 契约变更，须重跑 G1 包线扫描）。 */
export const MAX_PROMPT_TOKENS = 38;
export const MAX_FRAME_WIDTH = 1920;
export const COLLAPSE_TOLERANCE_PX = 8;

/** skipped reason 词表（plan:458 明定，chain 直通为 attempt.reason）。 */
export const TINYCLICK_REASON = {
  NON_ASCII: "tinyclick-envelope:non-ascii",
  TOO_LONG: "tinyclick-envelope:too-long",
  FRAME_TOO_WIDE: "tinyclick-envelope:frame-too-wide",
  COLLAPSE: "tinyclick-collapse-detected",
  ERROR: "tinyclick-error",
} as const;

export type TinyClickLocateOutcome =
  | {
      kind: "hit";
      point: { x: number; y: number };
      tokenIds: number[];
      prompt: string;
      timings: InferTimings;
      // G3：故意无 confidence 字段——校准前不返数值置信度（类型系统强制）。
    }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; reason: string };

/** 坍缩历史条目（同帧已发建议点；command 用于「同命令不抑制」判定）。 */
export interface CollapseRecord {
  command: string;
  x: number;
  y: number;
}

export interface TinyClickLocatorDeps {
  /** 会话（懒加载/单飞/熔断在 runtime 内）；测试注入 fake。 */
  session: Pick<TinyClickSession, "locate">;
  /** 与 session 同一 tokenizer（token 计数预检与推理编码零分叉）。 */
  tokenizer: TinyClickTokenizer;
  /** PNG → RGBA 帧解码（生产实现 WI-3.3 接线；测试注入 fake）。 */
  decodeFrame: (shot: CaptureMeta) => Promise<TinyClickFrame>;
  /** 坍缩历史（frameSha → 建议点序列）；缺省实例内新建（=任务级）。 */
  collapseHistory?: Map<string, CollapseRecord[]>;
  /** 以下为包线常量覆盖口（测试/复测用；生产勿用，改值即契约变更）。 */
  maxPromptTokens?: number;
  maxFrameWidth?: number;
  collapseTolerancePx?: number;
}

/**
 * 可打印 ASCII 判定（envelope §2.2 可判定子集；空串视为通过，token 检查在后方拦）。
 * WP5 I3 对抗修复 M3（P3-c）：收紧为可打印 0x20-0x7E——G1 命中证据全为可打印
 * 英文，C0 控制符（0x00-0x1F）与 DEL（0x7F）属「测量包线外」未测区域，
 * fail-closed 拒绝（reason 复用 non-ascii，与「拒绝未测区域」常量语义自洽）。
 */
function isAscii(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[^\x20-\x7e]/.test(s);
}

export class TinyClickLocator {
  private readonly session: Pick<TinyClickSession, "locate">;
  private readonly tokenizer: TinyClickTokenizer;
  private readonly decodeFrame: (shot: CaptureMeta) => Promise<TinyClickFrame>;
  private readonly history: Map<string, CollapseRecord[]>;
  private readonly maxPromptTokens: number;
  private readonly maxFrameWidth: number;
  private readonly collapseTolerancePx: number;

  constructor(deps: TinyClickLocatorDeps) {
    this.session = deps.session;
    this.tokenizer = deps.tokenizer;
    this.decodeFrame = deps.decodeFrame;
    this.history = deps.collapseHistory ?? new Map();
    this.maxPromptTokens = deps.maxPromptTokens ?? MAX_PROMPT_TOKENS;
    this.maxFrameWidth = deps.maxFrameWidth ?? MAX_FRAME_WIDTH;
    this.collapseTolerancePx = deps.collapseTolerancePx ?? COLLAPSE_TOLERANCE_PX;
  }

  /**
   * 定位一次：包线检查 → 解码 → 推理 → 坍缩检测。
   * 永不 throw——一切失败折叠为 skipped/error 结构化原因，链继续降级。
   */
  async locate(args: { command: string; shot: CaptureMeta }): Promise<TinyClickLocateOutcome> {
    const { command, shot } = args;

    // ① 非 ASCII 拒绝（zh 命令即使 tok≤38 也系统性 MISS——envelope §2.1 注记）
    if (!isAscii(command)) {
      return { kind: "skipped", reason: TINYCLICK_REASON.NON_ASCII };
    }
    // ② token 上限（拒绝不截断；length 含 [0,...,2] 包装，与 G1 冻结测量口径一致）
    const prompt = buildCommandPrompt(command);
    if (this.tokenizer.encode(prompt).length > this.maxPromptTokens) {
      return { kind: "skipped", reason: TINYCLICK_REASON.TOO_LONG };
    }
    // ③ 解码 + 帧宽上限（解码失败 = 层内诚实失败，不外抛）
    let frame: TinyClickFrame;
    try {
      frame = await this.decodeFrame(shot);
    } catch {
      return { kind: "error", reason: TINYCLICK_REASON.ERROR };
    }
    if (frame.width > this.maxFrameWidth) {
      return { kind: "skipped", reason: TINYCLICK_REASON.FRAME_TOO_WIDE };
    }

    // 推理（ModelRuntimeError 三 code 直通；其余折叠 tinyclick-error）
    let out: TinyClickLocateResult;
    try {
      out = await this.session.locate(command, frame);
    } catch (err) {
      if (
        err instanceof ModelRuntimeError &&
        (err.code === "model-disabled" || err.code === "model-not-ready" || err.code === "tinyclick-busy")
      ) {
        return { kind: "skipped", reason: err.code };
      }
      return { kind: "error", reason: TINYCLICK_REASON.ERROR };
    }
    // 非坐标输出：诚实失败，不编造坐标（runtime 已保证不编造，本层不再二次解读）
    if (!out.point) {
      return { kind: "error", reason: TINYCLICK_REASON.ERROR };
    }

    // 坍缩检测（同帧 + 异命令 + 同点 ≤8px 才抑制；同命令/跨帧不误伤）
    const frameSha = shot.sha256;
    if (frameSha) {
      const records = this.history.get(frameSha) ?? [];
      const collapsed = records.some(
        (prev) =>
          prev.command !== command &&
          Math.hypot(prev.x - out.point!.x, prev.y - out.point!.y) <= this.collapseTolerancePx,
      );
      if (collapsed) {
        return { kind: "skipped", reason: TINYCLICK_REASON.COLLAPSE };
      }
      records.push({ command, x: out.point.x, y: out.point.y });
      this.history.set(frameSha, records);
    }

    return {
      kind: "hit",
      point: out.point,
      tokenIds: out.tokenIds,
      prompt: out.prompt,
      timings: out.timings,
    };
  }
}
