// Skill-craft: extract reusable skills from conversation history via LLM analysis

import OpenAI from "openai"
import type { ThreadManager } from "../threads/thread-manager"

export interface CraftedSkill {
  name: string
  description: string
  type: "prompt_template" | "tool_chain"
  parameters?: SkillParameter[]
  body: string
}

export interface SkillParameter {
  name: string
  type: "string" | "number" | "boolean"
  required: boolean
  default?: string
  description: string
}

export interface CraftParams {
  threadId: string
  threadManager: ThreadManager
  messageIds?: string[]
  messageCount?: number
  config: {
    base_url: string
    api_key: string
    model_name: string
    temperature: number
  }
}

const CRAFT_SYSTEM_PROMPT = `你是一个技能提取器。分析以下 Agent 对话历史，识别可复用的操作模式。

## 规则

1. **有明确 tool call 序列** → 生成 tool_chain 类型，提取步骤和参数
2. **纯指导性对话** → 生成 prompt_template 类型，总结指导要点
3. 识别硬编码值中的**可参数化部分**（URL、搜索词、日期、用户名等）
4. 生成的技能应有清晰的名称（英文标识符）和中文描述

## 输出格式

严格遵循以下 Markdown 格式（不要用代码块包裹整个输出）：

---
name: <字母数字连字符，如 export-report>
description: <一句话中文描述>
type: <tool_chain 或 prompt_template>
parameters:
  <param_name>:
    type: <string | number | boolean>
    required: <true | false>
    default: <默认值或空>
    description: <参数说明>
---

# <中文技能标题>

<步骤或指导内容，用 {{param_name}} 标记可替换参数>

## 注意事项

- 如果没有可提取的复用模式，输出 "NO_PATTERN"
- name 必须唯一且简短
- 每个参数都要有说明
- 步骤要清晰可执行`

export async function craftSkill(params: CraftParams): Promise<CraftedSkill | null> {
  const { threadId, threadManager, messageIds, messageCount, config } = params

  // Get conversation messages
  const allMessages = threadManager.getMessages(threadId)
  if (allMessages.length === 0) return null

  // Filter to selected range
  let messages = allMessages
  if (messageIds && messageIds.length > 0) {
    messages = allMessages.filter(m => messageIds.includes(m.id))
  } else if (messageCount && messageCount > 0) {
    // Take last N user+assistant exchanges
    const userAssistant = allMessages.filter(m => m.role === "user" || m.role === "assistant")
    const slice = userAssistant.slice(-messageCount * 2) // user+assistant per round
    if (slice.length > 0) {
      const startId = slice[0].id
      const startIdx = allMessages.findIndex(m => m.id === startId)
      messages = allMessages.slice(startIdx)
    }
  }

  if (messages.length === 0) return null

  // Check if there's anything meaningful to extract
  const hasToolCalls = messages.some(m => m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0)
  if (!hasToolCalls) {
    // Only user-assistant text conversation — can still extract prompt_template
  }

  // Build the conversation summary for the LLM
  const conversationText = messages.map(m => {
    if (m.role === "user") return `用户: ${m.content}`
    if (m.role === "assistant") {
      let text = `Agent: ${m.content || ""}`
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          const fn = tc.function || tc
          text += `\n  [调用工具: ${fn.name}(${typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {})})]`
        }
      }
      return text
    }
    if (m.role === "tool") {
      if (m.tool_calls) {
        return m.tool_calls.map((tc: any) => `  [工具结果: ${tc.tool_name || "unknown"} → ${tc.status || "done"}]`).join("\n")
      }
      return `  [工具结果]`
    }
    return ""
  }).filter(Boolean).join("\n\n")

  // Create OpenAI client
  const client = new OpenAI({
    baseURL: config.base_url,
    apiKey: config.api_key || "sk-placeholder",
  })

  const response = await client.chat.completions.create({
    model: config.model_name,
    temperature: Math.min(config.temperature, 0.3), // lower temp for extraction
    messages: [
      { role: "system", content: CRAFT_SYSTEM_PROMPT },
      { role: "user", content: `请分析以下对话历史，提取可复用的技能：\n\n${conversationText}` },
    ],
  })

  const output = response.choices[0]?.message?.content?.trim() || ""

  if (!output || output === "NO_PATTERN") return null

  return parseCraftedSkill(output)
}

