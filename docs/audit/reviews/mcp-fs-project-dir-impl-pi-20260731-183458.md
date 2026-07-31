I have completed a thorough review of the real diff, source files, and test suite. Here is my independent assessment.

## Review findings

### Recoverability (P0a/b/c) — VERIFIED
- The bare `isError` path is now routed through `enhanceMcpError` (server.ts `runOnce`, ~4110), not just the throw path — the previous raw-error gap is closed.
- `classifyError` (security.ts:723-731) gains `parent directory does not exist`, `does not exist`, `access denied`, `not allowed`, `outside allowed`, `allowed director` — `6zhrh6` class no longer kill-turn. Tests confirm (`security-thread.test.ts`).
- `enhanceMcpError` preserves the machine tokens verbatim ("parent directory does not exist", "Access denied" in `Underlying:`) so `classifyError` still classifies after enhancement; asserted by `mcp-error-hints.test.ts`.

### ensure_project_dir (P1) — VERIFIED SAFE
- `sanitizeProjectName` strips separators/control chars, collapses dot/dash edges, rejects `.`/`..` (project-dir.ts:13-25).
- Double containment: base realpath'd under `homeReal` or `wsReal`; target re-checked against container (project-dir.ts:104-114). No escape possible.
- `workspace_root` is native-picker-bound (workspace.ts:80+) — user-verified, consistent with existing workspace tools.
- `__thread_id` injected server-side *after* `...params` spread (adapter.ts:701), so the LLM cannot spoof the acting thread's workspace.

### Allow-dir expand (P2) — VERIFIED
- Gated strictly on access-denied-class errors; parent-missing explicitly excluded (tested).
- `resolveAllowDirToOffer`: realpath(home) + realpath(dir) containment, sensitive blocklist `.ssh/.gnupg/Keychains/Mail/.aws/.config/gcloud`; symlink swap fails closed (re-resolved in `addFilesystemAllowDir`).
- L2 is **unconditional** — `securityConfirmations.request` is called directly (server.ts:4214-4230) with no god-mode/auto-approve shortcut; `criticalApis: ["mcp-allow-dir-expand"]` set; `{ originWs: opts.ws }` bound. God-mode cannot skip.
- User deny returns before `addFilesystemAllowDir` — no expansion.
- Retry is single-shot: expansion block runs once after first `runOnce`; retry is a plain `runOnce` with no re-entry (server.ts:4145-4163).
- `replaceMcpServers` atomic write + `applyConfig` diff — the double-apply (event listener + explicit call) is benign (second call sees already-updated `currentConfig` → no restart).

### Tests
Full suite: **2125 pass / 0 fail**, including the 4 new test files. As the implementer's table notes: no integration test for `tryExpand` + mock L2 confirm + retry — acknowledged gap.

## Nits (non-blocking)
1. **server.ts:4214** — the L2 prompt is shown *before* verifying the server is a filesystem server (`looksLikeFilesystemServer` is only checked inside `addFilesystemAllowDir` after approval, allow-dir-expand.ts:158). A non-filesystem server returning an "access denied"-class error with a home path in params triggers a misleading "允许 MCP「\<server\>」访问目录" prompt; if approved, the tool then fails with "server does not look like…" and the original rawErr is dropped from the final message. Pre-check server identity before prompting and keep the rawErr in the failure text.
2. **No integration test** for the P2 flow (deny → no expand, approve → add → single retry) — this is the security-sensitive path; mockable via `securityConfirmations` + stub manager.
3. **allow-dir-expand.ts:106-107** — sensitive blocklist compares `norm` case-sensitively; on case-insensitive APFS `~/.SSH` would evade the `.ssh` check. Lowercasing `norm` costs nothing.
4. **allow-dir-expand.ts:169** — `roots` `file://` URI is not URI-encoded (spaces/CJK produce a malformed URI; args still carry the path, low impact). Also, the walk-up can land on the home dir itself when the whole tree is missing — prompt then displays home (transparent, but the "不会开放整盘" copy undersells adding the entire home dir).
5. **server.ts:4295-4300** — the ENOENT branch also fires for read tools, giving "create parent folders" advice for a missing-file read; recoverable and underlying error preserved, but the hint could key on write-like tool names.

None of these are security regressions or blockers — all P2 invariants (home-only, L2-forced, origin-bound, no silent expand, single retry) hold in the real code, and the `6zhrh6` bug class is genuinely fixed.

VERDICT: APPROVE_WITH_NITS
