#!/usr/bin/env node
/**
 * #260 说话人分离评测门（spec §3.3 诚实门 · round-2 held-out 收紧）。
 * 钉死：评测命令 = cd companion && node scripts/diarize-eval.mjs
 *       夹具    = 合成确定性多说话人拼接音频：校准集（阈值调参用，仅参考分栏）
 *                 + held-out 集（全新说话人档案/种子，未参与调参 —— 门只看这组）
 * 两臂：legacy 3 维特征 k-means（silhouette 自动 K）vs embedding(ONNX 192 维)
 *       层次凝聚（阈值切 auto-K = DIARIZE_CLUSTER_THRESHOLD，非 silhouette）。
 * 指标 = 人数估计正确率 + 段级标签纯度（置换不变）；held-out 门 =
 *       显著优于 baseline AND countAcc ≥ 0.75 AND 每夹具 |k−truth| ≤ 1。
 * 退出码：gate FAIL 默认 = 1（round-2 strict 默认化）；--report-only 恢复报告
 *         语义（FAIL 也 = 0）；--strict 仍被接受（等价默认）。
 *         内部错误 / 模型或运行时缺失 = 1（绝不静默跳过 embedding 臂）。
 * --model-root <dir> 指定模型根（默认 ~/.cmspark-agent/models/diarize），
 * 期望文件 <root>/3dspeaker_speech_eres2net_sv_en_voxceleb_16k/speaker.onnx。
 */
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const impl = path.join(root, "scripts", "diarize-eval.ts")
const r = spawnSync(process.execPath, ["--import", "tsx", impl, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
})
process.exit(r.status ?? 1)
