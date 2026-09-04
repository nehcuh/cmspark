#!/usr/bin/env node
/**
 * #260 说话人分离评测门（spec §3.3 诚实门）。
 * 钉死：评测命令 = cd companion && node scripts/diarize-eval.mjs
 *       夹具    = 合成确定性多说话人拼接音频（3/5 段已知人数 + 同性别同音量对抗）
 * 两臂：legacy 3 维特征 k-means vs embedding(ONNX 192 维) 层次凝聚，均 silhouette 自动 K。
 * 指标 = 人数估计正确率 + 段级标签纯度（置换不变）；分栏打印。
 * 退出码：评测跑完 = 0（分栏是数据，experimental 摘除以 significantlyBetter PASS
 * 为准 + 单独一行 diff）；内部错误 / 模型或运行时缺失 = 1（绝不静默跳过 embedding 臂）；
 * --strict 时 gate fail 也 = 1（CI/复审用）。
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
