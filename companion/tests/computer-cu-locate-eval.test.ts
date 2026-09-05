// #362 (CU-D) — 本机定位 held-out 评测集结构测试。
//
// 断言：
//   1. 夹具确定性可复跑：gen --check 逐字节一致；评测脚本 --ocr-only 两次输出一致。
//   2. 夹具清单完整：10 例（desktop 5 + osr 5），corpus 与 PNG 一致。
//   3. **与 #361 红队集样本不重叠**（票面红线：红队样本不得算进准确率）。
//   4. 结构健全：每例有 taskText / targetText / target bbox / ocrWords / form；
//      golden（target bbox）不在 taskText 里（不进提示）。
//   5. 评测门输出含分栏与过门判定；无模型时不编造跑分（qwen status = 待执行）。
//
// 结构测试——真实模型跑分在 cu-locate-eval.mjs（需 GPU），不在此处伪造。

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { spawnSync } from "node:child_process"

const COMPANION_ROOT = path.join(__dirname, "..", "..")
const FIXTURE_DIR = path.join(COMPANION_ROOT, "tests", "fixtures", "cu-locate-eval")
const REDTEAM_FIXTURE_DIR = path.join(COMPANION_ROOT, "tests", "fixtures", "cu-redteam")

interface EvalFixture {
  id: string
  form: "desktop" | "osr"
  title: string
  taskText: string
  targetText: string
  target: { x: number; y: number; w: number; h: number }
  png: string
  ocrWords: Array<{ text: string; x: number; y: number; w: number; h: number }>
}

interface EvalCorpus {
  ticket: string
  fixtures: EvalFixture[]
  forms: { desktop: number; osr: number }
}

function readCorpus(): EvalCorpus {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "corpus.json"), "utf8"))
}

test("CU-D: 夹具确定性可复跑 — gen --check 逐字节一致", () => {
  const r = spawnSync("node", ["scripts/gen-cu-locate-eval-fixtures.mjs", "--check"], {
    cwd: COMPANION_ROOT,
    encoding: "utf8",
  })
  assert.equal(r.status, 0, `gen --check failed:\n${r.stderr}\n${r.stdout}`)
  assert.ok(r.stdout.includes("全部逐字节一致"), r.stdout)
})

test("CU-D: 评测脚本 --ocr-only 可复跑 — 两次输出一致", () => {
  const run = () =>
    spawnSync("node", ["scripts/cu-locate-eval.mjs", "--ocr-only"], {
      cwd: COMPANION_ROOT,
      encoding: "utf8",
    })
  const a = run()
  assert.equal(a.status, 0, `ocr-only run failed:\n${a.stderr}`)
  const b = run()
  assert.equal(b.status, 0)
  const strip = (s: string) => {
    const idx = s.indexOf("=== 分栏 ===")
    assert.ok(idx >= 0, "output must contain 分栏")
    return s.slice(idx).trim()
  }
  assert.equal(strip(a.stdout), strip(b.stdout), "两跑输出必须逐字节一致（可重复性）")
})

test("CU-D: corpus 结构 — 10 例、desktop 5 + osr 5、字段齐全", () => {
  const corpus = readCorpus()
  assert.equal(corpus.ticket, "#362 CU-D")
  assert.equal(corpus.fixtures.length, 10)
  const desktop = corpus.fixtures.filter((f) => f.form === "desktop")
  const osr = corpus.fixtures.filter((f) => f.form === "osr")
  assert.equal(desktop.length, 5)
  assert.equal(osr.length, 5)
  for (const f of corpus.fixtures) {
    assert.ok(f.id, "fixture id required")
    assert.ok(f.taskText && f.taskText.length > 0, `${f.id}: taskText required`)
    assert.ok(f.targetText && f.targetText.length > 0, `${f.id}: targetText required`)
    assert.ok(
      f.target && typeof f.target.x === "number" && typeof f.target.w === "number",
      `${f.id}: target bbox required`,
    )
    assert.ok(Array.isArray(f.ocrWords) && f.ocrWords.length > 0, `${f.id}: ocrWords required`)
    assert.ok(fs.existsSync(path.join(FIXTURE_DIR, f.png)), `${f.id}: png missing ${f.png}`)
  }
})

test("CU-D: golden 不进提示 — taskText 不含坐标/bbox 数字", () => {
  const corpus = readCorpus()
  for (const f of corpus.fixtures) {
    const t = f.taskText
    assert.ok(!/\d{2,3}\s*[,，]\s*\d{2,3}/.test(t), `${f.id}: taskText must not contain pixel coords`)
    assert.ok(!/x\s*[:=]/.test(t), `${f.id}: taskText must not contain bbox`)
    assert.ok(!t.includes(String(f.target.x)), `${f.id}: taskText must not embed target x`)
    assert.ok(!t.includes(String(f.target.y)), `${f.id}: taskText must not embed target y`)
  }
})

test("CU-D: 与 #361 红队集样本不重叠 — id / png / 物理文件无交集", () => {
  const corpus = readCorpus()
  const evalIds = new Set(corpus.fixtures.map((f) => f.id))
  const evalPngs = new Set(corpus.fixtures.map((f) => f.png))
  const rtPath = path.join(REDTEAM_FIXTURE_DIR, "corpus.json")
  if (fs.existsSync(rtPath)) {
    const rt: { fixtures: Array<{ id: string; png?: string }> } = JSON.parse(
      fs.readFileSync(rtPath, "utf8"),
    )
    for (const rf of rt.fixtures) {
      assert.ok(!evalIds.has(rf.id), `红队样本不得混入评测集: ${rf.id}`)
      if (rf.png) assert.ok(!evalPngs.has(rf.png), `红队 png 不得混入评测集: ${rf.png}`)
    }
  }
  if (fs.existsSync(REDTEAM_FIXTURE_DIR) && fs.existsSync(FIXTURE_DIR)) {
    const rtFiles = new Set(fs.readdirSync(REDTEAM_FIXTURE_DIR))
    for (const f of fs.readdirSync(FIXTURE_DIR)) {
      // corpus.json 是两集各自的清单文件（通用名），不算样本冲突——样本冲突由上方 id/png 断言覆盖
      if (f === "corpus.json") continue
      assert.ok(!rtFiles.has(f), `评测与红队夹具目录不得有同名文件: ${f}`)
    }
  }
})

test("CU-D: 无模型时评测门诚实标注 — 不编造跑分", () => {
  const r = spawnSync("node", ["scripts/cu-locate-eval.mjs"], { cwd: COMPANION_ROOT, encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  const idx = r.stdout.indexOf("=== 分栏 ===")
  assert.ok(idx >= 0)
  const json = JSON.parse(r.stdout.slice(idx).replace("=== 分栏 ===", "").trim())
  assert.equal(json.gate.pass, null, "无模型跑分不得给出 pass 结论")
  assert.ok(
    String(json.summary.qwen3_vl.status).includes("待") || String(json.summary.qwen3_vl.status).includes("待有模型"),
    "无 GPU 必须标待执行",
  )
  assert.ok(String(json.summary.qwen3_vl_int4.status).includes("无合规源"), "int4 无合规源必须标跳过")
  assert.equal(typeof json.summary.baseline.accuracy, "number", "OCR 基线须有实际数字")
})

test("CU-D: 每个例 ocrWords 含 targetText（基线能读到目标）", () => {
  const corpus = readCorpus()
  for (const f of corpus.fixtures) {
    const hasTarget = (f.ocrWords || []).some((w) => w.text === f.targetText)
    assert.ok(hasTarget, `${f.id}: ocrWords must contain targetText for baseline to locate`)
  }
})
