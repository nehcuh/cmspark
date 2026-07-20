// WP5 I2 WI-2.4 — TinyClickSession 会话封装测试。
// 锁定：locate 全链路（官方 prompt → s1 15 token → fake worker → point）、
// 会话复用（两次 locate 仅一次 load，session 创建 ~1.4-1.5s 绝不重建）、
// 变体解析（默认 hybrid / 请求 int8 命中 / 未知回退 loud log）、
// tokenizer 复验绑定 manifest（篡改 fail-closed）、熔断透传、非坐标诚实失败。

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

import {
  loadVerifiedTokenizer,
  resolveModelVariant,
  TinyClickSession,
} from "../src/computer/tinyclick-session";
import { ModelRuntimeError, type WorkerLike, type WorkerSource } from "../src/computer/tinyclick-runtime";
import type { ModelManifest } from "../src/computer/model-manifest";
import type { WorkerRequest, WorkerResponse } from "../src/computer/tinyclick-protocol";
import { loadTokenizerFromJson } from "../src/computer/tinyclick-tokenizer";

// --- fixtures -----------------------------------------------------------------

const REV = "0e1356f0b7cfb416099207121f6a766818ab8a66";
const COMPANION_ROOT = path.resolve(__dirname, "..", "..");
const BUNDLED_TOKENIZER = path.join(COMPANION_ROOT, "assets", "tinyclick", "tokenizer.json");

const S1_IDS = [0, 12196, 7, 109, 7, 11189, 5, 5936, 116, 3753, 15, 5, 15983, 6148, 2];
const ZERO_TIMINGS = { preprocessMs: 0, visionMs: 0, embedMs: 0, encoderMs: 0, decoderMs: 0, totalMs: 0 };

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function contentOf(seed: number, size = 64): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (seed + i) % 251;
  return buf;
}

/** manifest：hybrid 四图 + tokenizer.json 条目（指向 bundled asset 的真实哈希）。 */
function makeManifest(opts: { withInt8?: boolean; tokenizerEntry?: boolean } = {}): ModelManifest {
  const tokBuf = readFileSync(BUNDLED_TOKENIZER);
  const files = [
    ...["vision_encoder", "embed_tokens", "encoder_model", "decoder_model"].map((n, i) => ({
      name: `${n}.onnx`,
      url: `https://models.cmspark.invalid/tinyclick/${REV}/hybrid/${n}.onnx`,
      sha256: sha256(contentOf(11 + i)),
      size: 64,
    })),
    ...(opts.tokenizerEntry === false
      ? []
      : [
          {
            name: "tokenizer.json",
            url: `https://models.cmspark.invalid/tinyclick/${REV}/hybrid/tokenizer.json`,
            sha256: sha256(tokBuf),
            size: tokBuf.byteLength,
          },
        ]),
  ];
  const variants: Record<string, unknown> = { hybrid: { files } };
  if (opts.withInt8) {
    variants.int8 = {
      files: files.map((f) => ({ ...f, url: f.url.replace("/hybrid/", "/int8/") })),
    };
  }
  return {
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
        variants,
      },
    },
  } as unknown as ModelManifest;
}

function makeModelDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tinyclick-session-"));
  ["vision_encoder", "embed_tokens", "encoder_model", "decoder_model"].forEach((n, i) => {
    writeFileSync(path.join(dir, `${n}.onnx`), contentOf(11 + i));
  });
  return dir;
}

// --- FakeWorker（自动应答：load→loaded，infer→s1 结果） ----------------------------

class FakeWorker implements WorkerLike {
  posted: Array<{ msg: WorkerRequest; transfer?: ArrayBuffer[] }> = [];
  terminated = 0;
  locBins: [number, number] | null = [282, 528];
  private listeners = new Map<string, Array<(...args: never[]) => void>>();

  on(event: string, cb: (...args: never[]) => void): unknown {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
    return this;
  }

