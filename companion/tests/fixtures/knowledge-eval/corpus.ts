// #273 Wave B 评测夹具（spec §6.6 / AC-14，正式验收依赖）
// 钉死：fixture 路径 = companion/tests/fixtures/knowledge-eval/corpus.ts
//      评测命令 = cd companion && node scripts/knowledge-route-eval.mjs
//
// 语料：20 篇文档（= KNOWLEDGE_CLUSTER_MIN_DOCS）、20 条 query。
// 两条认证 query（算例体制：S_pre(flat) 每篇全长 = 2000、尾部全长 = 2000）：
//   cert-folder: "refund policy return process" —— 命中文件夹 aftersale
//     （_folder.md 已保存说明含 query 词），成员 fa1..fa5 为全局 top-5，
//     fa6 为过 SCORE_MIN 但全局排名 > k 的尾部。
//   cert-group:  "expense reimbursement report materials" —— 无命中夹，
//     走 top-1-2 派生组（gb 组），gb6 为同类尾部，gb7 不过阈（进概览行集）。
// 所有文档正文恰好 2000 字符（ASCII 为主，不触发 file-chunker 切块），
// 话题词进正文供聚类向量（纯 TF），bag（title+desc+tags+夹字段）供打分。

export type EvalDocSpec = {
  name: string
  title: string
  description: string
  tags: string[]
  /** global 桶内文件夹（缺省 = 桶根）。 */
  folder?: string
  /** 正文话题词（聚类信号）。 */
  topicWords: string[]
}

export type EvalQuery = {
  id: string
  text: string
  /** 相关文档名集合（recall 税哨兵与 p@5 用）。 */
  rel: string[]
}

export const EVAL_FOLDER = "aftersale"
export const EVAL_FOLDER_TITLE = "refund aftersale"
export const EVAL_FOLDER_DESCRIPTION = "refund return policy process after sales service"
export const EVAL_CERT_FOLDER_QUERY = "refund policy return process"
export const EVAL_CERT_GROUP_QUERY = "expense reimbursement report materials"
/** 算例体制：每篇全文长度（= 注入全长，不触发截断/切块）。 */
export const EVAL_DOC_FULL_CHARS = 2000

const FOLDER_TOPIC = ["refund", "return", "aftersale", "policy", "process"]
const GROUP_TOPIC = ["expense", "reimbursement", "report", "materials", "invoice"]
const COOKING_TOPIC = ["cooking", "recipe", "sauce", "kitchen", "flavor"]

function folderDoc(name: string, i: number): EvalDocSpec {
  return {
    name,
    title: `Refund policy note ${i}`,
    description: `refund return policy process guide number ${i}`,
    tags: ["refund", "policy"],
    folder: EVAL_FOLDER,
    topicWords: FOLDER_TOPIC,
  }
}

/** 夹内尾部：自身 title/desc 稀薄（过阈但排名 > k）；夹字段（路径段+祖先说明）仍在 bag 里。 */
function folderTailDoc(): EvalDocSpec {
  return {
    name: "fa6",
    title: "Return label printing",
    description: "return label printer hardware setup",
    tags: ["return"],
    folder: EVAL_FOLDER,
    topicWords: FOLDER_TOPIC,
  }
}

function groupDoc(name: string, i: number): EvalDocSpec {
  return {
    name,
    title: `Expense reimbursement guide ${i}`,
    description: `expense report reimbursement materials invoice number ${i}`,
    tags: ["expense", "reimbursement"],
    topicWords: GROUP_TOPIC,
  }
}

/** 组内尾部：过阈但排名 > k（自身 title/desc 只带少量 query 词）。 */
function groupTailDoc(): EvalDocSpec {
  return {
    name: "gb6",
    title: "Invoice reimbursement scanner setup",
    description: "invoice scanner hardware for reimbursement",
    tags: ["invoice"],
    topicWords: GROUP_TOPIC,
  }
}

/** 组内不过阈成员（概览行集含未过阈；不进候选）。 */
function groupBelowThresholdDoc(): EvalDocSpec {
  return {
    name: "gb7",
    title: "Office chair catalog",
    description: "office furniture catalog chairs",
    tags: ["furniture"],
    topicWords: GROUP_TOPIC,
  }
}

function cookingDoc(name: string, i: number): EvalDocSpec {
  return {
    name,
    title: `Cooking recipe ${i}`,
    description: `cooking recipe sauce kitchen flavor number ${i}`,
    tags: ["cooking", "recipe"],
    topicWords: COOKING_TOPIC,
  }
}

/** 全离群文档：完全独立词表（与任何其他文档零共享 token）。 */
function outlierDoc(name: string, topic: string[]): EvalDocSpec {
  return {
    name,
    title: `${topic[0]} ${topic[1]} notes`,
    description: `${topic.join(" ")} unique notes`,
    tags: [topic[0]],
    topicWords: topic,
  }
}

