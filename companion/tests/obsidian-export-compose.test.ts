import { test } from "node:test"
import * as assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

import {
  detectTemplates,
  saveTemplates,
  loadCachedTemplates,
  pickTemplate,
} from "../src/obsidian/vault-templates"
import { buildVaultIndex, saveIndex, loadCachedIndex, queryRelatedNotes } from "../src/obsidian/vault-index"
import {
  serializeThreadToMarkdown,
  type ExportMessage,
  type ObsidianExportConfig,
} from "../src/threads/markdown-export"

// End-to-end composition through the CACHE serialization layer — the exact seam the
// message-router export handler drives (detect→save→load→pick for templates,
// index→save→load→query for related notes, then serialize). Each function is unit-tested
// in isolation elsewhere; this proves they compose through the persisted cache files.
// Fully isolated: temp vault + temp cache paths (no real DATA_DIR pollution).

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"))
  fs.mkdirSync(path.join(dir, "templates"))
  // a topically-related note (the export body will share these terms)
  fs.writeFileSync(
    path.join(dir, "RAG 入门.md"),
    "---\ntitle: RAG 入门指南\n---\nRAG 检索增强生成 向量数据库 嵌入 embedding 召回\n",
  )
  // an unrelated note (must NOT be linked)
  fs.writeFileSync(path.join(dir, "购物清单.md"), "---\n---\n牛奶 鸡蛋 面包 苹果\n")
  // a default template skeleton
  fs.writeFileSync(
    path.join(dir, "templates", "default.md"),
    "---\ntype: 对话笔记\ntitle: {{title}}\n---\n# {{title}}\n\n> 来源: cm exports\n\n{{content}}\n",
  )
  return dir
}

test("compose (e2e seam): cached index → footer wikilinks + cached template → skeleton wrap", () => {
  const vault = makeVault()
  const idxFile = path.join(os.tmpdir(), `index-${Math.random().toString(36).slice(2)}.json`)
  const tplFile = path.join(os.tmpdir(), `tpl-${Math.random().toString(36).slice(2)}.json`)
  try {
    // 1) detect + cache + load templates exactly as the export handler does
    const detected = detectTemplates(vault)
    saveTemplates(detected, tplFile)
    const cachedTpl = loadCachedTemplates(vault, tplFile)
    const template = pickTemplate(cachedTpl)
    assert.ok(template, "template should be detected + cached + picked")
    assert.equal(template!.name, "default")

    // 2) build + cache + load the note index, query for related notes (export body overlap)
    const built = buildVaultIndex(vault)
    saveIndex(built, idxFile)
    const cachedIndex = loadCachedIndex(vault, idxFile)
    assert.ok(cachedIndex, "index should round-trip through the cache")
    const exportBody = "帮我整理一份 RAG 检索增强生成 和 向量数据库 召回 的落地方案"
    const relatedNotes = queryRelatedNotes(cachedIndex!, exportBody, 5)
    assert.ok(relatedNotes.includes("RAG 入门"), `should link the related RAG note; got [${relatedNotes.join(", ")}]`)
    assert.ok(!relatedNotes.includes("购物清单"), "unrelated shopping note must not be linked")

    // 3) serialize exactly as the export handler wires it (template + relatedNotes)
    const cfg: ObsidianExportConfig = {
      name_template: "{{date}} {{first_user_line}}",
      default_frontmatter: { tags: ["cmspark"] },
      vault_path: null,
    }
    const messages: ExportMessage[] = [
      { id: "u1", role: "user", content: exportBody, created_at: "2026-01-01T00:00:00Z" },
      { id: "a1", role: "assistant", content: "好的,这是 RAG 的落地方案……", created_at: "2026-01-01T00:00:00Z" },
    ]
    const result = serializeThreadToMarkdown(messages, {
      scope: "thread",
      config: cfg,
      thread: { id: "t1", alias: "RAG 方案讨论", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      relatedNotes,
      template: template!,
    })

    // footer wikilinks: related note present, unrelated absent
    assert.match(result.content, /## 相关笔记/)
    assert.match(result.content, /\[\[RAG 入门\]\]/)
    assert.ok(!result.content.includes("[[购物清单]]"))
    // template skeleton wrapped the body: contributed frontmatter + heading + prose + injected content
    assert.match(result.content, /type: 对话笔记/) // template contributes its frontmatter key
    assert.match(result.content, /^# RAG 方案讨论$/m) // {{title}} substituted (thread scope → alias)
    assert.ok(result.content.includes("来源: cm exports"), "template body prose present")
    assert.ok(result.content.includes("帮我整理一份"), "{{content}} injected")
    // layering: this template has NO `tags` key, so the default_frontmatter tags survive
    assert.match(result.content, /- cmspark/, "default_frontmatter survives for keys the template omits")
    // reserved provenance still anchors the source
    assert.match(result.content, /source: cmspark:\/\/thread\/t1/)
  } finally {
    fs.rmSync(idxFile, { force: true })
    fs.rmSync(tplFile, { force: true })
    fs.rmSync(vault, { recursive: true, force: true })
  }
})
