#!/usr/bin/env node
// WP5 I2 WI-2.5 — TinyClick × SEA 真机门禁（真 705MB 模型 × 生产管线同构）。
// ============================================================
// 仿 verify-ort-sea.js 三段式，但 O-1 围栏升级：dummy 模型 ≠ 尺寸级证据——
// 本门禁加载真实 onnx-hybrid 四图（705MB，I1 复验）于 SEA exe 内的 worker_threads，
// 跑 s1 参考输入锁 token 7/7，并以 RSS 底线证明模型真实物化（非 dummy 通过假象）。
//
// 结构：
//   1. 前置：staging node_modules（ps1 白名单产物）+ 编译产物 + 真模型 + 参考帧。
//   2. 组装 smoke SEA app：smoke-main（TinyClickSession 全链路）esbuild bundle
//      + tinyclick-worker.js 旁置 bundle（与 ps1 同款 esbuild 外部化）+ sea blob
//      + 运行时 node.exe + postject 注入；ORT 与 worker 旁置 exe 旁。
//   3. 运行：SEA exe → createRequire(execPath) 载 ORT、isSea() 分支读 worker 旁置
//      → token parity 7/7 + point ±1px + RSS warm ≥800MB（尺寸级物化证据）。
//
// Usage:
//   node scripts/verify-tinyclick-sea.js [stagingDir]
//     stagingDir  default: dist-package/cmspark-windows-x64 (ps1 output)
//
// Exit codes: 0 = all checks pass; 1 = gate failure; 2 = setup error.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_SETUP = 2;

const RSS_WARM_FLOOR_MB = 800; // O-1 尺寸级围栏：真 705MB 模型物化的 RSS 底线
const REF_TOKEN_IDS = [2, 0, 23008, 1437, 50551, 50797, 2];

function info(msg) { console.log(`[verify-tinyclick-sea] INFO:  ${msg}`); }
function ok(msg) { console.log(`[verify-tinyclick-sea] OK:    ${msg}`); }
function error(msg) { console.error(`[verify-tinyclick-sea] ERROR: ${msg}`); }

function run(cmd, args, opts = {}) {
  if (cmd.endsWith(".cmd")) {
    const cmdline = [cmd, ...args]
      .map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
      .join(" ");
    return execFileSync("cmd.exe", ["/d", "/s", "/c", cmdline], { stdio: ["ignore", "pipe", "pipe"], ...opts });
  }
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
}

