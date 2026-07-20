/**
 * WP5 I2 WI-2.1：TinyClick 推理 worker 入口（worker_threads 子线程）。
 *
 * 设计来源：
 * - w2-worker.js（spike s2，已实测 hybrid 736ms / token 7/7）推理管线原样移植：
 *   preprocess → vision_encoder → embed_tokens + concat → encoder_model →
 *   decoder 贪心循环（全前缀重算，ORT 内部算子融合，异步 session.run 不阻塞线程池）。
 * - W1 发现：worker 内未捕获异常 / abort 只终止 worker，主线程经 error 事件存活——
 *   因此本 worker 不做进程级兜底，异常由主线程 runtime 统一计入熔断。
 * - W1 发现 1：require 解析可能被 cwd 劫持，先裸探测，失败回退 execPath createRequire。
 *
 * 职责边界：只负责 ORT 会话生命周期 + 单帧推理；熔断/单飞/拓扑决策全部在主线程
 * tinyclick-runtime.ts。模型字节经 load 消息 transfer 进来（I1 契约），worker 不读盘。
 */
import { parentPort } from "node:worker_threads";
import { createRequire } from "node:module";
import { preprocessFrame, locBinToPixel } from "./tinyclick-preprocess";
import { greedyDecode, parseLocBins } from "./tinyclick-decode";
import type {
  WorkerRequest,
  WorkerLoadMsg,
  WorkerInferMsg,
  WorkerResponse,
  InferTimings,
} from "./tinyclick-protocol";

type OrtModule = typeof import("onnxruntime-node");
type InferenceSession = import("onnxruntime-node").InferenceSession;

/** W1 发现 1：先裸探测，cwd 被污染时回退可执行文件目录的 createRequire。 */
function resolveOrt(): OrtModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("onnxruntime-node") as OrtModule;
  } catch {
    const execRequire = createRequire(process.execPath);
    return execRequire("onnxruntime-node") as OrtModule;
  }
}

type SessionKey = "vision_encoder" | "embed_tokens" | "encoder_model" | "decoder_model";

const SESSION_ORDER: ReadonlyArray<SessionKey> = [
  "vision_encoder",
  "embed_tokens",
  "encoder_model",
  "decoder_model",
];

interface SessionSet {
  vision: InferenceSession;
  embed: InferenceSession;
  encoder: InferenceSession;
  decoder: InferenceSession;
}

const sessions: Partial<Record<SessionKey, InferenceSession>> = {};

function post(msg: WorkerResponse): void {
  parentPort?.postMessage(msg);
}

function postError(id: number | undefined, phase: "load" | "infer" | "dispose", err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  post({ type: "error", id, phase, message });
}

async function handleLoad(ort: OrtModule, msg: WorkerLoadMsg): Promise<void> {
  const createMs: Record<string, number> = {};
  for (const key of SESSION_ORDER) {
    const bytes = msg.files[key];
    if (!bytes) throw new Error(`missing session file: ${key}`);
    const t0 = performance.now();
    sessions[key] = await ort.InferenceSession.create(Buffer.from(bytes), {
      intraOpNumThreads: msg.sessionOptions.intraOpNumThreads,
      interOpNumThreads: msg.sessionOptions.interOpNumThreads,
      graphOptimizationLevel: "all",
    });
    createMs[key] = performance.now() - t0;
  }
  post({ type: "loaded", id: msg.id, createMs });
}

function loadedSessions(): SessionSet {
  const s: SessionSet = {
    vision: sessions.vision_encoder as InferenceSession,
    embed: sessions.embed_tokens as InferenceSession,
    encoder: sessions.encoder_model as InferenceSession,
    decoder: sessions.decoder_model as InferenceSession,
  };
  for (const [k, v] of Object.entries(s)) {
    if (!v) throw new Error(`session not loaded: ${k}`);
  }
  return s;
}