function parseCraftedSkill(output: string): CraftedSkill | null {
  try {
    // The output should be markdown with YAML frontmatter
    // LLM may or may not wrap in code fences — strip them
    let cleaned = output
    if (cleaned.startsWith("```")) {
      const end = cleaned.lastIndexOf("```")
      if (end > 3) {
        cleaned = cleaned.substring(cleaned.indexOf("\n") + 1, end).trim()
      }
    }

    // Parse frontmatter manually (no gray-matter dependency for YAML subsections)
    const frontmatterMatch = cleaned.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!frontmatterMatch) {
      // LLM didn't follow the format — try to salvage
      return salvageSkill(cleaned)
    }

    const yamlBlock = frontmatterMatch[1]
    const body = frontmatterMatch[2].trim()

    // Parse YAML frontmatter fields by line
    const nameMatch = yamlBlock.match(/^name:\s*(.+)$/m)
    const descMatch = yamlBlock.match(/^description:\s*(.+)$/m)
    const typeMatch = yamlBlock.match(/^type:\s*(.+)$/m)

    if (!nameMatch) return null

    const name = nameMatch[1].trim()
    const description = descMatch ? descMatch[1].trim() : ""
    const type = typeMatch ? typeMatch[1].trim() as "prompt_template" | "tool_chain" : "prompt_template"

    // Parse parameters section
    const parameters = parseParameters(yamlBlock)

    return { name, description, type, parameters, body }
  } catch {
    return null
  }
}

function parseParameters(yamlBlock: string): SkillParameter[] | undefined {
  // Find the "parameters:" section
  const paramMatch = yamlBlock.match(/^parameters:\s*\n([\s\S]*)$/m)
  if (!paramMatch) return undefined

  const paramBlock = paramMatch[1]
  const params: SkillParameter[] = []

  // Each parameter is key: { ... }
  const paramNames = paramBlock.match(/^  (\w+):\s*$/gm)
  if (!paramNames) return undefined

  for (const nameLine of paramNames) {
    const name = nameLine.match(/^  (\w+):/)![1]
    const nameIdx = paramBlock.indexOf(nameLine)
    const nextNameMatch = paramBlock.substring(nameIdx + nameLine.length).match(/^  (\w+):\s*$/m)
    const sectionEnd = nextNameMatch
      ? nameIdx + nameLine.length + (nextNameMatch.index || 0)
      : paramBlock.length
    const section = paramBlock.substring(nameIdx, sectionEnd)

    const typeMatch = section.match(/^\s*type:\s*(.+)$/m)
    const requiredMatch = section.match(/^\s*required:\s*(.+)$/m)
    const defaultMatch = section.match(/^\s*default:\s*(.+)$/m)
    const descMatch = section.match(/^\s*description:\s*(.+)$/m)

    params.push({
      name,
      type: (typeMatch?.[1]?.trim() || "string") as "string" | "number" | "boolean",
      required: requiredMatch?.[1]?.trim() === "true",
      default: defaultMatch?.[1]?.trim() || undefined,
      description: descMatch?.[1]?.trim() || "",
    })
  }

  return params.length > 0 ? params : undefined
}

// Salvage a skill from LLM output that didn't follow the frontmatter format
function salvageSkill(text: string): CraftedSkill | null {
  // Try to find a heading for the name
  const headingMatch = text.match(/^#\s+(.+)/m)
  const name = headingMatch
    ? headingMatch[1].trim().replace(/\s+/g, "-").toLowerCase().replace(/[^a-z0-9-]/g, "")
    : "extracted-skill"

  const firstLine = text.split("\n")[0].trim()
  const description = firstLine.length < 100 ? firstLine : "从对话中提取的技能"

  return {
    name,
    description,
    type: "prompt_template",
    parameters: undefined,
    body: text,
  }
}

/**
 * Convert a CraftedSkill back to markdown format for saving.
 */
export function craftSkillToMarkdown(skill: CraftedSkill): string {
  const lines = ["---"]
  lines.push(`name: ${skill.name}`)
  if (skill.description) lines.push(`description: ${skill.description}`)
  lines.push(`type: ${skill.type || "prompt_template"}`)
  if (skill.parameters && skill.parameters.length > 0) {
    lines.push("parameters:")
    for (const p of skill.parameters) {
      lines.push(`  ${p.name}:`)
      lines.push(`    type: ${p.type}`)
      lines.push(`    required: ${p.required}`)
      if (p.default) lines.push(`    default: ${p.default}`)
      lines.push(`    description: ${p.description}`)
    }
  }
  lines.push("---")
  lines.push("")
  lines.push(skill.body || "")
  return lines.join("\n")
}
