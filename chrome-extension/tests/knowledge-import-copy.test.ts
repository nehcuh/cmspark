/**
 * #285: oversized browser-picker copy must not say "已选 0 个请确认第一篇".
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  knowledgeImportSelectionCopy,
  KNOWLEDGE_UI_FILE_CAP_MB,
  KNOWLEDGE_NATIVE_FILE_CAP_MB,
} from "../src/sidepanel/utils/knowledge-import-copy"

test("#285 all-oversized: honest 未导入 copy, no 请确认第一篇", () => {
  const s = knowledgeImportSelectionCopy(0, ["招商证券报告.docx"])
  assert.match(s, /未导入：1 个文件超过 6MB/)
  assert.match(s, /招商证券报告\.docx/)
  assert.equal(s.includes("请确认第一篇"), false)
  assert.equal(s.includes("已选 0"), false)
  assert.match(s, /导入大文件/)
  assert.equal(KNOWLEDGE_UI_FILE_CAP_MB, 6)
  assert.equal(KNOWLEDGE_NATIVE_FILE_CAP_MB, 10)
})

test("#285 mixed: keep confirm-first plus skip line pointing at 导入大文件", () => {
  const s = knowledgeImportSelectionCopy(2, ["big.pdf", "bigger.pptx"])
  assert.match(s, /已选 2 个文件，请确认第一篇/)
  assert.match(s, /跳过 2 个超过 6MB/)
  assert.match(s, /导入大文件/)
})

test("#285 KnowledgeSubPanel uses the helper and has 导入大文件", () => {
  const src = readFileSync(
    join(process.cwd(), "src/sidepanel/components/KnowledgeSubPanel.tsx"),
    "utf8",
  )
  assert.match(src, /knowledgeImportSelectionCopy/)
  assert.match(src, /导入大文件/)
  assert.match(src, /knowledge\.import_local_file/)
})
