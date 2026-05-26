// Skill engine — load, inject, and manage skills

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import matter from "gray-matter"
import AdmZip from "adm-zip"
import { getConfigDir } from "../config"

interface SkillMeta {
  name: string
  description: string
  type: "prompt_template" | "tool_chain" | "sub_agent"
  builtin: boolean
  source_file: string
  dir?: string
  resources: string[]
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

            this.skillsCache.push({
              name,
              description,
              type,
              builtin,
              source_file: entryPath,
              content: parsed.content,
              resources: [],
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
    return this.skillsCache.map(s => ({
      name: s.name,
      description: s.description,
      type: s.type,
      builtin: s.builtin,
      source_file: s.source_file,
      dir: s.dir,
      resources: s.resources,
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
    const frontmatter = [
      "---",
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      `type: ${skill.type}`,
      "---",
    ].join("\n")

    return {
      content: `${frontmatter}\n\n${skill.content}`,
      format: "markdown",
      skill_name: name,
    }
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

  importSkillFolder(zipBase64: string): void {
    const buffer = Buffer.from(zipBase64, "base64")
    const zip = new AdmZip(buffer)

    // Validate: must contain a SKILL.md at some level
    const entries = zip.getEntries()
    const skillMdEntry = entries.find(e => e.entryName.endsWith("SKILL.md") || e.entryName.endsWith("SKILL.md/"))
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
      // Ensure we don't create nested directories
      if (relativePath.includes("/")) {
        const subDir = path.dirname(relativePath)
        fs.mkdirSync(path.join(destDir, subDir), { recursive: true })
      }

      const outPath = path.join(destDir, relativePath)
      fs.writeFileSync(outPath, entry.getData())
    }

    this.refresh()
  }

  importSkillFromPath(dirPath: string): void {
    const resolved = path.resolve(dirPath.replace(/^~/, os.homedir()))
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

    for (const file of files) {
      // Normalize path: strip any leading folder name
      let relPath = file.path
      if (relPath.includes("/")) {
        // Ensure subdirectories exist
        const subDir = path.dirname(relPath)
        if (subDir !== ".") {
          fs.mkdirSync(path.join(destDir, subDir), { recursive: true })
        }
      }
      fs.writeFileSync(path.join(destDir, relPath), file.content)
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
}
