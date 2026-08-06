/**
 * skill_install — install into user skills root (S40 Track 3 + S41 multi-adv fixes)
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
  classifySkillInstallSource,
  expandUserPath,
  MAX_CONTENT_BYTES,
  skillInstallOverwritePreview,
  skillInstallSourceDeniedError,
} from "../src/skills/skill-install"

function makeEngine(skillsDir: string) {
  // Minimal SkillEngine-shaped stub that implements import* used by skillInstall
  return {
    skillsDir,
    importSkill(content: string) {
      const m = content.match(/^name:\s*(.+)$/m)
      const name = (m?.[1] || "x").trim()
      const safe = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
      const dest = path.join(skillsDir, `${safe}.md`)
      fs.mkdirSync(skillsDir, { recursive: true })
      fs.writeFileSync(dest, content)
      return { name, destPath: dest }
    },
    importSkillFromPath(dirPath: string) {
      const skillMd = path.join(dirPath, "SKILL.md")
      if (!fs.existsSync(skillMd)) throw new Error("No SKILL.md")
      const content = fs.readFileSync(skillMd, "utf-8")
      const m = content.match(/^name:\s*(.+)$/m)
      const name = (m?.[1] || "x").trim()
      const safe = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
      const destDir = path.join(skillsDir, safe)
      fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(path.join(destDir, "SKILL.md"), content)
      return { name, destPath: destDir }
    },
    importSkillFolder(b64: string) {
      // Decode and look for name in SKILL.md-like payload (AdmZip-free stub)
      const raw = Buffer.from(b64, "base64").toString("utf-8")
      // Real engine uses AdmZip; stub expects base64 of "SKILL.md\0---\nname: zip-demo\n..."
      // For unit tests we accept base64 of a marker string "ZIP:name:zip-demo"
      const marker = Buffer.from(b64, "base64").toString("utf-8")
      const m = marker.match(/name:\s*([a-zA-Z0-9-]+)/)
      const name = m?.[1] || "zip-skill"
      const safe = name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
      const destDir = path.join(skillsDir, safe)
      fs.mkdirSync(destDir, { recursive: true })
      fs.writeFileSync(
        path.join(destDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: z\n---\n\nZip\n`,
      )
      void raw
      return { name, destPath: destDir }
    },
    refresh() {},
  } as any
}

test("skill_install content writes under skills root with honest dest_path", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-skill-"))
  const engine = makeEngine(tmp)
  const r = skillInstall(engine, {
    content: "---\nname: demo-skill\ndescription: d\n---\n\nBody\n",
  })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.name, "demo-skill")
  assert.equal(r.dest_path, path.join(tmp, "demo-skill.md"))
  assert.ok(fs.existsSync(path.join(tmp, "demo-skill.md")))
})

test("skill_install rejects oversized content", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-skill-big-"))
  const engine = makeEngine(tmp)
  const body = "x".repeat(MAX_CONTENT_BYTES + 1)
  const r = skillInstall(engine, {
    content: `---\nname: big\ndescription: d\n---\n\n${body}\n`,
  })
  assert.equal(r.ok, false)
  assert.match(r.error || "", /too large/)
})

test("skill_install zip_path returns dest_path under skill name (not skills root)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-skill-zip-src-"))
  const skills = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-skill-zip-dst-"))
  const zipPath = path.join(tmp, "Downloads", "s.zip")
  fs.mkdirSync(path.dirname(zipPath), { recursive: true })
  // Stub engine reads base64 for name; file only needs to exist + .zip suffix
  fs.writeFileSync(zipPath, Buffer.from("name: zip-demo\n", "utf-8"))
  const engine = makeEngine(skills)
  const r = skillInstall(engine, { zip_path: zipPath })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.name, "zip-demo")
  assert.ok(r.dest_path && r.dest_path.endsWith(`${path.sep}zip-demo`), r.dest_path)
  assert.notEqual(r.dest_path, r.skills_root)
  assert.ok(fs.existsSync(path.join(skills, "zip-demo", "SKILL.md")))
})

test("isSkillInstallSourceAllowed: default zone (Downloads/tmp) + user home, rejects outside home", () => {
  const dl = path.join(os.tmpdir(), "Downloads", "x")
  fs.mkdirSync(path.dirname(dl), { recursive: true })
  fs.writeFileSync(dl, "x")
  assert.equal(isSkillInstallSourceAllowed(fs.realpathSync(dl)), true)
  assert.equal(classifySkillInstallSource(fs.realpathSync(dl)), "default")
  assert.equal(isSkillInstallSourceAllowed(fs.realpathSync(os.tmpdir())), true)
  assert.equal(classifySkillInstallSource(fs.realpathSync(os.tmpdir())), "default")

  const home = os.homedir()
  assert.ok(home)
  // Product: ~/Projects and other home paths are allowed (L2 is authorization).
  const projects = path.join(home, "Projects")
  if (fs.existsSync(projects)) {
    const rp = fs.realpathSync(projects)
    assert.equal(isSkillInstallSourceAllowed(rp), true)
    assert.equal(classifySkillInstallSource(rp), "user_home")
  }
  const homeMarker = path.join(home, `.cmspark-skill-install-tier-test-${Date.now()}`)
  fs.writeFileSync(homeMarker, "x")
  try {
    const rp = fs.realpathSync(homeMarker)
    assert.equal(isSkillInstallSourceAllowed(rp), true)
    assert.equal(classifySkillInstallSource(rp), "user_home")
  } finally {
    try {
      fs.unlinkSync(homeMarker)
    } catch {
      /* */
    }
  }

  // Outside home and not Downloads/tmp/data → denied (e.g. synthetic absolute path).
  // Use a path that cannot resolve under home on this machine.
  const outside =
    process.platform === "win32"
      ? "C:\\Windows\\System32\\drivers\\etc\\hosts"
      : "/etc/hosts"
  if (fs.existsSync(outside)) {
    const rp = fs.realpathSync(outside)
    // Only assert deny if it is truly outside home (Windows profile under C:\Users\...)
    const homeRp = fs.realpathSync(home)
    const underHome =
      process.platform === "win32"
        ? rp.toLowerCase().startsWith(homeRp.toLowerCase() + path.sep) ||
          rp.toLowerCase() === homeRp.toLowerCase()
        : rp.startsWith(homeRp + path.sep) || rp === homeRp
    if (!underHome) {
      assert.equal(isSkillInstallSourceAllowed(rp), false)
      assert.equal(classifySkillInstallSource(rp), "denied")
    }
  }

  // S46: bare path segment "Downloads" outside home must NOT be default tier
  const evilDl =
    process.platform === "win32"
      ? "C:\\Windows\\Temp-not-tmp\\Downloads\\evil-skill"
      : "/usr/local/Downloads/evil-skill"
  assert.equal(classifySkillInstallSource(evilDl), "denied")
  assert.equal(isSkillInstallSourceAllowed(evilDl), false)

  const denied = skillInstallSourceDeniedError("path")
  assert.match(denied.error, /outside the allowed install source zone/)
  assert.match(denied.hint_zh, /主目录|Projects|下载/)
})

