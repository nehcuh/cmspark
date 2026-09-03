// #273 Wave B 诚实门评测实现（spec §6.6 / AC-14）。由 knowledge-route-eval.mjs 经 tsx 启动。
//
// 计量对象（§6.6 钉死，不要把两个指标钉在一个名词上）：
//   S_pre(flat)  = Wave A 入选集（pinned ∪ 打分 top-k，预算前）id 有序
//   S_pre(route) = 第二趟扩张后、概览与 8000 前的完整候选 id 有序（可变长）
//   S_post(*)    = 8000 截断后实际注入的文档 id（概览不是文档）
// 开闸谓词（按栏计，不是全局合取）：① 有效性前置 ∧ ② routed≠flat 计数 > 0
//   ∧ ⑤ 同一条认证 query 的交付谓词 ∧ ⑥ recall 税。p@5 只作哨兵（回归打印）。

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-kroute-eval-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

type SourceRow = { id: string; chars: number }

type TurnResult = {
  sPre: string[]
  sPost: SourceRow[]
  groupmap?: "injected" | "omitted"
}

function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

function setDiff(a: string[], b: string[]): string[] {
  const s = new Set(b)
  return a.filter((x) => !s.has(x))
}

/** recall 税哨兵只计完整注入篇（截断残片不进计数；本夹具完整 = 2000 字符）。 */
function fullInjectedRel(sPost: SourceRow[], rel: string[], fullChars: number): number {
  const relSet = new Set(rel)
  return sPost.filter((s) => s.chars >= fullChars && relSet.has(s.id)).length
}

