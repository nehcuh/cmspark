// S5: parse GitHub/GitLab-like URLs for page↔repo affordances.

export type RepoHint = {
  host: string
  owner: string
  name: string
  url: string
  kind: "github" | "gitlab" | "other"
  isPr: boolean
  prNumber?: string
}

export function parseRepoFromUrl(pageUrl: string | null | undefined): RepoHint | null {
  if (!pageUrl || typeof pageUrl !== "string") return null
  let u: URL
  try {
    u = new URL(pageUrl)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  const parts = u.pathname.split("/").filter(Boolean)
  if (parts.length < 2) return null

  const githubish =
    host === "github.com" ||
    host === "www.github.com" ||
    host.endsWith(".github.com") ||
    host === "gitlab.com" ||
    host.endsWith(".gitlab.com")

  if (!githubish && !host.includes("git")) {
    // still allow generic /owner/repo if path looks like it
    if (parts.length < 2) return null
  }

  const owner = parts[0]
  const name = parts[1].replace(/\.git$/i, "")
  if (!owner || !name || owner === "settings" || name === "settings") return null

  const kind: RepoHint["kind"] =
    host.includes("gitlab") ? "gitlab" : host.includes("github") ? "github" : "other"

  let isPr = false
  let prNumber: string | undefined
  // github.com/o/r/pull/123
  const pullIdx = parts.indexOf("pull")
  if (pullIdx >= 0 && parts[pullIdx + 1]) {
    isPr = true
    prNumber = parts[pullIdx + 1]
  }
  // gitlab merge_requests
  const mrIdx = parts.indexOf("merge_requests")
  if (mrIdx >= 0 && parts[mrIdx + 1]) {
    isPr = true
    prNumber = parts[mrIdx + 1]
  }

  return {
    host,
    owner,
    name,
    url: `https://${host}/${owner}/${name}`,
    kind,
    isPr,
    prNumber,
  }
}

export function formatPageContext(opts: {
  pageUrl?: string | null
  pageTitle?: string | null
  repo?: RepoHint | null
}): string {
  const lines: string[] = []
  if (opts.pageTitle) lines.push(`Title: ${opts.pageTitle}`)
  if (opts.pageUrl) lines.push(`URL: ${opts.pageUrl}`)
  if (opts.repo) {
    lines.push(`Repo: ${opts.repo.owner}/${opts.repo.name} (${opts.repo.host})`)
    if (opts.repo.isPr && opts.repo.prNumber) {
      lines.push(`PR/MR: #${opts.repo.prNumber}`)
    }
    lines.push(`Clone (copy): git clone ${opts.repo.url}.git`)
  }
  return lines.join("\n")
}

export function cloneCommand(repo: RepoHint): string {
  return `git clone ${repo.url}.git`
}
