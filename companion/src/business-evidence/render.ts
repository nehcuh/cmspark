import type { CheckedDraft } from "./checker"

// Every page/model string is escaped in Markdown. Keep this an inert document:
// raw HTML and remote images must not turn evidence into rendering instructions.
const escape = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1").replace(/\r?\n/g, "<br>")

export function renderDraft(view: CheckedDraft) {
  const label = view.ready ? "材料草稿：齐备待复核" : "材料草稿：未齐备待处理"
  const lines = [`# ${label}`, "", escape(view.draft.title), "", `草稿 ${escape(view.draft.id)} · revision ${view.draft.revision}`, "", "| 字段 | 候选值 | 核对状态 | 原因 |", "| --- | --- | --- | --- |"]
  for (const [name, field] of Object.entries(view.fields)) {
    const value = view.draft.fields[name]?.value
    lines.push(`| ${escape(name)} | ${escape(Array.isArray(value) ? JSON.stringify(value) : value)} | ${field.state} | ${escape(field.reasons.join(", "))} |`)
  }
  lines.push("", "## 关系", "")
  for (const [name, relation] of Object.entries(view.relations)) lines.push(`- ${escape(name)}: ${relation.state}${relation.confirmation === "user_confirmed" ? "（试点人工映射）" : ""} ${escape(relation.reasons.join(", "))}`)
  if (view.draft.kind === "development_trace.v1") lines.push("", "## 故事草稿（创作文字，尚未在平台创建）", "", escape(view.draft.story_draft_text || "未提供"))
  lines.push("", "## 待处理项", "", ...(view.gaps.length ? view.gaps.map(gap => `- ${escape(gap)}`) : ["资料规则检查通过，仍需用户复核。"]), "", "## 来源", "")
  const seen = new Set<string>()
  for (const field of Object.values(view.fields)) for (const source of field.sources) {
    if (seen.has(source.observation_id)) continue
    seen.add(source.observation_id)
    lines.push(`- ${escape(source.observation_id)} · ${escape(source.system_key)} · ${escape(source.environment)} · ${escape(source.url)} · 采集 ${escape(source.observed_at)}`)
  }
  if (view.coverage_basis.length) lines.push("", `覆盖依据：${escape(view.coverage_basis.join(", "))}。静态范围来自试点声明，不代表自动遍历。`)
  if (view.runtime_exemption) lines.push("", `运行态不适用（锁定试点契约）：${escape(view.runtime_exemption.rationale)}。未采集的字段仍标 missing，不伪称已核实。`)
  return { markdown: lines.join("\n"), json: structuredClone(view) }
}
