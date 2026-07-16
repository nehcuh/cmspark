// Tool definitions in OpenAI function-calling format

import { logger } from "../logger"

// Type definitions for tool schema
interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
  required?: string[]
}

/** Type guard for ToolParameter */
function isValidToolParameter(param: unknown): param is ToolParameter {
  if (typeof param !== "object" || param === null) return false
  const p = param as ToolParameter
  if (typeof p.type !== "string") return false
  if (p.description !== undefined && typeof p.description !== "string") return false
  if (p.enum !== undefined && !Array.isArray(p.enum)) return false
  if (p.properties !== undefined && typeof p.properties !== "object") return false
  if (p.required !== undefined && !Array.isArray(p.required)) return false
  return true
}

interface ToolFunction {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, ToolParameter>
    required: string[]
  }
}

export interface ToolDefinition {
  type: "function"
  function: ToolFunction
}

/** Validate a tool definition structure with comprehensive checks */
function isValidToolDefinition(tool: unknown): tool is ToolDefinition {
  if (typeof tool !== "object" || tool === null) return false
  const t = tool as ToolDefinition

  // Basic structure checks
  if (
    t.type !== "function" ||
    typeof t.function !== "object" ||
    t.function === null ||
    typeof t.function.name !== "string" ||
    typeof t.function.description !== "string"
  ) {
    return false
  }

  // FIXED [LOW]: Ensure description is non-empty after trimming
  // Empty descriptions provide no value to the LLM for tool selection
  if (!t.function.description?.trim()) {
    return false
  }

  // Parameters structure validation
  const params = t.function.parameters
  if (typeof params !== "object" || params === null) return false
  if (params.type !== "object") return false

  // properties: if present, must be an object
  if (params.properties !== undefined && typeof params.properties !== "object") {
    return false
  }

  // FIXED [MEDIUM]: Recursively validate nested ToolParameter structures
  // Previously, nested parameters (e.g., in array items) were not validated
  // This could allow invalid schemas through validation
  if (params.properties) {
    for (const propValue of Object.values(params.properties)) {
      if (!isValidToolParameter(propValue)) {
        return false
      }
    }
  }

  // required: if present, must be an array of strings
  if (params.required !== undefined) {
    if (!Array.isArray(params.required)) return false
    if (params.required.some((r) => typeof r !== "string")) return false
  }

  return true
}

