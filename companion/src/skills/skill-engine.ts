// Skill engine — load, inject, and manage skills

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import OpenAI from "openai"
import { tokenize, tokensToVec, cosineSimilarity } from "./semantic-match"
import matter from "gray-matter"
import AdmZip from "adm-zip"
import * as yaml from "js-yaml"
import { getConfigDir } from "../config"
import { ThreadManager } from "../threads/thread-manager"
import { matchSite } from "./site-matcher"
import { sanitizeKnowledgeContent } from "./content-sanitizer"
import { chunkFile, searchChunks, type FileChunk } from "../file-chunker"

interface ExperienceEntry {
  id: string
  category: "problem" | "success" | "tip" | "rule"
  content: string
  recorded_at: string
  confirmed_at: string | null
  stale: boolean
  stale_reason: string
  replaced_by: string
}

interface SkillMeta {
  name: string
  description: string
  type: "prompt_template" | "tool_chain" | "sub_agent" | "site_knowledge" | "domain_knowledge"
  site?: string
  tags?: string[]
  priority?: "high" | "normal" | "low"
  entries?: ExperienceEntry[]
  builtin: boolean
  source_file: string
  dir?: string
  resources: string[]
}

interface Skill extends SkillMeta {
  content: string  // markdown body (without frontmatter)
}

interface LlmConfig {
  base_url: string
  api_key: string
  model_name: string
  temperature: number
}

const KNOWLEDGE_SEARCH_THRESHOLD_TOKENS = 1000
const KNOWLEDGE_SEARCH_TOPK = 3

export class SkillEngine {
  private skillsDir: string
  private builtinDir: string
  private knowledgeDir: string
  private skillsCache: Skill[] = []
  private threadSkillMap: Map<string, string[]> = new Map() // threadId → skill names
  private llmConfig?: LlmConfig
  private knowledgeChunks: Map<string, FileChunk[]> = new Map()

  constructor(llmConfig?: LlmConfig) {
    this.skillsDir = path.join(getConfigDir(), "skills")
    this.builtinDir = path.join(getConfigDir(), "builtin-skills")
    this.knowledgeDir = path.join(getConfigDir(), "knowledge")
    this.llmConfig = llmConfig
    this.refresh()
  }

  refresh(): void {
    this.skillsCache = []
    // Load user skills
    this.loadFromDir(this.skillsDir, false)
    // Load builtin skills (including security/ subdirectory)
    this.loadFromDir(this.builtinDir, true)
    // Load knowledge docs from knowledge/global/ and knowledge/sites/
    this.loadFromDir(path.join(this.knowledgeDir, "global"), false)
    this.loadFromDir(path.join(this.knowledgeDir, "sites"), false)
    // Pre-chunk large knowledge docs for RAG
    this.rebuildKnowledgeChunks()
  }

  private rebuildKnowledgeChunks(): void {
    this.knowledgeChunks.clear()
    for (const skill of this.skillsCache) {
      if (skill.type !== "site_knowledge" && skill.type !== "domain_knowledge") continue
      const chunked = chunkFile(skill.name, skill.content, KNOWLEDGE_SEARCH_THRESHOLD_TOKENS)
      // Only store chunks if the doc is actually large enough to need splitting
      if (chunked.chunks.length > 1 || chunked.totalTokens > KNOWLEDGE_SEARCH_THRESHOLD_TOKENS) {
        this.knowledgeChunks.set(skill.name, chunked.chunks)
      }
    }
  }

  /** Get all security skills from builtin-skills/security/ */
  getSecuritySkills(): Skill[] {
    return this.skillsCache.filter(
      s => s.builtin && s.source_file.includes(path.sep + "security" + path.sep),
    )
  }