async function main() {
  const { initDataDir, getConfigDir } = await import("../src/config")
  await initDataDir()
  const {
    seedEvalCorpus,
    buildEvalDocs,
    buildEvalQueries,
    evalDocBody,
    EVAL_CERT_FOLDER_QUERY,
    EVAL_CERT_GROUP_QUERY,
    EVAL_DOC_FULL_CHARS,
  } = await import("../tests/fixtures/knowledge-eval/corpus")
  const { SkillEngine, KNOWLEDGE_DOC_TOPK_AUTO, KNOWLEDGE_SCORE_MIN } = await import("../src/skills/skill-engine")
  const clusters = await import("../src/skills/knowledge-clusters")

  const docs = buildEvalDocs()
  const queries = buildEvalQueries()
  seedEvalCorpus(path.join(getConfigDir(), "knowledge"))
  const se = new SkillEngine()
  se.refresh()
  const THREAD = "eval-thread"

  const runFlat = (text: string): TurnResult => {
    const ids = se.resolveKnowledgeIdsForThread(THREAD, "auto", undefined, text)
    const r = se.buildSystemPromptWithSources(THREAD, undefined, [], ids, text, {
      knowledgeMode: "auto",
      knowledgeSmartMatch: true,
      knowledgeRouteByGroup: false,
    })
    return { sPre: ids, sPost: r.retrieved_sources.map((s) => ({ id: s.id, chars: s.chars })) }
  }

  const runRouted = (text: string): TurnResult => {
    const ids = se.resolveKnowledgeIdsForThread(THREAD, "auto", undefined, text)
    const r = se.buildSystemPromptWithSources(THREAD, undefined, [], ids, text, {
      knowledgeMode: "auto",
      knowledgeSmartMatch: true,
      knowledgeRouteByGroup: true,
    })
    return {
      // 边关闭/no-op 时 s_pre 与 flat 恒等（closedRoutingPlan / 无 meta 两种形态同源）
      sPre: r.knowledge_routing?.s_pre ?? ids,
      sPost: r.retrieved_sources.map((s) => ({ id: s.id, chars: s.chars })),
      groupmap: r.knowledge_routing?.groupmap,
    }
  }

  console.log(`#273 Wave B knowledge-route eval: ${queries.length} queries × ${docs.length} docs, k=${KNOWLEDGE_DOC_TOPK_AUTO}, SCORE_MIN=${KNOWLEDGE_SCORE_MIN}, doc full=${EVAL_DOC_FULL_CHARS}`)

  const flatByQuery = new Map(queries.map((q) => [q.id, runFlat(q.text)]))

  const columns: Array<{ branch: "folder" | "group"; certQueryId: string }> = [
    { branch: "folder", certQueryId: "cert-folder" },
    { branch: "group", certQueryId: "cert-group" },
  ]

  const verdicts: Record<string, string> = {}
  for (const { branch, certQueryId } of columns) {
    clusters.setKnowledgeRouteBranchOverrides({ folder: branch === "folder", group: branch === "group" })
    try {
      const cert = queries.find((q) => q.id === certQueryId)!
      const certFlat = flatByQuery.get(certQueryId)!
      const certRoute = runRouted(cert.text)

      // ① 有效性前置：fixture ≥ 20 篇；认证 query 的算例体制（S_pre(flat) 每篇
      //    全长 2000、尾部全长 2000——直接机核 fixture 正文全长）；含「过阈但
      //    全局排名 > k」的粗索引成员。
      const regimeDocsOk = certFlat.sPre.every((id) => {
        const spec = docs.find((d) => d.name === id)
        return !!spec && evalDocBody(spec).length === EVAL_DOC_FULL_CHARS
      })
      const flatInjectedFull = certFlat.sPost.filter((s) => s.chars >= EVAL_DOC_FULL_CHARS)
      const tailIds = setDiff(certRoute.sPre, certFlat.sPre)
      const tailFullOk =
        tailIds.length > 0 &&
        tailIds.every((id) => {
          const spec = docs.find((d) => d.name === id)
          return !!spec && evalDocBody(spec).length === EVAL_DOC_FULL_CHARS
        })
      const certConstructed =
        docs.length >= 20 &&
        certFlat.sPre.length === KNOWLEDGE_DOC_TOPK_AUTO &&
        regimeDocsOk &&
        flatInjectedFull.length >= 4 && // 满篇体制：flat 前 4 篇各 2000 全注入
        tailFullOk
      if (!certConstructed) {
        verdicts[branch] = "absent"
        console.log(`\n[${branch}] cert query ${certQueryId}: cannot construct certification regime → absent`)
        continue
      }

      // ② routed≠flat ⇔ S_pre 集合不等（不用长度-5 前缀），该栏计数 > 0
      let routedDiffCount = 0
      const taxViolations: string[] = []
      const p5Warnings: string[] = []
      for (const q of queries) {
        const flat = flatByQuery.get(q.id)!
        const routed = runRouted(q.text)
        if (!setEqual(routed.sPre, flat.sPre)) routedDiffCount++
        // ⑥ 逐 query recall 税哨兵（只计完整注入篇）
        const taxRoute = fullInjectedRel(routed.sPost, q.rel, EVAL_DOC_FULL_CHARS)
        const taxFlat = fullInjectedRel(flat.sPost, q.rel, EVAL_DOC_FULL_CHARS)
        if (taxRoute < taxFlat - 1) {
          taxViolations.push(`${q.id}: route-full-rel=${taxRoute} < flat-full-rel=${taxFlat} - 1`)
        }
        // p@5 哨兵（方案 A 下结构性恒等；不恒等 = 公式被动过，须复审——只警告不开闸）
        const p5Flat = q.rel.filter((id) => flat.sPre.slice(0, KNOWLEDGE_DOC_TOPK_AUTO).includes(id)).length
        const p5Route = q.rel.filter((id) => routed.sPre.slice(0, KNOWLEDGE_DOC_TOPK_AUTO).includes(id)).length
        if (p5Flat !== p5Route) p5Warnings.push(`${q.id}: p@5 flat=${p5Flat} route=${p5Route}`)
      }

      // ⑤ 交付谓词（与 ① 同一条认证 query，量词绑定）：
      //    ∃ d ∈ (S_pre(route) \ S_pre(flat)) ∩ S_post(route)，注入字符 ≥ 1500
      const delivered = certRoute.sPost.filter((s) => tailIds.includes(s.id) && s.chars >= 1500)
      // ⑥ 认证 query 本身必过 recall 税
      const certTaxRoute = fullInjectedRel(certRoute.sPost, cert.rel, EVAL_DOC_FULL_CHARS)
      const certTaxFlat = fullInjectedRel(certFlat.sPost, cert.rel, EVAL_DOC_FULL_CHARS)
      const certTaxOk = certTaxRoute >= certTaxFlat - 1

      const ok2 = routedDiffCount > 0
      const ok5 = delivered.length > 0
      const ok6 = certTaxOk && taxViolations.length === 0
      verdicts[branch] = ok2 && ok5 && ok6 ? "pass" : "fail"

      console.log(`\n[${branch}] cert query: "${cert.text}"`)
      console.log(`  S_pre(flat)  = ${JSON.stringify(certFlat.sPre)}`)
      console.log(`  S_pre(route) = ${JSON.stringify(certRoute.sPre)}`)
      console.log(`  S_post(flat)  = ${JSON.stringify(certFlat.sPost)}`)
      console.log(`  S_post(route) = ${JSON.stringify(certRoute.sPost)} (groupmap: ${certRoute.groupmap ?? "n/a"})`)
      console.log(`  ② routed≠flat queries: ${routedDiffCount}/${queries.length} ${ok2 ? "OK" : "FAIL"}`)
      console.log(`  ⑤ delivery predicate: tail=${JSON.stringify(tailIds)} delivered≥1500=${JSON.stringify(delivered)} ${ok5 ? "OK" : "FAIL"}`)
      console.log(`  ⑥ recall tax: cert ${certTaxRoute} >= ${certTaxFlat} - 1 ${certTaxOk ? "OK" : "FAIL"}; per-query violations: ${taxViolations.length === 0 ? "none" : taxViolations.join("; ")}`)
      if (p5Warnings.length > 0) {
        console.log(`  p@5 sentinel WARNING (not a gate; formula drift suspected): ${p5Warnings.join("; ")}`)
      } else {
        console.log(`  p@5 sentinel: identical on all ${queries.length} queries (structural, regression-only)`)
      }
    } finally {
      clusters.setKnowledgeRouteBranchOverrides(null)
    }
  }

  console.log("\n--- gate verdicts (absent = fail for opening purposes; branch stays off) ---")
  for (const { branch } of columns) {
    console.log(`${branch}: ${verdicts[branch]}`)
  }

  // --strict：任一栏 fail|absent → exit 1（默认 exit 0 不是开闸依据，见 .mjs 头注释）
  if (process.argv.includes("--strict")) {
    const bad = columns.filter(({ branch }) => verdicts[branch] !== "pass")
    if (bad.length > 0) {
      console.error(`strict mode: non-pass columns: ${bad.map((c) => c.branch).join(", ")}`)
      fs.rmSync(tempHome, { recursive: true, force: true })
      process.exit(1)
    }
  }

  fs.rmSync(tempHome, { recursive: true, force: true })
}

main().catch((e) => {
  console.error("knowledge-route-eval internal error:", e)
  try {
    fs.rmSync(tempHome, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  process.exit(1)
})
