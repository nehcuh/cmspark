// Skill engine — load, inject, and manage skills

import * as fs from "fs"
import * as path from "path"
import matter from "gray-matter"
import { getConfigDir } from "../config"

interface SkillMeta {
  name: string
  description: string
  type: "prompt_template" | "tool_chain" | "sub_agent"
  builtin: boolean
  source_file: string
}

interface Skill extends SkillMeta {
  content: string  // markdown body (without frontmatter)
}

export class SkillEngine {
  private skillsDir: string
  private builtinDir: string
  private skillsCache: Skill[] = []
  private threadSkillMap: Map<string, string[]> = new Map() // threadId → skill names

  constructor() {
    this.skillsDir = path.join(getConfigDir(), "skills")
    this.builtinDir = path.join(getConfigDir(), "builtin-skills")
    this.refresh()
  }

  refresh(): void {
    this.skillsCache = []
    // Load user skills
    this.loadFromDir(this.skillsDir, false)
    // Load builtin skills
    this.loadFromDir(this.builtinDir, true)
  }

  private loadFromDir(dir: string, builtin: boolean): void {
    try {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".md")) continue
        const filePath = path.join(dir, file)
        try {
          const raw = fs.readFileSync(filePath, "utf-8")
          const parsed = matter(raw)
          const name = parsed.data.name || file.replace(".md", "")
          const description = parsed.data.description || ""
          const type = parsed.data.type || "prompt_template"

          this.skillsCache.push({
            name,
            description,
            type,
            builtin,
            source_file: filePath,
            content: parsed.content,
          })
        } catch {
          // skip malformed skills
        }
      }
    } catch {
      // directory may not exist yet
    }
  }

  list(): SkillMeta[] {
    return this.skillsCache.map(s => ({
      name: s.name,
      description: s.description,
      type: s.type,
      builtin: s.builtin,
      source_file: s.source_file,
    }))
  }

  get(name: string): Skill | undefined {
    return this.skillsCache.find(s => s.name === name)
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
    const active = this.threadSkillMap.get(threadId) || []
    return active.map(name => this.get(name)).filter(Boolean) as Skill[]
  }

  buildSystemPrompt(threadId: string): string {
    const skills = this.getActiveForThread(threadId)
    if (skills.length === 0) return ""

    const skillContents = skills.map(s => s.content).join("\n\n---\n\n")
    return `You have access to the following skills. Use them to guide your approach:\n\n${skillContents}`
  }

  exportSkill(name: string): string {
    const skill = this.get(name)
    if (!skill) throw new Error(`Skill not found: ${name}`)

    const frontmatter = [
      "---",
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      `type: ${skill.type}`,
      "---",
    ].join("\n")

    return `${frontmatter}\n\n${skill.content}`
  }

  importSkill(content: string): void {
    const parsed = matter(content)
    const name = parsed.data.name
    if (!name) throw new Error("Skill must have a 'name' field in frontmatter")

    // Ensure unique filename
    const safeName = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
    const filePath = path.join(this.skillsDir, `${safeName}.md`)

    fs.writeFileSync(filePath, content)
    this.refresh()
  }

  deleteSkill(name: string): void {
    const skill = this.get(name)
    if (!skill) throw new Error(`Skill not found: ${name}`)
    if (skill.builtin) throw new Error(`Cannot delete builtin skill: ${name}`)

    fs.unlinkSync(skill.source_file)
    this.refresh()
  }
}
