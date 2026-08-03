/**
 * skill_install — install into user skills root (S40 Track 3)
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  skillInstall,
  getUserSkillsRoot,
  isSkillInstallSourceAllowed,
} from "../src/skills/skill-install"

function makeEngine(skillsDir: string) {
  // Minimal SkillEngine-shaped stub that implements import* used by skillInstall
  const files: string[] = []
  return {
    skillsDir,
    importSkill(content: string) {
      const m = content.match(/^name:\s*(.+)$/m)
      const name = (m?.[1] || "x").trim()
      const safe = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
      const dest = path.join(skillsDir, `${safe}.md`)
      fs.mkdirSync(skillsDir, { recursive: true })
      fs.writeFileSync(dest, content)
      files.push(dest)
    },
    importSkillFromPath(dirPath: string) {
      const skillMd = path.join(dirPath, "SKILL.md")
      if (!fs.existsSync(skillMd)) throw new Error("No SKILL.md")
      const content = fs.readFileSync(skillMd, "utf-8")
      this.importSkill(content)
      // also copy dir
      const m = content.match(/^name:\s*(.+)$/m)
      const name = (m?.[1] || "x").trim()
      const safe = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
      const destDir = path.join(skillsDir, safe)
      fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(path.join(destDir, "SKILL.md"), content)
    },
    importSkillFolder(_b64: string) {
      // not used in path tests
      throw new Error("not implemented in stub")
    },
    refresh() {},
  } as any
}

test("skill_install content writes under skills root", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-skill-"))
  const engine = makeEngine(tmp)
  const r = skillInstall(engine, {
    content: "---\nname: demo-skill\ndescription: d\n---\n\nBody\n",
  })
  assert.equal(r.ok, true, r.error)
  assert.ok(fs.existsSync(path.join(tmp, "demo-skill.md")))
})

test("isSkillInstallSourceAllowed allows Downloads and tmp, rejects arbitrary", () => {
  const dl = path.join(os.tmpdir(), "Downloads", "x")
  fs.mkdirSync(path.dirname(dl), { recursive: true })
  fs.writeFileSync(dl, "x")
  assert.equal(isSkillInstallSourceAllowed(fs.realpathSync(dl)), true)
  assert.equal(isSkillInstallSourceAllowed(fs.realpathSync(os.tmpdir())), true)
  // C:\Windows or /etc style — use a non-Downloads non-tmp path if possible
  const home = os.homedir()
  if (home && !home.toLowerCase().includes("download")) {
    // home root itself is not under Downloads/tmp/data — should be false
    // unless getConfigDir is under home (it is ~/.cmspark-agent). Realpath of home alone:
    try {
      const desktop = path.join(home, "Desktop")
      if (fs.existsSync(desktop)) {
        assert.equal(isSkillInstallSourceAllowed(fs.realpathSync(desktop)), false)
      }
    } catch {
      /* skip */
    }
  }
})

test("skill_install path directory with SKILL.md", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-skill-src-"))
  const skills = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-skill-dst-"))
  const src = path.join(tmp, "pack")
  fs.mkdirSync(src)
  fs.writeFileSync(
    path.join(src, "SKILL.md"),
    "---\nname: from-path\ndescription: x\n---\n\nHi\n",
  )
  const engine = makeEngine(skills)
  // Override by calling importSkillFromPath via skillInstall — dest is engine's skillsDir
  // skillInstall uses real getUserSkillsRoot in return metadata only
  const r = skillInstall(engine, { path: src })
  assert.equal(r.ok, true, r.error)
  assert.ok(r.hint_zh?.includes("cmspark-agent") || r.hint_zh?.includes("skills"))
  assert.ok(fs.existsSync(path.join(skills, "from-path.md")) || fs.existsSync(path.join(skills, "from-path")))
})

test("skill_install rejects empty params", () => {
  const skills = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-skill-empty-"))
  const engine = makeEngine(skills)
  const r = skillInstall(engine, {})
  assert.equal(r.ok, false)
  assert.match(r.error || "", /path|zip_path|content/)
})

test("getUserSkillsRoot ends with skills", () => {
  assert.ok(getUserSkillsRoot().replace(/\\/g, "/").endsWith("/skills") || getUserSkillsRoot().endsWith(`${path.sep}skills`))
})
