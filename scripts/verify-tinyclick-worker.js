#!/usr/bin/env node
// WP5 I2 WI-2.5 — TinyClick worker 基准门禁（生产管线同构路径 × 真模型 × 真 worker）。
// ============================================================
// 路径同构：TinyClickSession（compiled .test-dist）→ TinyClickRuntime → 真实
// worker_threads(tinyclick-worker.js) → onnxruntime-node → 真 onnx 模型（I1 复验读盘）。
// 与生产唯一差异：编译产物取自 .test-dist（非 esbuild 包），modelDir 指向 spike 模型。
//
// 门禁（spike 复现门槛）：
//   - token parity：s1 参考输入 greedy token_ids 7/7 全等
//     [2,0,23008,1437,50551,50797,2]（reference.json），point 与 [157,211] 容差 ≤1px
//   - 会话创建预算：totalCreateMs ≤ 2200ms 仅告警不失败（hybrid 实测 ~1.4-1.5s）
//
// 基准输出：createMs 分段 / warmup e2e / 稳态 e2e（min/median/max）/ RSS 三段
// （prepare 前、warm 后、N 次推理后；worker_threads 与主线程同进程，RSS 即全量）。
//
// Usage:
//   node scripts/verify-tinyclick-worker.js [--variant hybrid|int8] [--intraop N]
//                                           [--repeat N] [--json OUT] [--freeze]
// Defaults: --variant hybrid --intraop <真实 CPU 拓扑> --repeat 5
//   --intraop 4 即 plan M6 要求的 hybrid@4 补测配置。
//   输出（F-1 修复）：默认写**时间戳新文件**（i2-worker-benchmark-*-<ts>.json，
//   非冻结路径）——冻结基准文件（envelope §8 锚点）只在显式 --freeze 或 --json
//   指定同名路径时才覆写，杜绝「每次复跑都在消耗冻结语义」。
//
// Exit codes: 0 = token parity 通过；1 = 门禁失败；2 = 环境/前置缺失。

const fs = require("fs");
const path = require("path");

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_SETUP = 2;

function info(msg) { console.log(`[verify-tinyclick-worker] INFO:  ${msg}`); }
function ok(msg) { console.log(`[verify-tinyclick-worker] OK:    ${msg}`); }
function warn(msg) { console.log(`[verify-tinyclick-worker] WARN:  ${msg}`); }
function error(msg) { console.error(`[verify-tinyclick-worker] ERROR: ${msg}`); }

const REPO_ROOT = path.resolve(__dirname, "..");
const DIST = path.join(REPO_ROOT, "companion", ".test-dist", "src", "computer");

// s1 参考（scripts/spike/s1-tinyclick-onnx/reference.json，冻结事实）
const REF_TOKEN_IDS = [2, 0, 23008, 1437, 50551, 50797, 2];
const REF_POINT = [157, 211]; // HF floor；生产 round → [158,211]，容差 ±1
const REF_COMMAND = "click on the ok button";
const FRAME_W = 560;
const FRAME_H = 400;
const CREATE_BUDGET_MS = 2200;