test("skill_install path under user home (Projects-shaped) succeeds", () => {
  const home = os.homedir()
  const srcRoot = fs.mkdtempSync(path.join(home, "cmspark-skill-home-src-"))
  const skills = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-skill-home-dst-"))
  try {
    const src = path.join(srcRoot, "pack")
    fs.mkdirSync(src)
    fs.writeFileSync(
      path.join(src, "SKILL.md"),
      "---\nname: from-home\ndescription: x\n---\n\nHi\n",
    )
    const engine = makeEngine(skills)
    const r = skillInstall(engine, { path: src })
    assert.equal(r.ok, true, r.error)
    assert.equal(r.name, "from-home")
    assert.equal(classifySkillInstallSource(fs.realpathSync(src)), "user_home")
  } finally {
    try {
      fs.rmSync(srcRoot, { recursive: true, force: true })
    } catch {
      /* */
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
  const r = skillInstall(engine, { path: src })
  assert.equal(r.ok, true, r.error)
  assert.equal(r.name, "from-path")
  assert.ok(r.dest_path?.includes("from-path"), r.dest_path)
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

test("expandUserPath expands ~ and %TEMP% when set", () => {
  const home = os.homedir()
  assert.equal(expandUserPath("~"), home)
  assert.ok(expandUserPath("~/foo").startsWith(home))
  if (process.env.TEMP || process.env.TMP) {
    const expanded = expandUserPath("%TEMP%\\x.zip")
    assert.ok(!expanded.includes("%TEMP%"), expanded)
  }
})

test("S42 P1: skillInstallOverwritePreview detects existing skill dest", () => {
  const root = getUserSkillsRoot()
  fs.mkdirSync(root, { recursive: true })
  const dest = path.join(root, "s42-ow-demo.md")
  fs.writeFileSync(dest, "---\nname: s42-ow-demo\ndescription: x\n---\n\nold\n")
  try {
    const prev = skillInstallOverwritePreview({
      content: "---\nname: s42-ow-demo\ndescription: d\n---\n\nBody\n",
    })
    assert.equal(prev.mode, "content")
    assert.equal(prev.name, "s42-ow-demo")
    assert.equal(prev.overwrite, true)
    assert.ok(prev.dest_path)

    const fresh = skillInstallOverwritePreview({
      content: "---\nname: s42-ow-never-exists-xyz\ndescription: d\n---\n\nBody\n",
    })
    assert.equal(fresh.overwrite, false)
    assert.equal(fresh.name, "s42-ow-never-exists-xyz")
  } finally {
    try {
      fs.unlinkSync(dest)
    } catch {
      /* */
    }
  }
})
