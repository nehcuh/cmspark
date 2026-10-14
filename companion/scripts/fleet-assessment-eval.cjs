// Compile tsconfig.test.json first. Read-only requests to the current configured
// model; no business tools, worker dispatch, live config writes or approvals.
const fs = require("node:fs")
const path = require("node:path")
const assert = require("node:assert/strict")
const { createHash } = require("node:crypto")
const digest = value => createHash("sha256").update(value).digest("hex")
const src = path.resolve(__dirname, "../.test-dist/src")
const { getConfig } = require(path.join(src, "config"))
const { createProvider } = require(path.join(src, "llm/provider"))
const { assessFleetTask } = require(path.join(src, "orchestrator/fleet-assessment"))
const { computeWorkerWhitelist } = require(path.join(src, "orchestrator/spawn"))

const cases = [
  ["company-trace", true, "麻烦你帮我深度调研芭田股份这家公司呢"],
  ["mixed-api", true, "深入研究这家化肥公司的行业、竞争对手与近期监管。我在主线程用 API 拉财务、写 Python 制图；独立公开资料请另行查询。"],
  ["comparison", true, "从公开网站比较三家云服务商的隐私政策、SLA、数据导出约束，最后给我比较表。"],
  ["provided-analysis", true, "基于已有数据做三个独立角度分析：收入100→120，毛利30→28，现金流20→10，负债40→65。分别从增长、盈利、偿债角度分析，不需要文件或网络。"],
  ["creative", true, "为面向新手的绘画教学产品独立设计三种营销方向：课程内容、社群活动、订阅方案，各自列利弊。"],
  ["cross-source", true, "深入比较公开的中国、欧盟和美国 AI 治理资料，分别查监管机构官方网页，提炼共性与差异。"],
  ["industry", true, "调研机器人行业：分别调查工业机器人、家庭机器人和医疗机器人公开市场与应用资料，最后整合报告。"],
  ["mixed-final", true, "研究三个开源数据库的官方备份恢复机制，分别查 PostgreSQL、MySQL、SQLite 文档；报告文件和演示脚本由主线程负责写盘。"],
  ["quick", false, "只查一下法国首都是哪里。"],
  ["refused", false, "深入研究公司公告、竞争对手和政策，但这次明确不要并行，不要给并行建议。"],
  ["sequential", false, "先打开网站，登录，再点我的账单，最后下载刚生成的账单。必须按顺序来。"],
  ["future-data", false, "先由主线程执行 shell 抓取我本地数据库，拿到结果后才能做三个财务分析。现在没有数据，不查公开网站。"],
  ["shell-only", false, "并行运行我本地三个目录的 npm test，把退出码合并。子任务必须运行 shell，没有浏览器或资料分析部分。"],
  ["host-only", false, "分别操作桌面 Photoshop、Excel 和微信窗口完成任务，每部分都必须点击本地主机 UI。"],
  ["single-file", false, "修改本地项目 config.ts 的一个拼写错误，保存即可。"],
  ["dependent-analysis", false, "读下面的一段话先选出唯一核心命题，再以这唯一命题写标题，再根据那个标题写一句摘要：团队明天开会。"],
]

// Additional semantic regressions: keep the original 16-case corpus/thresholds intact.
const semanticCases = [
  ["missing-entity-only", false, "请分别分析这家公司的竞争对手和这家公司的近期监管处罚，两项均要针对同一公司。暂未提供公司的名字或标识，也没有现成资料。不能挑选别的公司或换成行业分析。"],
  ["known-industry-independent", true, "分别查公开复合肥行业近期产能变化和磷矿原料供应趋势，给出两份独立资料要点。我未指定某家公司；这两项均只需行业公开资料，无须公司身份。"],
]

async function main() {
  const config = getConfig(), provider = createProvider(config.llm)
  const allowedTools = computeWorkerWhitelist({ parentWhitelist: null, roleAllow: null })
  const systemPromptHashes = new Set()
  const observedProvider = { complete(params) {
    // Hash the exact production assessor envelope, not a hand-built copy.
    systemPromptHashes.add(digest(params.messages[0].content))
    return provider.complete(params)
  } }
  const allCases = [...cases, ...semanticCases]
  const results = new Array(allCases.length)
  let cursor = 0
  async function lane() {
    while (cursor < allCases.length) {
      const index = cursor++, [id, expected, task] = allCases[index], started = Date.now()
      const result = await assessFleetTask({ provider: observedProvider, task, allowedTools })
      results[index] = { id, expected, ...result, latency_ms: Date.now() - started }
      console.log(JSON.stringify({ id, expected, status: result.status, latency_ms: results[index].latency_ms }))
    }
  }
  await Promise.all([lane(), lane(), lane()])
  const originalResults = results.slice(0, cases.length)
  const semanticResults = results.slice(cases.length)
  const positive = originalResults.filter(r => r.expected && r.status === "suggest").length
  const falsePositive = originalResults.filter(r => !r.expected && r.status === "suggest").length
  const unevaluated = results.filter(r => !["suggest", "solo"].includes(r.status)).length
  const semanticPassed = semanticResults.every(r => r.status === (r.expected ? "suggest" : "solo"))
  const report = { date: new Date().toISOString(), model: config.llm.model_name, protocol: config.llm.protocol ?? "openai",
    assessor_source_sha256: digest(fs.readFileSync(path.join(__dirname, "../src/orchestrator/fleet-assessment.ts"))),
    corpus_sha256: digest(JSON.stringify(cases)), tool_envelope_sha256: digest(JSON.stringify(allowedTools)),
    semantic_corpus_sha256: digest(JSON.stringify(semanticCases)),
    system_prompt_sha256: [...systemPromptHashes], timeout_ms: 12000,
    thresholds: { minimum_positive: 6, maximum_false_positive: 2 },
    positive, falsePositive, unevaluated, semanticPassed, cases: originalResults, semantic_cases: semanticResults }
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify({ positive, total_positive: 8, falsePositive, total_negative: 8, unevaluated }))
  assert.equal(unevaluated, 0, "failed or invalid assessments are not negative predictions")
  assert.ok(semanticPassed, "missing-entity and independent industry semantic cases must both pass")
  assert.ok(positive >= 6, "positive detection below 6/8")
  assert.ok(falsePositive <= 2, "false positives above 2/8")
}
main().catch(error => { console.error(error.name + ": " + error.message); process.exitCode = 1 })
