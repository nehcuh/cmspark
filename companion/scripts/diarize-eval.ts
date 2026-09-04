/**
 * #260 说话人分离评测门实现（spec §3.3；round-2 收紧）。由 diarize-eval.mjs 经 tsx 启动。
 *
 * 纯函数指标在 src/voice/diarize-eval.ts（有单测）；夹具在
 * scripts/diarize-eval-fixtures.ts；本文件只做：
 *   1. 两臂推理：legacy 3 维 k-means（silhouette 自动 K）vs embedding ONNX 层次凝聚
 *      （阈值切 auto-K = DIARIZE_CLUSTER_THRESHOLD，spec §4 —— 不是 silhouette）
 *   2. 两套夹具：校准集（阈值在此调参；只作参考分栏，不作为门依据）+
 *      held-out 集（全新说话人档案/种子 301+，未参与调参 —— 门只看这组）
 *   3. held-out 门（heldOutGate）：显著优于 baseline + countAcc ≥ 0.75 +
 *      每夹具 |k−truth| ≤ 1（过拆界；纯度置换不变救不了 K 暴涨）
 * 模型 / onnxruntime 缺失 → 显式退出 1（绝不静默只跑 legacy 臂）。
 * 退出码：gate FAIL 默认 exit 1（round-2 strict 默认化）；--report-only 恢复
 * 报告语义（FAIL 也 exit 0）；--strict 仍被接受（与默认等价，兼容旧调用）。
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
  DIARIZE_EVAL_HELDOUT_MIN_COUNT_ACC,
  DIARIZE_EVAL_MAX_K_ERROR,
  DIARIZE_EVAL_PURITY_MARGIN,
  heldOutGate,
  segmentPurity,
  speakerCountAccuracy,
} from "../src/voice/diarize-eval"
import type { Fixture } from "./diarize-eval-fixtures"
import {
  EVAL_SEG_SECONDS,
  EVAL_SR,
  buildFixtures,
  buildHeldOutFixtures,
} from "./diarize-eval-fixtures"

function fakeLines(n: number): TranscriptLine[] {
  return Array.from({ length: n }, () => ({ text: "x", source: "stt" as const }))
}

function labelToCluster(sp: string | undefined): number {
  const m = /^发言人(\d+)$/.exec((sp ?? "").trim())
  return m ? Number(m[1]) - 1 : -1
}

type ArmResult = { k: number; assign: number[] }

type SetRun = {
  legacy: ArmResult[]
  embed: ArmResult[]
  embedMs: number
}

/** 两臂跑一套夹具（auto-K：legacy silhouette / embedding 阈值切）。 */
async function runSet(
  label: string,
  fixtures: Fixture[],
  segs: Float32Array[][],
  modelRoot: string,
): Promise<SetRun> {
  const legacy: ArmResult[] = []
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]!
    const feats = segs[i]!.map((s) => Array.from(extractSegmentFeatures(s, EVAL_SR)))
    const r = diarizeByAudioFeatures(fakeLines(f.truth.length), feats, 0)
    legacy.push({ k: r.k, assign: r.speakers.map(labelToCluster) })
  }

  console.log(`\n${label} embedding 臂推理中…`)
  const embed: ArmResult[] = []
  let embedMs = 0
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]!
    const t0 = Date.now()
    const r = await embedSegmentsForDiarize(segs[i]!, { modelRootDir: modelRoot })
    embedMs += Date.now() - t0
    if (r.ok === false) {
      throw new Error(
        `embedding 臂失败（${r.code}）：${r.message}\n` +
          `（评测门绝不静默跳过 embedding 臂；${r.code === "diarize_runtime_unavailable" ? "请确认 npm install onnxruntime-node" : "请先下载模型"}）`,
      )
    }
    const d = diarizeByEmbeddings(fakeLines(f.truth.length), r.embeddings, 0)
    embed.push({ k: d.k, assign: d.speakers.map(labelToCluster) })
    console.log(`  ${f.name}: k=${d.k} (truth ${f.truthK})`)
  }
  return { legacy, embed, embedMs }
}

type Pooled = {
  legacyMetrics: { countAccuracy: number; purity: number; segments: number }
  embedMetrics: { countAccuracy: number; purity: number; segments: number }
  legacyKs: number[]
  embedKs: number[]
  truthKs: number[]
  totalSegs: number
}

function poolSet(
  fixtures: Fixture[],
  segs: Float32Array[][],
  run: SetRun,
): Pooled {
  const totalSegs = segs.reduce((s, x) => s + x.length, 0)
  const legacyKs: number[] = []
  const embedKs: number[] = []
  const truthKs: number[] = []
  let legacyAgreed = 0
  let embedAgreed = 0
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]!
    const n = f.truth.length
    legacyAgreed += segmentPurity(run.legacy[i]!.assign, f.truth) * n
    embedAgreed += segmentPurity(run.embed[i]!.assign, f.truth) * n
    legacyKs.push(run.legacy[i]!.k)
    embedKs.push(run.embed[i]!.k)
    truthKs.push(f.truthK)
  }
  return {
    legacyMetrics: {
      countAccuracy: speakerCountAccuracy(legacyKs, truthKs),
      purity: legacyAgreed / totalSegs,
      segments: totalSegs,
    },
    embedMetrics: {
      countAccuracy: speakerCountAccuracy(embedKs, truthKs),
      purity: embedAgreed / totalSegs,
      segments: totalSegs,
    },
    legacyKs,
    embedKs,
    truthKs,
    totalSegs,
  }
}

