// WP5 I2 WI-2.1 — TinyClick 推理 runtime（主线程封装：懒加载/单飞/熔断/拓扑）。
//
// 职责（plan WP5 I2 + W2/W1 证据）：
//   - 懒加载：首次 infer 才 prepare；prepare 全流程 = I1 复验读盘 → transfer 字节 →
//     spawn worker → load（会话创建）→ warmup 推理一次（ORT arena 预分配，M6/P3-b）。
//     每次 prepare 都重新 loadVerifiedFileBytes——无「已校验」缓存（I1 纪律 3），且
//     transfer 后 ArrayBuffer 已 detach，重建必须重读。
//   - 单飞（M5）：上一帧未完成的并发 infer 直接拒绝 tinyclick-busy；并发 prepare
//     共享同一 warmingPromise（经典 single-flight）。
//   - 熔断（M3/M6）：推理期故障（超时/worker error/worker exit/warmup 失败）计数，
//     faults ≥ maxFaults（默认 3）→ disabled + 审计 computeruse.model.disabled +
//     广播 computer.model.state {modelStatus:"disabled", reason:"circuit-breaker"}。
//     冷启动 load 超时不计熔断（M6：首次加载慢是已知包线项，非推理不稳）。
//     【与 plan 的偏差声明】plan 写「连续两次后强制手动」，本实现从严：熔断一旦触发
//     只能 resetCircuitBreaker() 手动复位，无自动恢复。
//   - 重建策略：故障后 terminate worker、懒重建（下次 infer 重新 prepare）；重建期
//     infer fail-fast（model-not-ready），不排队。
//   - 拓扑（W2 教训）：intraOpNumThreads 按 CPU 型号表取 P 核数，无命中回退保守 4——
//     plan 明令禁用 ORT 默认值（实测默认 5.4s vs 显式 1.8s）。
//
// 打包（SEA）：worker 以旁置 tinyclick-worker.js 读文本 eval 方式加载（与 ORT dll
// 旁置同安全级，决策已定不做 codegen 内联）；ps1 接线在 WI-2.5。
//
// 诚实失败：模型返回非坐标 token 序列时 point/locBins 为 null（parseLocBins），
// runtime 不编造坐标；locate-chain 据此回退其他定位层。

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { loadVerifiedFileBytes, modelDirFor, type ModelManifest } from "./model-manifest";
import type { InferTimings, WorkerRequest, WorkerResponse } from "./tinyclick-protocol";

// --- 错误与状态 ---------------------------------------------------------------

/** runtime 结构化错误。code 词表即协议（handlers/locate-chain 据此分支）。 */
export class ModelRuntimeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelRuntimeError";
    this.code = code;
  }
}

export type RuntimeStatus = "idle" | "warming" | "warm" | "rebuilding" | "disabled";

// --- worker 抽象（测试注入 fake） ----------------------------------------------

