import { z } from "zod"
import { BusinessEvidenceService } from "../business-evidence/service"
import type { EvidenceScope } from "../business-evidence/content"
import { CodeReviewService } from "./service"
import { canonicalRepository } from "./contract"
import { exactExcerpt, excerptSupportsValue } from "../business-evidence/content"
import { validateGithubRelease } from "./github-release"

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
  if (typeof commit === "string" && commit.trim().length > 0 && commit !== review.head) gaps.push("MATERIAL_COMMIT_MISMATCH")
  if (draft.draft.kind === "development_trace.v1") {
    let repository: string | undefined
    try { repository = canonicalRepository(String(draft.draft.fields["code.repository_id"]?.value || "")) } catch {}
    if (repository !== review.repository || draft.fields["code.repository_id"]?.state !== "supported") gaps.push("MATERIAL_REPOSITORY_UNVERIFIED")
    if (!review.business_context.some(ref => ref.kind === "requirement" && ref.external_id === draft.draft.fields["requirement.id"]?.value)) gaps.push("MATERIAL_REQUIREMENT_MISMATCH")
  }
  const releaseRelation = (() => {
    if (draft.draft.kind !== "change_material.v1" || draft.draft.revision !== binding.revision) return null
    const names = ["release.id", "release.version", "release.commit_id"]
    if (names.some(name => draft.fields[name]?.state !== "supported")) return null
    const candidates = names.map(name => draft.draft.fields[name])
    const citations = candidates.flatMap(candidate => candidate.citations)
    const ids = new Set(citations.map(citation => citation.observation_id))
    if (ids.size !== 1 || candidates.some(candidate => !candidate.citations.length)) return null
    // Store.read revalidates relation, content-bound digest and capture policy on
    // every render. Old/generic observations cannot acquire a relation here.
    const observation = draftService.store.read().observations.find(item => item.id === citations[0].observation_id)
    if (!observation?.release_relation) return null
    const relation = validateGithubRelease(observation.release_relation, observation.target.url)
    if (relation.repository !== review.repository || relation.head !== review.head
      || candidates[2].value !== relation.head || candidates[1].value !== relation.tag
      || ![relation.tag, relation.release_url].includes(String(candidates[0].value))) return null
    if (citations.some(citation => !exactExcerpt(observation.content, citation)
      || ![relation.tag, relation.head, new URL(relation.repository).pathname].every(value => excerptSupportsValue(observation.content, citation, value, false)))) return null
    return { status: "observed_platform_relation" as const, ...relation,
      limitation: "BUILD_ARTIFACT_AUTHENTICITY_UNVERIFIED" as const,
      source: { observation_id: observation.id, url: observation.target.url, observed_at: observation.observed_at,
        digest: observation.digest, relation_digest: observation.release_relation_digest, provenance: observation.provenance, citations } }
  })()
  if (draft.draft.kind === "change_material.v1") gaps.push(releaseRelation
    ? "RELEASE_BUILD_ARTIFACT_AUTHENTICITY_NOT_VERIFIED" : "RELEASE_REPOSITORY_NOT_VERIFIED")
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
  if (releaseRelation) lines.push("", "## 发布页当前声明（仅观测关系）", "",
    `状态：observed_platform_relation；仓库：${escape(releaseRelation.repository)}；tag：${escape(releaseRelation.tag)}；commit：${escape(releaseRelation.head)}`,
    `来源：${escape(releaseRelation.source.observation_id)} · ${escape(releaseRelation.source.url)} · ${escape(releaseRelation.source.observed_at)}`,
    "这只是当前采集的 GitHub 发布页声明；未验证历史 tag、构建/资产内容或签名真实性，不构成发布批准。")
  lines.push("", "## 合并核对缺项", "", ...[...new Set(gaps)].map(gap => `- ${escape(gap)}`))
  return { markdown: lines.join("\n"), json: { draft, code_review: review, release_relation: releaseRelation, review_ready: false, combined_ready: false, gaps: [...new Set(gaps)] } }
}
