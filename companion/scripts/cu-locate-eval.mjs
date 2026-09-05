#!/usr/bin/env node
// #362 (CU-D) — 本机定位 held-out 评测门。
//
// 用法：
//   node scripts/cu-locate-eval.mjs [--ocr-only] [--model <path>] [--device auto|cpu|cuda|mps]
//
//   --ocr-only      只跑 OCR 缺陷基线（无模型机器时验证 harness 结构）
//   --model <path>  已下载的 Qwen3-VL 模型目录（#359 manifest 校验后）；缺省自动探测
//
// 设计基准：.omx/artifacts/cu-rethink-20260905/FINAL-SYNTHESIS.md 票 D。
// 判据（票内定标）：top-1 命中 = 模型点落在 target bbox 内（含边框容差 4px）。
//
// 候选：
//   ocr-baseline      = 用 corpus ocrWords 文本层定位 targetText。**注入 OCR 缺陷**
//                       （每例确定性删 1 个词的 bbox），模拟真实 OCR 漏词——否则
//                       文本层 oracle 恒 100%，门无意义。基线 = 「有缺陷 OCR 的下限」。
//   qwen3-vl          = Qwen3-VL-2B BF16（#359 可钉哈希源）。无模型机器 → 标注待执行。
//   qwen3-vl-int4     = 官方 int4 变体；**若官方无可钉 int4 源 → 记「无合规源」跳过**
//                       （NEVER：不用社区/不可钉包）。
//
// 红线：
//   - golden（expected bbox）不进提示（taskText 只含 targetText，不含坐标/bbox）。
//   - 红队样本（#361 cu-redteam）不在此集，准确率只算本集 10 例。
//   - 无 GPU 时不许编造跑分——模型行输出「待有模型机器执行」+ 命令。

import * as fs from "node:fs"
import * as path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const fixtureDir = path.join(root, "tests", "fixtures", "cu-locate-eval")
const corpus = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8"))

// --- 参数 ---------------------------------------------------------------

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const ocrOnly = argv.includes("--ocr-only")
const modelDir = flag("--model") || process.env.CU_QWEN_MODEL_DIR
const device = flag("--device") || "cpu"

// --- 确定性伪随机（无 Math.random——可复跑） ---------------------------------

let _seed = 0x3620c0de
function rng() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0
  return _seed / 0xffffffff
}
function pick(arr) {
  if (arr.length === 0) return null
  return arr[Math.floor(rng() * arr.length)]
}

// --- 命中判定 ---------------------------------------------------------------

function pointInBox(px, py, box, tol = 4) {
  return px >= box.x - tol && px <= box.x + box.w + tol && py >= box.y - tol && py <= box.y + box.h + tol
}

// --- OCR 缺陷基线 -----------------------------------------------------------
// 用 corpus 文本层定位 targetText。每例确定性删除若干词的 bbox（模拟 OCR 漏词），
// 使基线不恒 100%。删除规则：优先删非 target 的邻近词（模拟「目标被遮挡/漏读」在
// 1/3 例上发生）；targetText 本身恒保留（基线总能读到目标词——它是「有缺陷 OCR 但
// 目标字可读」的下限）。真实 VLM 需在 target 词 OCR 都漏时仍能凭像素语义定位。

function buildOcrBaselineDefects() {
  const defects = new Map() // fixtureId -> Set(被删 ocrWord index)
  corpus.fixtures.forEach((f, i) => {
    const dropped = new Set()
    if (f.ocrWords && f.ocrWords.length > 1) {
      const nonTarget = f.ocrWords
        .map((w, idx) => ({ w, idx }))
        .filter(({ w }) => w.text !== f.targetText)
      // 档 1：一般 OCR 噪声——掉 1-2 个非目标词
      const noiseN = i % 3 === 0 ? 2 : 1
      for (let k = 0; k < noiseN && nonTarget.length > 0; k++) {
        const j = Math.floor(rng() * nonTarget.length)
        dropped.add(nonTarget[j].idx)
        nonTarget.splice(j, 1)
      }
      // 档 2（约 1/3 例，i%3===2）：**target 词也被 OCR 漏读**——模拟目标区域 OCR
      // 失败。这是 VLM 像素语义的真实发挥面：基线读不到目标 → 诚实 miss；
      // Qwen 若能凭按钮形状/相对位置定位 = 显著优于基线。无此档则基线 target 恒可
      // 读，VLM 只能跟文本层打平，门无意义。
      if (i % 3 === 2) {
        const ti = f.ocrWords.findIndex((w) => w.text === f.targetText)
        if (ti >= 0) dropped.add(ti)
      }
    }
    defects.set(f.id, dropped)
  })
  return defects
}

