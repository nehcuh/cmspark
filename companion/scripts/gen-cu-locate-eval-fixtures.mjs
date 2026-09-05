#!/usr/bin/env node
// #362 (CU-D) — 生成本机定位 held-out 评测夹具到 companion/tests/fixtures/cu-locate-eval/。
//
//   node scripts/gen-cu-locate-eval-fixtures.mjs          # 写入/更新夹具
//   node scripts/gen-cu-locate-eval-fixtures.mjs --check  # 不写盘，校验入仓夹具与生成器逐字节一致
//
// 确定性生成（见 cu-locate-eval-fixture-lib.mjs 头注释）：--check 失败 = 夹具被手工
// 改过或生成器变了而夹具没重新生成。

import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { buildCorpus } from "./cu-locate-eval-fixture-lib.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outDir = path.join(root, "tests", "fixtures", "cu-locate-eval")
const checkOnly = process.argv.includes("--check")

const { corpus, files } = buildCorpus()
const all = [...files, { name: "corpus.json", bytes: Buffer.from(JSON.stringify(corpus, null, 2) + "\n", "utf8") }]

let drift = 0
for (const f of all) {
  const p = path.join(outDir, f.name)
  const sha = createHash("sha256").update(f.bytes).digest("hex").slice(0, 16)
  if (checkOnly) {
    const onDisk = fs.existsSync(p) ? fs.readFileSync(p) : null
    if (onDisk === null || !onDisk.equals(f.bytes)) {
      console.error(`DRIFT ${f.name}（期望 sha256:${sha}）`)
      drift += 1
    } else {
      console.log(`OK    ${f.name}  sha256:${sha}`)
    }
  } else {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(p, f.bytes)
    console.log(`WROTE ${f.name}  sha256:${sha}`)
  }
}

if (checkOnly) {
  if (fs.existsSync(outDir)) {
    const known = new Set(all.map((f) => f.name))
    for (const name of fs.readdirSync(outDir)) {
      if (!known.has(name)) {
        console.error(`DRIFT 未知文件 ${name}（不在生成器产物清单里）`)
        drift += 1
      }
    }
  }
  if (drift > 0) {
    console.error(`\n${drift} 个夹具漂移——请重跑 gen-cu-locate-eval-fixtures.mjs（不带 --check）`)
    process.exit(1)
  }
  console.log("\ncu-locate-eval fixtures: 全部逐字节一致")
}
