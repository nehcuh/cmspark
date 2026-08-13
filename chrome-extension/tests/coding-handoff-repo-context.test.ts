import test from "node:test"
import assert from "node:assert/strict"
import {
  parseRepoFromUrl,
  formatPageContext,
  cloneCommand,
} from "../src/sidepanel/coding-handoff/repo-context"

test("parseRepoFromUrl github PR", () => {
  const r = parseRepoFromUrl("https://github.com/org/repo/pull/42")
  assert.ok(r)
  assert.equal(r!.owner, "org")
  assert.equal(r!.name, "repo")
  assert.equal(r!.isPr, true)
  assert.equal(r!.prNumber, "42")
})

test("parseRepoFromUrl null on junk", () => {
  assert.equal(parseRepoFromUrl("not-a-url"), null)
  assert.equal(parseRepoFromUrl("https://example.com/"), null)
})

test("formatPageContext includes clone hint", () => {
  const r = parseRepoFromUrl("https://github.com/a/b")!
  const ctx = formatPageContext({
    pageUrl: "https://github.com/a/b",
    pageTitle: "b",
    repo: r,
  })
  assert.match(ctx, /Repo: a\/b/)
  assert.match(ctx, /git clone/)
  assert.match(cloneCommand(r), /git clone https:\/\/github.com\/a\/b.git/)
})
