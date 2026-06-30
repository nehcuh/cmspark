import { test } from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import { buildSummaryTranscript, parseSummary } from "../src/threads/summary-export"
import {
  serializeSummaryToMarkdown,
  type ExportMessage,
  type ObsidianExportConfig,
} from "../src/threads/markdown-export"
import { buildVaultIndex, saveIndex, loadCachedIndex, queryRelatedNotes } from "../src/obsidian/vault-index"
import { detectTemplates, saveTemplates, loadCachedTemplates, pickTemplate } from "../src/obsidian/vault-templates"

// End-to-end composition of the P3 summary pipeline through the cache layer — the exact
// seam the message-router summary branch drives, minus the real LLM (which is faked by
// parseSummary on a canned response, i.e. what summarizeThread does after llmExtract):
//   buildSummaryTranscript (LLM input) → parseSummary (fake LLM output) → cache index/template
//   → serializeSummaryToMarkdown. Proves the summary note + folded appendix + footer wikilinks
//   + template skeleton compose correctly. Isolated to a temp vault + temp cache paths.

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  fs.mkdirSync(path.join(dir, "templates"))
  fs.writeFileSync(
    path.join(dir, "RAG 入门.md"),
    "---\ntitle: RAG 入门指南\n---\nRAG 检索增强生成 向量数据库 嵌入 召回\n",
  )
  fs.writeFileSync(
    path.join(dir, "templates", "default.md"),
    "---\ntype: 对话摘要\ntitle: {{title}}\n---\n# {{title}}\n\n> 由 cm 生成\n\n{{content}}\n",
  )
  return dir
}

test("compose (summary e2e seam): transcript → parse → assemble with index + template", () => {
  const vault = makeVault()
  const idxFile = path.join(os.tmpdir(), `sidx-${Math.random().toString(36).slice(2)}.json`)
  const tplFile = path.join(os.tmpdir(), `stpl-${Math.random().toString(36).slice(2)}.json`)
  try {
    // The conversation to summarize (topically overlaps the vault's RAG note).
    const messages: ExportMessage[] = [
      { id: "u1", role: "user", content: "帮我梳理 RAG 检索增强生成的原理", created_at: "2026-01-01T00:00:00Z" },
      { id: "a1", role: "assistant", content: "RAG 的核心是检索加生成……", created_at: "2026-01-01T00:00:00Z" },
      { id: "u2", role: "user", content: "向量数据库在其中起什么作用?", created_at: "2026-01-01T00:00:00Z" },
      { id: "a2", role: "assistant", content: "向量数据库存储嵌入并做相似度召回……", created_at: "2026-01-01T00:00:00Z" },
    ]

    // 1) build the LLM input transcript (what summarizeThread sends to the LLM).
    const transcript = buildSummaryTranscript(messages)
    assert.ok(transcript, "transcript built from the conversation")
    assert.ok(transcript!.includes("RAG"))

    // 2) fake the LLM: parse a canned structured response (this is summarizeThread's post-call step).
    const cannedLlm =
      "TITLE: RAG 与向量数据库\n" +
      "TLDR: 梳理了检索增强生成的原理与向量存储的作用。\n" +
      "## 关键主题\n- RAG\n- 向量数据库\n## 结论\n- 需要嵌入模型\n## 待办\n- [ ] 选型向量库"
    const summary = parseSummary(cannedLlm)
    assert.ok(summary, "canned LLM output parses to a summary")
    assert.equal(summary!.title, "RAG 与向量数据库")

    // 3) cache layer: index for the footer wikilinks + template skeleton (as the router loads them).
    const built = buildVaultIndex(vault)
    saveIndex(built, idxFile)
    const index = loadCachedIndex(vault, idxFile)
    const relatedNotes = queryRelatedNotes(index!, "RAG 检索增强生成 向量数据库", 5)
    assert.ok(relatedNotes.includes("RAG 入门"), `footer should link the RAG note; got [${relatedNotes.join(", ")}]`)

    saveTemplates(detectTemplates(vault), tplFile)
    const template = pickTemplate(loadCachedTemplates(vault, tplFile))
    assert.ok(template, "template detected + picked")

    // 4) assemble the summary note exactly as the router's summary branch does.
    const cfg: ObsidianExportConfig = {
      name_template: "{{date}} {{first_user_line}}",
      default_frontmatter: { tags: ["cmspark"] },
      vault_path: null,
    }
    const result = serializeSummaryToMarkdown(summary!, messages, {
      config: cfg,
      thread: { id: "t1", alias: "RAG 讨论", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      relatedNotes,
      template: template!,
    })

    // frontmatter: summary scope + provenance + template type key
    assert.match(result.content, /scope: summary/)
    assert.match(result.content, /source: cmspark:\/\/thread\/t1/)
    assert.match(result.content, /type: 对话摘要/)
    // summary section (template owns the H1 via {{title}}; tldr + structured body follow)
    assert.match(result.content, /^# RAG 与向量数据库$/m)
    assert.match(result.content, /> 梳理了检索增强生成的原理/)
    assert.match(result.content, /## 关键主题/)
    assert.match(result.content, /- \[ \] 选型向量库/) // todo checkbox survived
    // folded full-conversation appendix
    assert.match(result.content, /> \[!note\]- 完整对话/)
    assert.ok(result.content.includes("向量数据库在其中起什么作用"), "appendix contains the real conversation")
    // footer wikilinks
    assert.match(result.content, /## 相关笔记/)
    assert.match(result.content, /\[\[RAG 入门\]\]/)
    assert.ok(result.filename.endsWith(".md"))
  } finally {
    fs.rmSync(idxFile, { force: true })
    fs.rmSync(tplFile, { force: true })
    fs.rmSync(vault, { recursive: true, force: true })
  }
})
