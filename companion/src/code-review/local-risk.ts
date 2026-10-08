import type { EvidenceScope } from "../business-evidence/content"
import { CodeReviewService } from "./service"
import { getLocalReviewJobs, type LocalReviewJobs } from "./local-jobs"

const escape = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1").replace(/[\x00-\x1f\x7f]/g, " ")

/** Read-only composition of actual local findings and current web evidence.
 * No inferred business link/test pass is promoted to a fact. */
export function renderLocalRisk(dataDir: string, scope: EvidenceScope, input: unknown, jobs: LocalReviewJobs = getLocalReviewJobs(dataDir)) {
  const job = jobs.read(scope, input)
  const review = new CodeReviewService(dataDir, scope).read({ review_id: job.review_id })
  const result = job.result
  const gaps = [...new Set([...review.gaps, ...(result?.gaps || []).filter(g => !job.agent_result || !["STATIC_RULE_REVIEW_ONLY", "NO_HUMAN_OR_SEMANTIC_REVIEW"].includes(g)), ...(job.agent_result?.report.gaps || []),
    ...(job.agent_result ? ["NO_HUMAN_REVIEW", "SEMANTIC_AGENT_REVIEW_NOT_INDEPENDENTLY_VERIFIED"] : []),
    ...(!job.agent_result ? ["NO_LOCAL_AGENT_REVIEW"] : job.agent_result.report.status === "partial" ? ["LOCAL_AGENT_REVIEW_PARTIAL"] : []),
    ...(job.status !== "completed" ? [`LOCAL_REVIEW_${job.status.toUpperCase()}`] : []),
    ...(!review.business_context.length ? ["BUSINESS_IMPACT_UNVERIFIED"] : [])])]
  const introduced = result?.findings.filter(f => f.role === "head" && f.introduced) || []
  const risk = introduced.length || job.agent_result?.report.findings.some(f => f.severity === "major") ? "attention_required" : "unknown"
  const mappings = review.business_context.map(ref => ({ ...ref,
    assessment: "网页引用已保留；与本地变化的因果关系、测试执行与业务影响仍需人工核验。" }))
  const webPaths = new Set(review.files.flatMap(f => [f.old_path, f.new_path].filter(Boolean)))
  const changes = result?.changes.map(c => ({ ...c, web_diff_path_present: webPaths.has(c.path) })) || []
  if (changes.some(c => !c.web_diff_path_present)) gaps.push("LOCAL_CHANGES_WITHOUT_WEB_DIFF_REFERENCE")
  const json = { schema_version: 1, job, comparison: { repository: review.repository, base: review.base, head: review.head,
    web_diff_hash: review.diff_hash, identity_state: review.identity_state }, changes, findings: result?.findings || [],
    agent_assessment: job.agent_result, web_assessment: review.assessment, imported_assessment: review.receipt, sources: review.sources, mappings,
    risk, gaps: [...new Set(gaps)], review_ready: false, release_approved: false }
  const lines = ["# 实际变更风险分析（待核验）", "", `状态：${job.status}；风险：${risk}；不构成发布批准。`,
    `仓库：${escape(review.repository)}；base：${review.base}；head：${review.head}；网页 diff SHA-256：${review.diff_hash || "无"}。`,
    "", "## 本地比较与扫描证据", "", "下载 ZIP 仅解析，扫描器不执行或上传内容。若使用 ACP，推理位置见 Agent 目的地，运营者配置不等于系统沙箱。固定静态规则只能发现候选风险，未发现不等于安全。"]
  for (const a of job.artifacts) lines.push(`- ${a.role} ZIP SHA-256：${a.sha256}`)
  for (const c of changes) lines.push(`- ${escape(c.path)} · ${c.kind} · 内容检查 ${c.inspected ? "已进行" : "未进行"} · head hash ${c.head_hash || "已删除"}`)
  for (const f of result?.findings || []) lines.push(`- ${escape(f.role)} ${escape(f.path)}:${f.line} · ${f.rule} · ${f.introduced ? "head 新增候选" : "存量或额外制品候选"} · ${escape(f.summary)} · file ${f.file_hash} · line ${f.line_hash}`)
  lines.push("", "## 本地 Agent 代码评审", "")
  if (job.agent_result) {
    lines.push(`- ${escape(job.agent_result.agent_id)} · ACP session ${escape(job.agent_result.session_id)} · ${job.agent_result.report.status} · ${escape(job.agent_result.destination)}`,
      `- ${escape(job.agent_result.report.summary)}`)
    for (const f of job.agent_result.report.findings) lines.push(`- Agent 评估 ${escape(f.path)}:${f.line} · ${f.severity} · ${escape(f.summary)}`)
    for (const file of job.agent_result.report.reviewed_files) lines.push(`- Agent 声称已评审：${escape(file)}`)
  } else lines.push("- 尚无本地 Agent 评审结果；静态扫描不能代替语义代码评审。")
  lines.push("", "## 网页数据与业务影响", "")
  for (const source of review.sources) lines.push(`- observation ${escape(source.observation_id)} · ${escape(source.url)} · ${escape(source.observed_at)} · ${source.digest}`)
  for (const m of mappings) lines.push(`- ${m.kind} ${escape(m.external_id)} · observation ${escape(m.citation.observation_id)} · ${escape(m.citation.excerpt)} · ${m.assessment}`)
  for (const item of [review.assessment, review.receipt]) if (item) {
    lines.push(`- ${escape(item.origin)}：${escape(item.report.summary)}`)
    for (const mapping of item.report.mappings) lines.push(`- 评语映射 ${mapping.kind} ${escape(mapping.external_id)}：${escape(mapping.assessment)}`)
  }
  lines.push("", "## 未扫描范围", "")
  for (const a of result?.artifacts || []) {
    lines.push(`- ${a.role}：${a.entries} entries，${a.scanned} 文本文件已扫描。`)
    for (const omitted of a.omitted) lines.push(`- ${a.role} ${escape(omitted.path)} · ${escape(omitted.reason)}`)
  }
  lines.push("", "## 未核实事项", "", ...json.gaps.map(g => `- ${g}`))
  return { markdown: lines.join("\n"), json }
}
