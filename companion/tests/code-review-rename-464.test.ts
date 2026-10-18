// Actual public Git patch; the evidence wire below is an explicitly synthetic
// mutation of the recorded BrowserBridge shape, never a live host read.
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { parseUnifiedDiff } from "../src/code-review/diff"
import { CodeReviewService } from "../src/code-review/service"
import { EvidenceStore } from "../src/business-evidence/store"
import { normalizeEvidenceText } from "../src/business-evidence/content"

const fixtureRoot = path.join(__dirname, "../../tests/fixtures")
const diff = fs.readFileSync(path.join(fixtureRoot, "code-review-rename-464.patch"), "utf8")
const metadata = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "code-review-rename-464.json"), "utf8"))
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

test("#464 autocrlf checkout preserves the recorded Git patch bytes without disabling unrelated conversion", t => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-rename-checkout-"))
  t.after(() => fs.rmSync(owned, { recursive: true, force: true }))
  const seed = path.join(owned, "seed"), checkout = path.join(owned, "checkout")
  const emptyConfig = path.join(owned, "empty.gitconfig"), template = path.join(owned, "empty-template")
  fs.mkdirSync(seed)
  fs.mkdirSync(template)
  fs.writeFileSync(emptyConfig, "", { flag: "wx" })
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyConfig, GIT_TERMINAL_PROMPT: "0" }
  const git = (cwd: string, args: string[]) => execFileSync("git", args, {
    cwd, env, encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  })
  const relative = "companion/tests/fixtures/code-review-rename-464.patch"
  const repository = path.resolve(fixtureRoot, "../../..")
  fs.mkdirSync(path.dirname(path.join(seed, relative)), { recursive: true })
  fs.copyFileSync(path.join(repository, ".gitattributes"), path.join(seed, ".gitattributes"))
  fs.copyFileSync(path.join(repository, relative), path.join(seed, relative))
  fs.writeFileSync(path.join(seed, "unrelated.txt"), "Unrelated checkout conversion remains enabled.\n")
  git(seed, ["init", "--quiet", "--template=" + template])
  git(seed, ["-c", "core.autocrlf=false", "add", "--", ".gitattributes", relative, "unrelated.txt"])
  git(seed, ["-c", "user.name=Owned fixture", "-c", "user.email=fixture@invalid", "commit", "--quiet", "-m", "owned patch checkout"])
  git(owned, ["-c", "core.autocrlf=true", "clone", "--quiet", "--no-local", "--template=" + template, seed, checkout])
  const checked = fs.readFileSync(path.join(checkout, relative), "utf8")
  assert.equal(sha(checked), metadata.patchSHA256)
  assert.equal(sha(JSON.stringify(parseUnifiedDiff(checked)[0].lines)), metadata.lineInventorySHA256)
  assert.ok(fs.readFileSync(path.join(checkout, "unrelated.txt"), "utf8").includes("\r\n"))
})

test("#464 actual Git R064 patch retains both paths and the full independent hunk inventory", () => {
  assert.equal(sha(diff), metadata.patchSHA256)
  const files = parseUnifiedDiff(diff)
  assert.equal(files.length, 1)
  assert.equal(files[0].old_path, metadata.oldPath)
  assert.equal(files[0].new_path, metadata.newPath)
  assert.equal(files[0].lines.length, metadata.lines)
  assert.equal(sha(JSON.stringify(files[0].lines)), metadata.lineInventorySHA256)
  assert.ok(files[0].lines.some(line => line.old_line !== null && line.new_line === null))
  assert.ok(files[0].lines.some(line => line.old_line === null && line.new_line !== null))
})

