/**
 * B-lite S1: workspace git one-line (branch · dirty N).
 * Uses a real temp git repo — no mocks for the happy path.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { spawnSync } from "node:child_process"
import { getWorkspaceGitStatus } from "../src/acp/git-status"
import { handleAcpWsMessage } from "../src/acp/handlers"

const hasGit = (() => {
  const r = spawnSync("git", ["--version"], { encoding: "utf8", shell: false })
  return r.status === 0
})()

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      // deterministic author for commit tests
      GIT_AUTHOR_NAME: "cmspark-test",
      GIT_AUTHOR_EMAIL: "test@cmspark.local",
      GIT_COMMITTER_NAME: "cmspark-test",
      GIT_COMMITTER_EMAIL: "test@cmspark.local",
    },
  })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`)
  }
}

describe("acp git-status B-lite S1", { skip: !hasGit }, () => {
  let repoDir: string
  let bareNonRepo: string

  before(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-git-status-"))
    bareNonRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-nongit-"))
    git(repoDir, ["init", "-b", "main"])
    // Some git versions still default to master; force branch name
    try {
      git(repoDir, ["checkout", "-B", "main"])
    } catch {
      /* already main */
    }
    fs.writeFileSync(path.join(repoDir, "README.md"), "# test\n")
    git(repoDir, ["add", "README.md"])
    git(repoDir, ["commit", "-m", "init"])
  })

  after(() => {
    try {
      fs.rmSync(repoDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(bareNonRepo, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it("reports clean main branch", async () => {
    const st = await getWorkspaceGitStatus(repoDir)
    assert.equal(st.is_repo, true)
    assert.equal(st.branch, "main")
    assert.equal(st.dirty_count, 0)
    assert.ok(st.workspace_root)
    assert.equal(st.error, undefined)
  })

  it("counts dirty files (modified + untracked)", async () => {
    fs.writeFileSync(path.join(repoDir, "README.md"), "# dirty\n")
    fs.writeFileSync(path.join(repoDir, "extra.txt"), "new\n")
    const st = await getWorkspaceGitStatus(repoDir)
    assert.equal(st.is_repo, true)
    assert.equal(st.branch, "main")
    assert.ok(st.dirty_count >= 2, `expected dirty>=2 got ${st.dirty_count}`)
    // restore clean for later cases
    git(repoDir, ["checkout", "--", "README.md"])
    fs.unlinkSync(path.join(repoDir, "extra.txt"))
  })

  it("non-git directory → is_repo false", async () => {
    const st = await getWorkspaceGitStatus(bareNonRepo)
    assert.equal(st.is_repo, false)
    assert.equal(st.branch, null)
    assert.equal(st.dirty_count, 0)
  })

  it("missing path soft-fails with error", async () => {
    const st = await getWorkspaceGitStatus(
      path.join(os.tmpdir(), "cmspark-no-such-workspace-xyz"),
    )
    assert.equal(st.is_repo, false)
    assert.ok(st.error)
  })

  it("empty workspace_root soft-fails", async () => {
    const st = await getWorkspaceGitStatus("")
    assert.equal(st.is_repo, false)
    assert.ok(st.error)
  })

  it("WS handler coding.git_status returns shape", async () => {
    const r = await handleAcpWsMessage(
      "coding.git_status",
      { workspace_root: repoDir },
      {},
    )
    assert.equal(r.type, "coding.git_status")
    assert.equal(r.is_repo, true)
    assert.equal(r.branch, "main")
    assert.equal(r.agent_cwd_is_workspace, true)
    assert.equal(typeof r.dirty_count, "number")
  })

  it("WS handler acp.workspace_status alias works", async () => {
    const r = await handleAcpWsMessage(
      "acp.workspace_status",
      { workspace_root: bareNonRepo },
      {},
    )
    assert.equal(r.type, "coding.git_status")
    assert.equal(r.is_repo, false)
  })
})
