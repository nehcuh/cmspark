// Workflow: 根据 reviewer 问题进行第二轮修复

export const meta = {
  name: "bridge-review-fix",
  description: "修复 reviewer 发现的 17 个问题",
  phases: [
    { title: "Fix Issues", detail: "修复 reviewer 发现的所有问题" },
    { title: "Verify", detail: "验证修复后的代码" },
  ],
}

async function fixAllIssues() {
  return await agent(
    `修复以下 reviewer 发现的所有问题。

**Reviewer 1 发现的问题 (5 个)**:
1. [HIGH] getToolDefinition 调用 getToolDefinitions() 导致每次查找工具都重新验证所有工具定义，O(n) 性能问题
2. [HIGH] validateToolCallArguments 对 null 值的类型检查存在漏洞
3. [MEDIUM] isValidToolDefinition 未验证嵌套的 ToolParameter 结构
4. [MEDIUM] extractChineseBigrams 对纯英文文本返回空数组，但调用方未处理空数组边界
5. [LOW] 日志中 "matched: active" 出现两次（第 58 行和第 65 行），语义不清晰

**Reviewer 2 发现的问题 (6 个)**:
1. [HIGH] isTabRelevant 的 30% 阈值是硬编码，没有考虑查询长度差异
2. [HIGH] resolveTargetTab 在 pinnedTabIds 为空数组时仍然进入循环（虽不会执行但不清晰）
3. [MEDIUM] extractKeywords 的 split 正则表达式包含重复字符类
4. [MEDIUM] bigrams 提取逻辑对奇数长度中文文本会丢失最后一个字符
5. [LOW] 工具定义中的 description 字段没有验证非空
6. [LOW] 日志消息中 "explicit" 大写但其他匹配类型小写，不一致

**Reviewer 3 发现的问题 (6 个)**:
1. [HIGH] resolveTargetTab 的 sorted 数组每次都重新排序，O(n log n) 开销
2. [HIGH] getToolDefinitions 返回 any[] 而不是 ToolDefinition[]，类型不安全
3. [MEDIUM] isTabRelevant 对特殊字符查询（如 "!@#"）返回 true，可能误匹配
4. [MEDIUM] 错误消息 "No tabs available" 没有提供可操作的上下文
5. [LOW] extractKeywords 的 stopWords Set 每次调用都重新创建
6. [LOW] 函数命名不一致：isValidToolDefinition vs isValidToolParameter

修复要求：
1. 使用 Edit 工具直接修改代码
2. 每个修复都要有明确的注释说明
3. 保持代码风格一致
4. 不要引入新的问题

修复完成后报告修复的位置和方法。`,
    { label: "fix:all-issues" }
  )
}

async function verifyFixes() {
  return await agent(
    `验证修复后的代码是否正确。

请阅读以下文件并验证：
1. companion/src/bridge/tab-resolver.ts
2. companion/src/bridge/tool-definitions.ts

检查：
1. 所有 17 个问题是否都已修复
2. 是否引入新的问题
3. 代码是否能正常编译

运行测试验证：
npm test -- bridge.test.ts

输出验证结果。`,
    { label: "verify:fixes" }
  )
}

phase("Fix Issues")

log("开始修复 reviewer 发现的 17 个问题...")

const fixResult = await fixAllIssues()

log("修复完成")

phase("Verify")

log("验证修复后的代码...")

const verifyResult = await verifyFixes()

log("验证完成")

return {
  fixResult: fixResult ? fixResult.substring(0, 500) : "无结果",
  verifyResult: verifyResult ? verifyResult.substring(0, 500) : "无结果",
}