  emit(event: "error", err: Error): void {
    for (const cb of this.listeners.get(event) ?? []) (cb as (e: Error) => void)(err);
  }

  postMessage(msg: WorkerRequest, transfer?: ArrayBuffer[]): void {
    this.posted.push({ msg, transfer });
    const id = (msg as { id?: number }).id ?? 0;
    const reply = (r: WorkerResponse) =>
      queueMicrotask(() => {
        for (const cb of this.listeners.get("message") ?? []) (cb as (m: WorkerResponse) => void)(r);
      });
    if (msg.type === "load") {
      reply({ type: "loaded", id, createMs: { vision_encoder: 10 } });
    } else if (msg.type === "infer") {
      reply({
        type: "result",
        id,
        tokenIds: [2, 0, 23008, 1437, 50551, 50797, 2],
        locBins: this.locBins,
        point: this.locBins ? { x: 158, y: 211 } : null,
        timings: ZERO_TIMINGS,
      });
    }
  }

  terminate(): Promise<number> {
    this.terminated++;
    queueMicrotask(() => {
      for (const cb of this.listeners.get("exit") ?? []) (cb as (c: number) => void)(0);
    });
    return Promise.resolve(0);
  }
}

interface Harness {
  session: TinyClickSession;
  workers: FakeWorker[];
  logs: Array<{ event: string; payload: Record<string, unknown> }>;
  broadcasts: unknown[];
}

function makeHarness(opts: { variant?: string; withInt8?: boolean } = {}): Harness {
  const manifest = makeManifest({ withInt8: opts.withInt8 });
  const modelDir = makeModelDir();
  const workers: FakeWorker[] = [];
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const broadcasts: unknown[] = [];
  const session = new TinyClickSession({
    manifest,
    tokenizer: loadTokenizerFromJson(readFileSync(BUNDLED_TOKENIZER, "utf-8")),
    variant: opts.variant,
    modelDir,
    cpuModel: "Intel(R) Core(TM) i9-14900KF",
    workerFactory: (_source: WorkerSource) => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    broadcast: (m) => broadcasts.push(m),
    log: (event, payload) => logs.push({ event, payload }),
  });
  return { session, workers, logs, broadcasts };
}

const FRAME = { rgba: new Uint8Array(4 * 4 * 4), width: 4, height: 4 };

// --- locate 全链路 -----------------------------------------------------------------

test("locate: 官方 prompt → s1 15 token → 推理 → point/timings", async () => {
  const h = makeHarness();
  const out = await h.session.locate("click on the ok button", FRAME);
  assert.strictEqual(out.prompt, "what to do to execute the command? click on the ok button");
  assert.deepStrictEqual(out.inputIds, S1_IDS);
  assert.deepStrictEqual(out.tokenIds, [2, 0, 23008, 1437, 50551, 50797, 2]);
  assert.deepStrictEqual(out.locBins, [282, 528]);
  assert.deepStrictEqual(out.point, { x: 158, y: 211 });
  // worker 收到的 input_ids 必须与编码一致
  const w = h.workers[0]!;
  const infers = w.posted.filter((p) => p.msg.type === "infer");
  const realInfer = infers.at(-1)!;
  assert.deepStrictEqual((realInfer.msg as { inputIds: number[] }).inputIds, S1_IDS);
});

test("会话复用: 两次 locate 仅一次 load（session 创建 ~1.4-1.5s 绝不重建）", async () => {
  const h = makeHarness();
  await h.session.locate("click on the ok button", FRAME);
  await h.session.locate("open the file menu", { rgba: new Uint8Array(4 * 4 * 4), width: 4, height: 4 });
  assert.strictEqual(h.workers.length, 1, "不得 spawn 第二个 worker");
  const w = h.workers[0]!;
  assert.strictEqual(w.posted.filter((p) => p.msg.type === "load").length, 1, "load 仅一次");
  // warmup + 2 次真实推理
  assert.strictEqual(w.posted.filter((p) => p.msg.type === "infer").length, 3);
  assert.strictEqual(w.terminated, 0, "稳态不得 terminate");
});

