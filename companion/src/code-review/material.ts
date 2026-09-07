import { z } from "zod"
import { BusinessEvidenceService } from "../business-evidence/service"
import type { EvidenceScope } from "../business-evidence/content"
import { CodeReviewService } from "./service"
import { canonicalRepository } from "./contract"

// Inert Markdown: source/model strings cannot embed active HTML/images/links.
const escape = (text: unknown) => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1").replace(/\r?\n/g, "<br>")

export function renderReviewMaterial(dataDir: string, scope: EvidenceScope, input: unknown) {
  const request = z.object({ review_id: z.string().uuid(), draft_id: z.string().min(1).max(128) }).strict().parse(input)
  const review = new CodeReviewService(dataDir, scope).read({ review_id: request.review_id })
  const binding = review.material_bindings.find(ref => ref.draft_id === request.draft_id)
  if (!binding) throw new Error("CODE_REVIEW_MATERIAL_NOT_BOUND")
  const draftService = new BusinessEvidenceService(dataDir, scope)
  const rendered = draftService.render({ draft_id: request.draft_id }), draft = rendered.json
  const gaps = [...draft.gaps, ...review.gaps]
  if (draft.draft.revision !== binding.revision) gaps.push("CODE_REVIEW_MATERIAL_REVISION_CHANGED")
  const commitKey = draft.draft.kind === "change_material.v1" ? "release.commit_id" : "code.commit_id"
  if (draft.fields[commitKey]?.state !== "supported") gaps.push("MATERIAL_CODE_UNVERIFIED")
  const commit = draft.draft.fields[commitKey]?.value
  if (typeof commit === "string" && commit !== review.head) gaps.push("MATERIAL_COMMIT_MISMATCH")
  if (draft.draft.kind === "development_trace.v1") {
    let repository: string | undefined
    try { repository = canonicalRepository(String(draft.draft.fields["code.repository_id"]?.value || "")) } catch {}
    if (repository !== review.repository || draft.fields["code.repository_id"]?.state !== "supported") gaps.push("MATERIAL_REPOSITORY_UNVERIFIED")
    if (!review.business_context.some(ref => ref.kind === "requirement" && ref.external_id === draft.draft.fields["requirement.id"]?.value)) gaps.push("MATERIAL_REQUIREMENT_MISMATCH")
  } else gaps.push("RELEASE_REPOSITORY_NOT_VERIFIED")
  if (!review.business_context.some(ref => ref.kind === "development_task")) gaps.push("DEVELOPMENT_TASK_REFERENCE_MISSING")
  if (!review.assessment && !review.receipt) gaps.push("CODE_ASSESSMENT_MISSING")
  const lines = ["# 代码关联材料草稿：未齐备待处理", "", "以下保留原材料字段检查；代码来源、覆盖与评语单独核对，不构成发布批准。", "", rendered.markdown.replace(/^# /, "## 原材料字段核对："),
    "", "## 代码比较", "", `仓库：${escape(review.repository)}；base：${escape(review.base)}；head：${escape(review.head)}；diff hash：${escape(review.diff_hash || "未采集")}`,
    `身份：${review.identity_state}；覆盖：${review.coverage}；代码审阅齐备：否。`, "", "## 实际业务引用（不等于故事草稿）", ""]
  for (const ref of review.business_context) lines.push(`- ${escape(ref.kind)} ${escape(ref.external_id)} · observation ${escape(ref.citation.observation_id)} · ${escape(ref.citation.excerpt)}`)
  for (const item of [review.assessment, review.receipt]) {
    if (!item) continue
    lines.push("", `## ${item.origin === "cmspark_assessment" ? "CMspark 网页评语" : "用户确认导入的外部评语"}（未独立核实）`, "", escape(item.report.summary))
    for (const finding of item.report.findings) lines.push(`- ${escape(finding.severity)} ${escape(finding.path)} ${finding.side}:${finding.line} · ${escape(finding.summary)}`)
    for (const mapping of item.report.mappings) lines.push(`- ${escape(mapping.kind)} ${escape(mapping.external_id)} · ${escape(mapping.assessment)}`)
  }
  lines.push("", "## 代码网页来源", "")
  for (const source of review.sources) lines.push(`- ${escape(source.observation_id)} · ${escape(source.url)} · ${escape(source.observed_at)} · ${escape(source.digest)}`)
  lines.push("", "## 合并核对缺项", "", ...[...new Set(gaps)].map(gap => `- ${escape(gap)}`))
  return { markdown: lines.join("\n"), json: { draft, code_review: review, review_ready: false, combined_ready: false, gaps: [...new Set(gaps)] } }
}