function printTable(label: string, fixtures: Fixture[], segs: Float32Array[][], run: SetRun): void {
  console.log(`\n${"─".repeat(78)}\n${label}`)
  console.log(
    "fixture".padEnd(22) +
      "truthK".padStart(6) +
      "segs".padStart(5) +
      "   legacy k/purity".padEnd(22) +
      "embedding k/purity",
  )
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]!
    const lp = segmentPurity(run.legacy[i]!.assign, f.truth)
    const ep = segmentPurity(run.embed[i]!.assign, f.truth)
    console.log(
      f.name.padEnd(22) +
        String(f.truthK).padStart(6) +
        String(f.truth.length).padStart(5) +
        `   ${run.legacy[i]!.k} / ${lp.toFixed(3)}`.padEnd(22) +
        `${run.embed[i]!.k} / ${ep.toFixed(3)}`,
    )
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  // round-2: strict 默认化 —— gate FAIL 即 exit 1；--report-only 恢复报告语义。
  const reportOnly = argv.includes("--report-only")
  const strict = !reportOnly // --strict 仍被接受（等价默认，兼容旧调用）
  const fixturesOnly = argv.includes("--fixtures-only")
  const modelRootIdx = argv.indexOf("--model-root")
  const modelRoot =
    modelRootIdx >= 0 && argv[modelRootIdx + 1]
      ? path.resolve(argv[modelRootIdx + 1]!)
      : resolveDiarizeRoot()

  const cal = buildFixtures()
  const held = buildHeldOutFixtures()
  const calSegs = cal.segs.reduce((s, x) => s + x.length, 0)
  const heldSegs = held.segs.reduce((s, x) => s + x.length, 0)
  console.log(`说话人分离评测（#260 spec §3.3 诚实门 · round-2 held-out 收紧）`)
  console.log(`模型: ${DIARIZE_MODEL_ID} @ ${modelRoot}`)
  console.log(
    `夹具: 校准集 ${cal.fixtures.length} 组/${calSegs} 段（阈值调参用，仅供参考）+ ` +
      `held-out ${held.fixtures.length} 组/${heldSegs} 段（全新档案，门只看这组）· ` +
      `${EVAL_SEG_SECONDS}s/段 · ${EVAL_SR}Hz · 同RMS归一`,
  )

  if (fixturesOnly) {
    for (const [label, set] of [
      ["校准集（不作为门依据）", cal],
      ["held-out（过门集）", held],
    ] as const) {
      console.log(`\n${label}`)
      for (let i = 0; i < set.fixtures.length; i++) {
        const f = set.fixtures[i]!
        const s = set.segs[i]!
        const rms = Math.sqrt(s[0]!.reduce((a, x) => a + x * x, 0) / s[0]!.length)
        console.log(
          `  ${f.name.padEnd(22)} truthK=${f.truthK} segs=${s.length}${f.adversarial ? " [对抗:近F0]" : ""} rms=${rms.toFixed(4)}`,
        )
      }
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

  const calRun = await runSet("校准集", cal.fixtures, cal.segs, modelRoot)
  const heldRun = await runSet("held-out", held.fixtures, held.segs, modelRoot)

  printTable("校准集（DIARIZE_CLUSTER_THRESHOLD 在此调参 —— 不作为门依据）", cal.fixtures, cal.segs, calRun)
  const calPool = poolSet(cal.fixtures, cal.segs, calRun)
  printMetrics("校准集(参考)", calPool, calRun.embedMs)

  printTable("held-out（过门集）", held.fixtures, held.segs, heldRun)
  const heldPool = poolSet(held.fixtures, held.segs, heldRun)
  printMetrics("held-out(过门)", heldPool, heldRun.embedMs)

  const verdict = heldOutGate({
    embedding: heldPool.embedMetrics,
    baseline: heldPool.legacyMetrics,
    embeddingKs: heldPool.embedKs,
    truthKs: heldPool.truthKs,
  })
  console.log("")
  console.log(
    `gate (held-out): ${verdict.pass ? "PASS" : "FAIL"}（要求：显著优于 baseline（不劣 + 至少一项 +${DIARIZE_EVAL_PURITY_MARGIN}）` +
      ` AND countAcc ≥ ${DIARIZE_EVAL_HELDOUT_MIN_COUNT_ACC} AND 每夹具 |k−truth| ≤ ${DIARIZE_EVAL_MAX_K_ERROR}）`,
  )
  for (const r of verdict.reasons) console.log(`  ✗ ${r}`)
  console.log(
    "experimental 摘除判据 = held-out gate PASS + 单独一行 diff（本 diff 内不摘；本输出写进 PR）",
  )
  if (!verdict.pass) {
    if (strict) {
      console.error("gate FAIL（strict 默认）：exit 1；--report-only 可只出报告不拦")
      return 1
    }
    console.error("--report-only：gate FAIL 但按报告语义 exit 0")
  }
  return 0
}

function printMetrics(
  label: string,
  pool: Pooled,
  embedMs: number,
): void {
  console.log("")
  console.log(`${label}       人数正确率   段纯度`)
  console.log(
    `  legacy(3维)     ${pool.legacyMetrics.countAccuracy.toFixed(3).padEnd(12)} ${pool.legacyMetrics.purity.toFixed(3)}`,
  )
  console.log(
    `  embedding(192)  ${pool.embedMetrics.countAccuracy.toFixed(3).padEnd(12)} ${pool.embedMetrics.purity.toFixed(3)}   (推理 ${(embedMs / 1000).toFixed(1)}s / ${pool.totalSegs} 段)`,
  )
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error("[abort] 评测内部错误：", e)
    process.exit(1)
  },
)
