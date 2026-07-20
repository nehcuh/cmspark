// WP5 probe W2 main: spawns w2-worker.js for correctness + latency modes,
// prints results, writes w2-result.json.
const path = require("path");
const fs = require("fs");
const { Worker } = require("worker_threads");

const SPIKE_DIR = __dirname;
const S1_DIR = path.join(SPIKE_DIR, "..", "s1-tinyclick-onnx");
const ONNX_DIR = path.join(S1_DIR, "onnx");

function runWorker(mode, runs, sessionOptions) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(SPIKE_DIR, "w2-worker.js"), {
      workerData: { onnxDir: ONNX_DIR, s1Dir: S1_DIR, spikeDir: SPIKE_DIR, mode, runs, sessionOptions },
    });
    w.once("message", (m) => (m.fatal ? reject(new Error(m.fatal)) : resolve(m)));
    w.once("error", reject);
  });
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const r1 = (v) => Math.round(v * 10) / 10;

(async () => {
  const out = { node: process.version, platform: process.platform, arch: process.arch };

  console.log("=== W2 correctness arm (exact .npy inputs) ===");
  const corr = await runWorker("correctness", 1);
  out.sessionCreateMs = corr.sessionCreateMs;
  out.rss = corr.rss;
  out.correctness = { tokenMatch: corr.tokenMatch, tokenIds: corr.runs[0].tokenIds, refTokenIds: corr.refTokenIds };
  console.log("sessionCreateMs:", JSON.stringify(corr.sessionCreateMs));
  console.log("rss:", JSON.stringify(corr.rss));
  console.log("tokenMatch:", corr.tokenMatch, "ids:", JSON.stringify(corr.runs[0].tokenIds));

  console.log("=== W2 latency arm (full JS pipeline, 3 runs) ===");
  const lat = await runWorker("latency", 3);
  out.latency = {
    runs: lat.runs.map((r) => ({
      preprocessMs: r1(r.preprocessMs),
      preprocessBreakdown: r.preprocessBreakdown
        ? { decodeMs: r1(r.preprocessBreakdown.decodeMs), resizeMs: r1(r.preprocessBreakdown.resizeMs), normalizeMs: r1(r.preprocessBreakdown.normalizeMs) }
        : null,
      visionMs: r1(r.visionMs),
      embedMs: r1(r.embedMs),
      concatMs: r1(r.concatMs),
      encoderMs: r1(r.encoderMs),
      decoderStepsMs: r.decoderStepsMs,
      decoderTotalMs: r1(r.decoderTotalMs),
      totalMs: r1(r.totalMs),
      nTokens: r.tokenIds.length,
    })),
    tokenMatch: lat.tokenMatch,
    tokenIds: lat.runs[0].tokenIds,
  };
  const totals = lat.runs.map((r) => r.totalMs);
  out.latency.medianTotalMs = r1(median(totals));
  out.latency.rss = lat.rss;
  for (const [i, r] of lat.runs.entries()) {
    console.log(
      `run${i}: total=${r1(r.totalMs)}ms pre=${r1(r.preprocessMs)} vision=${r1(r.visionMs)} embed=${r1(r.embedMs)} enc=${r1(r.encoderMs)} dec=${r1(r.decoderTotalMs)}ms steps=[${r.decoderStepsMs.join(",")}] tokens=${r.tokenIds.length}`
    );
  }
  console.log("median total:", out.latency.medianTotalMs, "ms; tokenMatch:", lat.tokenMatch);

  // --- tuning arms: intraOpNumThreads sweep (hybrid P/E-core CPU) ---
  out.tuning = [];
  for (const intra of [16, 8, 4]) {
    console.log(`=== W2 tuning arm intraOpNumThreads=${intra} (3 runs) ===`);
    const t = await runWorker("latency", 3, { intraOpNumThreads: intra, interOpNumThreads: 1 });
    const med = r1(median(t.runs.map((r) => r.totalMs)));
    const arm = {
      sessionOptions: { intraOpNumThreads: intra, interOpNumThreads: 1 },
      medianTotalMs: med,
      medianVisionMs: r1(median(t.runs.map((r) => r.visionMs))),
      medianEncoderMs: r1(median(t.runs.map((r) => r.encoderMs))),
      medianDecoderMs: r1(median(t.runs.map((r) => r.decoderTotalMs))),
      medianPreprocessMs: r1(median(t.runs.map((r) => r.preprocessMs))),
      runTotalsMs: t.runs.map((r) => r1(r.totalMs)),
      tokenMatch: t.tokenMatch,
    };
    out.tuning.push(arm);
    console.log(`intra=${intra}: median total=${med}ms (vision=${arm.medianVisionMs} enc=${arm.medianEncoderMs} dec=${arm.medianDecoderMs}) runs=[${arm.runTotalsMs.join(",")}]`);
  }

  fs.writeFileSync(path.join(SPIKE_DIR, "w2-result.json"), JSON.stringify(out, null, 2));
  console.log("saved w2-result.json");
})().catch((err) => {
  console.error("W2 FATAL:", err);
  process.exitCode = 2;
});