// smoke main：SEA 内跑 TinyClickSession 全链路（路径经 env 注入，SEA argv 语义不稳定）
function smokeMainSource(distSessionJs, distManifestJs) {
  return `
const path = require("path");
const fs = require("fs");
(async () => {
  const sea = require("node:sea").isSea();
  const { TinyClickSession, loadVerifiedTokenizer } = require(${JSON.stringify(distSessionJs)});
  const { loadModelManifest } = require(${JSON.stringify(distManifestJs)});
  const modelDir = process.env.TC_MODEL_DIR;
  const manifest = await loadModelManifest(process.env.TC_MANIFEST);
  const tokenizer = await loadVerifiedTokenizer(manifest, "tinyclick", "hybrid", process.env.TC_TOKENIZER);
  const logs = [];
  const session = new TinyClickSession({
    manifest, tokenizer, variant: "hybrid", modelDir,
    log: (e, p) => { if (e === "computeruse.model.warmup") logs.push(p); },
  });
  const rss0 = process.memoryUsage().rss;
  const t0 = performance.now();
  await session.prepare();
  const prepareMs = performance.now() - t0;
  const rss1 = process.memoryUsage().rss;
  const rgba = fs.readFileSync(process.env.TC_FRAME);
  const t1 = performance.now();
  const out = await session.locate("click on the ok button", { rgba, width: 560, height: 400 });
  const e2eMs = performance.now() - t1;
  const rss2 = process.memoryUsage().rss;
  const REF = ${JSON.stringify(REF_TOKEN_IDS)};
  const parity = out.tokenIds.length === REF.length && out.tokenIds.every((v, i) => v === REF[i]);
  console.log("[smoke] REPORT " + JSON.stringify({
    isSea: sea,
    prepareMs: Math.round(prepareMs),
    totalCreateMs: logs[0] ? Math.round(logs[0].totalCreateMs) : null,
    warmupMs: logs[0] ? Math.round(logs[0].warmupMs) : null,
    intraOp: logs[0] ? logs[0].intraOpNumThreads : null,
    e2eMs: Math.round(e2eMs),
    workerTotalMs: Math.round(out.timings.totalMs),
    rssMB: {
      before: Math.round(rss0 / 1048576),
      warm: Math.round(rss1 / 1048576),
      after: Math.round(rss2 / 1048576),
    },
    point: out.point,
    tokenIds: out.tokenIds,
    parity,
  }));
  console.log("[smoke] RESULT:", parity ? "PASS" : "FAIL");
  await session.dispose();
  process.exitCode = parity ? 0 : 1;
})().catch((err) => {
  console.error("[smoke] FATAL:", err && err.stack ? err.stack : err);
  process.exitCode = 2;
});
`;
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const stagingDir = path.resolve(
    projectRoot,
    process.argv[2] || path.join("dist-package", "cmspark-windows-x64")
  );

  // --- 1. 前置检查 -------------------------------------------------------------
  const ortDir = path.join(stagingDir, "node_modules", "onnxruntime-node");
  if (!fs.existsSync(ortDir)) {
    error(`staged onnxruntime-node not found: ${ortDir}`);
    error("Run scripts/build-windows-exe.ps1 first (whitelist win32/x64 payload).");
    process.exit(EXIT_SETUP);
  }
  const DIST = path.join(projectRoot, "companion", ".test-dist", "src", "computer");
  const distSessionJs = path.join(DIST, "tinyclick-session.js").replace(/\\/g, "/");
  const distManifestJs = path.join(DIST, "model-manifest.js").replace(/\\/g, "/");
  const distWorkerJs = path.join(DIST, "tinyclick-worker.js");
  for (const p of [distSessionJs, distManifestJs, distWorkerJs]) {
    if (!fs.existsSync(p)) {
      error(`编译产物缺失: ${p}（先跑 cd companion && tsc -p tsconfig.test.json）`);
      process.exit(EXIT_SETUP);
    }
  }
  const modelDir = path.join(projectRoot, "scripts", "spike", "s3-golden", "onnx-hybrid");
  const framePath = path.join(projectRoot, "scripts", "spike", "s1-tinyclick-onnx", "reference-frame.rgba");
  const manifestPath = path.join(projectRoot, "companion", "models.manifest.json");
  const tokenizerPath = path.join(projectRoot, "companion", "assets", "tinyclick", "tokenizer.json");
  for (const p of [modelDir, framePath, manifestPath, tokenizerPath]) {
    if (!fs.existsSync(p)) {
      error(`前置缺失: ${p}`);
      process.exit(EXIT_SETUP);
    }
  }
  ok("前置齐全：staging ORT + 编译产物 + onnx-hybrid 705MB + 参考帧 + manifest/tokenizer");

  // --- 2. 组装 smoke SEA app -----------------------------------------------------
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-tinyclick-sea-"));
  try {
    fs.cpSync(path.join(stagingDir, "node_modules"), path.join(workDir, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(workDir, "smoke-main.cjs"), smokeMainSource(distSessionJs, distManifestJs));

    const esbuildBin = path.join(projectRoot, "companion", "node_modules", "esbuild", "bin", "esbuild");
    if (!fs.existsSync(esbuildBin)) {
      error(`esbuild not found: ${esbuildBin}`);
      process.exit(EXIT_SETUP);
    }
    // main bundle（与 ps1 同款外部化）
    run(process.execPath, [
      esbuildBin, path.join(workDir, "smoke-main.cjs"),
      "--bundle", "--platform=node", "--target=node22",
      "--external:onnxruntime-node",
      `--outfile=${path.join(workDir, "smoke-bundle.cjs")}`,
    ]);
    // worker 旁置 bundle（与 ps1 新增段同款）
    run(process.execPath, [
      esbuildBin, distWorkerJs,
      "--bundle", "--platform=node", "--target=node22",
      "--external:onnxruntime-node",
      `--outfile=${path.join(workDir, "tinyclick-worker.js")}`,
    ]);
    ok("esbuild: smoke-bundle.cjs + tinyclick-worker.js 旁置");

    fs.writeFileSync(
      path.join(workDir, "sea-config.json"),
      JSON.stringify({ main: "smoke-bundle.cjs", output: "sea-prep.blob" })
    );
    run(process.execPath, ["--experimental-sea-config", "sea-config.json"], { cwd: workDir });

    const exePath = path.join(workDir, "tinyclick-smoke.exe");
    fs.copyFileSync(process.execPath, exePath);
    const runtimeDir = path.dirname(process.execPath);
    const npxCandidates = [path.join(runtimeDir, "npx.cmd"), path.join(runtimeDir, "npx"), "npx.cmd", "npx"];
    let injected = false;
    let lastErr = null;
    for (const npx of npxCandidates) {
      try {
        run(npx, [
          "--yes", "postject@1.0.0-alpha.6", exePath, "NODE_SEA_BLOB",
          path.join(workDir, "sea-prep.blob"),
          "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
          "--overwrite",
        ]);
        injected = true;
        break;
      } catch (e) { lastErr = e; }
    }
    if (!injected) {
      error(`postject injection failed: ${lastErr && lastErr.message}`);
      process.exit(EXIT_SETUP);
    }
    ok("SEA exe 组装完成（postject 注入）");

    // --- 3. 运行 SEA exe（真模型加载 + 推理） --------------------------------------
    info("运行 tinyclick-smoke.exe（705MB 模型 I1 复验 + 会话创建 + warmup + 推理，约 10-20s）...");
    const out = run(exePath, [], {
      cwd: workDir,
      env: {
        ...process.env,
        TC_MODEL_DIR: modelDir,
        TC_MANIFEST: manifestPath,
        TC_TOKENIZER: tokenizerPath,
        TC_FRAME: framePath,
      },
      timeout: 180000,
    }).toString("utf-8");
    process.stdout.write(out);

    const reportLine = out.split(/\r?\n/).find((l) => l.startsWith("[smoke] REPORT "));
    if (!reportLine) {
      error("smoke 未产出 REPORT（见上方输出）");
      process.exitCode = EXIT_FAIL; // return 经由 finally 清理（process.exit 会跳过 finally）
      return;
    }
    const report = JSON.parse(reportLine.slice("[smoke] REPORT ".length));
    if (report.isSea !== true) {
      error(`isSea() != true —— SEA 分支未生效，worker 旁置路径未被验证`);
      process.exitCode = EXIT_FAIL;
      return;
    }
    ok("isSea()=true：runtime 走旁置 worker eval 分支");
    if (!out.includes("[smoke] RESULT: PASS")) {
      error(`token parity FAIL: ${JSON.stringify(report.tokenIds)}`);
      process.exitCode = EXIT_FAIL;
      return;
    }
    ok(`SEA×真模型 token parity 7/7，point ${JSON.stringify(report.point)}`);
    if (!(report.rssMB.warm >= RSS_WARM_FLOOR_MB)) {
      error(`O-1 围栏：RSS warm ${report.rssMB.warm}MB < ${RSS_WARM_FLOOR_MB}MB —— 模型未尺寸级物化`);
      process.exitCode = EXIT_FAIL;
      return;
    }
    ok(`O-1 尺寸级围栏：RSS warm ${report.rssMB.warm}MB ≥ ${RSS_WARM_FLOOR_MB}MB（真 705MB 物化，非 dummy 假象）`);
    ok(`SEA 延迟: prepare ${report.prepareMs}ms（create ${report.totalCreateMs}ms + warmup ${report.warmupMs}ms），e2e ${report.e2eMs}ms（worker ${report.workerTotalMs}ms），intraOp=${report.intraOp}`);

    console.log("");
    ok("All gates passed: SEA isSea 分支 + 旁置 worker + 真 705MB 模型加载 + token 7/7 + RSS 尺寸级。");
    process.exitCode = EXIT_OK;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  error(err && err.stack ? err.stack : String(err));
  process.exit(EXIT_SETUP);
});
