// WP5 spike S-3 runner: int8 parity + golden-set accuracy + 4-core latency.
// Usage: node s3-run.js <fp32|int8> <parity|golden|latency> [intraOp]
// - parity : S-1 test image, token ids must equal fp32 reference
// - golden : 19 cases, deviation (px) + hit (dist <= max(w,h)/2), group stats
// - latency: 3 runs on fixture.png, per-stage + total, median
const path = require("path");
const fs = require("fs");
const Module = require("module");

const ROOT = __dirname;
const S1 = path.join(ROOT, "..", "s1-tinyclick-onnx");
const w2Require = Module.createRequire(path.join(ROOT, "..", "w1w2-worker-sea", "package.json"));
const ort = w2Require("onnxruntime-node");
const { preprocessPng } = require("../w1w2-worker-sea/preprocess");

const variant = process.argv[2] || "int8";
const mode = process.argv[3] || "golden";
const intraOp = parseInt(process.argv[4] || "4", 10);
const ONNX_DIR = variant === "int8" ? path.join(ROOT, "onnx-int8") : path.join(S1, "onnx");

const mb = (b) => Math.round(b / 1e6);
const r1 = (v) => Math.round(v * 10) / 10;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function createSessions() {
  const t0 = performance.now();
  const opts = { intraOpNumThreads: intraOp, interOpNumThreads: 1 };
  const s = {};
  const createMs = {};
  for (const n of ["vision_encoder", "embed_tokens", "encoder_model", "decoder_model"]) {
    const t = performance.now();
    s[n] = await ort.InferenceSession.create(path.join(ONNX_DIR, n + ".onnx"), opts);
    createMs[n] = Math.round(performance.now() - t);
  }
  return { s, createMs, totalCreateMs: Math.round(performance.now() - t0) };
}

async function predict(s, imagePath, inputIds) {
  const pp = preprocessPng(imagePath, 768);
  const t = { preprocessMs: pp.timings.decodeMs + pp.timings.resizeMs + pp.timings.normalizeMs };
  const pixel = new ort.Tensor("float32", pp.tensor, [1, 3, 768, 768]);
  let ts = performance.now();
  const imgFeat = (await s.vision_encoder.run({ pixel_values: pixel })).image_features.data;
  t.visionMs = performance.now() - ts;

  ts = performance.now();
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
  t.encMs = performance.now() - ts;

  ts = performance.now();
  const out = [2];
  while (out.length - 1 < 50) {
    const decIn = BigInt64Array.from(out.map(BigInt));
    const logits = (await s.decoder_model.run({
      input_ids: new ort.Tensor("int64", decIn, [1, decIn.length]),
      encoder_hidden_states: new ort.Tensor("float32", encHidden, [1, seq, 768]),
      encoder_attention_mask: new ort.Tensor("float32", mask, [1, seq]),
    })).logits.data;
    const off = (out.length - 1) * 51289;
    let best = 0, bestV = -Infinity;
    for (let i = 0; i < 51289; i++) { const v = logits[off + i]; if (v > bestV) { bestV = v; best = i; } }
    out.push(best);
    if (best === 2) break;
  }
  t.decMs = performance.now() - ts;
  t.totalMs = t.preprocessMs + t.visionMs + t.encMs + t.decMs;
  return { ids: out, timings: t };
}

function idsToPoint(ids, locMap, W, H) {
  const vals = ids.filter((i) => locMap[String(i)] !== undefined).map((i) => locMap[String(i)]);
  if (vals.length < 2) return null;
  return { x: Math.round((vals[0] / 1000) * W), y: Math.round((vals[1] / 1000) * H), locRaw: [vals[0], vals[1]] };
}

