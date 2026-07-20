// WP5-I4 WI-4.3 — TinyClick 实验层 admission 组装（per-task 评估，server.ts
// host_computer 调用点在 runComputerTask 前 await 本模块）。
//
// 判定序（全 fail-closed；任一不过 → {locator:null, reason}，UIA/OCR/框选链
// 不受影响，locate-chain 记 attempts skipped model-disabled）：
//   ① modelEnabled!==true → model-switch-off（含 P9 手改 config=true 形态——
//     启动期 normalize loud log 已留痕；下方②③许可门照样拦，与 D2 先例一致：
//     开关只是 admission 的一票，不是唯一一票）
//   ② modelLicenseDeclined===true → model-license-declined（永久跳过）
//   ③ !modelLicenseAccepted（时间戳+文本哈希双要素，P1 漂移重门在 admission
//     侧比对——plan:572 明定）→ model-license-not-accepted
//   ④ 既有会话熔断（getStatus()==="disabled"）→ model-circuit-disabled
//     （复位路径 = 设置页 reset_circuit_breaker，I3 围栏不变）
//   ⑤ 无会话 → 单飞懒建（WeakMap<holder, Promise>）：manifest 加载 +
//     tokenizer 复验 + TinyClickSession.prepare()（I1 校验即加载 ~1.4s，
//     705MB 逐文件 sha256 无缓存）。失败 → model-build-failed + loud log，
//     holder 不写入，下个任务重试（build 失败多为文件缺失/哈希漂移/
//     磁盘错误，fail-closed 重试语义诚实；成本仅在任务起点，可观测）。
// 全通过 → holder.session=session（P8 写入点①），每任务新建
// TinyClickLocator（坍缩历史任务级随实例消亡，locator 头注释既定语义）。
//
// tokenizer 零分叉契约：locator 的 token 预检编码必须与 session 推理编码同一
// 实例（locator deps 注释明定）。构建期经 sessionMeta WeakMap 留存配对；
// 外来会话（非本模块构建——仅测试注入形态存在，P8 写入点③）无留存 →
// fail-closed model-session-foreign（无法保证同实例，宁可不开层）。
//
// 竞态处理：
//   - 并发首建：WeakMap 单飞，sessionFactory 只调一次，两调用方各拿独立
//     locator（历史不共享）。
//   - build 落地 × 用户关闭：disable/delete 在 build 飞行中会把 holder 置空，
//     build 完成后若直接写 holder 即会话泄漏（开关已关、~1.3GB RSS 常驻）。
//     落地前经 deps.stillEnabled() 新鲜度复核（生产 = getConfig() 重读）；
//     已关 → 立即 dispose 新建会话、不写 holder（P2 per-task 语义只覆盖
//     「任务运行中」的 locator 使用，不覆盖落地竞态）。
//   - dispose 撕毁 in-flight infer 的尾随失败不计熔断（runtime P4 豁免）。

import * as fs from "node:fs";
import * as path from "node:path";

import { logger } from "../logger";
import type { ComputerConfig } from "../config";
import {
  defaultManifestPath,
  modelLicenseAccepted,
  type ComputerModelSessionHolder,
} from "./model-handlers";
import { loadModelManifest, type ModelManifest } from "./model-manifest";
import { decodePngToRgba } from "./png-decode";
import { TinyClickLocator } from "./tinyclick-locator";
import type { TinyClickFrame } from "./tinyclick-runtime";
import {
  loadVerifiedTokenizer,
  TinyClickSession,
  type TinyClickSessionDeps,
} from "./tinyclick-session";
import type { TinyClickTokenizer } from "./tinyclick-tokenizer";
import type { CaptureMeta } from "./types";

