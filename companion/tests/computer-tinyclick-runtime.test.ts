// WP5 I2 WI-2.1 — TinyClickRuntime 主线程封装测试（FakeWorker 脚本化，零真实 ORT）。
// 覆盖：prepare 成功链路（真走 I1 校验读盘）、拓扑表命中/回退、并发 prepare 共享、
// 单飞 busy 拒绝、infer 超时 terminate+计熔断+懒重建+重建期 fail-fast、
// 冷启动 load 超时不计熔断（M6）、warmup 失败计熔断、3 次熔断 disabled+广播形状
// +手动复位恢复、worker error 事件 pending 拒绝且主线程存活、I1 错哈希上抛三态。

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ModelRuntimeError,
  resolveIntraOpThreads,
  TinyClickRuntime,
  type WorkerLike,
  type WorkerSource,
} from "../src/computer/tinyclick-runtime";
import type { ModelManifest } from "../src/computer/model-manifest";
import type { WorkerRequest, WorkerResponse } from "../src/computer/tinyclick-protocol";

// --- fixtures -----------------------------------------------------------------

const REV = "0e1356f0b7cfb416099207121f6a766818ab8a66";
const SESSION_NAMES = ["vision_encoder", "embed_tokens", "encoder_model", "decoder_model"] as const;

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function contentOf(seed: number, size = 64): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (seed + i) % 251;
  return buf;
}

/** 在 tmp 目录落四图小文件并生成对应 manifest（真走 I1 loadVerifiedFileBytes）。
 *  files 覆盖项：盘上写覆盖内容，manifest 仍登记规范内容的哈希——用于篡改检出场景。 */
function makeModelDir(files?: Partial<Record<string, Buffer>>): { modelDir: string; manifest: ModelManifest } {
  const modelDir = mkdtempSync(path.join(tmpdir(), "tinyclick-runtime-"));
  const entries = SESSION_NAMES.map((name, i) => {
    const canonical = contentOf(11 + i);
    writeFileSync(path.join(modelDir, `${name}.onnx`), files?.[name] ?? canonical);
    return { name: `${name}.onnx`, content: canonical };
  });
  const manifest = {
    schemaVersion: 1,
    models: {
      tinyclick: {
        repo: "Krystianz/TinyClick",
        revision: REV,
        license: "MIT",
        licenseCopyright: "Copyright (c) 2024 Samsung R&D Poland",
        baseModelNotice: { repo: "microsoft/Florence-2-base", license: "MIT" },
        provenance: {
          sourceFile: "model.safetensors",
          sourceSha256: sha256(contentOf(1)),
          exportVendor: {
            configuration: sha256(contentOf(2)),
            modeling: sha256(contentOf(3)),
            processing: sha256(contentOf(4)),
          },
          exportedAt: "2026-07-20",
        },
        variants: {
          hybrid: {
            files: entries.map((f) => ({
              name: f.name,
              url: `https://models.cmspark.invalid/tinyclick/${REV}/hybrid/${f.name}`,
              sha256: sha256(f.content),
              size: f.content.byteLength,
            })),
          },
        },
      },
    },
  } as unknown as ModelManifest;
  return { modelDir, manifest };
}

// --- FakeWorker ---------------------------------------------------------------

type ReplyFn = (msg: WorkerResponse) => void;

/** 脚本化 fake：onMessage 由测试注入；缺省自动回 loaded / result。 */
class FakeWorker implements WorkerLike {
  posted: Array<{ msg: WorkerRequest; transfer?: ArrayBuffer[] }> = [];
  terminated = 0;
  /** 测试脚本：收到消息后如何回应（可不回，模拟挂起）。 */
  onMessage: ((msg: WorkerRequest & { id?: number }, reply: ReplyFn) => void) | null = null;
  private listeners = new Map<string, Array<(...args: never[]) => void>>();

  on(event: string, cb: (...args: never[]) => void): unknown {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
    return this;
  }