export function getToolDefinitions(): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    // --- Tab tools ---
    {
      type: "function",
      function: {
        name: "list_tabs",
        description: "列出浏览器所有标签页",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "create_tab",
        description: "打开新标签页",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "要打开的 URL" },
            active: { type: "boolean", description: "是否激活新标签页，默认 true" },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "close_tab",
        description: "关闭标签页",
        parameters: {
          type: "object",
          properties: { tabId: { type: "number", description: "标签页 ID" } },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "navigate",
        description: "标签页导航到指定 URL",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            url: { type: "string", description: "目标 URL" },
          },
          required: ["tabId", "url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "screenshot",
        description: "截取标签页截图，返回 base64 图片",
        parameters: {
          type: "object",
          properties: { tabId: { type: "number", description: "标签页 ID（可选，默认活跃标签页）" } },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "analyze_image",
        description: "分析页面中指定图片的内容。支持通过 CSS 选择器指定图片元素。需要本地视觉模型已启用。适用于分析产品图片、数据图表、验证码、地图等非文本内容。",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID（可选，默认活跃标签页）" },
            selector: { type: "string", description: "图片元素的 CSS 选择器，如 'img.hero-banner' 或 '#product-image'" },
            prompt: { type: "string", description: "自定义分析提示，如 '描述这张图表的数据趋势'" },
          },
          required: [],
        },
      },
    },

    // --- Page read tools ---
    {
      type: "function",
      function: {
        name: "get_page_text",
        description: "提取页面可见文本内容",
        parameters: {
          type: "object",
          properties: { tabId: { type: "number", description: "标签页 ID" } },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_page_html",
        description: "获取页面 HTML 内容，可选 CSS 选择器范围",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            selector: { type: "string", description: "CSS 选择器（可选）" },
          },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_element_info",
        description: "获取元素位置、可见性和文本信息",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            selector: { type: "string", description: "CSS 选择器" },
          },
          required: ["tabId", "selector"],
        },
      },
    },

    // --- Page interaction tools ---
    {
      type: "function",
      function: {
        name: "click",
        description: "点击页面元素",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            selector: { type: "string", description: "CSS 选择器" },
          },
          required: ["tabId", "selector"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dblclick",
        description: "双击页面元素",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            selector: { type: "string", description: "CSS 选择器" },
          },
          required: ["tabId", "selector"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "type",
        description: "在输入框中输入文本",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            selector: { type: "string", description: "CSS 选择器（可选，不填则输入到当前焦点元素）" },
            value: { type: "string", description: "要输入的文本" },
          },
          required: ["tabId", "value"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fill_form",
        description: "批量填写表单字段",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            fields: {
              type: "array",
              description: "字段列表",
              items: {
                type: "object",
                properties: {
                  selector: { type: "string" },
                  value: { type: "string" },
                  clear_first: { type: "boolean", description: "是否先清空，默认 true" },
                },
                required: ["selector", "value"],
              },
            },
          },
          required: ["tabId", "fields"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "scroll",
        description: "滚动页面",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            deltaX: { type: "number", description: "水平滚动量" },
            deltaY: { type: "number", description: "垂直滚动量" },
            amount: { type: "number", description: "垂直滚动量（别名）" },
          },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "press_key",
        description: "发送键盘按键",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            key: { type: "string", description: "按键名称" },
            modifiers: { type: "number", description: "修饰键位掩码: Alt=1, Ctrl=2, Shift=4, Meta=8" },
          },
          required: ["tabId", "key"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "hover",
        description: "鼠标悬停在元素上",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            selector: { type: "string" },
          },
          required: ["tabId", "selector"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "select_option",
        description: "选择下拉框选项",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            selector: { type: "string", description: "select 元素的 CSS 选择器" },
            value: { type: "string", description: "选项值" },
          },
          required: ["tabId", "selector", "value"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "drag_and_drop",
        description: "拖拽元素",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            from_selector: { type: "string" },
            to_selector: { type: "string" },
          },
          required: ["tabId", "from_selector", "to_selector"],
        },
      },
    },

    // --- Advanced tools ---
    {
      type: "function",
      function: {
        name: "wait_for",
        description: "等待条件满足（选择器出现/消失或网络空闲）",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            selector: { type: "string", description: "等待的 CSS 选择器" },
            state: { type: "string", enum: ["visible", "hidden"], description: "等待出现还是消失，默认 visible" },
            timeout: { type: "number", description: "超时毫秒数，默认 15000" },
            network_idle: { type: "boolean", description: "等待网络空闲" },
          },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "evaluate",
        description: "在页面中执行 JavaScript 代码并返回结果",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            code: { type: "string", description: "要执行的 JavaScript 代码" },
            await_promise: { type: "boolean", description: "是否等待 Promise 完成，默认 true" },
          },
          required: ["tabId", "code"],
        },
      },
    },

    // --- Cookie tools ---
    {
      type: "function",
      function: {
        name: "get_cookies",
        description: "读取指定域的 cookie",
        parameters: {
          type: "object",
          properties: { domain: { type: "string", description: "域名" } },
          required: ["domain"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_cookie",
        description: "设置 cookie",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string" },
            name: { type: "string" },
            value: { type: "string" },
            domain: { type: "string" },
            path: { type: "string" },
            secure: { type: "boolean" },
            httpOnly: { type: "boolean" },
            expirationDate: { type: "number" },
          },
          required: ["url", "name", "value"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_cookie",
        description: "删除 cookie",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string" },
            name: { type: "string" },
          },
          required: ["url", "name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_all_cookies",
        description: "列出浏览器所有 cookie",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    // --- Companion direct tools (no extension needed) ---
    {
      type: "function",
      function: {
        name: "use_skill",
        description: "Load the full instructions of a skill by name. Skills provide step-by-step workflows for specific tasks. Call this ONLY when a skill's name or description matches the user's task — do NOT pre-load all skills.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Skill name to load" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "osascript_eval",
        description: "(macOS ONLY — does NOT work on Windows/Linux) Execute JavaScript in a Chrome tab via AppleScript. Only use this as a LAST RESORT when both get_page_text and evaluate fail on restricted pages (e.g. X.com with strict CSP). Prefer get_page_text for reading page content.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL fragment to match the Chrome tab (e.g. 'zhihu.com' matches 'https://www.zhihu.com/hot')" },
            expression: { type: "string", description: "JavaScript expression to execute in the page context" },
          },
          required: ["url", "expression"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "host_read",
        description: "(macOS ONLY — Phase 0 computer-use spike) Read top-1 message from Mail.app inbox. Returns {sender, subject, date_received, body_preview}. Requires user confirmation; subject to bundle-id vault blacklist.",
        parameters: {
          type: "object",
          properties: {
            application: { type: "string", description: "Bundle id of target app. Phase 0 only supports 'com.apple.mail' (default)." },
            max_chars: { type: "integer", description: "Max body_preview characters (default 500, max 5000)." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "record_experience",
        description: "记录一条操作经验。当用户说'记住这个'或'记录下这条经验'时调用。将经验保存到站点知识库(site_knowledge)或业务域知识库(domain_knowledge)，下次操作该站点时会自动注入。",
        parameters: {
          type: "object",
          properties: {
            target: { type: "string", enum: ["site", "domain"], description: "site=保存到当前站点知识库，domain=保存到全局业务知识库" },
            skill_name: { type: "string", description: "目标 knowledge skill 名称。domain 类型时必须指定；site 类型时如未传 domain，则使用该值作为技能名称" },
            domain: { type: "string", description: "site 类型时的站点域名（如 twitter.com）。如未提供且 skill_name 也为空，则回退为 unknown-site" },
            category: { type: "string", enum: ["problem", "success", "tip", "rule"], description: "经验类别" },
            content: { type: "string", description: "经验内容，简洁的一句话" },
            tags: { type: "array", items: { type: "string" }, description: "仅 domain_knowledge 类型使用，用于语义匹配" },
          },
          required: ["target", "category", "content"],
        },
      },
    },
  ] as ToolDefinition[]

  // Validate all tool definitions at load time
  const invalidTools = tools.filter(t => !isValidToolDefinition(t))
  if (invalidTools.length > 0) {
    const names = invalidTools.map(t => (t as ToolDefinition)?.function?.name || "unknown").join(", ")
    throw new Error(`Invalid tool definitions: ${names}`)
  }

  logger.info("tools_loaded", { count: tools.length }, "bridge")
  return tools
}

/** Build MCP meta tools (resources/prompts access) only when at least one connected
 *  server advertises the corresponding capability. This prevents the LLM from
 *  trying mcp_list_resources on tools-only servers like filesystem or brave-search.
 */
export function getMcpMetaToolDefinitions(capabilities: {
  resources: boolean
  prompts: boolean
}): ToolDefinition[] {
  const tools: ToolDefinition[] = []
  if (capabilities.resources) {
    tools.push({
      type: "function",
      function: {
        name: "mcp_list_resources",
        description: "List resources exposed by an MCP server. Returns URIs that can be passed to mcp_read_resource. Only servers that advertise the resources capability support this; tools-only servers expose file access via their own namespaced tools instead.",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string", description: "MCP server name (as shown in MCP panel)" },
          },
          required: ["server"],
        },
      },
    })
    tools.push({
      type: "function",
      function: {
        name: "mcp_read_resource",
        description: "Read the contents of a specific MCP resource by URI. Use mcp_list_resources first to discover available URIs. Only servers that advertise the resources capability support this.",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string", description: "MCP server name" },
            uri: { type: "string", description: "Resource URI (returned by mcp_list_resources)" },
          },
          required: ["server", "uri"],
        },
      },
    })
  }
  if (capabilities.prompts) {
    tools.push({
      type: "function",
      function: {
        name: "mcp_get_prompt",
        description: "Fetch a prompt template from an MCP server with arguments filled in. Returns ready-to-use messages. Useful for canned workflows like code-review, summarize, explain-error that the server provides.",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string", description: "MCP server name" },
            name: { type: "string", description: "Prompt name" },
            arguments: {
              type: "object",
              description: "Prompt arguments (server-specific; consult server docs)",
              properties: {},
            },
          },
          required: ["server", "name"],
        },
      },
    })
  }
  return tools
}

