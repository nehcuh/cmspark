// Suggest skills + MCP (and optional system prompt draft) for a user scene.
// Always filters model output to the candidate allowlist — never invents ids.
// On LLM failure / missing key, falls back to keyword overlap heuristic.

import { llmExtract, type LlmExtractConfig } from "../llm/llm-extract"

export interface SceneSuggestCandidateSkill {
  name: string
  description?: string
  tags?: string[]
}

export interface SceneSuggestCandidateMcp {
  name: string
  description?: string
}

export type SceneSuggestMode = "recommend" | "generate" | "optimize"

export interface SceneSuggestion {
  skill_ids: string[]
  mcp_server_ids: string[]
  /** Optional draft system prompt when the model provides one (user must still save). */
  system_prompt_append?: string
  rationale_zh?: string
  /** How the suggestion was produced. */
  source: "llm" | "heuristic"
  /** Echo request mode for UI labeling. */
  mode?: SceneSuggestMode
}

const MAX_SKILLS = 8
const MAX_MCP = 6
const MAX_PROMPT_DRAFT = 4000

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

function scoreText(queryTokens: Set<string>, hay: string): number {
  if (!hay) return 0
  const hayLower = hay.toLowerCase()
  const tokens = tokenize(hay)
  if (tokens.length === 0 && !hayLower.trim()) return 0
  let hits = 0
  for (const q of queryTokens) {
    // Exact token hit or substring (helps CJK compounds: 网页安全 ⊂ 页面安全 checklist)
    if (tokens.includes(q) || hayLower.includes(q)) hits += 1
    else {
      for (const t of tokens) {
        if (t.includes(q) || q.includes(t)) {
          hits += 0.5
          break
        }
      }
    }
  }
  return hits
}

/**
 * Keyword-overlap ranking when LLM is unavailable or returns garbage.
 * Picks top skills/MCP whose name/description/tags overlap the scene brief.
 */