  emit(event: "message", msg: WorkerResponse): void;
  emit(event: "error", err: Error): void;
  emit(event: "exit", code: number): void;
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) {
      (cb as (...a: unknown[]) => void)(...args);
    }
  }

  postMessage(msg: WorkerRequest, transfer?: ArrayBuffer[]): void {
    this.posted.push({ msg, transfer });
    const reply: ReplyFn = (r) => queueMicrotask(() => this.emit("message", r));
    if (this.onMessage) {
      this.onMessage(msg, reply);
      return;
    }
    // 缺省脚本：load → loaded；infer → result（s1 参考坐标 loc 282/528）
    const id = (msg as { id?: number }).id ?? 0;
    if (msg.type === "load") {
      reply({
        type: "loaded",
        id,
        createMs: { vision_encoder: 10, embed_tokens: 5, encoder_model: 20, decoder_model: 15 },
      });
    } else if (msg.type === "infer") {
      reply({
        type: "result",
        id,
        tokenIds: [2, 0, 23008, 1437, 50551, 50797, 2],
        locBins: [282, 528],
        point: { x: 2, y: 2 },
        timings: { preprocessMs: 1, visionMs: 2, embedMs: 1, encoderMs: 2, decoderMs: 3, totalMs: 9 },
      });
    }
  }

  terminate(): Promise<number> {
    this.terminated++;
    queueMicrotask(() => this.emit("exit", 0));
    return Promise.resolve(0);
  }
}

interface Harness {
  runtime: TinyClickRuntime;
  workers: FakeWorker[];
  broadcasts: unknown[];
  logs: Array<{ event: string; payload: Record<string, unknown> }>;
  next: () => FakeWorker; // 下一个将被 spawn 的 fake（可提前挂脚本）
}

function makeHarness(
  opts: {
    cpuModel?: string;
    inferTimeoutMs?: number;
    loadTimeoutMs?: number;
    files?: Partial<Record<string, Buffer>>;
    maxFaults?: number;
  } = {},
): Harness {
  const { modelDir, manifest } = makeModelDir(opts.files);
  const workers: FakeWorker[] = [];
  const broadcasts: unknown[] = [];
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  let scripted: FakeWorker | null = null;
  const runtime = new TinyClickRuntime({
    manifest,
    modelDir,
    cpuModel: opts.cpuModel ?? "Intel(R) Core(TM) i9-14900KF",
    inferTimeoutMs: opts.inferTimeoutMs ?? 5000,
    loadTimeoutMs: opts.loadTimeoutMs ?? 30000,
    maxFaults: opts.maxFaults ?? 3,
    workerFactory: (_source: WorkerSource) => {
      const w = scripted ?? new FakeWorker();
      scripted = null;
      workers.push(w);
      return w;
    },
    broadcast: (msg) => broadcasts.push(msg),
    log: (event, payload) => logs.push({ event, payload }),
  });
  return {
    runtime,
    workers,
    broadcasts,
    logs,
    next: () => {
      scripted = new FakeWorker();
      return scripted;
    },
  };
}

const FRAME = { rgba: new Uint8Array(4 * 4 * 4), width: 4, height: 4 };
const INPUT_IDS = [0, 12196, 7, 109, 7, 11189, 5, 5936, 116, 3753, 15, 5, 15983, 6148, 2];

/** 轮询等待条件成立（真实短定时器纪律：不用假定时器）。 */
async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`waitFor 超时: ${what}`);
}

/** fake 常用应答片段。 */
const ZERO_TIMINGS = { preprocessMs: 0, visionMs: 0, embedMs: 0, encoderMs: 0, decoderMs: 0, totalMs: 0 };
function loadedReply(id: number, createMs: Record<string, number> = {}): WorkerResponse {
  return { type: "loaded", id, createMs };
}
function resultReply(id: number): WorkerResponse {
  return { type: "result", id, tokenIds: [2, 2], locBins: null, point: null, timings: ZERO_TIMINGS };
}
/** 脚本：load/warmup 正常回，真实推理（第二次 infer 起）挂起，可手动 release。 */
function hangRealInfer(w: FakeWorker): { release: () => void } {
  let inferCount = 0;
  let releaseFn: (() => void) | null = null;
  w.onMessage = (msg, reply) => {
    if (msg.type === "load") {
      reply(loadedReply(msg.id ?? 0));
    } else if (msg.type === "infer") {
      inferCount++;
      const id = msg.id ?? 0;
      if (inferCount === 1) reply(resultReply(id)); // warmup
      else releaseFn = () => reply(resultReply(id)); // 真实推理挂起
    }
  };
  return { release: () => releaseFn?.() };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof ModelRuntimeError, `应为 ModelRuntimeError，实际: ${String(err)}`);
    assert.strictEqual(err.code, code);
    return true;
  });
}

// --- 拓扑 ---------------------------------------------------------------------