  private loadFromDir(dir: string, builtin: boolean): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          // Folder-based skill: look for SKILL.md inside
          const skillMdPath = path.join(entryPath, "SKILL.md")
          if (fs.existsSync(skillMdPath)) {
            try {
              const raw = fs.readFileSync(skillMdPath, "utf-8")
              const parsed = matter(raw)
              const name = parsed.data.name || entry.name
              const description = parsed.data.description || ""
              const type = parsed.data.type || "prompt_template"
              const site = parsed.data.site
              const tags = parsed.data.tags
              const priority = parsed.data.priority
              const entries = parsed.data.entries

              // Collect resource files (all non-SKILL.md files in directory)
              const resources = fs.readdirSync(entryPath)
                .filter(f => f !== "SKILL.md")
                .filter(f => {
                  const stat = fs.statSync(path.join(entryPath, f))
                  return stat.isFile()
                })

              this.skillsCache.push({
                name,
                description,
                type,
                builtin,
                source_file: skillMdPath,
                dir: entryPath,
                content: parsed.content,
                resources,
                site,
                tags,
                priority,
                entries,
              })
            } catch {
              // skip malformed folder skills
            }
          }
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          // Flat .md skill file (backward compat)
          try {
            const raw = fs.readFileSync(entryPath, "utf-8")
            const parsed = matter(raw)
            const name = parsed.data.name || entry.name.replace(".md", "")
            const description = parsed.data.description || ""
            const type = parsed.data.type || "prompt_template"
            const site = parsed.data.site
            const tags = parsed.data.tags
            const priority = parsed.data.priority
            const entries = parsed.data.entries

            this.skillsCache.push({
              name,
              description,
              type,
              builtin,
              source_file: entryPath,
              content: parsed.content,
              resources: [],
              site,
              tags,
              priority,
              entries,
            })
          } catch {
            // skip malformed skills
          }
        }
      }
    } catch {
      // directory may not exist yet
    }
  }

  list(): SkillMeta[] {
    return this.skillsCache
      .filter(s => s.type !== "site_knowledge" && s.type !== "domain_knowledge")
      .map(s => ({
        name: s.name,
        description: s.description,
        type: s.type,
        site: s.site,
        tags: s.tags,
        entries: s.entries,
        builtin: s.builtin,
        source_file: s.source_file,
        dir: s.dir,
        resources: s.resources,
      }))
  }

  get(name: string): Skill | undefined {
    return this.skillsCache.find(s => s.name === name)
  }

  getBySite(hostname: string): Skill[] {
    return this.skillsCache.filter(s => s.type === "site_knowledge" && s.site && matchSite(s.site, hostname))
  }

  getByType(type: string): Skill[] {
    return this.skillsCache.filter(s => s.type === type)
  }

  activate(threadId: string, skillName: string): void {
    const skill = this.get(skillName)
    if (!skill) throw new Error(`Skill not found: ${skillName}`)

    const active = this.threadSkillMap.get(threadId) || []
    if (!active.includes(skillName)) {
      active.push(skillName)
      this.threadSkillMap.set(threadId, active)
    }
  }

  deactivate(threadId: string, skillName: string): void {
    const active = this.threadSkillMap.get(threadId) || []
    this.threadSkillMap.set(threadId, active.filter(s => s !== skillName))
  }

  getActiveForThread(threadId: string): Skill[] {
    let active = this.threadSkillMap.get(threadId)
    if (!active) {
      try {
        const tm = new ThreadManager()
        const thread = tm.get(threadId)
        active = thread?.active_skill_ids || ["browse"]
        this.threadSkillMap.set(threadId, active)
      } catch {
        active = ["browse"]
      }
    }
    return active.map(name => this.get(name)).filter(Boolean) as Skill[]
  }

  /** Return full content of a skill by name. */
  loadContent(name: string): string | null {
    const skill = this.get(name)
    return skill?.content || null
  }

  /** LLM semantic re-ranking for low-confidence TF-IDF matches.
   * Sends top candidates to LLM for precise relevance scoring. */
  private async llmRerank(
    message: string,
    candidates: Skill[],
  ): Promise<Array<{ name: string; confidence: number }>> {
    if (!this.llmConfig || candidates.length === 0) {
      return candidates.map(s => ({ name: s.name, confidence: 50 }))
    }

    const skillList = candidates.map((s, i) =>
      `${i + 1}. name: ${s.name}, description: ${s.description || "(no description)"}, tags: ${(s.tags || []).join(", ") || "none"}`,
    ).join("\n")

    const prompt = `You are a skill matching assistant. Given a user message and a list of skills, identify the top 3 most relevant skills.

User message: "${message}"

Available skills:
${skillList}

Respond with a JSON array of objects: [{"name": "skill_name", "confidence": 95}]
- name must match exactly from the skill list above
- confidence is 0-100, where 100 means perfectly relevant
- Only include skills that are truly relevant to the user message
- Return at most 3 items, sorted by confidence descending`

    try {
      const client = new OpenAI({
        baseURL: this.llmConfig.base_url,
        apiKey: this.llmConfig.api_key || "sk-placeholder",
        timeout: 15000,
        maxRetries: 1,
      })

      const response = await client.chat.completions.create({
        model: this.llmConfig.model_name,
        messages: [
          { role: "system", content: "You are a skill matching assistant. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
      })

      const content = response.choices[0]?.message?.content || "[]"
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "[]")

      if (!Array.isArray(parsed)) return []

      const valid = parsed
        .filter((p: any) => p && typeof p.name === "string" && typeof p.confidence === "number")
        .map((p: any) => ({
          name: p.name,
          confidence: Math.max(0, Math.min(100, Math.round(p.confidence))),
        }))
        .sort((a: any, b: any) => b.confidence - a.confidence)

      return valid.slice(0, 3)
    } catch {
      // LLM re-ranking failed: gracefully fall back to mid-confidence candidates
      return candidates.slice(0, 3).map(s => ({ name: s.name, confidence: 50 }))
    }
  }

  /** Match user message against all skill descriptions using dual-track strategy:
   * - High confidence (>= 70%): TF-IDF fast path (millisecond-level)
   * - Low confidence (< 70%): LLM semantic re-ranking (precise, one-shot) */
  async matchSkills(message: string): Promise<Array<{ name: string; confidence: number }>> {
    const queryTokens = tokenize(message)
    const queryVec = tokensToVec(queryTokens)

    const results: Array<{ name: string; confidence: number }> = []
    for (const skill of this.skillsCache.values()) {
      const skillText = `${skill.name} ${skill.description || ""} ${(skill.tags || []).join(" ")}`
      const skillTokens = tokenize(skillText)
      const skillVec = tokensToVec(skillTokens)
      const score = cosineSimilarity(queryVec, skillVec)
      if (score > 0.1) {
        results.push({ name: skill.name, confidence: Math.round(score * 100) })
      }
    }
    results.sort((a, b) => b.confidence - a.confidence)

    const topScore = results[0]?.confidence || 0

    // Dual-track: high confidence → TF-IDF fast path
    if (topScore >= 70) {
      return results.slice(0, 3)
    }

    // Low confidence → LLM semantic re-ranking (precise)
    const candidates = this.skillsCache.filter(s => {
      const skillText = `${s.name} ${s.description || ""} ${(s.tags || []).join(" ")}`
      const skillTokens = tokenize(skillText)
      const skillVec = tokensToVec(skillTokens)
      const score = cosineSimilarity(queryVec, skillVec)
      return score > 0.05
    })

    const llmResults = await this.llmRerank(message, candidates)

    // If LLM returned results, use them; otherwise fall back to TF-IDF
    return llmResults.length > 0 ? llmResults : results.slice(0, 3)
  }

  /** Resolve skill IDs for a thread based on the selection mode.
   * - auto: active ∪ matchSkills(message) ∪ getBySite(hostname)
   * - all: all non-site_knowledge/domain_knowledge skills
   * - manual: active only */
  async resolveSkillIdsForThread(
    threadId: string,
    mode?: "auto" | "all" | "manual",
    message?: string,
    hostname?: string,
  ): Promise<string[]> {
    const resolvedMode = mode || "auto"

    if (resolvedMode === "manual") {
      return this.getActiveForThread(threadId).map(s => s.name)
    }

    if (resolvedMode === "all") {
      return this.skillsCache
        .filter(s => s.type !== "site_knowledge" && s.type !== "domain_knowledge")
        .map(s => s.name)
    }

    // auto mode (default)
    const active = this.getActiveForThread(threadId).map(s => s.name)
    const matched = message ? (await this.matchSkills(message)).map(m => m.name) : []
    const site = hostname ? this.getBySite(hostname).map(s => s.name) : []
    return [...new Set([...active, ...matched, ...site])]
  }

  /** Get active knowledge (site_knowledge/domain_knowledge) for a thread.
   * Reads from thread's active_skill_ids that match knowledge types. */
  getActiveKnowledgeForThread(threadId: string): Skill[] {
    const active = this.getActiveForThread(threadId)
    return active.filter(s => s.type === "site_knowledge" || s.type === "domain_knowledge")
  }

  /** Resolve knowledge IDs for a thread based on the selection mode.
   * - auto: activeKnowledge ∪ getBySite(hostname)  (union, deduped)
   * - all: all site_knowledge / domain_knowledge names
   * - manual: activeKnowledge only (pure user selection) */
  resolveKnowledgeIdsForThread(
    threadId: string,
    mode?: "auto" | "all" | "manual",
    hostname?: string,
  ): string[] {
    const resolvedMode = mode || "auto"

    if (resolvedMode === "manual") {
      return this.getActiveKnowledgeForThread(threadId).map(s => s.name)
    }

    if (resolvedMode === "all") {
      return this.skillsCache
        .filter(s => s.type === "site_knowledge" || s.type === "domain_knowledge")
        .map(s => s.name)
    }

    // auto mode (default)
    const active = this.getActiveKnowledgeForThread(threadId).map(s => s.name)
    const site = hostname ? this.getBySite(hostname).map(s => s.name) : []
    return [...new Set([...active, ...site])]
  }

  /** Build compact skill index for system prompt.
   * LLM calls use_skill(name) to load full instructions on demand.
   * For site_knowledge/domain_knowledge, inject entries summary directly.
   * Also injects global knowledge and matching site knowledge summaries.
   * If skillIds is provided, only includes those skills.
   * If knowledgeIds is provided, only includes those knowledge docs.
   * Security skills are ALWAYS injected and cannot be disabled. */
  buildSystemPrompt(
    threadId: string,
    hostname?: string,
    skillIds?: string[],
    knowledgeIds?: string[],
    query?: string,
  ): string {
    const skills = skillIds
      ? skillIds.map(id => this.get(id)).filter(Boolean) as Skill[]
      : this.getActiveForThread(threadId)

    const parts: string[] = []
    const injectedNames = new Set<string>()

    // --- Safety Guard: ALWAYS inject security skills (immutable, builtin) ---
    const securitySkills = this.getSecuritySkills()
    for (const s of securitySkills) {
      injectedNames.add(s.name)
      parts.push(`## Safety Guard: ${s.name}\n${s.content}`)
    }

    const promptSkills = skills.filter(s => s.type !== "site_knowledge" && s.type !== "domain_knowledge")
    const experienceSkills = skills.filter(s => s.type === "site_knowledge" || s.type === "domain_knowledge")

    // Experience skills: inject entry summaries directly (no use_skill needed)
    for (const s of experienceSkills) {
      const summary = this.getEntriesSummary(s.name)
      if (summary) {
        injectedNames.add(s.name)
        const label = s.type === "site_knowledge" ? `Site: ${s.site}` : `Domain: ${s.name}`
        parts.push(`## ${label}\n${summary}`)
      }
    }

    // Knowledge IDs filtering: if knowledgeIds provided, only include matching knowledge
    const knowledgeToInject = knowledgeIds
      ? knowledgeIds.map(id => this.get(id)).filter(Boolean) as Skill[]
      : undefined

    if (knowledgeToInject) {
      // Inject only the specified knowledge docs
      for (const k of knowledgeToInject) {
        if (injectedNames.has(k.name)) continue
        // Skip non-knowledge types
        if (k.type !== "site_knowledge" && k.type !== "domain_knowledge") continue
        const summary = this.getEntriesSummary(k.name) || this.getKnowledgeSummary(k, query)
        if (summary) {
          injectedNames.add(k.name)
          const label = k.type === "site_knowledge" ? `Site: ${k.site || k.name}` : `Domain: ${k.name}`
          parts.push(`## ${label}\n${summary}`)
        }
      }
    } else {
      // Global knowledge: always inject if present
      const globalKnowledge = this.getGlobalKnowledge()
      for (const k of globalKnowledge) {
        if (injectedNames.has(k.name)) continue
        const summary = this.getKnowledgeSummary(k, query)
        if (summary) {
          injectedNames.add(k.name)
          parts.push(`## Global Knowledge: ${k.name}\n${summary}`)
        }
      }

      // Site knowledge: inject if hostname is provided and matches
      if (hostname) {
        const siteKnowledge = this.getBySite(hostname)
        for (const k of siteKnowledge) {
          if (injectedNames.has(k.name)) continue
          const summary = this.getKnowledgeSummary(k, query)
          if (summary) {
            injectedNames.add(k.name)
            parts.push(`## Site Knowledge: ${k.site}\n${summary}`)
          }
        }
      }
    }

    // Regular skills: compact index, use_skill on demand
    if (promptSkills.length > 0) {
      const index = promptSkills.map(s =>
        `- \`${s.name}\`: ${s.description || "(no description)"}`
      ).join("\n")
      parts.push(`Available skills (call use_skill(name) to load full instructions when relevant):\n${index}`)
    }

    return parts.join("\n\n")
  }

  /** Get all global knowledge docs from knowledge/global/ directory. */
  private getGlobalKnowledge(): Skill[] {
    return this.skillsCache.filter(s => {
      if (s.type !== "site_knowledge" && s.type !== "domain_knowledge") return false
      // Global knowledge: no site field, or stored in knowledge/global/
      if (!s.site) return true
      return false
    })
  }

  /** Build a sanitized knowledge summary.
   * - Small docs: return full content (capped at 2000 chars)
   * - Large docs with query: search relevant chunks via RAG
   * - Large docs without query: return truncated summary */
  private getKnowledgeSummary(skill: Skill, query?: string): string {
    const chunks = this.knowledgeChunks.get(skill.name)

    // Large doc + query → RAG chunk retrieval
    if (chunks && chunks.length > 0 && query && query.trim()) {
      const matched = searchChunks(chunks, query.trim(), KNOWLEDGE_SEARCH_TOPK)
      if (matched.length) {
        return matched.map(c => c.text).join("\n\n---\n\n").trim()
      }
      // If no chunks matched the query, fall through to truncated summary
    }

    let content = skill.content || ""
    // Sanitize before injection
    content = sanitizeKnowledgeContent(content)
    // Rough token estimate: 1 token ≈ 4 chars for English, 1 token ≈ 1 char for CJK
    // Use a conservative char-based limit (~2000 chars ≈ 500 tokens for mixed content)
    const MAX_CHARS = 2000
    if (content.length > MAX_CHARS) {
      content = content.slice(0, MAX_CHARS) + "\n... (truncated)"
    }
    return content.trim()
  }

  // --- Experience entry management ---

  /** Get formatted summary of entries for a skill. */
  getEntriesSummary(skillName: string): string {
    const skill = this.get(skillName)
    if (!skill?.entries?.length) return ""
    const active = skill.entries.filter(e => !e.stale)
    const stale = skill.entries.filter(e => e.stale)
    const parts: string[] = []
    if (active.length) {
      parts.push(`Active entries (${active.length}):`)
      for (const e of active) {
        parts.push(`  [${e.category}] ${e.content}`)
      }
    }
    if (stale.length) {
      parts.push(`Stale entries (${stale.length}, may be outdated):`)
      for (const e of stale) {
        parts.push(`  [${e.category}] ${e.content} — ${e.stale_reason}`)
      }
    }
    return parts.join("\n")
  }

  /** Add an entry to a skill and persist to disk. */
  addEntry(skillName: string, entry: ExperienceEntry): void {
    const skill = this.get(skillName)
    if (!skill) throw new Error(`Skill not found: ${skillName}`)
    if (!skill.entries) skill.entries = []
    const exists = skill.entries.some(e => e.id === entry.id || e.content === entry.content)
    if (exists) return
    skill.entries.push(entry)
    this.saveSkillFile(skillName)
  }

  /** Mark an entry as stale with a reason. */
  markEntryStale(skillName: string, entryId: string, reason: string): void {
    const skill = this.get(skillName)
    if (!skill?.entries) return
    const entry = skill.entries.find(e => e.id === entryId)
    if (entry) {
      entry.stale = true
      entry.stale_reason = reason
      this.saveSkillFile(skillName)
    }
  }

  /** Save a skill back to its source file, updating frontmatter from current metadata.
   * Uses js-yaml for safe serialization to prevent YAML injection (P0). */
  private saveSkillFile(skillName: string): void {
    const skill = this.get(skillName)
    if (!skill || !skill.source_file) return
    const body = this.buildEntriesMarkdown(skill)
    const frontmatter: Record<string, any> = {
      name: skill.name,
      description: skill.description,
      type: skill.type,
    }
    if (skill.site) frontmatter.site = skill.site
    if (skill.tags?.length) frontmatter.tags = skill.tags
    if (skill.priority) frontmatter.priority = skill.priority
    if (skill.entries?.length) {
      frontmatter.entries = skill.entries.map(e => ({
        id: e.id,
        category: e.category,
        content: e.content,
        recorded_at: e.recorded_at,
        stale: e.stale,
        stale_reason: e.stale_reason || "",
        ...(e.confirmed_at ? { confirmed_at: e.confirmed_at } : {}),
        ...(e.replaced_by ? { replaced_by: e.replaced_by } : {}),
      }))
    }
    const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, quotingType: '"' })
    const md = `---\n${yamlStr}---\n\n${body}`
    fs.writeFileSync(skill.source_file, md)
  }

  /** Build human-readable markdown from entries. */
  private buildEntriesMarkdown(skill: Skill): string {
    if (!skill.entries?.length) return skill.content || ""
    const lines = ["# 记录列表", ""]
    for (const e of skill.entries) {
      const icon = e.stale ? "⚠️" : e.category === "problem" ? "🐛" : e.category === "success" ? "✅" : e.category === "tip" ? "💡" : "📋"
      const staleTag = e.stale ? ` [已过期: ${e.stale_reason}]` : ""
      lines.push(`- ${icon} ${e.content}${staleTag}`)
    }
    if (skill.content) {
      lines.push("")
      lines.push("# 说明")
      lines.push(skill.content)
    }
    return lines.join("\n")
  }

  exportSkill(name: string): { content: string; format: "markdown" | "zip"; skill_name: string } {
    const skill = this.get(name)
    if (!skill) throw new Error(`Skill not found: ${name}`)

    if (skill.dir) {
      // Folder-based skill: zip the entire directory
      const zip = new AdmZip()
      const dirName = path.basename(skill.dir)
      for (const f of fs.readdirSync(skill.dir)) {
        const filePath = path.join(skill.dir, f)
        if (fs.statSync(filePath).isFile()) {
          zip.addLocalFile(filePath, dirName)
        }
      }
      return {
        content: zip.toBuffer().toString("base64"),
        format: "zip",
        skill_name: name,
      }
    }

    // Flat .md skill: export as markdown text (backward compat)
    const extra: string[] = []
    if (skill.type === "site_knowledge" && skill.site) extra.push(`site: ${skill.site}`)
    if (skill.type === "domain_knowledge" && skill.tags?.length) extra.push(`tags: [${skill.tags.join(", ")}]`)

    const frontmatter = [
      "---",
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      `type: ${skill.type}`,
      ...extra,
      "---",
    ].join("\n")

    return {
      content: `${frontmatter}\n\n${skill.content}`,
      format: "markdown",
      skill_name: name,
    }
  }

  importSkill(content: string): void {
    let parsed: { data: { name?: string }; content: string }
    try {
      parsed = matter(content)
    } catch (e: any) {
      throw new Error(`Failed to parse skill frontmatter: ${e.message || String(e)}. Ensure the file starts with --- and valid YAML.`)
    }
    const name = parsed.data.name
    if (!name) throw new Error("Skill must have a 'name' field in frontmatter (e.g. ---\\nname: my-skill\\n---)")

    // Ensure unique filename
    const safeName = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
    if (!safeName || safeName === "-") {
      throw new Error(`Skill name '${name}' results in an invalid filename after sanitization. Use alphanumeric characters.`)
    }
    const filePath = path.join(this.skillsDir, `${safeName}.md`)

    fs.writeFileSync(filePath, content)
    this.refresh()
  }

  importSkillFolder(zipBase64: string): void {
    const buffer = Buffer.from(zipBase64, "base64")
    const zip = new AdmZip(buffer)

    // Validate: must contain a SKILL.md at some level
    const entries = zip.getEntries()
    const skillMdEntry = entries.find((e: AdmZip.IZipEntry) => e.entryName.endsWith("SKILL.md") || e.entryName.endsWith("SKILL.md/"))
    if (!skillMdEntry) {
      throw new Error("Zip must contain a SKILL.md file")
    }

    // Determine the skill folder name from the SKILL.md path
    const skillDirName = skillMdEntry.entryName.replace(/\/?SKILL\.md\/?$/, "")
    const folderName = path.basename(skillDirName) || skillMdEntry.entryName.replace(".md", "")

    // Extract name from SKILL.md frontmatter for the directory name
    const raw = zip.readAsText(skillMdEntry.name)
    const parsed = matter(raw)
    const skillName = parsed.data.name || folderName
    const safeName = skillName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()

    const destDir = path.join(this.skillsDir, safeName)

    // Remove existing if present
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true })
    }

    fs.mkdirSync(destDir, { recursive: true })

    // Extract all entries
    for (const entry of entries) {
      if (entry.isDirectory) continue

      // Compute the relative path within the zip
      let relativePath = entry.entryName
      // Strip leading skill directory name if present
      if (skillDirName && relativePath.startsWith(skillDirName + "/")) {
        relativePath = relativePath.slice(skillDirName.length + 1)
      }

      // Normalize and validate: reject absolute paths, parent traversal, and null bytes
      relativePath = path.normalize(relativePath).replace(/\\/g, "/")
      if (path.isAbsolute(relativePath) || relativePath.startsWith("..") || relativePath.includes("\0")) {
        throw new Error(`Security Violation: Invalid zip entry path: ${entry.entryName}`)
      }

      // Secure path traversal check (P0) — ensure resolved path stays under destDir
      const resolvedPath = path.resolve(destDir, relativePath)
      const normalizedDest = path.resolve(destDir)
      if (!resolvedPath.startsWith(normalizedDest + path.sep) && resolvedPath !== normalizedDest) {
        throw new Error(`Security Violation: Path traversal detected in zip entry: ${entry.entryName}`)
      }

      // Ensure we don't create nested directories
      if (relativePath.includes("/")) {
        const subDir = path.dirname(relativePath)
        fs.mkdirSync(path.join(destDir, subDir), { recursive: true })
      }

      fs.writeFileSync(resolvedPath, entry.getData())
    }

    this.refresh()
  }

  importSkillFromPath(dirPath: string): void {
    // Resolve and validate path stays within config directory (P0)
    if (typeof dirPath !== "string" || dirPath.includes("\0")) {
      throw new Error("Invalid directory path")
    }
    const resolved = path.resolve(dirPath.replace(/^~/, os.homedir()))
    const configDir = path.resolve(getConfigDir())
    // Ensure resolved path is under config directory (prevent path traversal)
    if (!resolved.startsWith(configDir + path.sep) && resolved !== configDir) {
      throw new Error(`Path traversal not allowed: ${dirPath}`)
    }
    const stat = fs.statSync(resolved, { throwIfNoEntry: false })
    if (!stat || !stat.isDirectory()) {
      throw new Error(`Directory not found: ${dirPath}`)
    }

    const skillMdPath = path.join(resolved, "SKILL.md")
    if (!fs.existsSync(skillMdPath)) {
      throw new Error(`No SKILL.md found in: ${dirPath}`)
    }

    const files = this.readDirectoryFiles(resolved)
    this.importSkillFiles(files)
  }

  private readDirectoryFiles(dir: string, prefix = ""): { path: string; content: string }[] {
    const results: { path: string; content: string }[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        results.push(...this.readDirectoryFiles(fullPath, relPath))
      } else if (entry.isFile()) {
        results.push({ path: relPath, content: fs.readFileSync(fullPath, "utf-8") })
      }
    }
    return results
  }

  importSkillFiles(files: { path: string; content: string }[]): void {
    // Find SKILL.md to determine skill name
    const skillMd = files.find(f => f.path === "SKILL.md" || f.path.endsWith("/SKILL.md"))
    if (!skillMd) throw new Error("Folder must contain a SKILL.md file")

    const parsed = matter(skillMd.content)
    const name = parsed.data.name
    if (!name) throw new Error("SKILL.md must have a 'name' field in frontmatter")

    const safeName = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
    const destDir = path.join(this.skillsDir, safeName)

    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true })
    }
    fs.mkdirSync(destDir, { recursive: true })

    const normalizedDest = path.resolve(destDir)
    for (const file of files) {
      // Secure path traversal check (P0)
      // Normalize and reject absolute paths, parent traversal, and null bytes
      let relPath = path.normalize(file.path).replace(/\\/g, "/")
      if (path.isAbsolute(relPath) || relPath.startsWith("..") || relPath.includes("\0")) {
        throw new Error(`Security Violation: Invalid skill file path: ${file.path}`)
      }
      const resolvedPath = path.resolve(destDir, relPath)
      if (!resolvedPath.startsWith(normalizedDest + path.sep) && resolvedPath !== normalizedDest) {
        throw new Error(`Security Violation: Path traversal detected in skill file: ${file.path}`)
      }

      // Ensure subdirectories exist
      if (relPath.includes("/")) {
        const subDir = path.dirname(relPath)
        if (subDir !== ".") {
          fs.mkdirSync(path.join(destDir, subDir), { recursive: true })
        }
      }
      fs.writeFileSync(resolvedPath, file.content)
    }

    this.refresh()
  }

  deleteSkill(name: string): void {
    const skill = this.get(name)
    if (!skill) throw new Error(`Skill not found: ${name}`)
    if (skill.builtin) throw new Error(`Cannot delete builtin skill: ${name}`)

    if (skill.dir) {
      fs.rmSync(skill.dir, { recursive: true })
    } else {
      fs.unlinkSync(skill.source_file)
    }
    this.refresh()
  }

  // --- Knowledge management (operates on knowledge/ directory) ---

  listKnowledge(): SkillMeta[] {
    return this.skillsCache
      .filter(s => s.type === "site_knowledge" || s.type === "domain_knowledge")
      .map(s => ({
        name: s.name,
        description: s.description,
        type: s.type,
        site: s.site,
        tags: s.tags,
        entries: s.entries,
        builtin: s.builtin,
        source_file: s.source_file,
        dir: s.dir,
        resources: s.resources,
      }))
  }

  importKnowledge(content: string, fallbackName?: string, nameOverride?: string): void {
    content = this.ensureKnowledgeFrontmatter(content, fallbackName, nameOverride)

    let parsed: { data: { name?: string; site?: string; type?: string }; content: string }
    try {
      parsed = matter(content)
    } catch (e: any) {
      throw new Error(`Failed to parse knowledge frontmatter: ${e.message || String(e)}`)
    }
    const name = parsed.data.name
    if (!name) throw new Error("Knowledge doc must have a 'name' field")

    const safeName = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
    if (!safeName || safeName === "-") {
      throw new Error(`Knowledge name '${name}' results in an invalid filename after sanitization. Use alphanumeric characters.`)
    }

    // Determine subdirectory: site_knowledge with site field → sites/, otherwise global/
    const isSiteKnowledge = parsed.data.type === "site_knowledge" || parsed.data.site
    const subDir = isSiteKnowledge ? "sites" : "global"
    const targetDir = path.join(this.knowledgeDir, subDir)
    fs.mkdirSync(targetDir, { recursive: true })
    const filePath = path.join(targetDir, `${safeName}.md`)

    fs.writeFileSync(filePath, content)
    this.refresh()
  }

  /** Auto-generate frontmatter for knowledge docs that lack it.
   * - name: nameOverride > frontmatter > first # heading > fallbackName > "未命名知识库"
   * - description: frontmatter > first 150 chars of body (cleaned)
   * - type: frontmatter > "domain_knowledge"
   * Preserves existing frontmatter fields.
   *
   * `nameOverride` (when provided) takes precedence over every other name source.
   * Used by directory import to guarantee unique doc names per file — without it,
   * two files sharing the same first-#-heading would sanitize to the same filename
   * and silently overwrite each other. */
  private ensureKnowledgeFrontmatter(content: string, fallbackName?: string, nameOverride?: string): string {
    let parsed: { data: Record<string, any>; content: string }
    try {
      parsed = matter(content)
    } catch {
      // If matter fails entirely, treat whole content as body
      parsed = { data: {}, content: content.trimStart() }
    }

    // If already has a valid name AND no override, assume frontmatter is complete
    if (!nameOverride && parsed.data.name && typeof parsed.data.name === "string") {
      return content
    }

    // --- Infer name ---
    let inferredName = ""
    if (nameOverride) {
      inferredName = nameOverride
    } else {
      const firstHeading = parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim()
      if (firstHeading) {
        inferredName = firstHeading
      } else if (fallbackName) {
        inferredName = fallbackName
      } else {
        inferredName = "未命名知识库"
      }
    }

    // --- Infer description ---
    let inferredDescription = ""
    if (parsed.data.description && typeof parsed.data.description === "string") {
      inferredDescription = parsed.data.description
    } else {
      // Clean body: remove markdown headings, bold, lists, code blocks
      const cleaned = parsed.content
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\*\*|__/g, "")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/\n+/g, " ")
        .trim()
      inferredDescription = cleaned.slice(0, 150) + (cleaned.length > 150 ? "..." : "")
    }

    // --- Infer type ---
    const inferredType = parsed.data.type || "domain_knowledge"

    const frontmatter: Record<string, any> = {
      name: inferredName,
      description: inferredDescription,
      type: inferredType,
    }
    if (parsed.data.site) frontmatter.site = parsed.data.site
    if (parsed.data.tags) frontmatter.tags = parsed.data.tags

    const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, quotingType: '"' })
    return `---\n${yamlStr}---\n\n${parsed.content.trimStart()}`
  }

  deleteKnowledge(name: string): void {
    const skill = this.get(name)
    if (!skill) throw new Error(`Knowledge not found: ${name}`)
    if (skill.builtin) throw new Error(`Cannot delete builtin knowledge: ${name}`)
    if (skill.type !== "site_knowledge" && skill.type !== "domain_knowledge") {
      throw new Error(`'${name}' is not a knowledge doc`)
    }

    if (skill.dir) {
      fs.rmSync(skill.dir, { recursive: true })
    } else {
      fs.unlinkSync(skill.source_file)
    }
    this.refresh()
  }

  /** Search relevant chunks from given knowledge docs based on query.
   *  Returns concatenated text of top matching chunks. */
  searchKnowledge(knowledgeNames: string[], query: string, topK = KNOWLEDGE_SEARCH_TOPK): string {
    if (!query || !knowledgeNames.length) return ""

    const allChunks: FileChunk[] = []
    for (const name of knowledgeNames) {
      const chunks = this.knowledgeChunks.get(name)
      if (chunks) {
        allChunks.push(...chunks)
      }
    }
    if (!allChunks.length) return ""

    const matched = searchChunks(allChunks, query, topK)
    if (!matched.length) return ""

    return matched.map(c => c.text).join("\n\n---\n\n")
  }

  /** Create a new site_knowledge or domain_knowledge skill with initial entry. */
  createExperienceSkill(
    name: string,
    type: "site_knowledge" | "domain_knowledge",
    site?: string,
    tags?: string[],
    entry?: ExperienceEntry,
  ): void {
    const safeName = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
    const filePath = path.join(this.skillsDir, `${safeName}.md`)
    if (fs.existsSync(filePath)) {
      // Skill already exists, just add entry
      const existing = this.get(name)
      if (existing && entry) {
        if (!existing.entries) existing.entries = []
        existing.entries.push(entry)
        this.saveSkillFile(name)
      }
      return
    }

    const frontmatter: Record<string, any> = {
      name,
      description: type === "site_knowledge" ? `Site experience for ${site}` : `Domain knowledge: ${name}`,
      type,
    }
    if (site) frontmatter.site = site
    if (tags?.length) frontmatter.tags = tags
    if (entry) {
      frontmatter.entries = [{
        id: entry.id,
        category: entry.category,
        content: entry.content,
        recorded_at: entry.recorded_at,
        confirmed_at: entry.confirmed_at,
        stale: entry.stale,
        stale_reason: entry.stale_reason || "",
        replaced_by: "",
      }]
    }
    const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, quotingType: '"' })
    let md = `---\n${yamlStr}---\n`
    if (entry) {
      const icon = entry.category === "problem" ? "🐛" : entry.category === "success" ? "✅" : entry.category === "tip" ? "💡" : "📋"
      md += `\n# 记录列表\n\n- ${icon} ${entry.content}`
    }

    fs.writeFileSync(filePath, md)
    this.refresh()
  }
}