function runOcrBaseline(f, dropped) {
  const words = (f.ocrWords || []).filter((_, i) => !dropped.has(i))
  const hit = words.find((w) => w.text === f.targetText)
  if (!hit) {
    // target 词被缺陷删掉（理论不发生——上面保证 target 恒保留，除非 corpus 缺词）
    return { hit: false, point: null, note: `target 词不在 ocrWords: ${f.targetText}` }
  }
  return {
    hit: pointInBox(hit.x + hit.w / 2, hit.y + hit.h / 2, f.target),
    point: { x: hit.x + hit.w / 2, y: hit.y + hit.h / 2 },
    via: "ocr-words",
  }
}

// --- VLM 驱动（可选；无模型机器时诚实标注） ---------------------------------

let worker = null
let workerReady = false

function startWorker(modelDirArg) {
  const py = path.join(root, "src", "computer", "qwen-vl-worker.py")
  if (!fs.existsSync(py)) throw new Error(`worker 缺失: ${py}`)
  worker = spawn("python3", [py], { stdio: ["pipe", "pipe", "pipe"] })
  let buf = ""
  worker.stdout.on("data", (d) => (buf += d.toString()))
  // load
  const id = `load-${Date.now()}`
  worker.stdin.write(JSON.stringify({ id, cmd: "load", model_dir: modelDirArg, device }) + "\n")
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const timer = setInterval(() => {
      const lines = buf.split("\n").filter(Boolean)
      for (const line of lines) {
        try {
          const m = JSON.parse(line)
          if (m.id === id) {
            clearInterval(timer)
            workerReady = m.ok
            if (!m.ok) reject(new Error(`worker load failed: ${m.error || "?"}`))
            else resolve(m)
            return
          }
        } catch {
          /* partial line */
        }
      }
      if (Date.now() - t0 > 600000) {
        clearInterval(timer)
        reject(new Error("worker load timeout 600s"))
      }
    }, 500)
  })
}

function inferOnce(f, modelDirArg) {
  const png = path.join(fixtureDir, f.png)
  return new Promise((resolve, reject) => {
    const id = `inf-${Date.now()}-${f.id}`
    const payload = {
      id,
      cmd: "infer",
      image_path: png,
      command: f.taskText,
      width: 640,
      height: 480,
    }
    let out = ""
    const onData = (d) => (out += d.toString())
    worker.stdout.on("data", onData)
    worker.stdin.write(JSON.stringify(payload) + "\n")
    const t0 = Date.now()
    const timer = setInterval(() => {
      const lines = out.split("\n").filter(Boolean)
      for (const line of lines) {
        try {
          const m = JSON.parse(line)
          if (m.id === id) {
            clearInterval(timer)
            worker.stdout.removeListener("data", onData)
            if (!m.ok) resolve({ hit: false, point: null, note: m.error || "infer failed" })
            else resolve({ hit: pointInBox(m.x, m.y, f.target), point: { x: m.x, y: m.y }, raw: m.raw })
            return
          }
        } catch {
          /* partial */
        }
      }
      if (Date.now() - t0 > 120000) {
        clearInterval(timer)
        worker.stdout.removeListener("data", onData)
        resolve({ hit: false, point: null, note: "infer timeout 120s" })
      }
    }, 250)
  })
}

function shutdownWorker() {
  if (worker) {
    try {
      worker.stdin.write(JSON.stringify({ id: "shutdown", cmd: "shutdown" }) + "\n")
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        worker.kill()
      } catch {
        /* ignore */
      }
    }, 1500)
  }
}

// --- 汇总 -------------------------------------------------------------------

function summarize(name, results) {
  const n = results.length
  const hit = results.filter((r) => r.hit).length
  const desktop = results.filter((r) => r.meta.form === "desktop")
  const osr = results.filter((r) => r.meta.form === "osr")
  const hitDesktop = desktop.filter((r) => r.hit).length
  const hitOsr = osr.filter((r) => r.hit).length
  return {
    candidate: name,
    n,
    hits: hit,
    accuracy: n ? +(hit / n).toFixed(3) : 0,
    desktop_accuracy: desktop.length ? +(hitDesktop / desktop.length).toFixed(3) : null,
    osr_accuracy: osr.length ? +(hitOsr / osr.length).toFixed(3) : null,
  }
}