test("拓扑: 14900KF 命中 8 P 核；未知型号回退保守 4（禁 ORT 默认值）", () => {
  assert.strictEqual(resolveIntraOpThreads("Intel(R) Core(TM) i9-14900KF"), 8);
  assert.strictEqual(resolveIntraOpThreads("Intel(R) Core(TM) i7-13700K"), 8);
  assert.strictEqual(resolveIntraOpThreads("Intel(R) Core(TM) i5-13600K"), 6);
  assert.strictEqual(resolveIntraOpThreads("Intel(R) Core(TM) Ultra 7 265K"), 8);
  assert.strictEqual(resolveIntraOpThreads("AMD Ryzen 9 7950X 16-Core Processor"), 4);
  assert.strictEqual(resolveIntraOpThreads(""), 4);
});

test("拓扑: load 消息携带映射的 intraOp 与 interOp=1", async () => {
  const h = makeHarness({ cpuModel: "Intel(R) Core(TM) i5-14600KF" });
  await h.runtime.prepare();
  const load = h.workers[0]!.posted.find((p) => p.msg.type === "load");
  assert.ok(load);
  assert.deepStrictEqual((load.msg as { sessionOptions: unknown }).sessionOptions, {
    intraOpNumThreads: 6,
    interOpNumThreads: 1,
  });
});

// --- prepare 成功链路 -----------------------------------------------------------

test("prepare: 真走 I1 校验读盘 → transfer 四图 → load → warmup → warm", async () => {
  const h = makeHarness();
  await h.runtime.prepare();
  assert.strictEqual(h.runtime.getStatus(), "warm");

  const w = h.workers[0]!;
  const load = w.posted.find((p) => p.msg.type === "load");
  assert.ok(load, "应发送 load");
  // 四图字节经 transfer 转移
  assert.strictEqual(load.transfer?.length, 4);
  for (const ab of load.transfer!) assert.ok(ab instanceof ArrayBuffer);
  const files = (load.msg as { files: Record<string, ArrayBuffer> }).files;
  assert.deepStrictEqual(Object.keys(files).sort(), [...SESSION_NAMES].sort());
  // warmup：load 后还有一次 infer（arena 预分配）
  const infers = w.posted.filter((p) => p.msg.type === "infer");
  assert.strictEqual(infers.length, 1, "prepare 只应做一次 warmup 推理");
  // 预算内 → 无 exceeded 标记
  const warmLog = h.logs.find((l) => l.event === "computeruse.model.warm");
  assert.ok(warmLog);
  assert.strictEqual(warmLog.payload.createBudgetExceeded, false);
});

test("prepare: 并发调用共享同一 warmingPromise（worker 只 spawn 一次）", async () => {
  const h = makeHarness();
  const [r1, r2] = await Promise.all([h.runtime.prepare(), h.runtime.prepare()]);
  assert.strictEqual(r1, undefined);
  assert.strictEqual(r2, undefined);
  assert.strictEqual(h.workers.length, 1);
  // 已 warm 后再 prepare 立即返回
  await h.runtime.prepare();
  assert.strictEqual(h.workers.length, 1);
});

test("prepare: I1 错哈希原样上抛 model-hash-mismatch，不计熔断", async () => {
  const h = makeHarness({ files: { vision_encoder: contentOf(99) } });
  // manifest 里登记的是 contentOf(11)，盘上换成 contentOf(99) → 哈希不符
  await assert.rejects(h.runtime.prepare(), (err: unknown) => {
    assert.strictEqual((err as { code?: string }).code, "model-hash-mismatch");
    return true;
  });
  assert.strictEqual(h.runtime.getFaults(), 0);
  assert.strictEqual(h.runtime.getStatus(), "idle", "失败后应复位 idle 允许重试");
});

// --- infer 单飞 -----------------------------------------------------------------

test("infer: 成功返回 token/loc/point/timings", async () => {
  const h = makeHarness();
  const out = await h.runtime.infer(FRAME, INPUT_IDS);
  assert.deepStrictEqual(out.locBins, [282, 528]);
  assert.deepStrictEqual(out.point, { x: 2, y: 2 });
  assert.deepStrictEqual(out.tokenIds, [2, 0, 23008, 1437, 50551, 50797, 2]);
  assert.strictEqual(out.timings.totalMs, 9);
  // prepare 的 warmup + 本次推理 = 两次 infer
  assert.strictEqual(h.workers[0]!.posted.filter((p) => p.msg.type === "infer").length, 2);
});

test("infer: 单飞——上一帧未完成时并发请求拒绝 tinyclick-busy", async () => {
  const h = makeHarness();
  const hang = hangRealInfer(h.next());
  const p1 = h.runtime.infer(FRAME, INPUT_IDS);
  // 等真实推理确实发出（warmup 之后的第二个 infer）
  await waitFor(
    () =>
      h.workers.length >= 1 &&
      h.workers[0]!.posted.filter((p) => p.msg.type === "infer").length >= 2,
    "真实推理发出",
  );
  await expectCode(h.runtime.infer(FRAME, INPUT_IDS), "tinyclick-busy");
  hang.release();
  const out = await p1;
  assert.strictEqual(out.locBins, null);
});

