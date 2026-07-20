#!/usr/bin/env node
// WP5 I3 WI-3.5① — TinyClick golden-set 门禁 harness（生产管线同构 × 真模型 × frozen 锚定）。
// ============================================================
// 路径同构：TinyClickLocator（compiled .test-dist）→ TinyClickSession → 真实
// worker_threads → onnxruntime-node → 真 onnx 模型。与生产唯一差异：编译产物取自
// .test-dist（非 esbuild 包），modelDir 指向 spike 模型，CaptureMeta 为伪采集。
//
// 数据（均在 git）：
//   - cases    : scripts/spike/s3-golden/golden.json（19 case，含 gt 与冻结 input_ids）
//   - frozen 臂: g1-envelope-result.json（hybrid）/ g1-envelope-result-int8.json（int8）
// 图像（spike 产物，gitignore 不入库，本机需在盘）：
//   fixture.jpg→fixture.png；其余 <name>.jpg→eval-<name>.png（与 s3-run.js 同映射）。
//
// 判定纪律（纯逻辑见 companion/src/computer/tinyclick-golden-eval.ts，门禁内单测覆盖）：
//   1. 包线外（非 ASCII 或 tok>38）→ 必须 skipped(tinyclick-envelope:*)，拒绝率 100%
//   2. 包线内 + frozen HIT → 必须 hit 且 dist ≤ frozen.distPx + 2px
//   3. 包线内 + frozen MISS → 仅报告不断言（frozen 锚定纪律，不自造阈值）
//   4. 包线内凡跑推理 → totalMs ≤ frozen.totalMs × 1.5
// 坍缩抑制规避：每 case 新建 TinyClickLocator（坍缩历史任务级，同图异命令合法）。
//
// Usage:
//   node scripts/verify-tinyclick-golden.js [--variant hybrid|int8] [--json OUT]
// Defaults: --variant hybrid
//
// Exit codes: 0 = 全过；1 = 门禁失败；2 = 环境/前置缺失（无 spike 模型时诚实退出，
//             不伪造通过——模型二进制不进 git）。

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Module = require("module");

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_SETUP = 2;

function info(msg) { console.log(`[verify-tinyclick-golden] INFO:  ${msg}`); }
function ok(msg) { console.log(`[verify-tinyclick-golden] OK:    ${msg}`); }
function warn(msg) { console.log(`[verify-tinyclick-golden] WARN:  ${msg}`); }
function error(msg) { console.error(`[verify-tinyclick-golden] ERROR: ${msg}`); }

const REPO_ROOT = path.resolve(__dirname, "..");
const DIST = path.join(REPO_ROOT, "companion", ".test-dist", "src", "computer");
const SPIKE = path.join(REPO_ROOT, "scripts", "spike", "s3-golden");
/** pngjs 从 w1w2-worker-sea 的 node_modules 解析（与 s3-run.js 同款）。 */
const w2Require = Module.createRequire(path.join(REPO_ROOT, "scripts", "spike", "w1w2-worker-sea", "package.json"));

const FROZEN_BY_VARIANT = {
  hybrid: "g1-envelope-result.json",
  int8: "g1-envelope-result-int8.json",
};

function parseArgs(argv) {
  const out = { variant: "hybrid", json: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--variant") out.variant = argv[++i];
    else if (argv[i] === "--json") out.json = argv[++i];
    else { error(`未知参数: ${argv[i]}`); process.exit(EXIT_SETUP); }
  }
  if (!FROZEN_BY_VARIANT[out.variant]) {
    error(`未知变体: ${out.variant}（支持 hybrid|int8）`);
    process.exit(EXIT_SETUP);
  }
  return out;
}

/** golden.json image → spike PNG 文件名（与 s3-run.js:128 同映射）。 */
function imageToPng(image) {
  return image === "fixture.jpg" ? "fixture.png" : "eval-" + image.replace(".jpg", ".png");
}

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