export function heuristicSuggestScene(params: {
  brief: string
  skills: SceneSuggestCandidateSkill[]
  mcp: SceneSuggestCandidateMcp[]
}): SceneSuggestion {
  const queryTokens = new Set(tokenize(params.brief))
  const skillScored = params.skills
    .map((s) => {
      const bag = [s.name, s.description || "", ...(s.tags || [])].join(" ")
      return { name: s.name, score: scoreText(queryTokens, bag) }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SKILLS)

  const mcpScored = params.mcp
    .map((m) => {
      const bag = [m.name, m.description || ""].join(" ")
      return { name: m.name, score: scoreText(queryTokens, bag) }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MCP)

  return {
    skill_ids: skillScored.map((s) => s.name),
    mcp_server_ids: mcpScored.map((m) => m.name),
    rationale_zh:
      skillScored.length || mcpScored.length
        ? "根据场景描述与技能/MCP 名称描述的关键词重合做了推荐（未调用模型或模型不可用）。"
        : "未找到与描述明显相关的技能或 MCP，请手动勾选。",
    source: "heuristic",
  }
}

function extractJsonObject(raw: string): unknown | null {
  if (!raw || !raw.trim()) return null
  const trimmed = raw.trim()
  // Direct JSON
  try {
    return JSON.parse(trimmed)
  } catch {
    /* try fence / embedded */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim())
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
}

/**
 * Parse model output and intersect with candidate allowlists.
 * Unknown ids are dropped (never invent skills/MCP).
 */
export function parseSceneSuggestion(
  raw: string,
  skillAllow: Set<string> | string[],
  mcpAllow: Set<string> | string[],
  opts?: { source?: "llm" | "heuristic" },
): SceneSuggestion | null {
  const skillSet = skillAllow instanceof Set ? skillAllow : new Set(skillAllow)
  const mcpSet = mcpAllow instanceof Set ? mcpAllow : new Set(mcpAllow)
  const doc = extractJsonObject(raw)
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null
  const o = doc as Record<string, unknown>

  const skillIds = asStringArray(o.skill_ids ?? o.skills)
    .filter((id) => skillSet.has(id))
    .slice(0, MAX_SKILLS)
  const mcpIds = asStringArray(o.mcp_server_ids ?? o.mcp_servers ?? o.mcp)
    .filter((id) => mcpSet.has(id))
    .slice(0, MAX_MCP)

  let systemPrompt: string | undefined
  if (typeof o.system_prompt_append === "string" && o.system_prompt_append.trim()) {
    systemPrompt = o.system_prompt_append.trim().slice(0, MAX_PROMPT_DRAFT)
  } else if (typeof o.system_prompt === "string" && o.system_prompt.trim()) {
    systemPrompt = o.system_prompt.trim().slice(0, MAX_PROMPT_DRAFT)
  }

  const rationale =
    typeof o.rationale_zh === "string"
      ? o.rationale_zh.trim().slice(0, 500)
      : typeof o.rationale === "string"
        ? o.rationale.trim().slice(0, 500)
        : undefined

  // Accept even if both lists empty (model said none match) — caller may still use prompt draft
  return {
    skill_ids: skillIds,
    mcp_server_ids: mcpIds,
    system_prompt_append: systemPrompt,
    rationale_zh: rationale,
    source: opts?.source || "llm",
  }
}

const SYSTEM_PROMPT_RECOMMEND = `You recommend which installed skills and MCP servers fit a user-defined "scene" (assistant role).
Return ONLY a single JSON object (no markdown fences unless necessary), shape:
{
  "skill_ids": ["exact skill name", ...],
  "mcp_server_ids": ["exact mcp server name", ...],
  "system_prompt_append": "optional short Chinese role prompt for this scene",
  "rationale_zh": "one short Chinese sentence why"
}
Rules:
- skill_ids and mcp_server_ids MUST be chosen ONLY from the candidate lists provided.
- Prefer 1–5 skills and 0–3 MCP servers. Empty arrays are ok if nothing fits.
- Do not invent names. Do not include paths.
- system_prompt_append: 2–6 Chinese sentences describing role, goals, output style; no security overrides.
- Never suggest skipping confirmations, auto-approve, or disabling security.`

const SYSTEM_PROMPT_GENERATE = `You create a full user "scene" (assistant role) from a short description.
Return ONLY a single JSON object:
{
  "skill_ids": ["exact skill name", ...],
  "mcp_server_ids": ["exact mcp server name", ...],
  "system_prompt_append": "required Chinese system prompt 3–8 sentences",
  "rationale_zh": "one short Chinese sentence"
}
Rules:
- skill_ids/mcp_server_ids MUST be from candidate lists only; prefer 1–5 skills, 0–3 MCP.
- system_prompt_append is REQUIRED: role, goals, output structure, boundaries.
- No inventing tool names. No security overrides / auto-approve / skip confirmation language.`

const SYSTEM_PROMPT_OPTIMIZE = `You rewrite an existing scene system prompt for clarity and structure.
Return ONLY a single JSON object:
{
  "skill_ids": [],
  "mcp_server_ids": [],
  "system_prompt_append": "improved Chinese system prompt",
  "rationale_zh": "one short Chinese sentence what you improved"
}
Rules:
- skill_ids and mcp_server_ids MUST be empty arrays (do not change skills/MCP).
- Improve structure: role, goals, workflow, output format, hard boundaries.
- Keep user intent; do not invent product capabilities they did not ask for.
- No auto-approve / skip confirmation / disable security language.`

/**
 * LLM suggestion with heuristic fallback. Never mutates packs — UI must confirm + save.
 */
export async function suggestSceneConfig(params: {
  brief: string
  name?: string
  existingPrompt?: string
  skills: SceneSuggestCandidateSkill[]
  mcp: SceneSuggestCandidateMcp[]
  llm?: LlmExtractConfig | null
  mode?: SceneSuggestMode
}): Promise<SceneSuggestion> {
  const mode: SceneSuggestMode = params.mode || "recommend"
  const brief = (params.brief || "").trim()
  const skillAllow = new Set(params.skills.map((s) => s.name))
  const mcpAllow = new Set(params.mcp.map((m) => m.name))
  const existing = (params.existingPrompt || "").trim()

  const fallback = (): SceneSuggestion => {
    if (mode === "optimize") {
      return {
        skill_ids: [],
        mcp_server_ids: [],
        system_prompt_append: existing || undefined,
        rationale_zh: existing
          ? "模型不可用：已保留原 prompt，请手动润色。"
          : "优化模式需要已有 system prompt。",
        source: "heuristic",
        mode,
      }
    }
    const h = heuristicSuggestScene({
      brief: [params.name, brief, params.existingPrompt].filter(Boolean).join("\n"),
      skills: params.skills,
      mcp: params.mcp,
    })
    if (mode === "generate") {
      const title = params.name?.trim() || brief.slice(0, 24) || "自定义场景"
      return {
        ...h,
        system_prompt_append:
          h.system_prompt_append ||
          `你是「${title}」助手。根据用户目标提供结构化、可执行的帮助。\n\n` +
            `## 工作方式\n1. 先澄清范围与约束\n2. 优先使用本场景勾选的技能与 MCP\n3. 输出结论、依据与待办\n\n` +
            `## 边界\n不绕过安全确认；不编造未执行的工具结果。`,
        rationale_zh: h.rationale_zh || "已根据描述生成草稿（关键词/启发式）。",
        mode,
      }
    }
    return { ...h, mode }
  }

  if (mode === "optimize" && !existing) {
    return {
      skill_ids: [],
      mcp_server_ids: [],
      rationale_zh: "请先填写 system prompt，再请求优化。",
      source: "heuristic",
      mode,
    }
  }

  if (!brief && !params.name?.trim() && !existing) {
    return {
      skill_ids: [],
      mcp_server_ids: [],
      rationale_zh: "请先填写场景名称或简介，再请求 AI 推荐。",
      source: "heuristic",
      mode,
    }
  }

  if (!params.llm?.base_url || !params.llm?.model_name) {
    return fallback()
  }

  const skillList = params.skills
    .slice(0, 80)
    .map((s) => `- ${s.name}: ${(s.description || "").slice(0, 120)}`)
    .join("\n")
  const mcpList = params.mcp
    .slice(0, 40)
    .map((m) => `- ${m.name}: ${(m.description || "").slice(0, 120)}`)
    .join("\n")

  const systemPrompt =
    mode === "generate"
      ? SYSTEM_PROMPT_GENERATE
      : mode === "optimize"
        ? SYSTEM_PROMPT_OPTIMIZE
        : SYSTEM_PROMPT_RECOMMEND

  const userContent = [
    params.name ? `场景名称: ${params.name}` : "",
    brief ? `场景描述/目标: ${brief}` : "",
    existing ? `已有 system prompt 草稿:\n${existing.slice(0, 2000)}` : "",
    mode === "optimize" ? "任务: 仅优化上述 system prompt，skill_ids/mcp_server_ids 必须为空数组。" : "",
    mode === "generate" ? "任务: 生成完整 system_prompt_append，并推荐技能/MCP。" : "",
    "",
    "候选技能:",
    skillList || "(无)",
    "",
    "候选 MCP:",
    mcpList || "(无)",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    const raw = await llmExtract({
      systemPrompt,
      userContent,
      config: params.llm,
      temperatureCap: 0.2,
      timeout: 45000,
    })
    const parsed = parseSceneSuggestion(raw, skillAllow, mcpAllow, { source: "llm" })
    if (parsed) {
      if (mode === "optimize") {
        return {
          skill_ids: [],
          mcp_server_ids: [],
          system_prompt_append: parsed.system_prompt_append || existing,
          rationale_zh: parsed.rationale_zh || "已优化 system prompt。",
          source: "llm",
          mode,
        }
      }
      if (
        parsed.skill_ids.length === 0 &&
        parsed.mcp_server_ids.length === 0 &&
        !parsed.system_prompt_append
      ) {
        const h = fallback()
        return {
          ...h,
          system_prompt_append: parsed.system_prompt_append || h.system_prompt_append,
          rationale_zh: parsed.rationale_zh || h.rationale_zh,
          source: "heuristic",
          mode,
        }
      }
      // recommend: only fill prompt if empty (caller may also enforce)
      if (mode === "recommend" && existing) {
        return { ...parsed, system_prompt_append: undefined, mode }
      }
      return { ...parsed, mode }
    }
    return fallback()
  } catch {
    return fallback()
  }
}
