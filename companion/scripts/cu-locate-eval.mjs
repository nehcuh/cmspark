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
//   textlayer-baseline = **文本层-缺陷对照器**（非测得 OCR——见下方诚实边界）：用 corpus
//                        ocrWords 权威文本层定位 targetText，**确定性删词档**制造缺陷
//                        （档定义见 buildTextlayerDefects，属门定义的一部分）。
//                        为什么不是真 OCR 基线：本票 T1 基建无 GPU/无 Vision 集成环境，
//                        真 OCR（UIA→OCR→VLM 生产链）不在此 harness 内测得；对照器的
//                        角色是「给定可读文本层时模型能否不低于纯文本定位」的下限锚。
//                        **措辞诚实降格：不是「仅 OCR 基线」，是「文本层-缺陷对照器」**
//                        （复审 M-2）。
//   qwen3-vl          = Qwen3-VL-2B BF16（#359 可钉哈希源）。无模型机器 → 标注待执行。
//   qwen3-vl-int4     = 官方 int4 变体；**若官方无可钉 int4 源 → 记「无合规源」跳过**
//                       （NEVER：不用社区/不可钉包）。
//
// 红线：
//   - golden（expected bbox）不进提示（taskText 只含 targetText，不含坐标/bbox）。
//   - 红队样本（#361 cu-redteam）不在此集，准确率只算本集 10 例。
//   - 无 GPU 时不许编造跑分——模型行输出「待有模型机器执行」+ 命令。
//   - 夹具为合成 PNG、Windows 风味元数据（win.app.test）——CU-D 目标形态含 macOS
//     本机定位；合成夹具无害（几何/文本层跨平台一致），仅说明免误导（复审 N-5）。

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