// --- 超时 / 熔断 ------------------------------------------------------------------

test("infer: 超时 → terminate + 计熔断 + 懒重建；重建期 infer fail-fast", async () => {
  const h = makeHarness({ inferTimeoutMs: 50 });
  // 第一个 worker：warmup 正常，真实推理挂起 → 触发超时
  hangRealInfer(h.next());
  await expectCode(h.runtime.infer(FRAME, INPUT_IDS), "infer-timeout");
  assert.strictEqual(h.workers[0]!.terminated, 1, "超时必须 terminate worker");
  assert.strictEqual(h.runtime.getFaults(), 1);
  assert.strictEqual(h.runtime.getStatus(), "idle", "故障后懒重建：回到 idle 等下次触发");

  // 第二个 worker：load 延迟 60ms 才回 → 重建窗口内第二次 infer 应 fail-fast
  const w1 = h.next();
  w1.onMessage = (msg, reply) => {
    if (msg.type === "load") {
      setTimeout(() => reply(loadedReply(msg.id ?? 0)), 60);
    } else if (msg.type === "infer") {
      reply(resultReply(msg.id ?? 0));
    }
  };
  const p2 = h.runtime.infer(FRAME, INPUT_IDS); // 触发懒重建
  await expectCode(h.runtime.infer(FRAME, INPUT_IDS), "model-not-ready"); // 重建期不排队
  await p2;
  assert.strictEqual(h.runtime.getStatus(), "warm");
  assert.strictEqual(h.workers.length, 2, "懒重建应 spawn 新 worker");
});

test("prepare: 冷启动 load 超时不计熔断（M6）", async () => {
  const h = makeHarness({ loadTimeoutMs: 50 });
  h.next().onMessage = () => {}; // load 永不回 → 冷启动超时
  await expectCode(h.runtime.prepare(), "load-failed");
  assert.strictEqual(h.runtime.getFaults(), 0, "冷启动超时不得计入熔断");
  assert.strictEqual(h.runtime.getStatus(), "idle");
  assert.strictEqual(h.workers[0]!.terminated, 1, "超时 worker 仍须 terminate");
  // 可立即重试
  await h.runtime.prepare();
  assert.strictEqual(h.runtime.getStatus(), "warm");
});

test("prepare: warmup 推理失败计入熔断（会话建成但推理失败是真故障）", async () => {
  const h = makeHarness();
  h.next().onMessage = (msg, reply) => {
    if (msg.type === "load") reply(loadedReply(msg.id ?? 0));
    else reply({ type: "error", id: msg.id ?? 0, phase: "infer", message: "boom" });
  };
  await expectCode(h.runtime.prepare(), "worker-error");
  assert.strictEqual(h.runtime.getFaults(), 1);
  assert.strictEqual(h.runtime.getStatus(), "idle");
});

test("熔断: 3 次推理故障 → disabled + 审计 + 广播形状；手动复位后恢复", async () => {
  const h = makeHarness();
  await h.runtime.prepare();
  const w0 = h.workers[0]!;
  // 连续 3 次 worker 进程级故障
  for (let i = 0; i < 3; i++) w0.emit("error", new Error(`crash-${i}`));
  assert.strictEqual(h.runtime.getStatus(), "disabled");
  assert.strictEqual(h.runtime.getFaults(), 3);
  // 审计事件
  const disabledLog = h.logs.find((l) => l.event === "computeruse.model.disabled");
  assert.ok(disabledLog, "应有 computeruse.model.disabled 审计");
  assert.strictEqual(disabledLog.payload.reason, "circuit-breaker");
  // 广播形状（plan 明定）
  assert.deepStrictEqual(h.broadcasts, [
    {
      type: "computer.model.state",
      modelId: "tinyclick",
      variant: "hybrid",
      modelStatus: "disabled",
      reason: "circuit-breaker",
    },
  ]);
  // disabled 后 infer/prepare 快速失败
  await expectCode(h.runtime.infer(FRAME, INPUT_IDS), "model-disabled");
  await expectCode(h.runtime.prepare(), "model-disabled");
  // 手动复位（从严：无自动恢复）→ 可重新 prepare
  h.runtime.resetCircuitBreaker();
  assert.strictEqual(h.runtime.getStatus(), "idle");
  assert.strictEqual(h.runtime.getFaults(), 0);
  await h.runtime.infer(FRAME, INPUT_IDS);
  assert.strictEqual(h.runtime.getStatus(), "warm");
});

