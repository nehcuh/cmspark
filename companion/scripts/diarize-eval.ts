/**
 * #260 说话人分离评测门实现（spec §3.3）。由 diarize-eval.mjs 经 tsx 启动。
 *
 * 纯函数指标在 src/voice/diarize-eval.ts（有单测）；夹具在
 * scripts/diarize-eval-fixtures.ts；本文件只做：
 *   1. 两臂推理：legacy 3 维 k-means vs embedding ONNX 层次凝聚（都 silhouette 自动 K）
 *   2. 分栏打印 + significantlyBetter 门（PASS 才允许单独一行 diff 摘 experimental）
 * 模型 / onnxruntime 缺失 → 显式退出 1（绝不静默只跑 legacy 臂）。
 */

import { existsSync } from "node:fs"
import * as path from "node:path"

import { embedSegmentsForDiarize } from "../src/meeting/diarize-embed"
import { diarizeByEmbeddings } from "../src/meeting/diarize-cluster"
import {
  diarizeByAudioFeatures,
  extractSegmentFeatures,
} from "../src/meeting/auto-diarize"
import type { TranscriptLine } from "../src/meeting/meeting-store"
import { DIARIZE_MODEL_ID, resolveDiarizeRoot } from "../src/voice/diarize-model"
import {
  DIARIZE_EVAL_PURITY_MARGIN,
  segmentPurity,
  significantlyBetter,
  speakerCountAccuracy,
} from "../src/voice/diarize-eval"
import { EVAL_SEG_SECONDS, EVAL_SR, buildFixtures } from "./diarize-eval-fixtures"

function fakeLines(n: number): TranscriptLine[] {
  return Array.from({ length: n }, () => ({ text: "x", source: "stt" as const }))
}

function labelToCluster(sp: string | undefined): number {
  const m = /^发言人(\d+)$/.exec((sp ?? "").trim())
  return m ? Number(m[1]) - 1 : -1
}