async function main() {
  const args = parseArgs(process.argv);

  // --- 前置检查：编译产物 -------------------------------------------------------
  const need = ["tinyclick-golden-eval.js", "tinyclick-locator.js", "tinyclick-session.js", "model-manifest.js"];
  for (const f of need) {
    const p = path.join(DIST, f);
    if (!fs.existsSync(p)) {
      error(`编译产物缺失: ${p}\n  先运行: cd companion && node node_modules/typescript/bin/tsc -p tsconfig.test.json`);
      process.exit(EXIT_SETUP);
    }
  }

  // --- 前置检查：模型目录（4 个 onnx，逐个点名；模型二进制不进 git） --------------
  const modelDir = path.join(SPIKE, `onnx-${args.variant}`);
  const onnxFiles = ["vision_encoder.onnx", "embed_tokens.onnx", "encoder_model.onnx", "decoder_model.onnx"];
  for (const f of onnxFiles) {
    if (!fs.existsSync(path.join(modelDir, f))) {
      error(`模型文件缺失: ${path.join(modelDir, f)}\n  模型二进制不进 git，需本地 spike 产物（scripts/spike/s3-golden/onnx-${args.variant}/）。`);
      process.exit(EXIT_SETUP);
    }
  }

  // --- 前置检查：数据与图像 -------------------------------------------------------
  const goldenPath = path.join(SPIKE, "golden.json");
  const frozenPath = path.join(SPIKE, FROZEN_BY_VARIANT[args.variant]);
  for (const p of [goldenPath, frozenPath]) {
    if (!fs.existsSync(p)) {
      error(`数据文件缺失: ${p}（该文件应已入库）`);
      process.exit(EXIT_SETUP);
    }
  }
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  const frozen = JSON.parse(fs.readFileSync(frozenPath, "utf8"));
  const pngByImage = new Map();
  for (const c of golden.cases) {
    if (pngByImage.has(c.image)) continue;
    const p = path.join(SPIKE, imageToPng(c.image));
    if (!fs.existsSync(p)) {
      error(`golden 图像缺失: ${p}（spike 产物 gitignore 不入库，需本机重新生成）`);
      process.exit(EXIT_SETUP);
    }
    pngByImage.set(c.image, p);
  }

  // --- 加载编译产物（生产管线同构） ---------------------------------------------
  const { TinyClickSession, loadVerifiedTokenizer } = require(path.join(DIST, "tinyclick-session.js"));
  const { TinyClickLocator } = require(path.join(DIST, "tinyclick-locator.js"));
  const { loadModelManifest } = require(path.join(DIST, "model-manifest.js"));
  const evalMod = require(path.join(DIST, "tinyclick-golden-eval.js"));
  const { PNG } = w2Require("pngjs");

  const manifest = await loadModelManifest(path.join(REPO_ROOT, "companion", "models.manifest.json"));
  const tokenizer = await loadVerifiedTokenizer(
    manifest, "tinyclick", args.variant,
    path.join(REPO_ROOT, "companion", "assets", "tinyclick", "tokenizer.json"),
  );
  ok("tokenizer 复验通过（manifest 绑定 sha256）");

  const session = new TinyClickSession({
    manifest,
    tokenizer,
    variant: args.variant,
    modelDir,
    log: (event, payload) => info(`LOG ${event} ${JSON.stringify(payload)}`),
  });
  await session.prepare();
  ok(`session prepare 完成（variant=${args.variant}）`);

  // --- 逐 case 评估（每 case 新建 locator：坍缩历史任务级，互不抑制） -------------
  const verdicts = [];
  for (let idx = 0; idx < golden.cases.length; idx++) {
    const c = golden.cases[idx];
    const anchor = frozen.golden?.[String(idx)] ?? null;
    const pngPath = pngByImage.get(c.image);

    const locator = new TinyClickLocator({
      session,
      tokenizer,
      decodeFrame: async () => {
        const png = PNG.sync.read(fs.readFileSync(pngPath));
        return { rgba: png.data, width: png.width, height: png.height };
      },
    });

    // 伪 CaptureMeta：rect/client = 图像空间原点坐标（预测点即图像像素坐标，与 gt 可比）
    const shot = {
      hwnd: 0,
      rect: { x: 0, y: 0, w: 0, h: 0 },
      client: { x: 0, y: 0, w: 0, h: 0 },
      dpi: 96,
      path: pngPath,
      sha256: sha256File(pngPath), // 同图同 sha；每 case 新 locator 故无跨 case 抑制
      black: false,
      fallbackUsed: false,
      osrBlackSuspected: false,
    };

    const out = await locator.locate({ command: c.command, shot });
    const obs =
      out.kind === "hit"
        ? { kind: "hit", point: out.point, totalMs: out.timings.totalMs }
        : { kind: out.kind, reason: out.reason };

    const v = evalMod.evaluateGoldenCase(c, anchor, obs);
    verdicts.push(v);
    const mark = v.status === "pass" ? "PASS" : v.status === "fail" ? "FAIL" : "REPORT";
    console.log(`[verify-tinyclick-golden] ${mark}:  ${c.id} [${c.group}/${c.lang}] ${v.detail}`);
  }

  // --- 汇总 ---------------------------------------------------------------------
  const summary = evalMod.summarizeGolden(verdicts);
  const summaryLine = `汇总: total=${summary.total} pass=${summary.pass} fail=${summary.fail} report=${summary.report}`;
  if (args.json) {
    fs.writeFileSync(
      args.json,
      JSON.stringify({ variant: args.variant, at: new Date().toISOString(), summary, verdicts }, null, 2),
    );
    info(`报告已写入: ${args.json}`);
  }
  if (!summary.ok) {
    error(`${summaryLine} —— 门禁失败`);
    process.exit(EXIT_FAIL);
  }
  ok(`${summaryLine} —— golden 门禁通过`);
  process.exit(EXIT_OK);
}

main().catch((e) => {
  error(`未捕获异常: ${e && e.stack ? e.stack : e}`);
  process.exit(EXIT_SETUP);
});