function parseArgs(argv) {
  const out = { variant: "hybrid", intraop: null, repeat: 5, json: null, freeze: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--variant") out.variant = argv[++i];
    else if (argv[i] === "--intraop") out.intraop = Number(argv[++i]);
    else if (argv[i] === "--repeat") out.repeat = Number(argv[++i]);
    else if (argv[i] === "--json") out.json = argv[++i];
    else if (argv[i] === "--freeze") out.freeze = true;
    else { error(`未知参数: ${argv[i]}`); process.exit(EXIT_SETUP); }
  }
  return out;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  const args = parseArgs(process.argv);

  // --- 前置检查 ---------------------------------------------------------------
  const sessionJs = path.join(DIST, "tinyclick-session.js");
  const workerJs = path.join(DIST, "tinyclick-worker.js");
  for (const p of [sessionJs, workerJs]) {
    if (!fs.existsSync(p)) {
      error(`编译产物缺失: ${p}\n  先运行: cd companion && node node_modules/typescript/bin/tsc -p tsconfig.test.json`);
      process.exit(EXIT_SETUP);
    }
  }
  const modelDir = path.join(REPO_ROOT, "scripts", "spike", "s3-golden", `onnx-${args.variant}`);
  if (!fs.existsSync(modelDir)) {
    error(`模型目录不存在: ${modelDir}（模型二进制不进 git，需本地 spike 产物）`);
    process.exit(EXIT_SETUP);
  }
  const framePath = path.join(REPO_ROOT, "scripts", "spike", "s1-tinyclick-onnx", "reference-frame.rgba");
  if (!fs.existsSync(framePath)) {
    error(`参考帧缺失: ${framePath}\n  生成: .venv python 将 s1 test_image.png convert('RGBA').tobytes() 落盘`);
    process.exit(EXIT_SETUP);
  }
  const manifestPath = path.join(REPO_ROOT, "companion", "models.manifest.json");
  const tokenizerPath = path.join(REPO_ROOT, "companion", "assets", "tinyclick", "tokenizer.json");

  // --- 加载编译产物（生产管线同构） ---------------------------------------------
  const { TinyClickSession, loadVerifiedTokenizer } = require(sessionJs);
  const { loadModelManifest } = require(path.join(DIST, "model-manifest.js"));

  const manifest = await loadModelManifest(manifestPath);
  const tokenizer = await loadVerifiedTokenizer(manifest, "tinyclick", args.variant, tokenizerPath);
  ok(`tokenizer 复验通过（manifest 绑定 sha256）: ${tokenizerPath}`);

  const warmupLogs = [];
  const session = new TinyClickSession({
    manifest,
    tokenizer,
    variant: args.variant,
    modelDir,
    intraOpNumThreads: args.intraop ?? undefined, // null → 真实 CPU 拓扑
    log: (event, payload) => {
      if (event === "computeruse.model.warmup") warmupLogs.push(payload);
      console.log(`[verify-tinyclick-worker] LOG:   ${event} ${JSON.stringify(payload)}`);
    },
  });

  // --- prepare（冷启动 + warmup） ------------------------------------------------
  const rssBefore = process.memoryUsage().rss;
  const tPrepare = performance.now();
  await session.prepare();
  const prepareMs = performance.now() - tPrepare;
  const rssWarm = process.memoryUsage().rss;
  const warmup = warmupLogs[0] ?? {};
  ok(`prepare 完成: ${Math.round(prepareMs)}ms（load+会话创建 ${warmup.totalCreateMs ?? "?"}ms，warmup e2e ${warmup.warmupMs ?? "?"}ms，intraOp=${warmup.intraOpNumThreads ?? "?"}）`);
  if ((warmup.totalCreateMs ?? 0) > CREATE_BUDGET_MS) {
    warn(`会话创建 ${warmup.totalCreateMs}ms 超预算 ${CREATE_BUDGET_MS}ms（仅告警；M6 包线项）`);
  }

  // --- N 次推理（token parity 门禁 + 稳态延迟） -----------------------------------
  const e2e = [];
  const wall = [];
  let firstResult = null;
  for (let i = 0; i < args.repeat; i++) {
    // transfer 会 detach buffer——每次重读帧（生产亦为每帧新采集）
    const rgba = fs.readFileSync(framePath);
    const t0 = performance.now();
    const out = await session.locate(REF_COMMAND, { rgba, width: FRAME_W, height: FRAME_H });
    wall.push(performance.now() - t0);
    e2e.push(out.timings.totalMs);
    if (i === 0) firstResult = out;
  }
  const rssAfter = process.memoryUsage().rss;

  // --- token parity 门禁 ----------------------------------------------------------
  const ids = firstResult.tokenIds;
  const parity =
    ids.length === REF_TOKEN_IDS.length && ids.every((v, i) => v === REF_TOKEN_IDS[i]);
  if (!parity) {
    error(`token parity FAIL: 实际 ${JSON.stringify(ids)}，参考 ${JSON.stringify(REF_TOKEN_IDS)}`);
    process.exit(EXIT_FAIL);
  }
  ok(`token parity 7/7: ${JSON.stringify(ids)}`);
  const pt = firstResult.point;
  const pxOk = pt && Math.abs(pt.x - REF_POINT[0]) <= 1 && Math.abs(pt.y - REF_POINT[1]) <= 1;
  if (!pxOk) {
    error(`point 超容差: 实际 ${JSON.stringify(pt)}，参考 [${REF_POINT}]（±1px）`);
    process.exit(EXIT_FAIL);
  }
  ok(`point ${JSON.stringify(pt)} ≈ [${REF_POINT}]（±1px，round vs HF floor）`);

  // --- 报告 -----------------------------------------------------------------------
  const mb = (b) => Math.round((b / 1024 / 1024) * 10) / 10;
  const report = {
    variant: args.variant,
    intraOp: warmup.intraOpNumThreads ?? null,
    repeat: args.repeat,
    prepareMs: Math.round(prepareMs),
    createMs: warmup.createMs ?? null,
    totalCreateMs: warmup.totalCreateMs ?? null,
    warmupInferMs: warmup.warmupMs ?? null,
    e2eMs: { min: Math.round(Math.min(...e2e)), median: Math.round(median(e2e)), max: Math.round(Math.max(...e2e)) },
    wallMs: { min: Math.round(Math.min(...wall)), median: Math.round(median(wall)), max: Math.round(Math.max(...wall)) },
    firstInferTimings: firstResult.timings,
    rssMB: { beforePrepare: mb(rssBefore), warm: mb(rssWarm), afterInfers: mb(rssAfter) },
    tokenParity: parity,
    point: pt,
    at: new Date().toISOString(),
  };
  console.log("[verify-tinyclick-worker] REPORT: " + JSON.stringify(report, null, 2));
  // F-1：默认时间戳新文件（非冻结）；--freeze 才写 envelope §8 锚定的冻结名
  const canonical = `i2-worker-benchmark-${args.variant}${args.intraop ? `@${args.intraop}` : ""}.json`;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const outName = args.freeze
    ? canonical
    : `i2-worker-benchmark-${args.variant}${args.intraop ? `@${args.intraop}` : ""}-${ts}.json`;
  const jsonPath = args.json ?? path.join(REPO_ROOT, "scripts", "spike", "s3-golden", outName);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  ok(`基准数据已写入: ${jsonPath}${args.freeze ? "（--freeze：冻结锚点已覆写）" : "（时间戳新文件，冻结锚点未动）"}`);

  await session.dispose();
  ok("门禁通过：token 7/7 + point ±1px（spike 复现门槛）");
  process.exit(EXIT_OK);
}

main().catch((err) => {
  error(err && err.stack ? err.stack : String(err));
  process.exit(EXIT_SETUP);
});
