// WP5 I1 WI-1.5 (G1) — envelope scan harness: command-length sweep, sentence-
// pattern sweep, zh calibration curve (confidence proxy vs hit rate).
//
// Reuses the S-3 predict pipeline verbatim (copied from s3-run.js — the frozen
// baseline producer is NOT modified) with one addition: per-step softmax
// log-prob of the greedy-chosen token, yielding two confidence proxies:
//   meanLogprob : mean log p over all generated tokens
//   locLogprob  : mean log p over <loc_N> tokens only (coordinate-bearing)
//
// Usage: node g1-envelope-scan.js [variant] [intraOp]   (default hybrid 8)
// Output: g1-envelope-result.json (+ stdout table)
const path = require("path");
const fs = require("fs");
const Module = require("module");

const ROOT = __dirname;
const S1 = path.join(ROOT, "..", "s1-tinyclick-onnx");
const w2Require = Module.createRequire(path.join(ROOT, "..", "w1w2-worker-sea", "package.json"));
const ort = w2Require("onnxruntime-node");
const { preprocessPng } = require("../w1w2-worker-sea/preprocess");

const variant = process.argv[2] || "hybrid";
const intraOp = parseInt(process.argv[3] || "8", 10);
const ONNX_DIR = variant === "int8"
  ? path.join(ROOT, "onnx-int8")
  : path.join(ROOT, "onnx-hybrid");

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

async function createSessions() {
  const opts = { intraOpNumThreads: intraOp, interOpNumThreads: 1 };
  const s = {};
  for (const n of ["vision_encoder", "embed_tokens", "encoder_model", "decoder_model"]) {
    s[n] = await ort.InferenceSession.create(path.join(ONNX_DIR, n + ".onnx"), opts);
  }
  return s;
}

// S-3 predict + per-step logprob collection
async function predict(s, imagePath, inputIds) {
  const pp = preprocessPng(imagePath, 768);
  const pixel = new ort.Tensor("float32", pp.tensor, [1, 3, 768, 768]);
  const t0 = performance.now();
  const imgFeat = (await s.vision_encoder.run({ pixel_values: pixel })).image_features.data;
  const ids = BigInt64Array.from(inputIds.map(BigInt));
  const txtEmb = (await s.embed_tokens.run({ input_ids: new ort.Tensor("int64", ids, [1, ids.length]) })).inputs_embeds.data;
  const merged = new Float32Array(imgFeat.length + txtEmb.length);
  merged.set(imgFeat, 0); merged.set(txtEmb, imgFeat.length);
  const seq = merged.length / 768;
  const mask = new Float32Array(seq).fill(1);
  const encHidden = (await s.encoder_model.run({
    inputs_embeds: new ort.Tensor("float32", merged, [1, seq, 768]),
    attention_mask: new ort.Tensor("float32", mask, [1, seq]),
  })).encoder_hidden_states.data;

  const out = [2];
  const stepLogprobs = [];
  while (out.length - 1 < 50) {
    const decIn = BigInt64Array.from(out.map(BigInt));
    const logits = (await s.decoder_model.run({
      input_ids: new ort.Tensor("int64", decIn, [1, decIn.length]),
      encoder_hidden_states: new ort.Tensor("float32", encHidden, [1, seq, 768]),
      encoder_attention_mask: new ort.Tensor("float32", mask, [1, seq]),
    })).logits.data;
    const off = (out.length - 1) * 51289;
    let best = 0, bestV = -Infinity, sumExp = 0;
    for (let i = 0; i < 51289; i++) {
      const v = logits[off + i];
      if (v > bestV) { bestV = v; best = i; }
    }
    // logsumexp against max (numerically stable): log p(best) = -log(Σexp(v-bestV))
    for (let i = 0; i < 51289; i++) { sumExp += Math.exp(logits[off + i] - bestV); }
    stepLogprobs.push({ id: best, logp: -Math.log(sumExp) });
    out.push(best);
    if (best === 2) break;
  }
  const totalMs = performance.now() - t0;
  return { ids: out, stepLogprobs, totalMs };
}

function idsToPoint(ids, locMap, W, H) {
  const vals = ids.filter((i) => locMap[String(i)] !== undefined).map((i) => locMap[String(i)]);
  if (vals.length < 2) return null;
  return { x: Math.round((vals[0] / 1000) * W), y: Math.round((vals[1] / 1000) * H), locRaw: [vals[0], vals[1]] };
}

