#!/usr/bin/env node
// WP5 I1 WI-1.6 — ORT×SEA packaging smoke gate (B7 acceptance).
// ============================================================
// Replays the S-2 spike pipeline as a scripted, repeatable gate:
//   1. Assert the STAGED onnxruntime-node is the win32/x64-only payload
//      (<=70MB budget; no darwin/linux dirs — whitelist copy in
//      build-windows-exe.ps1 is the single implementation, this script
//      consumes and verifies its output rather than re-implementing it).
//   2. Assemble a dummy SEA app: esbuild bundle (--external:onnxruntime-node)
//      + sea blob + runtime node.exe + postject injection, with the STAGED
//      onnxruntime-node placed next to the exe.
//   3. Run it: Module.createRequire(process.execPath) must load ORT and a
//      dummy Add model must infer [1,2,3] -> [2,3,4].
//
// Usage:
//   node scripts/verify-ort-sea.js [stagingDir]
//     stagingDir  default: dist-package/cmspark-windows-x64 (ps1 output)
//
// Exit codes: 0 = all checks pass; 1 = assertion failure; 2 = setup error.

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_SETUP = 2;

const ORT_BUDGET_BYTES = 70 * 1024 * 1024;

function info(msg) { console.log(`[verify-ort-sea] INFO:  ${msg}`); }
function ok(msg) { console.log(`[verify-ort-sea] OK:    ${msg}`); }
function error(msg) { console.error(`[verify-ort-sea] ERROR: ${msg}`); }

function dirBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirBytes(p);
    else if (entry.isFile()) total += fs.statSync(p).size;
  }
  return total;
}

// Smoke main: mirrors scripts/spike/s2-onnxruntime-sea/index.js steps 2-3
// (bare-require documentation step omitted — the gate asserts the working path).
const SMOKE_MAIN = String.raw`
const path = require("path");
const fs = require("fs");
const Module = require("module");
(async () => {
  const sea = require("node:sea").isSea();
  const baseDir = sea ? path.dirname(process.execPath) : __dirname;
  const seaRequire = Module.createRequire(process.execPath);
  const ort = seaRequire("onnxruntime-node");
  const pkgPath = seaRequire.resolve("onnxruntime-node/package.json");
  console.log("[smoke] isSea:", sea, "ort:", JSON.parse(fs.readFileSync(pkgPath, "utf8")).version);
  const session = await ort.InferenceSession.create(path.join(baseDir, "dummy_add.onnx"));
  const input = new ort.Tensor("float32", Float32Array.from([1, 2, 3]), [1, 3]);
  const results = await session.run({ x: input });
  const y = Array.from(results[session.outputNames[0]].data);
  const expected = [2, 3, 4];
  const pass = y.length === 3 && y.every((v, i) => Math.abs(v - expected[i]) < 1e-6);
  console.log("[smoke] RESULT:", pass ? "PASS" : "FAIL", "y =", y);
  process.exitCode = pass ? 0 : 1;
})().catch((err) => {
  console.error("[smoke] FATAL:", err && err.stack ? err.stack : err);
  process.exitCode = 2;
});
`;

