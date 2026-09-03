#!/usr/bin/env node
/**
 * #273 Wave B 诚实门评测（spec §6.6 / AC-14）。
 * 钉死：评测命令 = cd companion && node scripts/knowledge-route-eval.mjs
 *       fixture  = tests/fixtures/knowledge-eval/corpus.ts（20 query × 20 文档，
 *                  含算例体制认证 query：S_pre(flat) 每篇全长 2000、尾部全长 2000）
 * 输出分栏：folder: pass|fail|absent、group: pass|fail|absent。
 * absent 与 fail 同等 ⇒ 该边保持关（出厂两只分支常数均 false）。
 * 退出码：评测自身跑完 = 0（分栏结果是数据，供开闸决策——**默认 exit 0
 * 不是开闸依据**，开闸只能以分栏 pass 为准）；内部错误 = 1；
 * `--strict` 时任一栏 fail|absent → exit 1（CI/复审用）。
 */
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const impl = path.join(root, "scripts", "knowledge-route-eval.ts")
const r = spawnSync(process.execPath, ["--import", "tsx", impl, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
})
process.exit(r.status ?? 1)