export function buildEvalDocs(): EvalDocSpec[] {
  const docs: EvalDocSpec[] = []
  for (let i = 1; i <= 5; i++) docs.push(folderDoc(`fa${i}`, i))
  docs.push(folderTailDoc())
  for (let i = 1; i <= 5; i++) docs.push(groupDoc(`gb${i}`, i))
  docs.push(groupTailDoc())
  docs.push(groupBelowThresholdDoc())
  for (let i = 1; i <= 4; i++) docs.push(cookingDoc(`fc${i}`, i))
  docs.push(outlierDoc("o1", ["astronomy", "telescope", "nebula", "orbit", "comet"]))
  docs.push(outlierDoc("o2", ["bonsai", "pruning", "wiring", "potting", "moss"]))
  docs.push(outlierDoc("o3", ["calligraphy", "brush", "inkstone", "stroke", "ricepaper"]))
  return docs
}

export function buildEvalQueries(): EvalQuery[] {
  const faAll = ["fa1", "fa2", "fa3", "fa4", "fa5", "fa6"]
  const gbAll = ["gb1", "gb2", "gb3", "gb4", "gb5", "gb6", "gb7"]
  const fcAll = ["fc1", "fc2", "fc3", "fc4"]
  return [
    { id: "cert-folder", text: EVAL_CERT_FOLDER_QUERY, rel: faAll },
    { id: "cert-group", text: EVAL_CERT_GROUP_QUERY, rel: gbAll },
    { id: "q-cooking", text: "cooking recipe sauce", rel: fcAll },
    { id: "q-return", text: "return shipping label", rel: faAll },
    { id: "q-invoice", text: "invoice reimbursement timing", rel: gbAll },
    { id: "q-kitchen", text: "kitchen flavor balance", rel: fcAll },
    { id: "q-policy", text: "policy terms overview", rel: faAll },
    { id: "q-report", text: "report submission steps", rel: gbAll },
    { id: "q-astro", text: "telescope nebula observation", rel: ["o1"] },
    { id: "q-bonsai", text: "bonsai pruning season", rel: ["o2"] },
    { id: "q-calli", text: "calligraphy brush practice", rel: ["o3"] },
    { id: "q-noise-1", text: "quantum battery graphene", rel: [] },
    { id: "q-noise-2", text: "yoga mat cleaning", rel: [] },
    { id: "q-noise-3", text: "vintage camera aperture", rel: [] },
    { id: "q-noise-4", text: "sourdough hydration ratio", rel: [] },
    { id: "q-noise-5", text: "kayak paddle feathering", rel: [] },
    { id: "q-noise-6", text: "mushroom foraging safety", rel: [] },
    { id: "q-noise-7", text: "origami crane folding", rel: [] },
    { id: "q-noise-8", text: "beekeeping smoker fuel", rel: [] },
    { id: "q-noise-9", text: "marathon taper schedule", rel: [] },
  ]
}

/** 正文恰好 2000 字符：话题词占大头（聚类信号），每篇唯一 pad token（防跨话题粘连）。 */
export function evalDocBody(doc: EvalDocSpec): string {
  const topicStr = (doc.topicWords.join(" ") + " ").repeat(45)
  const padStr = (`pad${doc.name.replace(/[^a-z0-9]/g, "")} `).repeat(400)
  let body = (topicStr + padStr).slice(0, EVAL_DOC_FULL_CHARS).replace(/\s+$/, "")
  while (body.length < EVAL_DOC_FULL_CHARS) body += "z"
  return body
}

/**
 * 把语料落盘到 <knowledgeDir>/global/（含 aftersale/_folder.md 已保存说明）。
 * 返回写到的 global 目录。
 */
export function seedEvalCorpus(knowledgeDir: string): string {
  // 延迟 require，避免夹具被无关测试 import 时拖进 fs 副作用（纯数据可单独用）。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path")
  const globalDir = path.join(knowledgeDir, "global")
  fs.mkdirSync(path.join(globalDir, EVAL_FOLDER), { recursive: true, mode: 0o700 })
  const folderMeta = [
    "---",
    "type: knowledge_folder",
    `title: "${EVAL_FOLDER_TITLE}"`,
    `description: "${EVAL_FOLDER_DESCRIPTION}"`,
    "---",
    "",
  ].join("\n")
  fs.writeFileSync(path.join(globalDir, EVAL_FOLDER, "_folder.md"), folderMeta, { mode: 0o600 })
  for (const doc of buildEvalDocs()) {
    const dir = doc.folder ? path.join(globalDir, doc.folder) : globalDir
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    // 注意：frontmatter 闭合行后直接跟正文（不加空行）——gray-matter 会把
    // 闭合行后的第一个换行之外的空行算进 content，凑不出「全文恰好 2000」的
    // 算例体制（getKnowledgeSummary 在 trim 前比较长度）。
    const lines = [
      "---",
      `name: ${doc.name}`,
      `title: "${doc.title}"`,
      `description: "${doc.description}"`,
      "type: domain_knowledge",
      `tags: [${doc.tags.join(", ")}]`,
      "---",
      evalDocBody(doc),
    ]
    fs.writeFileSync(path.join(dir, `${doc.name}.md`), lines.join("\n"), { mode: 0o600 })
  }
  return globalDir
}
