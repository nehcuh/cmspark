// Workflow: Development Task Router
// Routes user development requests to the appropriate workflow template.

export const meta = {
  name: "dev-router",
  description: "开发任务路由：分析任务类型并匹配对应 Workflow 模板",
  phases: [
    { title: "Analyze", detail: "分析用户输入，识别开发任务类型" },
    { title: "Match", detail: "匹配对应的 Workflow 模板" },
    { title: "Route", detail: "输出路由结果和执行指引" },
  ],
}

const WORKFLOW_TEMPLATES = {
  bug_fix: {
    name: "bridge-review-fix",
    pattern: /fix|bug|repair|crash|error|broken|fail|regression|issue/i,
    description: "修复型任务：定位问题根因，实施修复，验证回归",
    phases: ["Diagnose", "Fix", "Verify", "Regression Test"],
  },
  feature: {
    name: "bridge-triple-insurance-fix",
    pattern: /feat|feature|add|implement|support|enable|new/i,
    description: "功能型任务：设计实现，多 agent 并行，对抗验证",
    phases: ["Design", "Implement", "Adversarial Review", "Skeptic Review"],
  },
  refactor: {
    name: "bridge-review-fix",
    pattern: /refactor|cleanup|simplify|restructure|migrate|deprecate/i,
    description: "重构型任务：分析影响面，渐进改造，保持行为一致",
    phases: ["Audit", "Refactor", "Verify", "Review"],
  },
  review: {
    name: "bridge-review-fix",
    pattern: /review|audit|check|inspect|evaluate|assess/i,
    description: "审查型任务：代码审查，安全审计，架构评估",
    phases: ["Read", "Analyze", "Report", "Action"],
  },
}

/** Phase 1: Analyze user input to determine task type. */
async function analyzeTaskType(userRequest: string) {
  const scores: Record<string, number> = {}
  for (const [type, template] of Object.entries(WORKFLOW_TEMPLATES)) {
    const matches = (userRequest.match(template.pattern) || []).length
    scores[type] = matches
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const topType = sorted[0][0]
  const topScore = sorted[0][1]
  const secondScore = sorted[1]?.[1] || 0

  // If top score is 0, default to review (safest fallback)
  const taskType = topScore === 0 ? "review" : topType
  const confidence = topScore === 0 ? 0.3 : (secondScore === 0 ? 0.95 : topScore / (topScore + secondScore))

  return {
    taskType,
    confidence: Math.round(confidence * 100),
    allScores: scores,
    ambiguous: confidence < 0.7,
  }
}

/** Phase 2: Match the workflow template. */
function matchWorkflow(analysis: { taskType: string; confidence: number; ambiguous: boolean }) {
  const template = WORKFLOW_TEMPLATES[analysis.taskType as keyof typeof WORKFLOW_TEMPLATES]
  if (!template) {
    return {
      matched: false,
      fallback: "review",
      reason: `Unknown task type "${analysis.taskType}", falling back to review workflow`,
    }
  }

  return {
    matched: true,
    workflowName: template.name,
    workflowDescription: template.description,
    phases: template.phases,
    ambiguous: analysis.ambiguous,
  }
}

/** Phase 3: Output routing result and execution guidance. */
function buildRouteResult(
  userRequest: string,
  analysis: { taskType: string; confidence: number; allScores: Record<string, number>; ambiguous: boolean },
  match: { matched: boolean; workflowName?: string; workflowDescription?: string; phases?: string[]; fallback?: string; reason?: string; ambiguous?: boolean },
) {
  const lines: string[] = []

  lines.push(`# Dev Router Result`)
  lines.push(``)
  lines.push(`## Input Analysis`)
  lines.push(`- Task Type: **${analysis.taskType}**`)
  lines.push(`- Confidence: ${analysis.confidence}%`)
  lines.push(`- Ambiguous: ${analysis.ambiguous ? "Yes" : "No"}`)
  lines.push(`- Keyword Scores:`)
  for (const [type, score] of Object.entries(analysis.allScores)) {
    lines.push(`  - ${type}: ${score}`)
  }

  lines.push(``)
  lines.push(`## Workflow Match`)

  if (!match.matched) {
    lines.push(`- Status: **FALLBACK**`)
    lines.push(`- Fallback Workflow: ${match.fallback}`)
    lines.push(`- Reason: ${match.reason}`)
  } else {
    lines.push(`- Status: **MATCHED**`)
    lines.push(`- Workflow: \`${match.workflowName}\``)
    lines.push(`- Description: ${match.workflowDescription}`)
    lines.push(`- Phases: ${match.phases?.join(" → ")}`)
    if (match.ambiguous) {
      lines.push(`- Warning: Low confidence — consider manual override`)
    }
  }

  lines.push(``)
  lines.push(`## Execution Guidance`)

  if (match.matched && match.workflowName) {
    lines.push(`1. Load workflow: \`workflows/${match.workflowName}.ts\``)
    lines.push(`2. Follow phases: ${match.phases?.join(" → ")}`)
    lines.push(`3. Report completion with summary of changes`)
  } else {
    lines.push(`1. Load fallback workflow: \`workflows/${match.fallback}.ts\``)
    lines.push(`2. Proceed with general review pattern`)
  }

  if (analysis.ambiguous) {
    lines.push(``)
    lines.push(`## Manual Override Options`)
    lines.push(`Task confidence is low. You may override with:`)
    lines.push(`- \`dev-router --type bug_fix\` for bug-fix workflow`)
    lines.push(`- \`dev-router --type feature\` for feature workflow`)
    lines.push(`- \`dev-router --type refactor\` for refactor workflow`)
    lines.push(`- \`dev-router --type review\` for review workflow`)
  }

  return lines.join("\n")
}

// --- Workflow Execution ---

phase("Analyze")

log("Phase 1: Analyzing task type from user request...")

const analysis = await analyzeTaskType(userRequest || "")

log(`Task type: ${analysis.taskType} (confidence: ${analysis.confidence}%)`)
log(`Ambiguous: ${analysis.ambiguous}`)

phase("Match")

log("Phase 2: Matching workflow template...")

const match = matchWorkflow(analysis)

if (match.matched) {
  log(`Matched workflow: ${match.workflowName}`)
} else {
  log(`Fallback to: ${match.fallback}`)
}

phase("Route")

log("Phase 3: Building route result...")

const result = buildRouteResult(userRequest || "", analysis, match)

log(result)

return {
  taskType: analysis.taskType,
  confidence: analysis.confidence,
  ambiguous: analysis.ambiguous,
  workflow: match.matched ? match.workflowName : match.fallback,
  matched: match.matched,
  guidance: result,
}
