import { test } from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import {
  buildVaultIndex,
  queryRelatedNotes,
  saveIndex,
  loadCachedIndex,
} from "../src/obsidian/vault-index"

function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  fs.writeFileSync(path.join(dir, "RAG 入门.md"), "---\ntitle: RAG 入门\n---\n检索增强生成 RAG retrieval augmented generation 原理与实现")
  fs.writeFileSync(path.join(dir, "向量数据库.md"), "---\ntitle: 向量数据库\n---\nembedding 向量检索 数据库 pgvector")
  fs.writeFileSync(path.join(dir, "今日午餐.md"), "---\n---\n今天吃了拉面 味增汤") // unrelated topic
  return dir
}

test("buildVaultIndex: collects notes, strips .md, builds vectors", () => {
  const dir = makeFixture()
  try {
    const index = buildVaultIndex(dir)
    assert.equal(index.entries.length, 3)
    const names = index.entries.map(e => e.name).sort()
    assert.deepEqual(names, ["RAG 入门", "今日午餐", "向量数据库"])
    // vectors keyed by name, non-empty
    for (const e of index.entries) {
      assert.ok(Object.keys(index.vectors[e.name]).length > 0)
    }
    // fingerprint over all .md
    assert.equal(index.fingerprint.file_count, 3)
    // vault_path resolved
    assert.equal(index.vault_path, path.resolve(dir))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("queryRelatedNotes: finds topically-related notes, filters unrelated", () => {
  const dir = makeFixture()
  try {
    const index = buildVaultIndex(dir)
    const related = queryRelatedNotes(index, "RAG 检索增强生成 检索 embedding 向量", 5)
    // the RAG + 向量数据库 notes should rank; 午餐 should not
    assert.ok(related.includes("RAG 入门") || related.includes("向量数据库"))
    assert.ok(!related.includes("今日午餐"))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("queryRelatedNotes: empty/unrelated query → empty", () => {
  const dir = makeFixture()
  try {
    const index = buildVaultIndex(dir)
    assert.deepEqual(queryRelatedNotes(index, ""), [])
    // a query with zero token overlap (rare symbols) → below threshold → empty
    assert.deepEqual(queryRelatedNotes(index, "zzz qqq xxx"), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("queryRelatedNotes: respects top-K cap and clamps negative k", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  try {
    for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(dir, `topic ${i}.md`), `topic ${i} 共享主题 shared topic`)
    const index = buildVaultIndex(dir)
    const related = queryRelatedNotes(index, "共享主题 topic", 3)
    assert.ok(related.length <= 3)
    // negative k must not truncate via slice(0,-1); must return []
    assert.deepEqual(queryRelatedNotes(index, "共享主题 topic", -1), [])
    assert.deepEqual(queryRelatedNotes(index, "共享主题 topic", 0), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("queryRelatedNotes: skips names unsafe as [[wikilinks]] (brackets/pipe/hash)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  try {
    fs.writeFileSync(path.join(dir, "Topic|pipe.md"), "shared topic content here") // unsafe name
    fs.writeFileSync(path.join(dir, "Topic [bracket].md"), "shared topic content here") // unsafe name
    fs.writeFileSync(path.join(dir, "Topic safe.md"), "shared topic content here") // safe name
    const index = buildVaultIndex(dir)
    const related = queryRelatedNotes(index, "shared topic content", 5)
    assert.ok(related.includes("Topic safe"))
    assert.ok(!related.some(n => n.includes("|")), "pipe-containing name must be filtered")
    assert.ok(!related.some(n => n.includes("[")), "bracket-containing name must be filtered")
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("buildVaultIndex: empty vault → empty index (no throw)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  try {
    const index = buildVaultIndex(dir)
    assert.equal(index.entries.length, 0)
    assert.equal(index.fingerprint.file_count, 0)
    assert.deepEqual(queryRelatedNotes(index, "anything"), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("saveIndex / loadCachedIndex: round-trip + vault_path match gate (tmp file)", () => {
  const dir = makeFixture()
  const indexFile = path.join(dir, "index.json")
  try {
    const index = buildVaultIndex(dir)
    saveIndex(index, indexFile)
    const loaded = loadCachedIndex(dir, indexFile)
    assert.ok(loaded)
    assert.equal(loaded!.entries.length, 3)
    // query works on the LOADED index (proves vectors persisted)
    const related = queryRelatedNotes(loaded!, "RAG 检索 向量", 5)
    assert.ok(related.length > 0)
    // mismatch vault_path → null
    assert.equal(loadCachedIndex("/other/path", indexFile), null)
    // missing file → null
    assert.equal(loadCachedIndex(dir, path.join(dir, "nope.json")), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
