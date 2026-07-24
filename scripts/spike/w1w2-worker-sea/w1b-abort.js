// WP5 probe W1b: native-level fault propagation worker -> main.
// (1) process.abort() in a worker — Node intercepts it (JS error), main survives.
// (2) V8 --abort-on-uncaught-exception set inside the worker, then an uncaught
//     throw: V8 aborts the whole OS process. Expected: "main survived" is never
//     printed and the process exit code is non-zero (SIGABRT / 0xC0000409).
// Run standalone: node w1b-abort.js <1|2>; inspect exit code.
const mode = process.argv[2] || "1";
const { Worker } = require("worker_threads");

const src1 = `
  const { parentPort } = require("worker_threads");
  parentPort.postMessage("worker about to process.abort()");
  process.abort();
`;
const src2 = `
  const { parentPort } = require("worker_threads");
  require("v8").setFlagsFromString("--abort-on-uncaught-exception");
  parentPort.postMessage("worker armed V8 abort; throwing uncaught");
  setImmediate(() => { throw new Error("trigger v8 abort from worker"); });
`;

const w = new Worker(mode === "2" ? src2 : src1, { eval: true });
w.on("message", (m) => console.log("[w1b] msg:", m));
w.on("error", (e) => console.log("[w1b] error event:", e.message));
w.on("exit", (code) => console.log("[w1b] worker exit:", code));
setTimeout(() => console.log("[w1b] main survived 3s (mode " + mode + ")"), 3000);