function proxies(stepLogprobs, locMap) {
  const gen = stepLogprobs.filter((s) => s.id !== 2); // exclude EOS
  const loc = gen.filter((s) => locMap[String(s.id)] !== undefined);
  const mean = (arr) => (arr.length ? arr.reduce((a, s) => a + s.logp, 0) / arr.length : null);
  return {
    meanLogprob: mean(gen) === null ? null : r3(mean(gen)),
    locLogprob: mean(loc) === null ? null : r3(mean(loc)),
    locCount: loc.length,
    genTokens: gen.length,
  };
}

async function runCaseSet(s, cases, locMap, resolveImage) {
  const results = [];
  for (const c of cases) {
    const imgPath = resolveImage(c.image);
    const { width: W, height: H } = w2Require("pngjs").PNG.sync.read(fs.readFileSync(imgPath));
    const r = await predict(s, imgPath, c.input_ids);
    const pt = idsToPoint(r.ids, locMap, W, H);
    let dist = null, hit = false;
    if (pt) {
      dist = r1(Math.hypot(pt.x - c.gt.cx, pt.y - c.gt.cy));
      hit = dist <= Math.max(c.gt.w, c.gt.h) / 2;
    }
    const px = proxies(r.stepLogprobs, locMap);
    results.push({
      id: c.id, group: c.group, lang: c.lang, promptTokens: c.prompt_tokens ?? c.input_ids.length,
      pred: pt, distPx: dist, hit, ...px, totalMs: r1(r.totalMs),
    });
    console.log(
      `${c.id} [${c.group}/${c.lang}] tok=${c.prompt_tokens ?? c.input_ids.length} ` +
      `pred=${pt ? pt.x + "," + pt.y : "NONE"} dist=${dist} hit=${hit} ` +
      `locLP=${px.locLogprob} meanLP=${px.meanLogprob}`
    );
  }
  return results;
}

(async () => {
  console.log(`variant=${variant} intraOp=${intraOp} onnx=${ONNX_DIR}`);
  const s = await createSessions();

  const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "golden.json"), "utf8"));
  const locMap = golden.loc_id_to_value;

  // A/B: length + pattern sweeps (g1-cases.json, fixture.png)
  const g1 = JSON.parse(fs.readFileSync(path.join(ROOT, "g1-cases.json"), "utf8"));
  const sweepResults = await runCaseSet(s, g1.cases, locMap, (img) => path.join(ROOT, img));

  // C: zh calibration — full frozen golden set (15 zh + 4 en control)
  const goldenResults = await runCaseSet(s, golden.cases, locMap, (img) =>
    path.join(ROOT, img === "fixture.jpg" ? "fixture.png" : "eval-" + img.replace(".jpg", ".png"))
  );

  // calibration buckets on the golden set (locLogprob proxy)
  const buckets = [
    ["(-inf,-4)", -Infinity, -4],
    ["[-4,-2)", -4, -2],
    ["[-2,-1)", -2, -1],
    ["[-1,-0.5)", -1, -0.5],
    ["[-0.5,0]", -0.5, 0.0001],
  ];
  const calib = {};
  for (const r of goldenResults) {
    if (r.locLogprob === null) continue;
    const b = buckets.find(([, lo, hi]) => r.locLogprob >= lo && r.locLogprob < hi);
    const key = `${r.lang}:${b[0]}`;
    calib[key] = calib[key] || { n: 0, hits: 0 };
    calib[key].n++;
    calib[key].hits += r.hit ? 1 : 0;
  }
  const calibTable = Object.fromEntries(
    Object.entries(calib).map(([k, v]) => [k, { n: v.n, hits: v.hits, acc: r1((v.hits / v.n) * 100) + "%" }])
  );
  console.log("CALIB:", JSON.stringify(calibTable, null, 1));

  const out = { variant, intraOp, sweeps: sweepResults, golden: goldenResults, calibration: calibTable };
  fs.writeFileSync(path.join(ROOT, "g1-envelope-result.json"), JSON.stringify(out, null, 1));
  console.log("saved g1-envelope-result.json");
})().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 2;
});