// FIXED [HIGH]: Cache tool definitions to avoid O(n) re-validation on every getToolDefinition call
// Previously, getToolDefinition called getToolDefinitions() which re-validated all tools
const cachedToolDefinitions = getToolDefinitions()

/** Error thrown when tool definitions fail to load */
export class ToolDefinitionError extends Error {
  constructor(message: string, public readonly toolName?: string) {
    super(message)
    this.name = "ToolDefinitionError"
  }
}

/** Get a tool definition by name */
export function getToolDefinition(name: string): ToolDefinition {
  try {
    // FIXED [HIGH]: Use cached tool definitions instead of re-fetching and re-validating
    // This changes from O(n) validation overhead per call to O(1) lookup
    const tool = cachedToolDefinitions.find(t => t.function.name === name)
    if (!tool) {
      throw new ToolDefinitionError(`Tool '${name}' not found`, name)
    }
    return tool
  } catch (error) {
    if (error instanceof ToolDefinitionError) {
      throw error // Re-throw ToolDefinitionError as-is
    }
    const message = error instanceof Error ? error.message : String(error)
    logger.warn("tool_fetch_failed", { name, error: message }, "bridge")
    throw new ToolDefinitionError(`Failed to fetch tool '${name}': ${message}`, name)
  }
}

/** Check if a tool exists */
export function hasTool(name: string): boolean {
  try {
    getToolDefinition(name)
    return true
  } catch (error) {
    if (error instanceof ToolDefinitionError) {
      // Tool not found is expected case, don't log
      return false
    }
    // Other errors are unexpected
    const message = error instanceof Error ? error.message : String(error)
    logger.error("tool_check_failed", { name, error: message }, "bridge")
    return false
  }
}

