// Workflow: 2026-06-23 深度诊断后的分批优化
//
// Source of truth: docs/audit/diagnosis-2026-06-23.md (18 critical, 26 high, 30 medium, 20+ low)
//
// Optimization is split into 7 batches (A–G) by severity + file locality.
// Each batch runs as parallel `agent()` fan-out, then a verify phase
// (tsc --noEmit + targeted tests), then a report. Batches ship sequentially
// (B depends on A's redaction change; etc.) — within a batch, fixes are
// parallel because they touch disjoint files.

export const meta = {
  name: "diagnosis-optimization-2026-06-23",
  description:
    "基于 2026-06-23 深度诊断的分批优化：Batch A 止血（critical security）→ B abort 正确性 → C 状态/并发 → D 注入面 → E 架构/文档 → F 测试网 → G 性能",
  phases: [
    { title: "Batch A — Stop-the-bleeding", detail: "5 agents 并行：history redaction+chmod / MCP zod / HMAC+selector / export origin / settings CSRF+SSRF+CLI" },
    { title: "Verify A", detail: "tsc --noEmit + touched package tests + 手工 diff review" },
    { title: "Batch B — Abort correctness", detail: "3 agents：tool.cancel propagation / rejectAll scope / abortControllers generation counter" },
    { title: "Verify B", detail: "tsc + ws-roundtrip + mcp tests" },
    { title: "Batch C — State + concurrency", detail: "3 agents：keep-alive listener dedup + SW state persist / history await ready + thread mutex / mcp reaggregate on disconnect" },
    { title: "Batch D — Prompt-injection surface", detail: "4 agents：skill body sanitize / destructive metadata / injection scan normalize / skill name collision" },
    { title: "Batch E — Architecture + docs", detail: "3 agents：delete extension privilege UI / ADR-007 + supersede 006 / protocol version negotiation" },
    { title: "Batch F — Test net", detail: "CI matrix + adapter-loop test + DB migration test" },
    { title: "Batch G — Performance", detail: "streaming markdown throttle / skill vector cache / tool parallelization" },
    { title: "Final verify", detail: "Full npm test + (optional) kimi review + manual smoke" },
  ],
}

// Batches B–G are queued after A verifies clean. Within Batch A:

const BATCH_A = [
  {
    label: "fix:A1-history-redact-chmod",
    file: "companion/src/history/store.ts",
    findings: ["C-MCP-2", "C-SEC-1", "C-PERS-1"],
    scope:
      "Extend redactForStorage to cover mcp__* tools (hash params + result_summary for sensitive patterns); " +
      "fix redactCookieSummary to handle single-object shape (not just arrays); " +
      "add mode:0o600 to writeFileSync + explicit chmodSync after create.",
  },
  {
    label: "fix:A2-mcp-zod",
    files: ["companion/src/bridge/tool-schemas.ts", "companion/src/llm/adapter.ts"],
    findings: ["C-MCP-1"],
    scope:
      "In tryParseToolArgs, when toolName is mcp__*, look up the tool meta from McpManager and " +
      "validate args against the server-declared inputSchema (JSON Schema). Use ajv-free approach: " +
      "either convert JSON Schema to zod at load time, or do direct JSON Schema validation. " +
      "On parse failure, route to existing LLM-self-correction path.",
  },
  {
    label: "fix:A3-eval-hmac-selector",
    files: ["chrome-extension/src/background/browser-bridge.ts", "chrome-extension/src/background/security-token.ts"],
    findings: ["C-EXT-2", "C-EXT-3"],
    scope:
      "Delete dead security-token.ts (per audit — companion is sole authority, file is 87 LOC unused). " +
      "Remove the misleading 'security_token non-empty string' check in browser-bridge.ts evaluate path; " +
      "document that companion-side confirmation is the only gate. " +
      "Replace selector/value string interpolation in getElementInfo, selectOption, waitFor, " +
      "dragAndDrop, click fallbacks with JSON.stringify(selector) pattern.",
  },
  {
    label: "fix:A4-export-origin-bind",
    files: ["companion/src/server.ts", "companion/src/security-confirmation.ts"],
    findings: ["C-SEC-2", "C-SRV-1"],
    scope:
      "Track originating ws in PendingConfirmation. Filter rejectAll('disconnect') to only confirmations " +
      "whose origin ws matches the closing one. Also: history.export confirmation must require the response " +
      "to come from the originating ws (or be rejected).",
  },
  {
    label: "fix:A5-settings-csrf-ssrf-cli",
    files: ["companion/src/settings-web.ts", "companion/src/settings-cli.ts", "companion/src/index.ts"],
    findings: ["C-SYS-1", "C-SYS-2", "C-SYS-3"],
    scope:
      "settings-web: require matching Origin header + per-session token in URL query (?token=...) printed at startup. " +
      "Block private IPs (RFC1918 + 169.254/16 + localhost) in /api/test fetches. " +
      "settings-cli: reject api_key in --set argv; add --set-stdin path; accept CMSPARK_API_KEY env var.",
  },
]

// Phase 1 (Batch A) — actually executed via parallel Agent tool invocations
// (see diagnosis-optimization-2026-06-23 agents launched in conversation).
// Each agent gets the finding context + scope + instruction to preserve
// existing tests and add a regression test where practical.

phase("Batch A — Stop-the-bleeding (parallel fan-out)")

log(`Launching ${BATCH_A.length} fix agents in parallel`)
log("Findings source: docs/audit/diagnosis-2026-06-23.md")

// Agents execute via the parent orchestrator's Agent tool. Each agent:
//   1. Reads the cited file(s)
//   2. Applies minimal Edit-tool changes per the finding's fix sketch
//   3. Adds or updates tests where practical
//   4. Reports file:line of every change

phase("Verify A — tsc + targeted tests")

// Verification per batch:
//   cd companion && npx tsc --noEmit
//   cd companion && npm test -- --test-name-pattern="redact|MCP|export|settings"
//   cd chrome-extension && npx tsc --noEmit
// Manual diff review by parent orchestrator before reporting batch complete.

phase("Batches B–G — queued")

// Batches B–G execute the same fan-out pattern with their respective finding sets.
// See docs/audit/diagnosis-2026-06-23.md "Recommended fix batches" for the full plan.

return {
  batchA: BATCH_A,
  next: "Wait for Batch A agents to return, run verify, then ask user before Batches B–G.",
}