type ArmResult = { k: number; assign: number[] }

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const strict = argv.includes("--strict")
  const fixturesOnly = argv.includes("--fixtures-only")
  const modelRootIdx = argv.indexOf("--model-root")
  const modelRoot =
    modelRootIdx >= 0 && argv[modelRootIdx + 1]
      ? path.resolve(argv[modelRootIdx + 1]!)
      : resolveDiarizeRoot()

  const { fixtures, segs } = buildFixtures()
  const totalSegs = segs.reduce((s, x) => s + x.length, 0)
  console.log(`说话人分离评测（#260 spec §3.3 诚实门）`)
  console.log(`模型: ${DIARIZE_MODEL_ID} @ ${modelRoot}`)
  console.log(`夹具: ${fixtures.length} 组 · ${totalSegs} 段 · ${EVAL_SEG_SECONDS}s/段 · ${EVAL_SR}Hz · 同RMS归一`)

  if (fixturesOnly) {
    console.log("")
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i]!
      const s = segs[i]!
      const rms = Math.sqrt(s[0]!.reduce((a, x) => a + x * x, 0) / s[0]!.length)
      console.log(
        `  ${f.name.padEnd(18)} truthK=${f.truthK} segs=${s.length}${f.adversarial ? " [对抗:同性别近F0]" : ""} rms=${rms.toFixed(4)}`,
      )
    }
    console.log("\n--fixtures-only：仅合成夹具自检（不跑两臂）。")
    return 0
  }

  const modelPath = path.join(modelRoot, DIARIZE_MODEL_ID, "speaker.onnx")
  if (!existsSync(modelPath)) {
    console.error(
      `[abort] 说话人模型缺失：${modelPath}\n` +
        `  下载：设置 → 听写方式 → 「说话人分离模型」；或手动放置 speaker.onnx 到上述路径\n` +
        `  或用 --model-root <dir> 指向 <dir>/${DIARIZE_MODEL_ID}/speaker.onnx\n` +
        `（评测门绝不静默跳过 embedding 臂）`,
    )
    return 1
  }

  // --- legacy arm (3-dim features + k-means, silhouette auto K) -------------------
  const legacyPerFixture: ArmResult[] = []
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]!
    const feats = segs[i]!.map((s) => Array.from(extractSegmentFeatures(s, EVAL_SR)))
    const r = diarizeByAudioFeatures(fakeLines(f.truth.length), feats, 0)
    legacyPerFixture.push({ k: r.k, assign: r.speakers.map(labelToCluster) })
  }

  // --- embedding arm (fbank → ONNX 192-dim → agglomerative, silhouette auto K) ----
  console.log("\nembedding 臂推理中…")
  const embedPerFixture: ArmResult[] = []
  let embedMs = 0
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]!
    const t0 = Date.now()
    const r = await embedSegmentsForDiarize(segs[i]!, { modelRootDir: modelRoot })
    embedMs += Date.now() - t0
    if (r.ok === false) {
      console.error(
        `[abort] embedding 臂失败（${r.code}）：${r.message}\n` +
          `（评测门绝不静默跳过 embedding 臂；${r.code === "diarize_runtime_unavailable" ? "请确认 npm install onnxruntime-node" : "请先下载模型"}）`,
      )
      return 1
    }
    const d = diarizeByEmbeddings(fakeLines(f.truth.length), r.embeddings, 0)
    embedPerFixture.push({ k: d.k, assign: d.speakers.map(labelToCluster) })
    console.log(`  ${f.name}: k=${d.k} (truth ${f.truthK})`)
  }

  // --- per-fixture table + pooled metrics ------------------------------------------
  console.log("\n" + "─".repeat(78))
  console.log(
    "fixture".padEnd(20) +
      "truthK".padStart(6) +
      "segs".padStart(5) +
      "   legacy k/purity".padEnd(22) +
      "embedding k/purity",
  )
  const legacyKs: number[] = []
  const embedKs: number[] = []
  const truthKs: number[] = []
  let legacyAgreed = 0
  let embedAgreed = 0
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]!
    const n = f.truth.length
    const lp = segmentPurity(legacyPerFixture[i]!.assign, f.truth)
    const ep = segmentPurity(embedPerFixture[i]!.assign, f.truth)
    legacyAgreed += lp * n
    embedAgreed += ep * n
    legacyKs.push(legacyPerFixture[i]!.k)
    embedKs.push(embedPerFixture[i]!.k)
    truthKs.push(f.truthK)
    console.log(
      f.name.padEnd(20) +
        String(f.truthK).padStart(6) +
        String(n).padStart(5) +
        `   ${legacyPerFixture[i]!.k} / ${lp.toFixed(3)}`.padEnd(22) +
        `${embedPerFixture[i]!.k} / ${ep.toFixed(3)}`,
    )
  }
  console.log("─".repeat(78))
  const legacyMetrics = {
    countAccuracy: speakerCountAccuracy(legacyKs, truthKs),
    purity: legacyAgreed / totalSegs,
    segments: totalSegs,
  }
  const embedMetrics = {
    countAccuracy: speakerCountAccuracy(embedKs, truthKs),
    purity: embedAgreed / totalSegs,
    segments: totalSegs,
  }
  console.log("engine          人数正确率   段纯度")
  console.log(
    `legacy(3维)     ${legacyMetrics.countAccuracy.toFixed(3).padEnd(12)} ${legacyMetrics.purity.toFixed(3)}`,
  )
  console.log(
    `embedding(192)  ${embedMetrics.countAccuracy.toFixed(3).padEnd(12)} ${embedMetrics.purity.toFixed(3)}   (推理 ${(embedMs / 1000).toFixed(1)}s / ${totalSegs} 段)`,
  )
  console.log("")

  const gate = significantlyBetter(embedMetrics, legacyMetrics)
  console.log(
    `gate: embedding 显著优于 legacy → ${gate ? "PASS" : "FAIL"}` +
      `（要求两项均不劣于且至少一项 +${DIARIZE_EVAL_PURITY_MARGIN}；实测 Δcount=${(embedMetrics.countAccuracy - legacyMetrics.countAccuracy).toFixed(3)} Δpurity=${(embedMetrics.purity - legacyMetrics.purity).toFixed(3)}）`,
  )
  console.log(
    "experimental 摘除判据 = gate PASS + 单独一行 diff（本 diff 内不摘；本输出写进 PR）",
  )
  if (strict && !gate) {
    console.error("--strict：gate FAIL → exit 1")
    return 1
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("[abort] 评测内部错误：", e)
    process.exit(1)
  },
)
