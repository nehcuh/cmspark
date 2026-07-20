// WP5 probe W1: worker_threads × SEA × createRequire combination.
// Main embeds the worker source (SEA has no fs access to bundled files, so
// workers must be created with eval:true from an inline string).
// Test matrix:
//   (a) worker: createRequire(process.execPath) -> onnxruntime-node -> dummy
//       inference. Proves native binding loads in worker context under SEA.
//   (b) worker: JS exception -> 'error' event, main must survive.
//   (c) worker: corrupt ONNX file -> ORT native-side failure surfaces as a JS
//       exception, main must survive.
// Run mode is logged via node:sea so dev vs SEA runs are distinguishable.
const path = require("path");
const fs = require("fs");
const { Worker } = require("worker_threads");

const WORKER_SRC = `
const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs");
const Module = require("module");

(async () => {
  const { task, baseDir } = workerData;
  // dev: bare require resolves node_modules from cwd; SEA: must createRequire(execPath)
  let req, how;
  try { req = require; req.resolve("onnxruntime-node"); how = "bare-require"; }
  catch { req = Module.createRequire(process.execPath); how = "createRequire(execPath)"; }
  const ort = req("onnxruntime-node");
  parentPort.postMessage({ phase: task, event: "ort-loaded", how, version: req("onnxruntime-node/package.json").version });

  if (task === "infer") {
    const modelPath = path.join(baseDir, "dummy_add.onnx");
    const session = await ort.InferenceSession.create(modelPath);
    const input = new ort.Tensor("float32", Float32Array.from([1, 2, 3]), [1, 3]);
    const results = await session.run({ x: input });
    const y = Array.from(results[session.outputNames[0]].data);
    parentPort.postMessage({ phase: "infer", event: "result", y });
    return;
  }
  if (task === "js-crash") {
    // throw outside the promise chain so it is genuinely UNCAUGHT
    setImmediate(() => { throw new Error("deliberate JS exception in worker"); });
    return;
  }
  if (task === "corrupt-model") {
    const bad = path.join(baseDir, "corrupt.onnx");
    fs.writeFileSync(bad, Buffer.from("this is not an onnx model"));
    await ort.InferenceSession.create(bad); // expected to throw (JS-level)
    parentPort.postMessage({ phase: "corrupt-model", event: "unexpected-success" });
    return;
  }
})().catch((err) => {
  parentPort.postMessage({ phase: workerData.task, event: "worker-caught", message: String(err && err.message || err) });
});
`;

function isSea() {
  try {
    return require("node:sea").isSea();
  } catch {
    return false;
  }
}

function runWorker(task, baseDir) {
  return new Promise((resolve) => {
    const w = new Worker(WORKER_SRC, { eval: true, workerData: { task, baseDir } });
    const msgs = [];
    let error = null;
    w.on("message", (m) => msgs.push(m));
    w.on("error", (err) => { error = String(err && err.message || err); });
    w.on("exit", (code) => resolve({ msgs, error, exitCode: code }));
  });
}

(async () => {
  const sea = isSea();
  const baseDir = sea ? path.dirname(process.execPath) : __dirname;
  console.log("[w1] node:", process.version, "isSea:", sea, "execPath:", process.execPath);

  // (a) inference in worker
  const a = await runWorker("infer", baseDir);
  const loaded = a.msgs.find((m) => m.event === "ort-loaded");
  const result = a.msgs.find((m) => m.event === "result");
  const caughtA = a.msgs.find((m) => m.event === "worker-caught");
  console.log("[w1] (a) ort-loaded:", JSON.stringify(loaded || null));
  if (caughtA) console.log("[w1] (a) worker-caught:", caughtA.message);
  if (a.error) console.log("[w1] (a) worker error event:", a.error);
  console.log("[w1] (a) inference y:", JSON.stringify(result ? result.y : null), "exitCode:", a.exitCode);
  const aPass = !!result && JSON.stringify(result.y) === "[2,3,4]" && a.exitCode === 0;

  // (b) JS exception isolation
  const b = await runWorker("js-crash", baseDir);
  console.log("[w1] (b) worker error event:", b.error, "exitCode:", b.exitCode);
  const bPass = !!b.error && /deliberate JS exception/.test(b.error) && b.exitCode === 1;

  // (c) corrupt model -> JS-level exception, main survives
  const c = await runWorker("corrupt-model", baseDir);
  const caughtC = c.msgs.find((m) => m.event === "worker-caught");
  console.log("[w1] (c) worker-caught:", caughtC ? caughtC.message : null, "| error event:", c.error, "exitCode:", c.exitCode);
  const cPass = !!caughtC || !!c.error; // either caught inside or surfaced as error event

  console.log("[w1] main process ALIVE after all worker tests");
  console.log("[w1] RESULT:", aPass && bPass && cPass ? "PASS" : "FAIL",
    JSON.stringify({ a: aPass, b: bPass, c: cPass }));
  process.exitCode = aPass && bPass && cPass ? 0 : 1;
})().catch((err) => {
  console.error("[w1] FATAL:", err && err.stack ? err.stack : err);
  process.exitCode = 2;
});