export interface WorkerLike {
  postMessage(msg: WorkerRequest, transferList?: ArrayBuffer[]): void;
  terminate(): Promise<number> | void;
  on(event: "message", cb: (msg: WorkerResponse) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  on(event: "exit", cb: (code: number) => void): unknown;
}

/** worker 加载方式：dev=编译产物路径；SEA=旁置文件读文本 eval。 */
export type WorkerSource = { kind: "path"; path: string } | { kind: "eval"; source: string };

export interface TinyClickRuntimeDeps {
  manifest: ModelManifest;
  /** manifest.models 的键，默认 "tinyclick"。 */
  modelId?: string;
  /** 交付变体，默认 "hybrid"（int8 备选，WI-2.4 封装选择逻辑）。 */
  variant?: string;
  /** 模型目录，默认 modelDirFor(variant)。 */
  modelDir?: string;
  /** 测试注入 fake worker；缺省用 node:worker_threads 真实 Worker。 */
  workerFactory?: (source: WorkerSource) => WorkerLike;
  /** 测试注入 worker 源；缺省按 SEA/dev 自动解析。 */
  workerSource?: WorkerSource;
  /** handlers 广播钩子（computer.model.state）。 */
  broadcast?: (msg: unknown) => void;
  /** 审计钩子（computeruse.model.* 事件，同 model-download 惯例）。 */
  log?: (event: string, payload: Record<string, unknown>) => void;
  /** 拓扑测试注入；缺省 os.cpus()[0].model。 */
  cpuModel?: string;
  /** 单帧推理超时（默认 5000ms，超时 terminate + 计熔断）。 */
  inferTimeoutMs?: number;
  /** 冷启动 load 超时（默认 30000ms，不计熔断，M6）。 */
  loadTimeoutMs?: number;
  /** 会话创建预算（默认 2200ms，hybrid 实测 ~1.4-1.5s；超出仅 loud log 告警）。 */
  createBudgetMs?: number;
  /** 熔断阈值（默认 3 次推理期故障）。 */
  maxFaults?: number;
}

export interface TinyClickFrame {
  /** RGBA 字节；所有权随 transfer 转移给 worker（调用方事后不得复用该 buffer）。 */
  rgba: Uint8Array | ArrayBuffer;
  width: number;
  height: number;
}

export interface TinyClickInferResult {
  tokenIds: number[];
  locBins: [number, number] | null;
  point: { x: number; y: number } | null;
  timings: InferTimings;
}

// --- 常量 ---------------------------------------------------------------------

const SESSION_KEYS = ["vision_encoder", "embed_tokens", "encoder_model", "decoder_model"] as const;
type SessionKey = (typeof SESSION_KEYS)[number];

/** warmup 固定输入（s1 官方模板，w2-worker.js:135 同款硬编码；仅用于 arena 预分配）。 */
const WARMUP_INPUT_IDS: ReadonlyArray<number> = [
  0, 12196, 7, 109, 7, 11189, 5, 5936, 116, 3753, 15, 5, 15983, 6148, 2,
];

/** CPU 型号 → P 核数（W2 实测对照表；无命中回退保守 4，禁 ORT 默认值）。 */
const P_CORE_TABLE: ReadonlyArray<readonly [string, number]> = [
  ["14900", 8],
  ["14700", 8],
  ["13900", 8],
  ["13700", 8],
  ["14600", 6],
  ["13600", 6],
  ["12600", 6],
  ["285K", 8],
  ["265K", 8],
];

export function resolveIntraOpThreads(cpuModel?: string): number {
  const model = cpuModel ?? os.cpus()[0]?.model ?? "";
  for (const [pattern, cores] of P_CORE_TABLE) {
    if (model.includes(pattern)) return cores;
  }
  return 4;
}

/** Buffer/Uint8Array → 可 transfer 的 ArrayBuffer（对齐零拷贝，不对齐 slice 一次）。 */
function toTransferableArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? (view.buffer as ArrayBuffer)
    : (view.buffer as ArrayBuffer).slice(view.byteOffset, view.byteOffset + view.byteLength);
}

// --- 默认 worker 工厂（SEA 旁置 eval / dev 路径） --------------------------------

function defaultWorkerSource(): WorkerSource {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sea = require("node:sea") as { isSea?: () => boolean } | null;
    if (sea?.isSea?.()) {
      const sidecar = path.join(path.dirname(process.execPath), "tinyclick-worker.js");
      return { kind: "eval", source: fs.readFileSync(sidecar, "utf-8") };
    }
  } catch {
    // node:sea 不可用（非 SEA 模式）→ dev 路径
  }
  return { kind: "path", path: path.join(__dirname, "tinyclick-worker.js") };
}

function defaultWorkerFactory(source: WorkerSource): WorkerLike {
  return source.kind === "path"
    ? (new Worker(source.path) as unknown as WorkerLike)
    : (new Worker(source.source, { eval: true }) as unknown as WorkerLike);
}

// --- runtime --------------------------------------------------------------------

interface PendingEntry {
  worker: WorkerLike;
  timer: NodeJS.Timeout;
  resolve: (msg: WorkerResponse) => void;
  reject: (err: Error) => void;
}

export class TinyClickRuntime {
  private status: RuntimeStatus = "idle";
  private faults = 0;
  private hadFault = false;
  private disposed = false;
  private worker: WorkerLike | null = null;
  private warmingPromise: Promise<void> | null = null;
  private inFlightId: number | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingEntry>();
  private readonly expectedExits = new Set<WorkerLike>();
  /** 已 terminate 的 worker（永不删除，幂等依据；与 expectedExits 分工：后者判 exit 事件是否预期）。 */
  private readonly terminatedWorkers = new Set<WorkerLike>();

  private readonly manifest: ModelManifest;
  private readonly modelId: string;
  private readonly variant: string;
  private readonly modelDir: string;
  private readonly intraOp: number;
  private readonly inferTimeoutMs: number;
  private readonly loadTimeoutMs: number;
  private readonly createBudgetMs: number;
  private readonly maxFaults: number;
  private readonly workerFactory: (source: WorkerSource) => WorkerLike;
  private readonly workerSource?: WorkerSource;
  private readonly broadcast?: (msg: unknown) => void;
  private readonly log: (event: string, payload: Record<string, unknown>) => void;

