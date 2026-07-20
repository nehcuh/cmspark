// WP5 probe W2 worker: real 4-graph TinyClick ONNX in onnxruntime-node.
// Measures: per-session creation time, RSS deltas, per-stage latency,
// autoregressive decode steps, end-to-end totals over N runs.
// Modes: "correctness" (exact .npy inputs; token ids must equal S-1 reference)
//        "latency"    (full JS pipeline incl. pure-JS preprocessing)
const { parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs");
const ort = require("onnxruntime-node");
const { readNpy } = require("./npy");
const { preprocessPng } = require("./preprocess");

const { onnxDir, s1Dir, mode, runs, sessionOptions } = workerData;

const rss = () => process.memoryUsage().rss;
const mb = (b) => Math.round(b / 1e6);

function concatAlongAxis1(a, b) {
  // a: [1,La,D] Float32Array, b: [1,Lb,D] -> [1,La+Lb,D]
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function main() {
  const report = { mode, sessionCreateMs: {}, rss: {}, runs: [] };
  report.rss.baselineMB = mb(rss());

  // --- session creation (one-off, individually timed) ---
  const sessions = {};
  for (const name of ["vision_encoder", "embed_tokens", "encoder_model", "decoder_model"]) {
    const t0 = performance.now();
    sessions[name] = await ort.InferenceSession.create(
      path.join(onnxDir, name + ".onnx"),
      sessionOptions || {}
    );
    report.sessionCreateMs[name] = Math.round(performance.now() - t0);
    report.rss["after_" + name + "_MB"] = mb(rss());
  }
  report.sessionOptions = sessionOptions || "default";

  // --- inputs ---
  let pixelValues, inputIds, srcSize = [560, 400], preprocessMs = null;
  if (mode === "correctness") {
    const pv = readNpy(path.join(workerData.spikeDir, "pixel_values.npy"));
    const ii = readNpy(path.join(workerData.spikeDir, "input_ids.npy"));
    pixelValues = new Float32Array(pv.data); // own copy
    inputIds = new BigInt64Array(ii.data);
  } else {
    preprocessMs = null; // measured per run below
  }
  const textLen = 15;

  async function runOnce(withJsPreprocess) {
    const t = {};
    let t0 = performance.now();
    let pv = pixelValues;
    if (withJsPreprocess) {
      const pp = preprocessPng(path.join(s1Dir, "test_image.png"), 768);
      pv = pp.tensor;
      t.preprocessMs = pp.timings.decodeMs + pp.timings.resizeMs + pp.timings.normalizeMs;
      t.preprocessBreakdown = pp.timings;
    } else {
      t.preprocessMs = 0;
    }

    let tS = performance.now();
    const imgFeat = (
      await sessions.vision_encoder.run({
        pixel_values: new ort.Tensor("float32", pv, [1, 3, 768, 768]),
      })
    ).image_features.data;
    t.visionMs = performance.now() - tS;

    tS = performance.now();
    const ids = withJsPreprocess
      ? inputIdsFromPrompt()
      : inputIds;
    const txtEmb = (
      await sessions.embed_tokens.run({
        input_ids: new ort.Tensor("int64", ids, [1, textLen]),
      })
    ).inputs_embeds.data;
    t.embedMs = performance.now() - tS;

    tS = performance.now();
    const merged = concatAlongAxis1(imgFeat, txtEmb);
    const encMask = new Float32Array(merged.length / 768).fill(1);
    t.concatMs = performance.now() - tS;

    tS = performance.now();
    const encHidden = (
      await sessions.encoder_model.run({
        inputs_embeds: new ort.Tensor("float32", merged, [1, merged.length / 768, 768]),
        attention_mask: new ort.Tensor("float32", encMask, [1, encMask.length]),
      })
    ).encoder_hidden_states.data;
    t.encoderMs = performance.now() - tS;

    // greedy decode, full-prefix recompute, eos = decoder_start = 2
    tS = performance.now();
    const ids2 = [2];
    const stepMs = [];
    while (ids2.length - 1 < 50) {
      const ts = performance.now();
      const decIn = BigInt64Array.from(ids2.map(BigInt));
      const logits = (
        await sessions.decoder_model.run({
          input_ids: new ort.Tensor("int64", decIn, [1, decIn.length]),
          encoder_hidden_states: new ort.Tensor("float32", encHidden, [1, encHidden.length / 768, 768]),
          encoder_attention_mask: new ort.Tensor("float32", encMask, [1, encMask.length]),
        })
      ).logits.data;
      // argmax over last position (vocab 51289)
      const off = (ids2.length - 1) * 51289;
      let best = 0, bestV = -Infinity;
      for (let i = 0; i < 51289; i++) {
        const v = logits[off + i];
        if (v > bestV) { bestV = v; best = i; }
      }
      ids2.push(best);
      stepMs.push(performance.now() - ts);
      if (best === 2) break;
    }
    t.decoderStepsMs = stepMs.map((v) => Math.round(v * 10) / 10);
    t.decoderTotalMs = stepMs.reduce((a, b) => a + b, 0);
    t.totalMs = performance.now() - t0;
    t.tokenIds = ids2;
    return t;
  }

  // hardcoded prompt ids (same 15 tokens as dumped; latency mode skips tokenizer)
  function inputIdsFromPrompt() {
    return BigInt64Array.from([0, 12196, 7, 109, 7, 11189, 5, 5936, 116, 3753, 15, 5, 15983, 6148, 2].map(BigInt));
  }

  // warmup + measured runs
  const nRuns = runs || 3;
  let first = await runOnce(mode === "latency");
  report.rss.afterFirstInferenceMB = mb(rss());
  report.runs.push(first);
  for (let i = 1; i < nRuns; i++) {
    report.runs.push(await runOnce(mode === "latency"));
  }

  // correctness compare vs S-1 reference
  const ref = JSON.parse(fs.readFileSync(path.join(s1Dir, "reference.json"), "utf8"));
  report.refTokenIds = ref.greedy.token_ids;
  report.tokenMatch = JSON.stringify(report.runs[0].tokenIds) === JSON.stringify(ref.greedy.token_ids);
  report.rss.finalMB = mb(rss());

  parentPort.postMessage(report);
}

main().catch((err) => {
  parentPort.postMessage({ fatal: String((err && err.stack) || err) });
});