/** admission 拒绝原因词表（稳定契约；server.ts/测试断言按此比对）。 */
export const ADMISSION_REASON = {
  SWITCH_OFF: "model-switch-off",
  LICENSE_DECLINED: "model-license-declined",
  LICENSE_NOT_ACCEPTED: "model-license-not-accepted",
  CIRCUIT_DISABLED: "model-circuit-disabled",
  BUILD_FAILED: "model-build-failed",
  SESSION_FOREIGN: "model-session-foreign",
} as const;

/** admission 侧会话最小面（holder 四方法 + locate/prepare 构建期需要）。 */
export type AdmissionSession = Pick<
  TinyClickSession,
  "locate" | "prepare" | "getStatus" | "getFaults" | "resetCircuitBreaker" | "dispose"
>;

export interface TinyClickAdmissionDeps {
  manifestLoader?: () => Promise<ModelManifest>;
  /** 默认：loadVerifiedTokenizer（manifest 登记哈希复验 bundled asset）。 */
  tokenizerLoader?: (manifest: ModelManifest, variant: string) => Promise<TinyClickTokenizer>;
  sessionFactory?: (deps: TinyClickSessionDeps) => AdmissionSession;
  /** 默认：读 shot.path（采集 PNG）→ decodePngToRgba。 */
  decodeFrame?: (shot: CaptureMeta) => Promise<TinyClickFrame>;
  /** 熔断广播等 runtime 事件的透传口（生产 = WS broadcast 包装）。 */
  broadcast?: (msg: unknown) => void;
  log?: (event: string, payload: Record<string, unknown>) => void;
  /**
   * build 落地 × 用户关闭竞态的新鲜度复核（生产 = getConfig() 重读
   * modelEnabled）；缺省 () => true（无复核——测试/纯函数用法）。
   */
  stillEnabled?: () => boolean;
}

export interface TinyClickAdmission {
  locator: Pick<TinyClickLocator, "locate"> | null;
  /** locator 为 null 时的稳定原因（ADMISSION_REASON 词表）。 */
  reason?: string;
}

/** bundled tokenizer.json 随发版路径解析（与 defaultManifestPath 同型三候选）。 */
export function defaultTokenizerPath(): string {
  const candidates = [
    path.join(__dirname, "..", "..", "assets", "tinyclick", "tokenizer.json"), // src 布局
    path.join(__dirname, "..", "..", "..", "assets", "tinyclick", "tokenizer.json"), // .test-dist 布局
    path.join(__dirname, "assets", "tinyclick", "tokenizer.json"), // bundle 同级（assets 随包）
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]!;
}

/** 生产 decodeFrame：采集 PNG（shot.path）→ RGBA 帧（png-decode 最小解码器）。 */
async function defaultDecodeFrame(shot: CaptureMeta): Promise<TinyClickFrame> {
  const bytes = await fs.promises.readFile(shot.path);
  return decodePngToRgba(bytes);
}

/** 构建期配对留存（session → 同实例 tokenizer/locate）；WeakMap 随会话消亡。 */
const sessionMeta = new WeakMap<
  object,
  { tokenizer: TinyClickTokenizer; locate: TinyClickSession["locate"] }
>();

/** 并发首建单飞（holder 粒度；P10 同型——防并发不防轮询，轮询成本=任务起点一次复验）。 */
const inFlightBuilds = new WeakMap<ComputerModelSessionHolder, Promise<AdmissionSession | null>>();