  constructor(deps: TinyClickRuntimeDeps) {
    this.manifest = deps.manifest;
    this.modelId = deps.modelId ?? "tinyclick";
    this.variant = deps.variant ?? "hybrid";
    this.modelDir = deps.modelDir ?? modelDirFor(this.variant);
    this.intraOp = resolveIntraOpThreads(deps.cpuModel);
    this.inferTimeoutMs = deps.inferTimeoutMs ?? 5000;
    this.loadTimeoutMs = deps.loadTimeoutMs ?? 30000;
    this.createBudgetMs = deps.createBudgetMs ?? 2200;
    this.maxFaults = deps.maxFaults ?? 3;
    this.workerFactory = deps.workerFactory ?? defaultWorkerFactory;
    this.workerSource = deps.workerSource;
    this.broadcast = deps.broadcast;
    this.log = deps.log ?? (() => {});
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  getFaults(): number {
    return this.faults;
  }

  /** 手动复位熔断（M3 从严：无自动恢复）。复位后可重新 prepare。 */
  resetCircuitBreaker(): void {
    this.faults = 0;
    if (this.status === "disabled") this.status = "idle";
    this.log("computeruse.model.circuit-reset", { modelId: this.modelId, variant: this.variant });
  }

  /** 关闭：terminate worker 并拒绝后续调用。 */
  async dispose(): Promise<void> {
    this.disposed = true;
    const w = this.worker;
    this.worker = null;
    if (w) this.terminateWorker(w);
    this.status = "idle";
  }

  /**
   * 懒加载入口：并发调用共享同一 warmingPromise（single-flight）。
   * disabled/disposed → model-disabled；已 warm → 立即返回。
   */
  prepare(): Promise<void> {
    if (this.disposed || this.status === "disabled") {
      return Promise.reject(
        new ModelRuntimeError("model-disabled", "模型层已禁用（熔断或手动关闭），UIA/OCR/云端定位不受影响"),
      );
    }
    if (this.status === "warm") return Promise.resolve();
    if (this.warmingPromise) return this.warmingPromise;
    this.warmingPromise = this.doPrepare().finally(() => {
      this.warmingPromise = null;
    });
    return this.warmingPromise;
  }

  /**
   * 单帧推理（单飞 M5）。
   * - disabled → model-disabled；warming/rebuilding → model-not-ready（fail-fast 不排队）；
   * - idle → 懒 prepare；warm 但上一帧未完成 → tinyclick-busy。
   * - 超时 → terminate + 计熔断 + 懒重建；worker 进程级故障同样计熔断。
   */
  async infer(frame: TinyClickFrame, inputIds: number[]): Promise<TinyClickInferResult> {
    if (this.disposed || this.status === "disabled") {
      throw new ModelRuntimeError("model-disabled", "模型层已禁用（熔断或手动关闭），UIA/OCR/云端定位不受影响");
    }
    if (this.status === "warming" || this.status === "rebuilding") {
      throw new ModelRuntimeError("model-not-ready", "模型加载/重建中，本次请求已快速失败（不排队）");
    }
    if (this.status === "idle") {
      await this.prepare(); // 失败原样抛出（ModelGateError 三态或 ModelRuntimeError）
    }
    if (this.inFlightId !== null) {
      throw new ModelRuntimeError("tinyclick-busy", "上一帧推理未完成（单飞），本次请求被拒绝");
    }
    const worker = this.worker;
    if (!worker) {
      // 不变量保护：warm 必有 worker；走到此即内部状态损坏，按故障处理
      this.registerFault("worker-missing", new Error("warm 状态无 worker"));
      throw new ModelRuntimeError("worker-error", "内部状态异常：worker 缺失");
    }

    const rgbaAb =
      frame.rgba instanceof ArrayBuffer ? frame.rgba : toTransferableArrayBuffer(frame.rgba);
    const id = this.nextId++;
    this.inFlightId = id;
    try {
      const msg = await this.sendRequest(
        worker,
        { type: "infer", id, rgba: rgbaAb, width: frame.width, height: frame.height, inputIds },
        [rgbaAb],
        this.inferTimeoutMs,
        "infer-timeout",
        `推理超时（>${this.inferTimeoutMs}ms），已 terminate worker 并计入熔断`,
        "infer",
      );
      if (msg.type !== "result") {
        throw new ModelRuntimeError("worker-error", `worker 返回意外消息: ${msg.type}`);
      }
      return {
        tokenIds: msg.tokenIds,
        locBins: msg.locBins,
        point: msg.point,
        timings: msg.timings,
      };
    } finally {
      if (this.inFlightId === id) this.inFlightId = null;
    }
  }

  // --- prepare 内部 -------------------------------------------------------------

  private async doPrepare(): Promise<void> {
    this.status = this.hadFault ? "rebuilding" : "warming";
    try {
      await this.doPrepareInner();
    } catch (err) {
      // 失败复位 idle（disabled 优先）：否则后续 infer 永远 model-not-ready
      // （cast：TS 不知 doPrepareInner 内经 registerFault 可能已置 disabled）
      if ((this.status as RuntimeStatus) !== "disabled") this.status = "idle";
      throw err;
    }
  }

  private async doPrepareInner(): Promise<void> {
    // 1) I1 校验即加载（每次复验，无缓存；ModelGateError 三态原样上抛）
    const { files, transfer } = await this.readModelFiles();
    // 2) spawn worker
    const worker = this.spawnWorker();
    // 3) load（冷启动超时不计熔断，M6）
    let createMs: Record<string, number>;
    try {
      const msg = await this.sendRequest(
        worker,
        {
          type: "load",
          id: this.nextId++,
          files,
          sessionOptions: { intraOpNumThreads: this.intraOp, interOpNumThreads: 1 },
        },
        transfer,
        this.loadTimeoutMs,
        "load-failed",
        `模型加载超时（>${this.loadTimeoutMs}ms），已 terminate worker（冷启动，不计熔断）`,
        "load",
      );
      if (msg.type !== "loaded") {
        throw new ModelRuntimeError("load-failed", `worker 返回意外消息: ${msg.type}`);
      }
      createMs = msg.createMs;
    } catch (err) {
      this.terminateWorker(worker);
      throw err;
    }
    const totalCreateMs = Object.values(createMs).reduce((a, b) => a + b, 0);
    // 4) warmup（arena 预分配 M6/P3-b；失败=推理故障，计熔断）
    try {
      const warmupId = this.nextId++;
      const warmupRgba = new Uint8Array(8 * 8 * 4); // 黑帧，尺寸无关紧要（stretch 到 768²）
      const warmupAb = toTransferableArrayBuffer(warmupRgba);
      const wmsg = await this.sendRequest(
        worker,
        {
          type: "infer",
          id: warmupId,
          rgba: warmupAb,
          width: 8,
          height: 8,
          inputIds: [...WARMUP_INPUT_IDS],
        },
        [warmupAb],
        this.inferTimeoutMs,
        "infer-timeout",
        `warmup 推理超时（>${this.inferTimeoutMs}ms）`,
        "infer",
      );
      this.log("computeruse.model.warmup", {
        modelId: this.modelId,
        variant: this.variant,
        createMs,
        totalCreateMs: Math.round(totalCreateMs),
        createBudgetMs: this.createBudgetMs,
        createBudgetExceeded: totalCreateMs > this.createBudgetMs,
        warmupMs: wmsg.type === "result" ? Math.round(wmsg.timings.totalMs) : null,
        intraOpNumThreads: this.intraOp,
      });
    } catch (err) {
      this.terminateWorker(worker);
      this.registerFault("warmup-failed", err);
      throw err;
    }
    this.worker = worker;
    this.status = "warm";
    this.log("computeruse.model.warm", {
      modelId: this.modelId,
      variant: this.variant,
      totalCreateMs: Math.round(totalCreateMs),
      createBudgetExceeded: totalCreateMs > this.createBudgetMs,
    });
  }

  /** 读盘 + 复验四图，返回可 transfer 的 ArrayBuffer（每次 prepare 重读，无缓存）。 */
  private async readModelFiles(): Promise<{
    files: Record<SessionKey, ArrayBuffer>;
    transfer: ArrayBuffer[];
  }> {
    const model = this.manifest.models[this.modelId];
    if (!model) {
      throw new ModelRuntimeError("load-failed", `manifest 中不存在模型: ${this.modelId}`);
    }
    const variantEntry = model.variants[this.variant];
    if (!variantEntry) {
      throw new ModelRuntimeError("load-failed", `模型 ${this.modelId} 无变体: ${this.variant}`);
    }
    const files = {} as Record<SessionKey, ArrayBuffer>;
    const transfer: ArrayBuffer[] = [];
    for (const key of SESSION_KEYS) {
      const entry = variantEntry.files.find((f) => f.name === `${key}.onnx`);
      if (!entry) {
        throw new ModelRuntimeError(
          "load-failed",
          `变体 ${this.variant} 缺少图文件: ${key}.onnx（发版内容异常）`,
        );
      }
      const buf = await loadVerifiedFileBytes(path.join(this.modelDir, entry.name), {
        sha256: entry.sha256,
        size: entry.size,
      });
      const ab = toTransferableArrayBuffer(buf);
      files[key] = ab;
      transfer.push(ab);
    }
    return { files, transfer };
  }

  // --- worker 生命周期 ----------------------------------------------------------

  private spawnWorker(): WorkerLike {
    const worker = this.workerFactory(this.workerSource ?? defaultWorkerSource());
    worker.on("message", (msg) => this.onWorkerMessage(msg));
    worker.on("error", (err) => this.onWorkerGone(worker, err));
    worker.on("exit", (code) => {
      if (this.expectedExits.delete(worker)) return; // 主动 terminate 的退出，不重复计故障
      this.onWorkerGone(worker, new Error(`worker 意外退出（code=${code}）`));
    });
    return worker;
  }

  private terminateWorker(worker: WorkerLike): void {
    // 幂等：超时路径与 doPrepareInner catch 可能重复 terminate 同一 worker
    // （注意不能用 expectedExits 判重——exit 事件微任务会先于 catch 删标记）
    if (this.terminatedWorkers.has(worker)) return;
    this.terminatedWorkers.add(worker);
    this.expectedExits.add(worker);
    void worker.terminate();
    if (this.worker === worker) this.worker = null;
  }

  private onWorkerMessage(msg: WorkerResponse): void {
    if (msg.id === undefined) return;
    const entry = this.pending.get(msg.id);
    if (!entry) return; // 超时后迟到的消息，丢弃
    clearTimeout(entry.timer);
    this.pending.delete(msg.id);
    if (msg.type === "error") {
      entry.reject(
        new ModelRuntimeError(
          msg.phase === "load" ? "load-failed" : "worker-error",
          `worker ${msg.phase} 阶段失败: ${msg.message}`,
        ),
      );
    } else {
      entry.resolve(msg);
    }
  }

  /** worker 进程级故障（error / 意外 exit）：拒绝其全部 pending、计熔断、懒重建。 */
  private onWorkerGone(worker: WorkerLike, err: Error): void {
    for (const [id, entry] of this.pending) {
      if (entry.worker === worker) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.reject(new ModelRuntimeError("worker-error", err.message));
      }
    }
    if (this.worker === worker) this.worker = null;
    this.registerFault("worker-gone", err);
    // 故障后懒重建：不在此处重建，下次 infer 走 prepare；重建期 infer fail-fast
    if (this.status !== "disabled") this.status = "idle";
  }