async function handleInfer(ort: OrtModule, msg: WorkerInferMsg): Promise<void> {
  const t0 = performance.now();
  const timings: InferTimings = {
    preprocessMs: 0,
    visionMs: 0,
    embedMs: 0,
    encoderMs: 0,
    decoderMs: 0,
    totalMs: 0,
  };

  const s = loadedSessions();
  const rgba = new Uint8Array(msg.rgba);

  // 1) 预处理（768² stretch + ImageNet CHW）
  let t = performance.now();
  const pixel = preprocessFrame(rgba, msg.width, msg.height).tensor;
  timings.preprocessMs = performance.now() - t;

  // 2) vision encoder
  t = performance.now();
  const visionOut = await s.vision.run({
    pixel_values: new ort.Tensor("float32", pixel, [1, 3, 768, 768]),
  });
  const imageFeatures = Object.values(visionOut)[0];
  timings.visionMs = performance.now() - t;

  // 3) embed tokens + concat(image, text)
  t = performance.now();
  const seq = msg.inputIds.length;
  const embedOut = await s.embed.run({
    input_ids: new ort.Tensor(
      "int64",
      BigInt64Array.from(msg.inputIds.map((v) => BigInt(v))),
      [1, seq],
    ),
  });
  const textEmb = Object.values(embedOut)[0];
  const imgData = imageFeatures.data as Float32Array;
  const txtData = textEmb.data as Float32Array;
  const imgLen = imageFeatures.dims[1] as number;
  const hidden = imageFeatures.dims[2] as number;
  const totalLen = imgLen + seq;
  const inputsEmbeds = new Float32Array(totalLen * hidden);
  inputsEmbeds.set(imgData, 0);
  inputsEmbeds.set(txtData, imgLen * hidden);
  timings.embedMs = performance.now() - t;

  // 4) encoder
  t = performance.now();
  const encoderOut = await s.encoder.run({
    inputs_embeds: new ort.Tensor("float32", inputsEmbeds, [1, totalLen, hidden]),
    attention_mask: new ort.Tensor("int64", new BigInt64Array(totalLen).fill(1n), [1, totalLen]),
  });
  const encoderHidden = Object.values(encoderOut)[0];
  timings.encoderMs = performance.now() - t;

  // 5) decoder 贪心循环（全前缀重算）
  t = performance.now();
  const totalDims = encoderHidden.dims;
  const tokenIds = await greedyDecode(async (prefixIds) => {
    const decOut = await s.decoder.run({
      input_ids: new ort.Tensor(
        "int64",
        BigInt64Array.from(prefixIds.map((v) => BigInt(v))),
        [1, prefixIds.length],
      ),
      encoder_hidden_states: new ort.Tensor(
        "float32",
        encoderHidden.data as Float32Array,
        totalDims as number[],
      ),
      encoder_attention_mask: new ort.Tensor(
        "int64",
        new BigInt64Array(totalLen).fill(1n),
        [1, totalLen],
      ),
    });
    const logits = Object.values(decOut)[0];
    return logits.data as Float32Array;
  });
  timings.decoderMs = performance.now() - t;

  // 6) 解析 loc bins → 像素点（用原图尺寸映射）
  const locBins = parseLocBins(tokenIds);
  const point = locBins
    ? locBinToPixel(locBins[0], locBins[1], msg.width, msg.height)
    : null;

  timings.totalMs = performance.now() - t0;
  post({ type: "result", id: msg.id, tokenIds, locBins, point, timings });
}

async function main(): Promise<void> {
  if (!parentPort) return;
  const ort = resolveOrt();
  parentPort.on("message", (raw: WorkerRequest) => {
    void (async () => {
      try {
        if (raw.type === "load") {
          await handleLoad(ort, raw as WorkerLoadMsg);
        } else if (raw.type === "infer") {
          await handleInfer(ort, raw as WorkerInferMsg);
        } else if (raw.type === "dispose") {
          for (const key of SESSION_ORDER) {
            await sessions[key]?.release();
            sessions[key] = undefined;
          }
          process.exit(0);
        }
      } catch (err) {
        postError((raw as { id?: number }).id, raw.type, err);
      }
    })();
  });
}

void main();
