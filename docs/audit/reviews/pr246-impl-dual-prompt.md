# Dual re-review — PR #246 implementation (#245 A+B)

You are an **independent** senior reviewer. You did not implement this PR. Inspect **current code** on `fix/245-capture-p0`, not just the summary.

Workspace: `/Users/huchen/.grok/worktrees/projects-cmspark/subagent-01a04878-bc2b-7dc0-ba36-3ec2ad542b94`
Base: `origin/main` (`8b71f07d`)  Head: `fix/245-capture-p0`

## Capability declaration

```text
Surface:      Capture overlay L0 honesty ; Operate sidepanel unchanged
L2-classes:   host_computer (estop socket identity only)
Compose:      pack/skill bind overlay lease thread ; overlay does not manage MCP
Autonomy:     n/a
Trust:        overlay never Allow/Deny ; markdown CSP nonce ; estop DATA_DIR + nonce
Channel:      community
Blast:        T3
```

## Inputs (read with tools)

1. Spec: `docs/superpowers/specs/2026-08-28-post-diagnosis-opt-path.md`
2. Code diff: `docs/audit/reviews/pr246-impl-diff-20260829-081244.patch` (companion + extension only)
3. Also `git diff origin/main...HEAD -- companion/src companion/tests chrome-extension`
4. PR claims: A1 XSS+CSP nonce; A2 hide→closed abort overlay LLM/STT/meeting then leases; A3 stamp surface + deny full native executors + kill MCP mutate **paths** without changing `SUMMONER_ALLOW`; B1 truncated save; B2 estop leave `/tmp`

## REJECT if

- `SUMMONER_ALLOW` no longer contains `mcp.toggle_server` (#230 rollback)
- hide aborts Operate via `abortThreadChat(lease.thread_id)` as the sole path
- XSS still raw `href=""+unescaped u` or CSP still bare `script-src 'unsafe-inline'`
- truncated Save can overwrite unread tail
- Node still CONNECT-first-arms anonymous `/tmp/cmspark-estop.sock`
- Overlay Allow/Deny added
- #228 profile expanded

## APPROVE_WITH_NITS if DoD holds and leftovers are: Swift binaries not rebuilt, extra deny of use_skill, hidden MCP rail still POSTs 4xx, implementation tests not full-suite.

Final line exactly one of:
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