(async () => {
  console.log(`variant=${variant} mode=${mode} intraOp=${intraOp} onnx=${ONNX_DIR}`);
  console.log("rss baseline MB:", mb(process.memoryUsage().rss));
  const { s, createMs, totalCreateMs } = await createSessions();
  console.log("session create ms:", JSON.stringify(createMs), "total:", totalCreateMs);
  console.log("rss after load MB:", mb(process.memoryUsage().rss));

  if (mode === "parity") {
    const ref = JSON.parse(fs.readFileSync(path.join(S1, "reference.json"), "utf8"));
    const ids15 = [0, 12196, 7, 109, 7, 11189, 5, 5936, 116, 3753, 15, 5, 15983, 6148, 2];
    const r = await predict(s, path.join(S1, "test_image.png"), ids15);
    const match = JSON.stringify(r.ids) === JSON.stringify(ref.greedy.token_ids);
    console.log("parity ids:", JSON.stringify(r.ids));
    console.log("ref    ids:", JSON.stringify(ref.greedy.token_ids));
    console.log("PARITY:", match ? "MATCH" : "MISMATCH", "timings:", JSON.stringify(r.timings));
    return;
  }

  if (mode === "latency") {
    const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "golden.json"), "utf8"));
    const c0 = golden.cases[0];
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const r = await predict(s, path.join(ROOT, "fixture.png"), c0.input_ids);
      runs.push(r.timings);
      console.log(`run${i}: total=${r1(r.timings.totalMs)}ms pre=${r1(r.timings.preprocessMs)} vision=${r1(r.timings.visionMs)} enc=${r1(r.timings.encMs)} dec=${r1(r.timings.decMs)}`);
    }
    console.log("median total:", r1(median(runs.map((r) => r.totalMs))), "ms");
    console.log("rss final MB:", mb(process.memoryUsage().rss));
    return;
  }

  // golden
  const golden = JSON.parse(fs.readFileSync(path.join(ROOT, "golden.json"), "utf8"));
  const locMap = golden.loc_id_to_value;
  const results = [];
  for (const c of golden.cases) {
    const imgFile = c.image === "fixture.jpg" ? "fixture.png" : "eval-" + c.image.replace(".jpg", ".png");
    const imgPath = path.join(ROOT, imgFile);
    const { width: W, height: H } = w2Require("pngjs").PNG.sync.read(fs.readFileSync(imgPath));
    const r = await predict(s, imgPath, c.input_ids);
    const pt = idsToPoint(r.ids, locMap, W, H);
    let dist = null, hit = false;
    if (pt) {
      dist = r1(Math.hypot(pt.x - c.gt.cx, pt.y - c.gt.cy));
      hit = dist <= Math.max(c.gt.w, c.gt.h) / 2;
    }
    results.push({ id: c.id, group: c.group, lang: c.lang, pred: pt, gt: c.gt, distPx: dist, hit, totalMs: r1(r.timings.totalMs) });
    console.log(`${c.id} [${c.group}/${c.lang}] pred=${pt ? pt.x + "," + pt.y : "NONE"} gt=${c.gt.cx},${c.gt.cy} dist=${dist} hit=${hit}`);
  }
  const groups = {};
  for (const r of results) {
    for (const key of [r.group, r.lang, "ALL"]) {
      groups[key] = groups[key] || { n: 0, hits: 0, dists: [] };
      groups[key].n++; groups[key].hits += r.hit ? 1 : 0;
      if (r.distPx !== null) groups[key].dists.push(r.distPx);
    }
  }
  const stats = {};
  for (const [k, g] of Object.entries(groups)) {
    stats[k] = { n: g.n, hits: g.hits, acc: r1((g.hits / g.n) * 100) + "%", medianDistPx: g.dists.length ? median(g.dists) : null, maxDistPx: g.dists.length ? Math.max(...g.dists) : null };
  }
  console.log("STATS:", JSON.stringify(stats, null, 1));
  fs.writeFileSync(path.join(ROOT, `s3-golden-result-${variant}.json`), JSON.stringify({ variant, intraOp, createMs, totalCreateMs, results, stats }, null, 1));
  console.log(`saved s3-golden-result-${variant}.json`);
})().catch((e) => { console.error("FATAL:", e); process.exitCode = 2; });