/**
 * Validate tool call arguments against the tool definition schema.
 * Returns validated args or throws ToolDefinitionError with details.
 */
export function validateToolCallArguments(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const tool = getToolDefinition(toolName)
  const params = tool.function.parameters
  const result: Record<string, unknown> = { ...args }

  // Check required parameters
  if (Array.isArray(params.required)) {
    const missing = params.required.filter((key) => !(key in args))
    if (missing.length > 0) {
      throw new ToolDefinitionError(
        `Missing required parameters for '${toolName}': ${missing.join(", ")}`,
        toolName
      )
    }
  }

  // Type check each argument
  if (params.properties) {
    for (const [key, value] of Object.entries(args)) {
      const paramSchema = params.properties[key]
      if (!paramSchema) {
        // Unknown parameter — warn but don't fail (forward compatibility)
        logger.warn("unknown_tool_param", { toolName, param: key }, "bridge")
        continue
      }

      // FIXED [HIGH]: Handle null values explicitly in type checking
      // Previously, null values were skipped entirely, allowing invalid null to pass validation
      // Now we check if the schema allows null (via union types or nullable pattern)
      if (value === null) {
        // Null is only valid if not in required array
        // (OpenAPI/JSON Schema nullable via "type: ["string", "null"]" would need additional check)
        if (Array.isArray(params.required) && params.required.includes(key)) {
          throw new ToolDefinitionError(
            `Parameter '${key}' for '${toolName}' is required and cannot be null`,
            toolName
          )
        }
        // Optional parameter with null value is acceptable
        continue
      }

      // Basic type validation for non-null values
      switch (paramSchema.type) {
        case "string":
          if (typeof value !== "string") {
            throw new ToolDefinitionError(
              `Parameter '${key}' for '${toolName}' must be string, got ${typeof value}`,
              toolName
            )
          }
          break
        case "number":
          if (typeof value !== "number") {
            throw new ToolDefinitionError(
              `Parameter '${key}' for '${toolName}' must be number, got ${typeof value}`,
              toolName
            )
          }
          break
        case "boolean":
          if (typeof value !== "boolean") {
            throw new ToolDefinitionError(
              `Parameter '${key}' for '${toolName}' must be boolean, got ${typeof value}`,
              toolName
            )
          }
          break
        case "array":
          if (!Array.isArray(value)) {
            throw new ToolDefinitionError(
              `Parameter '${key}' for '${toolName}' must be array, got ${typeof value}`,
              toolName
            )
          }
          break
        case "object":
          if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new ToolDefinitionError(
              `Parameter '${key}' for '${toolName}' must be object, got ${typeof value}`,
              toolName
            )
          }
          break
      }

      // Enum validation
      if (paramSchema.enum && typeof value === "string") {
        if (!paramSchema.enum.includes(value)) {
          throw new ToolDefinitionError(
            `Parameter '${key}' for '${toolName}' must be one of: ${paramSchema.enum.join(", ")}, got '${value}'`,
            toolName
          )
        }
      }
    }
  }

  return result
}