test("非坐标输出: point/locBins 为 null 诚实失败，不编造坐标", async () => {
  const h = makeHarness();
  await h.session.prepare();
  h.workers[0]!.locBins = null;
  const out = await h.session.locate("describe the screen", FRAME);
  assert.strictEqual(out.point, null);
  assert.strictEqual(out.locBins, null);
});

// --- 变体选择 -----------------------------------------------------------------------

test("变体: 默认 hybrid；请求 int8 且已登记 → int8", () => {
  const h1 = makeHarness();
  assert.strictEqual(h1.session.variant, "hybrid");
  const h2 = makeHarness({ variant: "int8", withInt8: true });
  assert.strictEqual(h2.session.variant, "int8");
});

test("变体: 请求未登记变体 → 回退 hybrid + loud log（性能选择非信任边界）", () => {
  const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const manifest = makeManifest();
  const got = resolveModelVariant("fp32", manifest, "tinyclick", (event, payload) =>
    logs.push({ event, payload }),
  );
  assert.strictEqual(got, "hybrid");
  assert.deepStrictEqual(logs, [
    {
      event: "computeruse.model.variant-fallback",
      payload: { modelId: "tinyclick", requested: "fp32", using: "hybrid", reason: "variant-unknown" },
    },
  ]);
});

// --- tokenizer 复验绑定 manifest ------------------------------------------------------

test("loadVerifiedTokenizer: bundled asset 按 manifest 哈希复验通过", async () => {
  const tok = await loadVerifiedTokenizer(makeManifest(), "tinyclick", "hybrid", BUNDLED_TOKENIZER);
  assert.deepStrictEqual(
    tok.encode("what to do to execute the command? click on the ok button"),
    S1_IDS,
  );
});

test("loadVerifiedTokenizer: 篡改 bundled asset → model-hash-mismatch（fail-closed）", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tinyclick-tok-"));
  const tampered = path.join(dir, "tokenizer.json");
  writeFileSync(tampered, readFileSync(BUNDLED_TOKENIZER) + " "); // 尾加空格 → size/hash 双不符
  await assert.rejects(
    loadVerifiedTokenizer(makeManifest(), "tinyclick", "hybrid", tampered),
    (err: unknown) => {
      assert.strictEqual((err as { code?: string }).code, "model-size-mismatch");
      return true;
    },
  );
});

test("loadVerifiedTokenizer: manifest 缺 tokenizer 条目 → load-failed", async () => {
  await assert.rejects(
    loadVerifiedTokenizer(
      makeManifest({ tokenizerEntry: false }),
      "tinyclick",
      "hybrid",
      BUNDLED_TOKENIZER,
    ),
    (err: unknown) => {
      assert.ok(err instanceof ModelRuntimeError);
      assert.strictEqual(err.code, "load-failed");
      return true;
    },
  );
});

// --- 熔断透传 -----------------------------------------------------------------------

test("熔断透传: 3 次 worker 故障 → locate 拒 model-disabled + 广播", async () => {
  const h = makeHarness();
  await h.session.prepare();
  const w = h.workers[0]!;
  for (let i = 0; i < 3; i++) w.emit("error", new Error(`crash-${i}`));
  assert.strictEqual(h.session.getStatus(), "disabled");
  await assert.rejects(h.session.locate("click ok", FRAME), (err: unknown) => {
    assert.strictEqual((err as { code?: string }).code, "model-disabled");
    return true;
  });
  assert.deepStrictEqual(h.broadcasts, [
    {
      type: "computer.model.state",
      modelId: "tinyclick",
      variant: "hybrid",
      modelStatus: "disabled",
      reason: "circuit-breaker",
    },
  ]);
  // 手动复位恢复
  h.session.resetCircuitBreaker();
  await h.session.locate("click ok", FRAME);
  assert.strictEqual(h.session.getStatus(), "warm");
});