async function buildSession(
  cfg: ComputerConfig,
  deps: TinyClickAdmissionDeps,
  log: (event: string, payload: Record<string, unknown>) => void,
): Promise<AdmissionSession | null> {
  try {
    const manifest = await (
      deps.manifestLoader ?? (() => loadModelManifest(defaultManifestPath()))
    )();
    const variant = cfg.modelVariant ?? "hybrid";
    const tokenizer = await (
      deps.tokenizerLoader ??
      ((m: ModelManifest, v: string) => loadVerifiedTokenizer(m, "tinyclick", v, defaultTokenizerPath()))
    )(manifest, variant);
    const session = (deps.sessionFactory ?? ((d: TinyClickSessionDeps) => new TinyClickSession(d)))({
      manifest,
      tokenizer,
      variant,
      broadcast: deps.broadcast,
      log,
    });
    // I1 校验即加载（逐文件 sha256，无缓存）+ warmup；失败原样抛出走 catch
    await session.prepare();
    sessionMeta.set(session, { tokenizer, locate: session.locate.bind(session) });
    log("computer.model.admission.ready", { variant });
    return session;
  } catch (err) {
    // I1 三态（ModelGateError）/ load-failed / manifest invalid / 文件缺失
    // / tokenizer 复验失败 —— 全部 fail-closed：loud log 留痕，holder 不写入。
    log("computer.model.admission.failed", {
      code:
        err instanceof Error && "code" in err
          ? String((err as { code?: string }).code)
          : "build-error",
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * per-task admission 评估。调用点 async 可 await（会话懒建 ~1.4s 仅在全通过
 * 且首次时发生；既有会话命中 = 同步快路径）。
 */
export async function resolveTinyClickAdmission(args: {
  config: ComputerConfig | undefined;
  holder: ComputerModelSessionHolder;
  deps?: TinyClickAdmissionDeps;
}): Promise<TinyClickAdmission> {
  const cfg = args.config;
  const deps = args.deps ?? {};
  const log =
    deps.log ?? ((event: string, payload: Record<string, unknown>) => logger.info(event, payload));
  const refuse = (reason: string): TinyClickAdmission => ({ locator: null, reason });

  // ①②③ 配置门（per-task 重评：用户任务间改配置立即生效，P2）
  if (cfg?.modelEnabled !== true) return refuse(ADMISSION_REASON.SWITCH_OFF);
  if (cfg.modelLicenseDeclined === true) return refuse(ADMISSION_REASON.LICENSE_DECLINED);
  if (!modelLicenseAccepted(cfg)) return refuse(ADMISSION_REASON.LICENSE_NOT_ACCEPTED);

  const decodeFrame = deps.decodeFrame ?? defaultDecodeFrame;
  const buildLocator = (session: AdmissionSession): TinyClickAdmission => {
    const meta = sessionMeta.get(session);
    if (!meta) return refuse(ADMISSION_REASON.SESSION_FOREIGN);
    // 每任务新建 locator（坍缩历史任务级；session 共享是 I2 既定语义）
    return {
      locator: new TinyClickLocator({
        session: { locate: meta.locate },
        tokenizer: meta.tokenizer,
        decodeFrame,
      }),
    };
  };

  // ④ 既有会话快路径（熔断 refuse；外来会话 refuse）
  const existing = args.holder.session;
  if (existing) {
    if (existing.getStatus() === "disabled") return refuse(ADMISSION_REASON.CIRCUIT_DISABLED);
    // holder 四方法 Pick 无 locate——经 meta 取回构建期配对的同实例绑定
    return buildLocator(existing as AdmissionSession);
  }

  // ⑤ 单飞懒建（并发首建共享同一 Promise；sessionFactory 只调一次）
  let build = inFlightBuilds.get(args.holder);
  if (!build) {
    build = buildSession(cfg, deps, log);
    inFlightBuilds.set(args.holder, build);
  }
  const session = await build;
  inFlightBuilds.delete(args.holder);
  if (!session) return refuse(ADMISSION_REASON.BUILD_FAILED);
  // 落地 × 关闭竞态：复核失败 → 立即 dispose，不写 holder（见文件头注释）
  if (!(deps.stillEnabled ?? (() => true))()) {
    try {
      await session.dispose();
    } catch {
      /* best-effort dispose */
    }
    log("computer.model.admission.discarded", { reason: "disabled-during-build" });
    return refuse(ADMISSION_REASON.SWITCH_OFF);
  }
  args.holder.session = session; // P8 写入点①：admission 全通过懒建
  return buildLocator(session);
}