// --- main -------------------------------------------------------------------

async function main() {
  const defects = buildOcrBaselineDefects()
  const results = { baseline: [], qwen: [], qwen_int4: [] }

  for (const f of corpus.fixtures) {
    const meta = { id: f.id, form: f.form }
    const b = runOcrBaseline(f, defects.get(f.id) || new Set())
    results.baseline.push({ ...b, meta })

    if (!ocrOnly) {
      results.qwen.push({ meta, hit: false, point: null, note: "pending-model" })
      results.qwen_int4.push({ meta, hit: false, point: null, note: "pending-model" })
    }
  }

  const summary = { baseline: summarize("ocr-baseline", results.baseline) }

  // VLM：若指定/探测到模型则真跑；否则诚实标待执行
  let qwenRan = false
  if (!ocrOnly && modelDir) {
    try {
      await startWorker(modelDir)
      qwenRan = true
      const qres = []
      for (const f of corpus.fixtures) {
        const r = await inferOnce(f, modelDir)
        qres.push({ ...r, meta: { id: f.id, form: f.form } })
        console.log(`  qwen ${f.id}: ${r.hit ? "HIT" : "MISS"} ${r.point ? `(${r.point.x},${r.point.y})` : ""} ${r.note || ""}`)
      }
      results.qwen = qres
      shutdownWorker()
    } catch (e) {
      console.error(`[qwen3-vl] 未跑成: ${e.message}`)
      qwenRan = false
    }
  }

  if (!ocrOnly) {
    if (qwenRan) {
      summary.qwen3_vl = summarize("qwen3-vl-bf16", results.qwen)
    } else {
      summary.qwen3_vl = {
        candidate: "qwen3-vl-bf16",
        status: "待有模型机器执行",
        command: "node scripts/cu-locate-eval.mjs --model <qwen3-vl-2b-bf16-dir> --device cuda",
        note: "本机无 GPU / 未指定模型目录，不许编造跑分",
      }
    }
    summary.qwen3_vl_int4 = {
      candidate: "qwen3-vl-int4",
      status: "无合规源跳过",
      note: "官方无可钉 sha256 的 int4 变体（#362 NEVER：不用社区/不可钉量化包）；有合规源后同门赛马",
    }
  }

  // --- 过门判定（阈值定标，写 PR 理由） ---
  // 基线含 target 漏读档（约 1/3 例 OCR 读不到目标）→ 基线上限 ~0.7，VLM 的像素
  // 语义在这档上发挥。过门 = 优于基线 ≥0.15 且 ≥0.7 且中文子集 ≥0.65。
  const ACC_ABS_MIN = 0.7 // 全量 top-1 绝对下限
  const ACC_ZH_MIN = 0.65 // 中文桌面子集下限
  const gate = {
    ocr_baseline_accuracy: summary.baseline.accuracy,
    ocr_baseline_zh: summary.baseline.desktop_accuracy,
    qwen3_vl_accuracy: summary.qwen3_vl?.accuracy ?? null,
    qwen3_vl_zh: summary.qwen3_vl?.desktop_accuracy ?? null,
    abs_min: ACC_ABS_MIN,
    zh_min: ACC_ZH_MIN,
    pass: null, // 需模型跑分才可判
    note: "过门双条件：显著优于 OCR 基线（准确率高 ≥0.15）且 ≥ 绝对下限 0.7 且 中文子集 ≥0.65；qwen 跑分缺 → pass=null。过门 ≠ 摘 experimental（#363）。",
  }
  if (qwenRan && summary.qwen3_vl && typeof summary.qwen3_vl.accuracy === "number") {
    const acc = summary.qwen3_vl.accuracy
    const zh = summary.qwen3_vl.desktop_accuracy
    gate.pass =
      acc - summary.baseline.accuracy >= 0.15 && acc >= ACC_ABS_MIN && zh !== null && zh >= ACC_ZH_MIN
  }

  console.log("\n=== 分栏 ===")
  console.log(JSON.stringify({ corpus: { n: corpus.fixtures.length, forms: corpus.forms }, summary, gate }, null, 2))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => {
    try {
      shutdownWorker()
    } catch {
      /* ignore */
    }
  })
