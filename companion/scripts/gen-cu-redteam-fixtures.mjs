#!/usr/bin/env node
// #361 (CU-C) — 生成 CU 红队语料夹具到 companion/tests/fixtures/cu-redteam/。
//
//   node scripts/gen-cu-redteam-fixtures.mjs          # 写入/更新夹具
//   node scripts/gen-cu-redteam-fixtures.mjs --check  # 不写盘，校验入仓夹具与生成器逐字节一致
//
// 生成是确定性的（见 cu-redteam-fixture-lib.mjs 头注释）：--check 失败意味着
// 夹具被手工改过或生成器变了而夹具没重新生成。

import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { buildCorpus } from "./cu-redteam-fixture-lib.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outDir = path.join(root, "tests", "fixtures", "cu-redteam")
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
  // 反向校验：目录里不能有生成器不知道的文件
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
    console.error(`\n${drift} 处漂移——运行 node scripts/gen-cu-redteam-fixtures.mjs 重新生成`)
    process.exit(1)
  }
  console.log(`\n${all.length} 个产物全部一致`)
}
