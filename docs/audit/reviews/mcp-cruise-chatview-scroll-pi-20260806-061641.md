All verification complete. Here is my review.

---

## Dual review — `mcp-cruise-chatview-scroll`

### Verification performed
- Patch confirmed non-stale: `git status` matches the patch's file list exactly (6 modified files, same hashes).
- Read actual sources: `server.ts` (executeMcpTool / executeMcpMetaTool / §6.2 gate), `config.ts`, `security.ts`, `pack-engine.ts`, full `ChatView.tsx`, `docs/mcp.md`, test file.
- Compiled & ran the full MCP gate integration suite: **39/39 pass** (incl. new cruise + enterprise-alone tests).
- TS check on chrome-extension: clean (no ChatView errors).
- Applied ADR-020 checklist template.

### A) MCP full-autonomy cruise — CORRECT, verified in code and tests

| Claim | Evidence |
|---|---|
| Three flags required | `server.ts:4686-4690` — `=== true` on all three; `auto_approve_enterprise_tools` is optional (`config.ts:56`) so `=== true` is fail-safe on undefined |
| Matches shell_exec/§6.2 algebra | Identical expression at `server.ts:1530-1535` (critical_api_gate) and `server.ts:862-867` (cookie-trust waive); `reason: "full_autonomy_cruise"` precedent at `server.ts:897` |
| God-mode (2 flags) still confirms | `server.ts:4714` path unchanged; test "god-mode ON + critical MCP → STILL confirms" passes (beforeEach now also resets enterprise flag — no state leak) |
| Enterprise alone still confirms | New test passes (8ms) |
| Audit log `mcp.confirm.waived` / `reason=full_autonomy_cruise` | `server.ts:4703-4715` (tool) and `server.ts:5049-5055` (meta) — logs server/tool/trust_level/session/caps + both would-have flags |
| originWs not regressed | Remaining confirm paths still bind `{ originWs: ws }` (`server.ts:4752-4754`, `5086-5088`) |
| Meta tools waived consistently | `executeMcpMetaTool` uses the same && chain (`server.ts:5041-5046`) |
| No new confirm dialect | Waive short-circuits before `securityConfirmations.request`; remaining confirms use existing L2 request |
| Config warning + docs | `config.ts:906` and `docs/mcp.md` bullet are accurate vs. code |

Trust monotonicity holds: cruise is strictly more opt-in than any partial flag; partial flags demonstrably do NOT weaken MCP (two tests prove it). ADR-020 declaration in the prompt is present, accurate, and no bare "中层 Agent" / new runtime.

### B) ChatView stick-to-bottom — CORRECT

- `pinnedRef` + `handleScroll` (distance < 120px) respects user scroll-up; `scrollToBottom` early-returns when unpinned everywhere.
- `ignoreScrollRef` guards programmatic scrolls for 2 rAF frames; scroll events land at bottom (distance ≈ 0) so no false unpin even after reset.
- `stickKey` (last-msg id/content length/tool_calls state + streaming lengths + processingLabel) catches same-count `SET_MESSAGES` replace and tool-result card expansion — the two failure modes the old `messages.length` watch missed.
- ResizeObserver on `contentRef` catches late layout growth (mermaid/tool results/KaTeX) with unchanged React deps; callback only scrolls when pinned.
- No re-render loop: scroll writes don't touch React state; RO → scrollTop change doesn't change content size.
- Thread switch re-pins (`activeThreadId` effect resets refs). Type-checks clean.

### Nits (non-blocking)

1. **`ChatView.tsx:305` (sentinel/bottomRef)** — `bottomRef` is declared and attached but never read (dead ref). The `overflow-anchor: auto` on the sentinel is **inert**: the container's `overflow-anchor: none` disables anchoring at the scroll-container level, so the comment "Anchor only the bottom edge" over-claims — stickiness is actually delivered by the ResizeObserver path. Harmless dead code + misleading comment; could delete sentinel+bottomRef or wire it as the RO target.
2. **`mcp-capability-gate.test.ts:483-495` (cruise test failure mode)** — `await executeTool(...)` precedes `await noPrompt`; if the gate wrongly triggered, the test would block on the pending confirm until an unhandled rejection/timeout instead of failing fast at the 400ms window. Await the no-prompt promise first (or `Promise.race`) for a clean fast-fail.
3. **No meta-tool-under-cruise test** — `mcp_read_resource` waive (`server.ts:5049`) is code-verified consistent but untested; likewise no enterprise+dangerous (2 flags w/o `allow_all_schemes`) test. Same && chain as tested paths, so coverage is adequate for the reviewed claims.
4. **Drive-by `netsec-port-survey/pack.yaml:18-21`** — out of scope per prompt; fail-safe (missing refs filtered at `pack-engine.ts:750-756`, pack doesn't enable netsec/expand allowlist/skip L2) but: `reverse-skill-router` doesn't exist in `skills/` (silently dropped → dead config), and a *builtin* pack referencing *user-local* skills makes builtin content environment-dependent. No security coupling.
5. **`docs/mcp.md` bullet** lists "god-mode 或 auto_approve_dangerous 单独" but not enterprise-alone for MCP; `config.ts:906` covers it, so doc completeness nit only.

No blocking issues. Core product intent is implemented correctly, algebra-consistent, audit-logged, originWs-intact, and tested green.

VERDICT: APPROVE_WITH_NITS
