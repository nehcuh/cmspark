// Workflow: companion/src/bridge/ 三保险修复

export const meta = {
  name: "bridge-triple-insurance-fix",
  description: "三保险修复 bridge/ 模块：修复层+对抗验证+综合审查",
  phases: [
    { title: "Fix", detail: "3 个 agent 并行修复工具调度、错误处理、日志记录" },
    { title: "Adversarial Review", detail: "3 个 reviewer 以对抗姿态审查每个修复" },
    { title: "Skeptic Review", detail: "skeptic agent 做最终综合审查" },
  ],
}

const FILES = {
  tabResolver: "companion/src/bridge/tab-resolver.ts",
  toolDefinitions: "companion/src/bridge/tool-definitions.ts",
}

async function fixToolDispatch() {
  return await agent(
    "修复 bridge/ 模块的**工具调度逻辑**问题。" +
    "请阅读 " + FILES.tabResolver + " 和 " + FILES.toolDefinitions +
    "，分析并修复工具调度相关的逻辑问题。" +
    "重点检查：resolveTargetTab 优先级逻辑、语义匹配边界、tabList 为空处理、" +
    "explicitTabId 无效回退、pinnedTabIds 顺序处理。" +
    "使用 Edit 工具修改，添加必要注释说明修复原因。最后报告修复位置。",
    { label: "fix:tool-dispatch" }
  )
}

async function fixErrorHandling() {
  return await agent(
    "修复 bridge/ 模块的**错误处理**问题。" +
    "请阅读 " + FILES.tabResolver + " 和 " + FILES.toolDefinitions +
    "，分析并修复错误处理相关的问题。" +
    "重点检查：错误消息清晰性、未捕获异常、边界条件错误处理、" +
    "类型安全（tab.id 可能 undefined）、用户错误可恢复性。" +
    "使用 Edit 工具修改，添加类型守卫。最后报告修复位置。",
    { label: "fix:error-handling" }
  )
}

async function fixLogging() {
  return await agent(
    "修复 bridge/ 模块的**日志记录**问题。" +
    "请阅读 " + FILES.tabResolver + " 和 " + FILES.toolDefinitions +
    "，分析并修复日志记录相关的问题。" +
    "重点检查：关键决策点日志、日志级别合理性、调试上下文完整性、" +
    "重复冗余日志、性能敏感路径过度日志。" +
    "使用 Edit 工具修改，从 ../../logger.ts 导入 logger。最后报告修复位置。",
    { label: "fix:logging" }
  )
}

async function adversarialReview(fixResult, focus) {
  return await agent(
    "以**对抗姿态**审查以下修复。审查焦点：" + focus +
    "。请阅读 " + FILES.tabResolver + " 和 " + FILES.toolDefinitions +
    "。前序修复：" + (fixResult || "无") +
    "审查要求（必须找出至少 2 个问题）：逻辑缺陷、边界遗漏、性能问题、" +
    "类型安全、代码重复、错误退化。" +
    "输出 JSON: {approved: boolean, issues: [{severity, description, suggested_fix}]}。" +
    "如果找不出 2 个以上问题，说明审查不充分。",
    { schema: {
      type: "object",
      properties: {
        approved: { type: "boolean" },
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              severity: { type: "string" },
              description: { type: "string" },
              suggested_fix: { type: "string" },
            },
          },
        },
      },
      required: ["approved", "issues"],
    }}
  )
}

async function skepticReview(allFixes, allReviews) {
  return await agent(
    "作为**Skeptic**，对整个修复集合做最终审查。" +
    "请阅读 " + FILES.tabResolver + " 和 " + FILES.toolDefinitions +
    "。审查重点：冲突检测、回归风险、一致性、完整性、过度修复。" +
    "输出 JSON: {approved: boolean, conflicts: [], regressions: [], overall_assessment: string}。" +
    "如果 approved 为 false，必须说明阻止通过的原因。",
    { schema: {
      type: "object",
      properties: {
        approved: { type: "boolean" },
        conflicts: { type: "array", items: { type: "string" } },
        regressions: { type: "array", items: { type: "string" } },
        overall_assessment: { type: "string" },
      },
      required: ["approved", "overall_assessment"],
    }}
  )
}

phase("Fix")

log("第一层：3 个 agent 并行修复...")

const fixes = await parallel([
  () => fixToolDispatch(),
  () => fixErrorHandling(),
  () => fixLogging(),
])

const [toolDispatchFix, errorHandlingFix, loggingFix] = fixes

log("修复完成")

phase("Adversarial Review")

log("第二层：3 个 reviewer 以对抗姿态审查...")

const reviews = await parallel([
  () => adversarialReview(toolDispatchFix, "工具调度逻辑"),
  () => adversarialReview(errorHandlingFix, "错误处理"),
  () => adversarialReview(loggingFix, "日志记录"),
])

const [review1, review2, review3] = reviews

const reviewPass = reviews.every(r => r && r.issues && r.issues.length >= 2)

log("审查结果：" + reviews.filter(r => r && r.approved).length + "/3 通过")
log("审查充分性：" + (reviewPass ? "充分" : "不充分"))

phase("Skeptic Review")

log("第三层：skeptic agent 做最终综合审查...")

const skeptic = await skepticReview(fixes, reviews)

log("Skeptic 审查结果：" + (skeptic.approved ? "通过" : "不通过"))

const allApproved = skeptic && skeptic.approved && reviews.every(r => r && r.approved)

return {
  approved: allApproved,
  summary: {
    fixes: fixes.map((f, i) => ({
      layer: "fix",
      agent: i + 1,
      summary: (f || "无").substring(0, 200),
    })),
    reviews: reviews.map((r, i) => ({
      layer: "review",
      reviewer: i + 1,
      approved: r ? r.approved : false,
      issues_count: r && r.issues ? r.issues.length : 0,
    })),
    skeptic: {
      layer: "skeptic",
      approved: skeptic.approved,
      conflicts: skeptic.conflicts || [],
      regressions: skeptic.regressions || [],
    },
  },
}