test("#464 renamed code uses the unchanged exact-citation store and side-specific report fences", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-rename-review-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const scope = { kind: "chat" as const, threadId: "rename-owned" }
  const wire = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "web-code-diff-v1.json"), "utf8")).wire
  const prefix = `Repository ${metadata.repository}\nBase ${metadata.base}\nHead ${metadata.head}\n`
  wire.data.text = prefix + diff
  const capture = new EvidenceStore(dir, scope).capture("synthetic-rename-wire", "get_page_text", wire)
  if (capture.capture_status !== "captured") throw Error("owned fixture capture failed")
  const content = normalizeEvidenceText(wire.data.text), points = Array.from(content), start = Array.from(prefix).length
  const input = { request_id: "rename", repository: metadata.repository, base: metadata.base, head: metadata.head,
    diff: { observation_id: capture.observation_id, start, end: points.length, excerpt: points.slice(start).join("") },
    identity_citations: [{ observation_id: capture.observation_id, start: 0, end: start, excerpt: prefix }] }
  const service = new CodeReviewService(dir, scope), view = service.create(input)
  assert.equal(view.diff_hash, sha(normalizeEvidenceText(diff)))
  assert.deepEqual(new CodeReviewService(dir, scope).read({ review_id: view.review_id }), view)
  for (const gap of ["HOST_COMPARISON_UNVERIFIED", "WEB_DIFF_COVERAGE_UNKNOWN", "CODE_DIFF_CITED_SPAN_ONLY"]) assert.ok(view.gaps.includes(gap))
  assert.equal(view.review_ready, false)
  assert.throws(() => service.create({ ...input, request_id: "forged", diff: { ...input.diff, excerpt: input.diff.excerpt + "+forged" } }), /CITATION_INVALID/)
  const oldLine = view.files[0].lines.find(line => line.old_line !== null && line.new_line === null)!.old_line!
  const newLine = view.files[0].lines.find(line => line.old_line === null && line.new_line !== null)!.new_line!
  const report = { review_id: view.review_id, repository: view.repository, base: view.base, head: view.head, diff_hash: view.diff_hash,
    status: "completed", summary: "Synthetic structural assessment only", reviewed_files: [metadata.oldPath, metadata.newPath], mappings: [], findings: [
      { severity: "info", summary: "Old side", path: metadata.oldPath, side: "old", line: oldLine },
      { severity: "info", summary: "New side", path: metadata.newPath, side: "new", line: newLine },
    ] }
  for (const finding of [
    { ...report.findings[0], path: metadata.newPath },
    { ...report.findings[1], path: metadata.oldPath },
    { ...report.findings[1], line: 9007199254740991 },
  ]) assert.throws(() => service.assess({ ...report, findings: [finding] }), /LINE_INVALID/)
  for (const missing of [metadata.oldPath, metadata.newPath]) {
    // Assessments are immutable: each deliberately incomplete report owns a job.
    const separate = service.create({ ...input, request_id: missing })
    const assessed = service.assess({ ...report, review_id: separate.review_id, reviewed_files: [missing] })
    assert.ok(assessed.gaps.includes("CODE_REPORT_FILES_MISSING"))
    assert.equal(assessed.review_ready, false)
  }
  service.receive(report)
  const received = service.read({ review_id: view.review_id })
  assert.equal(received.receipt?.report.findings.length, 2)
  assert.equal(received.review_ready, false)
  wire.data.threats_removed = ["synthetic-rewrite"]
  const rewritten = new EvidenceStore(dir, scope).capture("synthetic-rewritten", "get_page_text", wire)
  if (rewritten.capture_status !== "captured") throw Error("owned rewrite capture failed")
  assert.throws(() => service.create({ ...input, request_id: "rewritten", diff: { ...input.diff, observation_id: rewritten.observation_id } }), /RECAPTURE_REQUIRED/)
})

test("#464 rename metadata must match both headers; unsupported forms and old bounds stay closed", () => {
  const from = `rename from ${metadata.oldPath}`, to = `rename to ${metadata.newPath}`
  for (const value of [
    diff.replace("similarity index 64%", "similarity index 101%"),
    diff.replace(from, from + "\n" + from), diff.replace(from, "rename from ../escape"),
    diff.replace(to, "rename to unrelated.ts"), diff.replace("similarity index 64%\n", ""),
    diff.replace(to + "\n", ""), diff.replace(from, from.replace("rename from", "copy from")),
    diff.replace(`--- a/${metadata.oldPath}`, "--- /dev/null"),
    diff.replace(`+++ b/${metadata.newPath}`, "+++ /dev/null"),
    diff.slice(0, diff.indexOf("@@")), diff + "garbage\n", diff.slice(0, diff.lastIndexOf("\n+")),
    diff.replace(`a/${metadata.oldPath}`, `a/"${metadata.oldPath}"`),
    diff.replace("similarity index 64%", "old mode 100644\nnew mode 100755"),
  ]) assert.throws(() => parseUnifiedDiff(value), /UNSUPPORTED_OR_INCOMPLETE/)
  assert.throws(() => parseUnifiedDiff(diff.repeat(9)), /CAPACITY/)
})

test("#464 each old/new side owns its path once while cross-side swaps remain representable", () => {
  // Deliberate mutations of the actual Git fixture, not host-coverage receipts.
  const rename = (oldPath: string, newPath: string) => diff
    .replaceAll(metadata.oldPath, "__OLD_PATH__")
    .replaceAll(metadata.newPath, "__NEW_PATH__")
    .replaceAll("__OLD_PATH__", oldPath).replaceAll("__NEW_PATH__", newPath)
  assert.throws(() => parseUnifiedDiff(rename("old.ts", "one.ts") + rename("old.ts", "two.ts")), /UNSUPPORTED_OR_INCOMPLETE/)
  assert.throws(() => parseUnifiedDiff(rename("one.ts", "new.ts") + rename("two.ts", "new.ts")), /UNSUPPORTED_OR_INCOMPLETE/)
  const ordinary = (name: string) => rename(name, name)
    .replace(`similarity index 64%\nrename from ${name}\nrename to ${name}\n`, "")
  assert.throws(() => parseUnifiedDiff(ordinary("old.ts") + rename("old.ts", "next.ts")), /UNSUPPORTED_OR_INCOMPLETE/)
  assert.throws(() => parseUnifiedDiff(rename("before.ts", "new.ts") + ordinary("new.ts")), /UNSUPPORTED_OR_INCOMPLETE/)
  const swap = parseUnifiedDiff(rename("one.ts", "two.ts") + rename("two.ts", "one.ts"))
  assert.deepEqual(swap.map(file => [file.old_path, file.new_path]), [["one.ts", "two.ts"], ["two.ts", "one.ts"]])
  for (const file of swap) assert.equal(sha(JSON.stringify(file.lines)), metadata.lineInventorySHA256)
  const add = (name: string) => `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1 @@\n+x\n`
  const del = (name: string) => `diff --git a/${name} b/${name}\ndeleted file mode 100644\n--- a/${name}\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n`
  assert.deepEqual(parseUnifiedDiff(add("one.ts") + add("two.ts")).map(file => file.old_path), [null, null])
  assert.deepEqual(parseUnifiedDiff(del("one.ts") + del("two.ts")).map(file => file.new_path), [null, null])
})
