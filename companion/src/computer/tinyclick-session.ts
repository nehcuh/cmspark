// WP5 I2 WI-2.4 — TinyClick 会话封装（tokenizer + runtime 一体，handlers 的唯一入口）。
//
// 职责：
//   - locate(command, frame)：官方 prompt 配方 → BPE 编码 → runtime.infer → 结果回传。
//     非坐标输出 point=null 诚实失败（不编造坐标，locate-chain 据此回退其他层）。
//   - 变体选择：默认 hybrid；computer.modelVariant 请求值存在于 manifest 则使用，
//     不存在 → loud log 回退 hybrid（变体是性能选择不是信任边界，回退不 fail-closed；
//     但 hybrid 本身缺失会在 prepare 以 load-failed 结构化失败）。
//   - tokenizer 加载绑定 manifest：bundled assets/tinyclick/tokenizer.json 经
//     loadVerifiedFileBytes 按 manifest 登记 sha256/size 复验（I1 同 buffer 契约）——
//     随包资产被篡改同样 fail-closed，与下载模型同一信任叙事。
//   - 会话复用：多次 locate 共享同一 TinyClickRuntime（worker/会话只建一次，
//     测试锁定 load 仅一次）。

import { loadVerifiedFileBytes, type ModelManifest } from "./model-manifest";
import {
  ModelRuntimeError,
  TinyClickRuntime,
  type RuntimeStatus,
  type TinyClickFrame,
  type TinyClickRuntimeDeps,
  type TinyClickInferResult,
} from "./tinyclick-runtime";
import {
  buildCommandPrompt,
  loadTokenizerFromJson,
  type TinyClickTokenizer,
} from "./tinyclick-tokenizer";

export interface TinyClickLocateResult extends TinyClickInferResult {
  /** 实际使用的 prompt（官方配方后）。 */
  prompt: string;
  /** BPE 编码后的 input_ids（含 [0,...,2] 包装）。 */
  inputIds: number[];
}

export interface TinyClickSessionDeps
  extends Omit<TinyClickRuntimeDeps, "manifest" | "variant" | "modelId"> {
  manifest: ModelManifest;
  tokenizer: TinyClickTokenizer;
  modelId?: string;
  /** 请求变体（computer.modelVariant）；缺省 "hybrid"，不存在 → 回退 hybrid + loud log。 */
  variant?: string;
  /** 测试注入 runtime；缺省内部构造。 */
  runtime?: TinyClickRuntime;
}

/** 变体解析：默认 hybrid；请求值不在 manifest → loud log 回退 hybrid。 */
export function resolveModelVariant(
  requested: string | undefined,
  manifest: ModelManifest,
  modelId: string,
  log: (event: string, payload: Record<string, unknown>) => void = () => {},
): string {
  const variants = manifest.models[modelId]?.variants ?? {};
  if (requested === undefined || requested === "") return "hybrid";
  if (variants[requested] !== undefined) return requested;
  log("computeruse.model.variant-fallback", {
    modelId,
    requested,
    using: "hybrid",
    reason: "variant-unknown",
  });
  return "hybrid";
}

/**
 * 加载并复验 bundled tokenizer.json：按 manifest 登记的 tokenizer.json 条目
 * （sha256/size）校验文件字节——随包资产与下载模型同一信任叙事（I1 纪律 3）。
 */
export async function loadVerifiedTokenizer(
  manifest: ModelManifest,
  modelId: string,
  variant: string,
  tokenizerPath: string,
): Promise<TinyClickTokenizer> {
  const entry = manifest.models[modelId]?.variants[variant]?.files.find(
    (f) => f.name === "tokenizer.json",
  );
  if (!entry) {
    throw new ModelRuntimeError(
      "load-failed",
      `manifest 变体 ${variant} 缺少 tokenizer.json 条目（发版内容异常）`,
    );
  }
  const buf = await loadVerifiedFileBytes(tokenizerPath, {
    sha256: entry.sha256,
    size: entry.size,
  });
  return loadTokenizerFromJson(buf.toString("utf-8"));
}

export class TinyClickSession {
  readonly modelId: string;
  readonly variant: string;
  private readonly tokenizer: TinyClickTokenizer;
  private readonly runtime: TinyClickRuntime;

  constructor(deps: TinyClickSessionDeps) {
    this.modelId = deps.modelId ?? "tinyclick";
    const log = deps.log ?? (() => {});
    this.variant = resolveModelVariant(deps.variant, deps.manifest, this.modelId, log);
    this.tokenizer = deps.tokenizer;
    this.runtime =
      deps.runtime ??
      new TinyClickRuntime({
        manifest: deps.manifest,
        modelId: this.modelId,
        variant: this.variant,
        modelDir: deps.modelDir,
        workerFactory: deps.workerFactory,
        workerSource: deps.workerSource,
        broadcast: deps.broadcast,
        log: deps.log,
        cpuModel: deps.cpuModel,
        inferTimeoutMs: deps.inferTimeoutMs,
        loadTimeoutMs: deps.loadTimeoutMs,
        createBudgetMs: deps.createBudgetMs,
        maxFaults: deps.maxFaults,
      });
  }

  /** 懒加载（首次 locate 也会自动触发；显式调用可提前暖机）。 */
  prepare(): Promise<void> {
    return this.runtime.prepare();
  }

  /**
   * 定位一次：command → prompt → input_ids → 推理。
   * 失败语义全部透传 runtime（model-disabled/model-not-ready/tinyclick-busy/
   * infer-timeout/worker-error + I1 三态），handlers/locate-chain 按 code 分支。
   */
  async locate(command: string, frame: TinyClickFrame): Promise<TinyClickLocateResult> {
    const prompt = buildCommandPrompt(command);
    const inputIds = this.tokenizer.encode(prompt);
    const out = await this.runtime.infer(frame, inputIds);
    return { prompt, inputIds, ...out };
  }

  getStatus(): RuntimeStatus {
    return this.runtime.getStatus();
  }

  getFaults(): number {
    return this.runtime.getFaults();
  }

  resetCircuitBreaker(): void {
    this.runtime.resetCircuitBreaker();
  }

  dispose(): Promise<void> {
    return this.runtime.dispose();
  }
}
