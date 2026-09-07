// #465: real Git diff -> production BrowserBridge -> recorded wire shape.
// Synthetic DOM only; this is not a real code-host adapter acceptance test.
// Run after nvm use 22 and tsc -p tsconfig.test.json in chrome-extension.
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import vm from "node:vm"
const require = createRequire(import.meta.url)
const { BrowserBridge } = require("../.test-dist/src/background/browser-bridge.js")
const directory = mkdtempSync(join(tmpdir(), "cmspark-diff-producer-"))
try {
  const git = (...args) => execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: "2026-09-07T00:00:00Z", GIT_COMMITTER_DATE: "2026-09-07T00:00:00Z" },
  }).trimEnd()
  git("init", "-q")
  git("config", "user.name", "Fixture")
  git("config", "user.email", "fixture@example.test")
  writeFileSync(join(directory, "hello.ts"), 'export const greeting = "hello"\n')
  git("add", ".")
  git("-c", "commit.gpgsign=false", "commit", "-qm", "base")
  const base = git("rev-parse", "HEAD")
  writeFileSync(join(directory, "hello.ts"), 'export const greeting = "你好"\nexport const enabled = true\n')
  git("add", ".")
  git("-c", "commit.gpgsign=false", "commit", "-qm", "head")
  const head = git("rev-parse", "HEAD")
  const diff = git("diff", "--no-ext-diff", "--no-textconv", base, head, "--") + "\n"
  const repository = "https://code.example.test/team/demo"
  const url = `${repository}/compare/${base}...${head}`
  const text = `Repository ${repository}\nBase ${base}\nHead ${head}\n${diff}`
  globalThis.chrome = {
    tabs: { get: async () => ({ url, title: "Synthetic Git comparison" }) },
    debugger: {
      onDetach: { addListener() {} }, attach: async () => {},
      sendCommand: async (_target, method) => {
        if (["Page.enable", "DOM.enable"].includes(method)) return {}
        throw new Error("Synthetic fixture CDP unavailable")
      },
    },
    scripting: { executeScript: async options => [{ result: vm.runInNewContext(
      `(${options.func.toString()})(...args)`,
      { args: options.args || [], location: { href: url }, document: { body: { innerText: text } } },
    ) }] },
  }
  const wire = await new BrowserBridge().execute("get_page_text", { tabId: 7 })
  if (!wire.success || wire.data?.provenance?.channel !== "isolated") throw new Error("unexpected producer result")
  writeFileSync(new URL("../../companion/tests/fixtures/web-code-diff-v1.json", import.meta.url),
    JSON.stringify({ git: { repository, base, head, diff }, wire }, null, 2) + "\n")
} finally {
  rmSync(directory, { recursive: true, force: true })
}