// --- 文本层-缺陷对照器删词档（门定义的一部分，非临时选择） ---
//
// 对照器 = corpus 权威文本层 − 确定性删词。删词档是【门定义】而非可调参数：
//   档1（一般噪声）：每例确定性删 1-2 个【非目标】词 bbox（i%3===0 → 2 个，否则 1 个）
//   ——模拟 OCR 在日常界面的零星漏词。
//   档2（目标漏读）：i%3===2 的例（约 1/3）连 targetText 词也删——模拟「目标区域
//   OCR 失败」。这是 VLM 像素语义（凭按钮形状/相对位置定位补缺）的真实发挥面：
//   对照器在此例必 miss，VLM 若能命中 = 显著优于对照器。
//
// 为什么 targetText 词偶尔被删：若永不删目标词，对照器在文本层可读时恒能定位，
// VLM 只能跟文本层打平（上限≈对照器），门无意义。本档是门能区分「VLM 读像素
// 补缺」与「纯文本定位」的关键。
//
// 审计性：无 Math.random，seed 固定 0x3620c0de → 同输入同输出（测试两跑逐字节一致）。
function buildTextlayerDefects() {
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

function runTextlayer(f, dropped) {
  const words = (f.ocrWords || []).filter((_, i) => !dropped.has(i))
  const hit = words.find((w) => w.text === f.targetText)
  if (!hit) {
    // target 词被档2删掉（门定义：目标区域 OCR 漏读）→ 对照器诚实 miss，无像素能力
    return { hit: false, point: null, note: `target 词被删词档命中（目标区漏读）: ${f.targetText}` }
  }
  const cx = hit.x + hit.w / 2
  const cy = hit.y + hit.h / 2
  return {
    hit: pointInBox(cx, cy, f.target),
    point: { x: cx, y: cy },
    via: "textlayer-words",
    note: `词中心(${cx},${cy}) target=(${f.target.x},${f.target.y},${f.target.w},${f.target.h})`,
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
  const defects = buildTextlayerDefects()
  const results = { baseline: [], qwen: [], qwen_int4: [] }

  for (const f of corpus.fixtures) {
    const meta = { id: f.id, form: f.form }
    const b = runTextlayer(f, defects.get(f.id) || new Set())
    results.baseline.push({ ...b, meta })
    // NIT-1 (复审 claude): 对照器也逐例输出 HIT/MISS + miss 原因（不再只打 qwen 行）
    console.log(
      `  textlayer ${f.id}: ${b.hit ? "HIT" : "MISS"} ${b.note || ""}`,
    )

    if (!ocrOnly) {
      results.qwen.push({ meta, hit: false, point: null, note: "pending-model" })
      results.qwen_int4.push({ meta, hit: false, point: null, note: "pending-model" })
    }
  }

  const summary = { baseline: summarize("textlayer-baseline", results.baseline) }

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
      note: "验证于 2026-09-06：Qwen 官方 org（QwenLM/Qwen）对 Qwen3-VL-2B 无可钉 sha256 的 int4 变体（manifest variants 仅 2b/4b/8b 全精度；现网 int4 为 AXERA-TECH/simaai 等第三方 NPU 转换 = NEVER 所禁社区包）。有官方合规源后同门赛马；届时同步改本状态与测试断言（复审 NIT-2）。",
    }
  }

  // --- 过门判定（阈值定标，以实测数字为准；复审 claude M-1/B-1） ---
  // 实跑对照器（本机无 GPU，--ocr-only）：accuracy 0.7 / desktop 0.8 / osr 0.6（7/10）。
  // 三条件：
  //   ① 优于对照器 ≥0.15 → 有效门槛 = qwen ≥ 0.85（n=10 粒度 = 至少 9/10）——
  //      VLM 必须在 3 个「目标漏读」区分档（d3/d6/d9）上至少补足 2 例，这是
  //      「读像素补缺」的最小可证价值；
  //   ② 绝对下限 ≥0.7（要点建议）——防「差值达标但绝对弱」（对照器 0.7 时要求
  //      qwen≥0.85 已覆盖绝对面，但保留绝对值作对照器更低时的兜底）；
  //   ③ **desktop 地板 ≥0.65**（复审 N-4：全语料皆中文，此条件实为「桌面 vs OSR」
  //      子集地板，非「中文 vs 其他」——正名）。粒度现实：desktop 5 例，0.65 名义
  //      阈值在 n=5 不可达中点——实际需 ≥4/5 = 0.8 才过（3/5=0.6 < 0.65）。
  //      故 desktop 地板的有效含义是「5 例中至少 4 例命中」，0.65 是名义下限兜底
  //      （若语料扩到更大 n，0.65 才成为真分数地板）。
  // 数字来源：0.7/0.65 取票面建议初值，0.15 差值反推（区分档补足 ≥2/3）；qwen 真实
  // 跑分后若档位实际区分度偏差，调阈值并留痕，不调夹具（脚本可复算保证门可信）。
  const ACC_ABS_MIN = 0.7 // 全量 top-1 绝对下限
  const ACC_DESKTOP_MIN = 0.65 // desktop 子集地板（n=5 → 至少 4/5）
  const gate = {
    textlayer_baseline_accuracy: summary.baseline.accuracy,
    textlayer_baseline_desktop: summary.baseline.desktop_accuracy,
    qwen3_vl_accuracy: summary.qwen3_vl?.accuracy ?? null,
    qwen3_vl_desktop: summary.qwen3_vl?.desktop_accuracy ?? null,
    abs_min: ACC_ABS_MIN,
    desktop_min: ACC_DESKTOP_MIN,
    pass: null, // 需模型跑分才可判
    note: "过门三条件：qwen 准确率 ≥ 对照器+0.15 且 ≥ 绝对下限 0.7 且 desktop 地板 ≥0.65；qwen 跑分缺 → pass=null。对照器为文本层-缺陷对照器（非测得 OCR，见头注释）。过门 ≠ 摘 experimental（#363）。",
  }
  if (qwenRan && summary.qwen3_vl && typeof summary.qwen3_vl.accuracy === "number") {
    const acc = summary.qwen3_vl.accuracy
    const dt = summary.qwen3_vl.desktop_accuracy
    gate.pass =
      acc - summary.baseline.accuracy >= 0.15 &&
      acc >= ACC_ABS_MIN &&
      dt !== null &&
      dt >= ACC_DESKTOP_MIN
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
