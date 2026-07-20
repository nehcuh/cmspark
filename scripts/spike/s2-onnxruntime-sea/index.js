// WP5 spike S-2: verify onnxruntime-node can be required and run an
// InferenceSession under the "SEA exe + esbuild external + side-by-side
// node_modules" layout (same layout as scripts/build-windows-exe.ps1).
//
// Run modes:
//   dev:  node index.js                     (node_modules in this dir)
//   sea:  dist-app/s2-ort-sea.exe           (node_modules next to the exe)
//
// Exit codes: 0 = inference result correct, 1 = wrong result, 2 = load/run error.

const path = require("path");
const fs = require("fs");
const Module = require("module");

function isSea() {
  try {
    // node:sea exists since Node 20; isSea() reports whether running as SEA.
    const sea = require("node:sea");
    return sea.isSea();
  } catch {
    return false;
  }
}

(async () => {
  const sea = isSea();
  const baseDir = sea ? path.dirname(process.execPath) : __dirname;
  console.log("[s2] node:", process.version, "platform:", process.platform, "arch:", process.arch);
  console.log("[s2] isSea:", sea);
  console.log("[s2] execPath:", process.execPath);
  console.log("[s2] baseDir:", baseDir);

  // Step 1: bare require — expected to FAIL under SEA (main-script require only
  // resolves builtins); recorded to document why createRequire is mandatory.
  let ort = null;
  let usedRequire = null;
  try {
    ort = require("onnxruntime-node");
    usedRequire = require;
    console.log("[s2] bare require('onnxruntime-node'): OK");
  } catch (err) {
    console.log("[s2] bare require('onnxruntime-node'): FAIL ->", err.code || err.message);
  }

  // Step 2: SEA-style resolver — same pattern as companion/src/tray/systray2-bridge.ts
  if (!ort) {
    const seaRequire = Module.createRequire(process.execPath);
    ort = seaRequire("onnxruntime-node");
    usedRequire = seaRequire;
    console.log("[s2] Module.createRequire(process.execPath)('onnxruntime-node'): OK");
  }

  const pkgPath = usedRequire.resolve("onnxruntime-node/package.json");
  const pkgVer = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  console.log("[s2] onnxruntime-node version:", pkgVer, "at", path.dirname(pkgPath));

  // Step 3: load dummy model (Add: y = x + [1,1,1]) placed next to script/exe
  const modelPath = path.join(baseDir, "dummy_add.onnx");
  console.log("[s2] modelPath:", modelPath, "exists:", fs.existsSync(modelPath));
  const session = await ort.InferenceSession.create(modelPath);
  console.log("[s2] session created. inputNames:", session.inputNames, "outputNames:", session.outputNames);

  const input = new ort.Tensor("float32", Float32Array.from([1, 2, 3]), [1, 3]);
  const results = await session.run({ x: input });
  const outName = session.outputNames[0];
  const y = Array.from(results[outName].data);
  console.log("[s2] input  x:", [1, 2, 3]);
  console.log("[s2] output y:", y);

  const expected = [2, 3, 4];
  const ok = y.length === 3 && y.every((v, i) => Math.abs(v - expected[i]) < 1e-6);
  console.log("[s2] RESULT:", ok ? "PASS" : "FAIL", "(expected [2,3,4])");
  process.exitCode = ok ? 0 : 1;
})().catch((err) => {
  console.error("[s2] FATAL:", err && err.stack ? err.stack : err);
  process.exitCode = 2;
});