function run(cmd, args, opts) {
  info(`run: ${path.basename(cmd)} ${args.join(" ")}`);
  if (/\.cmd$/i.test(cmd)) {
    // .cmd batch wrappers cannot be spawned directly (CreateProcess runs PE images,
    // not batch files) — route through cmd.exe with a single quoted command line.
    const cmdline = [cmd, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
    return execFileSync("cmd.exe", ["/d", "/s", "/c", cmdline], { stdio: ["ignore", "pipe", "pipe"], ...opts });
  }
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const stagingDir = path.resolve(
    projectRoot,
    process.argv[2] || path.join("dist-package", "cmspark-windows-x64")
  );

  // --- 1. Staged payload assertions -----------------------------------------
  const ortDir = path.join(stagingDir, "node_modules", "onnxruntime-node");
  if (!fs.existsSync(ortDir)) {
    error(`staged onnxruntime-node not found: ${ortDir}`);
    error("Run scripts/build-windows-exe.ps1 first (it whitelist-copies the win32/x64 payload).");
    process.exit(EXIT_SETUP);
  }
  const napiDir = path.join(ortDir, "bin", "napi-v6");
  for (const platform of ["darwin", "linux"]) {
    if (fs.existsSync(path.join(napiDir, platform))) {
      error(`NON-TARGET PLATFORM SHIPPED: bin/napi-v6/${platform} must not be staged (B7 whitelist)`);
      process.exit(EXIT_FAIL);
    }
  }
  const stagedBytes = dirBytes(ortDir);
  const stagedMB = (stagedBytes / 1024 / 1024).toFixed(1);
  if (stagedBytes > ORT_BUDGET_BYTES) {
    error(`staged onnxruntime-node ${stagedMB}MB exceeds 70MB budget (expected ~63MB)`);
    process.exit(EXIT_FAIL);
  }
  ok(`staged payload: win32/x64 only, ${stagedMB}MB <= 70MB budget`);

  const dummyModel = path.join(projectRoot, "scripts", "spike", "s2-onnxruntime-sea", "dummy_add.onnx");
  if (!fs.existsSync(dummyModel)) {
    error(`dummy model missing: ${dummyModel} (S-2 spike artifact, expected in repo)`);
    process.exit(EXIT_SETUP);
  }

  // --- 2. Assemble dummy SEA app ---------------------------------------------
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-ort-sea-"));
  let code;
  try {
    code = await smoke(workDir, projectRoot, stagingDir, dummyModel);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  process.exit(code);
}

// WP5 I3 WI-3.5② 修复：本函数原以 process.exit 内联于 try 体（exit-in-try），
// finally 的临时目录清理被跳过导致 verify-ort-sea-* 泄漏。现改为返回出口码，
// 由外层 finally 清理后统一 process.exit（exec 异常仍向上传播，经 finally 后由
// main().catch 收口，路径不变）。
async function smoke(workDir, projectRoot, stagingDir, dummyModel) {
    // The whole staged node_modules is the artifact under test (whitelist output
    // of build-windows-exe.ps1: onnxruntime-node + onnxruntime-common [+ systray2
    // deps in a full build]) — copy it verbatim next to the exe.
    const stagedNodeModules = path.join(stagingDir, "node_modules");
    fs.cpSync(stagedNodeModules, path.join(workDir, "node_modules"), { recursive: true });
    fs.copyFileSync(dummyModel, path.join(workDir, "dummy_add.onnx"));

    fs.writeFileSync(path.join(workDir, "smoke-main.cjs"), SMOKE_MAIN);

    // esbuild bundle (same external style as build-windows-exe.ps1)
    const esbuildBin = path.join(projectRoot, "companion", "node_modules", "esbuild", "bin", "esbuild");
    if (!fs.existsSync(esbuildBin)) {
      error(`esbuild not found: ${esbuildBin} (run npm install in companion/ first)`);
      return EXIT_SETUP;
    }
    run(process.execPath, [
      esbuildBin, path.join(workDir, "smoke-main.cjs"),
      "--bundle", "--platform=node", "--target=node22",
      "--external:onnxruntime-node",
      `--outfile=${path.join(workDir, "smoke-bundle.cjs")}`,
    ]);

    // SEA blob
    fs.writeFileSync(
      path.join(workDir, "sea-config.json"),
      JSON.stringify({ main: "smoke-bundle.cjs", output: "sea-prep.blob" })
    );
    run(process.execPath, ["--experimental-sea-config", "sea-config.json"], { cwd: workDir });
    if (!fs.existsSync(path.join(workDir, "sea-prep.blob"))) {
      error("sea-prep.blob not generated");
      return EXIT_SETUP;
    }

    // exe = runtime node + postject injection (same postject version as ps1)
    const exePath = path.join(workDir, "ort-smoke.exe");
    fs.copyFileSync(process.execPath, exePath);
    const runtimeDir = path.dirname(process.execPath);
    const npxCandidates = [
      path.join(runtimeDir, "npx.cmd"),
      path.join(runtimeDir, "npx"),
      "npx.cmd",
      "npx",
    ];
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
      error(`postject injection failed via all npx candidates: ${lastErr && lastErr.message}`);
      return EXIT_SETUP;
    }

    // --- 3. Run the dummy SEA exe ---------------------------------------------
    const out = run(exePath, [], { cwd: workDir }).toString("utf-8");
    process.stdout.write(out);
    if (!out.includes("[smoke] RESULT: PASS")) {
      error("dummy SEA inference did not report PASS");
      return EXIT_FAIL;
    }
    ok("dummy SEA exe: createRequire(execPath) loaded staged ORT; inference [1,2,3] -> [2,3,4] PASS");

    console.log("");
    ok("All gates passed: staged payload whitelist+size, SEA load, dummy inference.");
    return EXIT_OK;
}

main().catch((e) => {
  if (e && e.status !== undefined && e.stdout) {
    // execFileSync non-zero exit from the smoke exe
    process.stdout.write(e.stdout ? e.stdout.toString() : "");
    process.stderr.write(e.stderr ? e.stderr.toString() : "");
    error(`smoke exe exited with code ${e.status}`);
    process.exit(EXIT_FAIL);
  }
  error(`Unexpected error: ${e && e.message ? e.message : e}`);
  process.exit(EXIT_SETUP);
});