  /** 熔断计数；达阈值 → disabled + 审计 + 广播（plan 明定广播形状）。 */
  private registerFault(reason: string, err: unknown): void {
    this.faults++;
    this.hadFault = true;
    this.log("computeruse.model.fault", {
      modelId: this.modelId,
      variant: this.variant,
      reason,
      faults: this.faults,
      message: err instanceof Error ? err.message : String(err),
    });
    if (this.faults >= this.maxFaults && this.status !== "disabled") {
      this.status = "disabled";
      this.log("computeruse.model.disabled", {
        modelId: this.modelId,
        variant: this.variant,
        reason: "circuit-breaker",
        faults: this.faults,
      });
      this.broadcast?.({
        type: "computer.model.state",
        modelId: this.modelId,
        variant: this.variant,
        modelStatus: "disabled",
        reason: "circuit-breaker",
      });
    }
  }

  /** 发送请求并挂超时。超时语义按 phase 区分（见 prepare/infer 调用点注释）。 */
  private sendRequest(
    worker: WorkerLike,
    msg: WorkerRequest & { id: number },
    transfer: ArrayBuffer[],
    timeoutMs: number,
    timeoutCode: string,
    timeoutMessage: string,
    phase: "load" | "infer",
  ): Promise<WorkerResponse> {
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg.id);
        // 超时：terminate worker。infer 超时计熔断；load（冷启动）超时不计（M6）。
        this.terminateWorker(worker);
        const err = new ModelRuntimeError(timeoutCode, timeoutMessage);
        if (phase === "infer") {
          this.registerFault("infer-timeout", err);
          if (this.status !== "disabled") this.status = "idle";
        }
        reject(err);
      }, timeoutMs);
      this.pending.set(msg.id, { worker, timer, resolve, reject });
      try {
        worker.postMessage(msg, transfer);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(msg.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