test("worker error: pending 推理拒绝 worker-error，主线程存活，计一次熔断", async () => {
  const h = makeHarness();
  hangRealInfer(h.next());
  const p = h.runtime.infer(FRAME, INPUT_IDS);
  const assertion = expectCode(p, "worker-error");
  await waitFor(
    () =>
      h.workers.length >= 1 &&
      h.workers[0]!.posted.filter((m) => m.msg.type === "infer").length >= 2,
    "真实推理发出",
  );
  h.workers[0]!.emit("error", new Error("worker crashed"));
  await assertion; // 主线程（测试进程）存活即证明隔离（W1）
  assert.strictEqual(h.runtime.getFaults(), 1);
  assert.strictEqual(h.runtime.getStatus(), "idle");
});

test("预算: createMs 超 2.2s 预算仅 loud log 告警，不阻塞 warm", async () => {
  const h = makeHarness();
  h.next().onMessage = (msg, reply) => {
    if (msg.type === "load") {
      reply({
        type: "loaded",
        id: msg.id ?? 0,
        createMs: { vision_encoder: 900, embed_tokens: 100, encoder_model: 800, decoder_model: 700 },
      });
    } else {
      reply({
        type: "result", id: msg.id ?? 0, tokenIds: [2, 2], locBins: null, point: null,
        timings: { preprocessMs: 0, visionMs: 0, embedMs: 0, encoderMs: 0, decoderMs: 0, totalMs: 0 },
      });
    }
  };
  await h.runtime.prepare();
  assert.strictEqual(h.runtime.getStatus(), "warm");
  const warmupLog = h.logs.find((l) => l.event === "computeruse.model.warmup");
  assert.ok(warmupLog);
  assert.strictEqual(warmupLog.payload.createBudgetExceeded, true);
  assert.strictEqual(warmupLog.payload.totalCreateMs, 2500);
});

test("拓扑 override: 显式 intraOpNumThreads 优先于 CPU 映射（基准/补测用）", async () => {
  const { modelDir, manifest } = makeModelDir();
  const workers: FakeWorker[] = [];
  const runtime = new TinyClickRuntime({
    manifest,
    modelDir,
    cpuModel: "Intel(R) Core(TM) i9-14900KF", // 映射应为 8
    intraOpNumThreads: 4, // 覆盖优先
    workerFactory: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
  });
  await runtime.prepare();
  const load = workers[0]!.posted.find((p) => p.msg.type === "load");
  assert.deepStrictEqual((load!.msg as { sessionOptions: unknown }).sessionOptions, {
    intraOpNumThreads: 4,
    interOpNumThreads: 1,
  });
});

// --- M2: worker 返回值域校验（I2 对抗 P2-a） -----------------------------------------

/** 脚本：load/warmup 正常，真实推理返回篡改结果。 */
function scriptBadResult(w: FakeWorker, bad: Record<string, unknown>): void {
  let inferCount = 0;
  w.onMessage = (msg, reply) => {
    if (msg.type === "load") {
      reply(loadedReply(msg.id ?? 0));
    } else if (msg.type === "infer") {
      inferCount++;
      const id = msg.id ?? 0;
      if (inferCount === 1) reply(resultReply(id)); // warmup 正常
      else reply({ ...resultReply(id), ...bad } as WorkerResponse);
    }
  };
}

test("M2: 值域校验——NaN/负 bin/超屏 point/越界 tokenId 各拒 worker-error 并计熔断", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["point NaN", { point: { x: NaN, y: 5 } }],
    ["locBins 负值", { locBins: [-1, 500] }],
    ["point 超屏（帧 4×4，x=100）", { point: { x: 100, y: 1 } }],
    ["tokenId 越界（≥51289）", { tokenIds: [2, 51289, 2] }],
  ];
  for (const [what, bad] of cases) {
    const h = makeHarness();
    scriptBadResult(h.next(), bad);
    await expectCode(h.runtime.infer(FRAME, INPUT_IDS), "worker-error");
    assert.strictEqual(h.runtime.getFaults(), 1, `${what}: 应计一次熔断`);
    assert.strictEqual(h.workers[0]!.terminated, 1, `${what}: 应 terminate 越权 worker`);
    assert.strictEqual(h.runtime.getStatus(), "idle", `${what}: 故障后懒重建回 idle`);
  }
});
