kimi version 0.39.1
• UserPromptSubmit hook

  {"systemMessage": "🔀 VibeSOP detected multiple intents. Execution plan injected.", "hookSpecificOutput": {"additionalContext": "[VibeSOP Execution Plan]\n{\n  \"plan_id\": \"dac6d30e-fa0\",\n  \"original_query\": \"# Dual re-review — run_progress adapter tri-state implementation\\n\\nREAD-ONLY. Independent senior reviewer. Do not edit.\\n\\nWork in: `/Users/huchen/Projects/cmspark` branch `fix/runprogress-adapter-tristate`\\n\\n## Capability\\n\\n```text\\nSurface: L0 RunProgress | Blast: T2 latent\\n```\\n\\n## Inputs\\n\\n1. Spec: `docs/superpowers/specs/2026-08-31-runprogress-adapter-tristate.md`\\n2. Diff: `git diff` on this branch vs main — files `companion/src/threads/run-progress.ts`, `companion/src/llm/adapter.ts`, `companion/src/message-router/handlers/run-progress.ts`, `companion/tests/run-progress.test.ts`\\n3. Machine: `node --test .test-dist/tests/run-progress.test.js` 29/29 pass\\n\\n## REJECT if\\n\\n- `nextRunProgressAfterToolSuccess(null thread, matching tool)` would still return a seeded object\\n- adapter success window still inlines `seedRunProgress` / `applyToolResult`\\n- toggle on null writes `{ items: [] }`\\n- helper called on failure/abort paths\\n\\nFinal line exactly:\\n\\nVERDICT: APPROVE\\nor\\nVERDICT: APPROVE_WITH_NITS\\nor\\nVERDICT: REJECT\",\n  \"steps\": [\n    {\n      \"step_id\": \"implementer-13f8\",\n      \"step_number\": 1,\n      \"skill_id\": \"fallback-llm\",\n      \"intent\": \"implementer: agent_squad\",\n      \"input_query\": \"\",\n      \"output_as\": \"step_1_result\",\n      \"status\": \"pending\"\n    },\n    {\n      \"step_id\": \"reviewer-7576\",\n      \"step_number\": 2,\n      \"skill_id\": \"fallback-llm\",\n      \"intent\": \"reviewer: agent_squad\",\n      \"input_query\": \"\",\n      \"output_as\": \"step_2_result\",\n      \"status\": \"pending\"\n    },\n    {\n      \"step_id\": \"tester-5a37\",\n      \"step_number\": 3,\n      \"skill_id\": \"fallback-llm\",\n      \"intent\": \"tester: agent_squad\",\n      \"input_query\": \"\",\n      \"output_as\": \"step_3_result\",\n      \"status\": \"pending\"\n    }\n  ],\n  \"detected_intents\": [\n    \"code_review\",\n    \"code_review\",\n    \"fix_bug\",\n    \"test\"\n  ],\n  \"reasoning\": \"Step 1: 'implementer' → fallback-llm (squad); Step 2: 'reviewer' → fallback-llm (squad); Step 3: 'tester' → fallback-llm (squad)\",\n  \"status\": \"pending\"\n}", "hookEventName": "UserPromptSubmit"}}

• This is a read-only review task. Let me look at the spec, diff, and run tests. I could do this directly or delegate. The files are small scope; let me do it directly but efficiently.

• I'll review the spec, the branch diff, and test results.On branch fix/runprogress-adapter-tristate
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   CHANGELOG.md
	modified:   companion/src/llm/adapter.ts
	modified:   companion/src/message-router/handlers/run-progress.ts
	modified:   companion/src/threads/run-progress.ts
	modified:   companion/tests/run-progress.test.ts

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	docs/audit/reviews/_prompts/runprogress-tristate-impl-dual-20260831.md
	docs/audit/reviews/_prompts/runprogress-tristate-spec-dual-20260831.md
	docs/audit/reviews/runprogress-tristate-impl-claude-20260831-131800.md
	docs/audit/reviews/runprogress-tristate-impl-kimi-20260831-131800.md
	docs/audit/reviews/runprogress-tristate-spec-claude-20260831-131200.md
	docs/audit/reviews/runprogress-tristate-spec-kimi-20260831-131200.md
	docs/superpowers/specs/2026-08-31-runprogress-adapter-tristate.md

no changes added to commit (use "git add" and/or "git commit -a")


diff --git a/companion/src/llm/adapter.ts b/companion/src/llm/adapter.ts
index 27c51e16..5c8a220d 100644
--- a/companion/src/llm/adapter.ts
+++ b/companion/src/llm/adapter.ts
@@ -66,7 +66,7 @@ import {
   shouldThawAfterSuccess,
   shouldPersistSiteOpExperience,
 } from "../tool/site-op-memory"
-import { applyToolResult, seedRunProgress } from "../threads/run-progress"
+import { nextRunProgressAfterToolSuccess } from "../threads/run-progress"
 
 // Jailbreak patterns to detect in LLM output
 const JAILBREAK_OUTPUT_PATTERNS = [
@@ -1341,14 +1341,8 @@ ${hostUseRule12}${computerUsePlaybook}${appIndexSection ? `\n\n${appIndexSection
             try {
               const th = threadManager.get(threadId)
               if (th) {
-                const current =
-                  th.run_progress && th.run_progress.items.length > 0
-                    ? th.run_progress
-                    : seedRunProgress(th)
-                const next = applyToolResult(current, { tool: toolName, success: true })
-                const shouldWrite =
-                  next !== current || (!th.run_progress && next.items.length > 0)
-                if (shouldWrite) {
+                const next = nextRunProgressAfterToolSuccess(th, toolName)
+                if (next) {
                   const updated = threadManager.update(threadId, { run_progress: next })
                   if (updated) {
                     sendToExtension({ type: "thread.updated", thread: updated })
diff --git a/companion/src/message-router/handlers/run-progress.ts b/companion/src/message-router/handlers/run-progress.ts
index d62eaa49..926c88bc 100644
--- a/companion/src/message-router/handlers/run-progress.ts
+++ b/companion/src/message-router/handlers/run-progress.ts
@@ -15,6 +15,10 @@ export function handleRunProgressToggle(
   if (!itemId) return { type: "error", error: "item_id required" }
   const thread = threadManager.get(threadId)
   if (!thread) return { type: "error", error: `Thread not found: ${threadId}` }
+  // Sticky explicit clear — do not coerce null → { items: [] }.
+  if (thread.run_progress === null) {
+    return { type: "thread.updated", thread }
+  }
   const current = thread.run_progress ?? { items: [] }
   const next = userToggle(current, itemId)
   try {
diff --git a/companion/src/threads/run-progress.ts b/companion/src/threads/run-progress.ts
index 75ae505e..887612ef 100644
--- a/companion/src/threads/run-progress.ts
+++ b/companion/src/threads/run-progress.ts
@@ -103,6 +103,35 @@ export function seedRunProgress(thread: {
   })
 }
 
+/**
+ * Adapter tick after a confirmed successful tool_result.
+ * Call only on success (adapter already gates `toolResult.success`).
+ *
+ * `undefined` return = do not write.
+ * `run_progress === null` is sticky clear — never seed.
+ * Caller-set `{ items: [] }` still reseeds on this path (pre-existing adapter
+ * behavior; TM itself does not reseed empty objects).
+ */
+export function nextRunProgressAfterToolSuccess(
+  thread: {
+    run_progress?: RunProgress | null
+    runtime_context_budget?: {
+      handoff?: { open_todos?: unknown } | null
+    } | null
+  },
+  toolName: string,
+): RunProgress | undefined {
+  if (thread.run_progress === null) return undefined
+  const current =
+    thread.run_progress != null && thread.run_progress.items.length > 0
+      ? thread.run_progress
+      : seedRunProgress(thread)
+  const next = applyToolResult(current, { tool: toolName, success: true })
+  if (next !== current) return next
+  if (thread.run_progress === undefined && next.items.length > 0) return next
+  return undefined
+}
+
 /**
  * Tick at most one oldest undone seed|user row whose item.tool === tool (exact).
  * success===true only. Never ticks model_draft. Never matches text.
diff --git a/companion/tests/run-progress.test.ts b/companion/tests/run-progress.test.ts
index bf88850e..5610b809 100644
--- a/companion/tests/run-progress.test.ts
+++ b/companion/tests/run-progress.test.ts
@@ -10,11 +10,13 @@ import * as path from "node:path"
 
 import {
   applyToolResult,
+  nextRunProgressAfterToolSuccess,
   sanitizeRunProgress,
   seedRunProgress,
   type RunProgress,
   type RunProgressItem,
 } from "../src/threads/run-progress"
+import { handleRunProgressToggle } from "../src/message-router/handlers/run-progress"
 import { validateWsMessage } from "../src/ws/validate"
 import { assertSummonerAllowed } from "../src/ws/summoner-acl"
 import { SUMMONER_WEB_DISPATCH_ALLOW } from "../src/summoner-web"
@@ -430,10 +432,83 @@ test("thread-manager run_progress sanitize-on-read + cap", () => {
   assert.equal(got!.run_progress!.items[1]!.text, "ok")
 })
 
-test("adapter source: applyToolResult on toolResult.success send, not abort/parse/validation", () => {
+function handoffThread(over: {
+  run_progress?: RunProgress | null
+  todos?: { text: string; tool?: string }[]
+}) {
+  return {
+    run_progress: over.run_progress,
+    runtime_context_budget: {
+      handoff: {
+        open_todos: over.todos ?? [{ text: "打开页", tool: "navigate" }],
+      },
+    },
+  }
+}
+
+test("nextRunProgressAfterToolSuccess: null is sticky — does not reseed on tool tick", () => {
+  const out = nextRunProgressAfterToolSuccess(
+    handoffThread({ run_progress: null, todos: [{ text: "打开页", tool: "navigate" }] }),
+    "navigate",
+  )
+  assert.equal(out, undefined)
+})
+
+test("nextRunProgressAfterToolSuccess: undefined seeds then ticks matching tool", () => {
+  const out = nextRunProgressAfterToolSuccess(
+    handoffThread({ todos: [{ text: "打开页", tool: "navigate" }] }),
+    "navigate",
+  )
+  assert.ok(out)
+  assert.equal(out!.items.length, 1)
+  assert.equal(out!.items[0]!.done, true)
+  assert.equal(out!.items[0]!.tool, "navigate")
+})
+
+test("nextRunProgressAfterToolSuccess: existing items tick without reseed", () => {
+  const current: RunProgress = {
+    items: [
+      { id: "keep", text: "打开页", done: false, source: "seed", tool: "navigate" },
+    ],
+  }
+  const out = nextRunProgressAfterToolSuccess(
+    handoffThread({
+      run_progress: current,
+      todos: [{ text: "should-not-replace", tool: "navigate" }],
+    }),
+    "navigate",
+  )
+  assert.ok(out)
+  assert.equal(out!.items[0]!.id, "keep")
+  assert.equal(out!.items[0]!.done, true)
+})
+
+test("nextRunProgressAfterToolSuccess: existing items unmatched tool → no write", () => {
+  const current: RunProgress = {
+    items: [
+      { id: "keep", text: "打开页", done: false, source: "seed", tool: "navigate" },
+    ],
+  }
+  const out = nextRunProgressAfterToolSuccess(
+    handoffThread({ run_progress: current }),
+    "get_page_text",
+  )
+  assert.equal(out, undefined)
+})
+
+test("handleRunProgressToggle: null stays null (no empty-object coerce)", () => {
+  const tm = new ThreadManager()
+  const th = tm.create("run-progress-toggle-null")
+  tm.update(th.id, { run_progress: null })
+  const r = handleRunProgressToggle({ thread_id: th.id, item_id: "x" }, tm)
+  assert.equal(r.type, "thread.updated")
+  assert.equal(tm.get(th.id)!.run_progress, null)
+})
+
+test("adapter source: nextRunProgressAfterToolSuccess on toolResult.success send, not abort/parse/validation", () => {
   const src = readSrc("llm", "adapter.ts")
   assert.match(src, /from ["']\.\.\/threads\/run-progress["']/)
-  assert.match(src, /applyToolResult\(/)
+  assert.match(src, /nextRunProgressAfterToolSuccess/)
 
   function windowAfter(marker: string, size = 900): string {
     const i = src.indexOf(marker)
@@ -441,13 +516,15 @@ test("adapter source: applyToolResult on toolResult.success send, not abort/pars
     return src.slice(i, i + size)
   }
 
-  assert.doesNotMatch(windowAfter("function persistInterruptedRemainder"), /applyToolResult/)
-  assert.doesNotMatch(windowAfter("Invalid JSON in tool arguments"), /applyToolResult/)
-  assert.doesNotMatch(windowAfter("llm.tool_arg_validation_failed"), /applyToolResult/)
+  assert.doesNotMatch(windowAfter("function persistInterruptedRemainder"), /nextRunProgressAfterToolSuccess/)
+  assert.doesNotMatch(windowAfter("Invalid JSON in tool arguments"), /nextRunProgressAfterToolSuccess/)
+  assert.doesNotMatch(windowAfter("llm.tool_arg_validation_failed"), /nextRunProgressAfterToolSuccess/)
 
   const afterSend = windowAfter("Send tool result to extension for UI display", 1600)
   assert.match(afterSend, /toolResult\.success/)
-  assert.match(afterSend, /applyToolResult/)
+  assert.match(afterSend, /nextRunProgressAfterToolSuccess/)
+  assert.doesNotMatch(afterSend, /seedRunProgress/)
+  assert.doesNotMatch(afterSend, /applyToolResult/)
 })
 
 test("userToggle flips seed/user done (toggle) and is a no-op on model_draft", () => {
• Now let me verify:
  1. Run the tests to confirm 29/29.
  2. Check the adapter success window context — is the helper only called on success paths (not failure/abort)?
  3. Check seedRunProgress signature accepts the thread shape passed.

  Let me look at the adapter context around the change and seedRunProgress.            )
            const cap = peekDomScriptCap(threadId, meta.key, meta.origin)
            if (cap.capped) {
              toolResult = cappedDomScriptResult(cap.error_code)
            } else {
              toolResult = await executeTool(tc.id, toolName, execParams, signal)
              if (toolResult.success) {
                recordDomScriptSuccess(threadId, meta.key, meta.origin)
              }
            }
          } else {
            toolResult = await executeTool(tc.id, toolName, execParams, signal)
          }

          const durationMs = Date.now() - startTime

          // Record to history. C-P0-4: record is async (awaits init).
          await historyStore.record({
            thread_id: threadId,
            tool_name: toolName,
            params: JSON.stringify(params),
            result_summary: toolResult.success
              ? JSON.stringify(toolResult.data || {}).substring(0, 500)
              : "",
            error: toolResult.error || null,
            success: toolResult.success ? 1 : 0,
            duration_ms: durationMs,
            created_at: new Date().toISOString(),
          })

          // Send tool result to extension for UI display (before vision analysis so UI shows raw result)
          sendToExtension({
            type: "tool.result",
            tool_call_id: tc.id,
            thread_id: threadId,
            tool_name: toolName,
            result: toolResult,
          })

          // Slice 6: evidence tick on real success only (not parse/validation/abort sends).
          if (toolResult.success) {
            try {
              const th = threadManager.get(threadId)
              if (th) {
                const next = nextRunProgressAfterToolSuccess(th, toolName)
                if (next) {
                  const updated = threadManager.update(threadId, { run_progress: next })
                  if (updated) {
                    sendToExtension({ type: "thread.updated", thread: updated })
                  }
                }
              }
            } catch {
              /* non-fatal run_progress tick */
            }
          }

          // Vision pipeline: intercept image-carrying tool results for local analysis
          const VISION_TOOLS = ["screenshot", "analyze_image"]
          if (VISION_TOOLS.includes(toolName) && toolResult.success && toolResult.data?.image_base64) {
            const globalCfg = getConfig()
            const threadVisionOff =
              (threadManager.get(threadId)?.config_override as any)?.vision_enabled === false
            // Use this turn's LLM (chatCreate `config`), not a getConfig() shadow.
            const visionCfg = threadVisionOff
              ? null
              : visionConfigForAnalyze(config, globalCfg.vision)

            if (visionCfg) {
              sendToExtension({ type: "tool.vision_start", thread_id: threadId,
                  tool_call_id: tc.id })
    if (!text) continue
    let id = scrubId(o.id, `rp:${i}`)
    if (seen.has(id)) id = `${id}:${i}`
    seen.add(id)
    const tool = scrubTool(o.tool)
    const done = source === "model_draft" ? false : o.done === true
    const item: RunProgressItem = { id, text, done, source }
    if (tool) item.tool = tool
    items.push(item)
  }
  return { items }
}

/**
 * Seed from thread.runtime_context_budget.handoff.open_todos only.
 * Missing handoff → empty. Never reads thread.open_todos.
 */
export function seedRunProgress(thread: {
  runtime_context_budget?: {
    handoff?: { open_todos?: unknown } | null
  } | null
} | null | undefined): RunProgress {
  const todos = thread?.runtime_context_budget?.handoff?.open_todos
  if (!Array.isArray(todos)) return { items: [] }
  return sanitizeRunProgress({
    items: todos.map((t, i) => {
      if (t && typeof t === "object" && !Array.isArray(t)) {
        const o = t as Record<string, unknown>
        return {
          id: `seed:${i}`,
          text: o.text ?? "",
          done: false,
          source: "seed" as const,
          tool: o.tool,
        }
      }
      return {
        id: `seed:${i}`,
        text: t,
        done: false,
        source: "seed" as const,
      }
    }),
  })
}

/**
 * Adapter tick after a confirmed successful tool_result.
 * Call only on success (adapter already gates `toolResult.success`).
 *
 * `undefined` return = do not write.
 * `run_progress === null` is sticky clear — never seed.
 * Caller-set `{ items: [] }` still reseeds on this path (pre-existing adapter
 * behavior; TM itself does not reseed empty objects).
 */
export function nextRunProgressAfterToolSuccess(
  thread: {
    run_progress?: RunProgress | null
    runtime_context_budget?: {
      handoff?: { open_todos?: unknown } | null
    } | null
  },
  toolName: string,
): RunProgress | undefined {
  if (thread.run_progress === null) return undefined
  const current =
    thread.run_progress != null && thread.run_progress.items.length > 0
      ? thread.run_progress
      : seedRunProgress(thread)
  const next = applyToolResult(current, { tool: toolName, success: true })
  if (next !== current) return next
  if (thread.run_progress === undefined && next.items.length > 0) return next
  return undefined
}

/**
 * Tick at most one oldest undone seed|user row whose item.tool === tool (exact).
 * success===true only. Never ticks model_draft. Never matches text.
 */
export function applyToolResult(
  progress: RunProgress,
Now run the tests. The prompt says `.test-dist/tests/run-progress.test.js` — need to check build. The tests may need tsc build first. Let me check whether .test-dist is up-to-date; safest to run the compile + test. Check package.json scripts.

• Now run the machine check against the compiled tests..test-dist/tests/run-progress.test.js
1788153309 .test-dist/tests/run-progress.test.js
1788153295 tests/run-progress.test.ts
1788153295 src/threads/run-progress.ts
    "build": "tsc && node -e \"const fs=require('fs'),p=require('path');fs.mkdirSync('dist/computer',{recursive:true});fs.copyFileSync('src/computer/qwen-vl-worker.py','dist/computer/qwen-vl-worker.py');process.platform!=='win32'&&fs.chmodSync('dist/index.js',0o755)\"",
    "test": "node -e \"require('fs').rmSync('.test-dist',{recursive:true,force:true})\" && tsc -p tsconfig.test.json && node scripts/run-tests.mjs",
    "build:host": "bash src/host-use/darwin/build-host.sh",
    "build:exe": "npm run build && npm run stage:win-scripts && npm run bundle:exe"


• The .test-dist file is newer than the source (mtime 1788153309 > 1788153295), so it appears current. But to be safe, recompile the test dist or just run the test. Let me rebuild test dist quickly to be sure it reflects the current source, then run. Actually simpler: run `tsc -p tsconfig.test.json` then node --test on the file.npm warn Unknown user config "//registry.npmmirror.com" (registry https://registry.npmmirror.com). This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
✔ adapter source: nextRunProgressAfterToolSuccess on toolResult.success send, not abort/parse/validation (0.251458ms)
✔ userToggle flips seed/user done (toggle) and is a no-op on model_draft (0.049792ms)
✔ validate thread.run_progress.toggle requires thread_id and item_id (0.547958ms)
✔ message-router thread.run_progress.toggle flips item and returns thread.updated (2.832417ms)
✔ message-router thread.run_progress.toggle errors on missing thread (0.101ms)
✔ summoner surface thread.run_progress.toggle is denied SUMMONER_ACL (0.040125ms)
✔ thread.run_progress.toggle is not on overlay allowlists or thread.update keys (0.270583ms)
ℹ tests 29
ℹ suites 0
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 157.210083
Tests pass 29/29 after a fresh compile. Now the REJECT criteria check:

  1. `nextRunProgressAfterToolSuccess(null thread, matching tool)` returns seeded object? — No: `if (thread.run_progress === null) return undefined`. Tested. PASS.
  2. Adapter success window still inlines seedRunProgress/applyToolResult? — No: adapter imports only `nextRunProgressAfterToolSuccess` and calls it; grep lock asserts no `seedRunProgress`/`applyToolResult` in the success window. PASS.
  3. Toggle on null writes `{ items: [] }`? — No: handler early-returns `{ type: "thread.updated", thread }` unchanged when `run_progress === null`. Tested. PASS.
  4. Helper called on failure/abort paths? — The call site is gated by `if (toolResult.success)`. Grep lock checks abort/parse/validation windows don't contain the helper. PASS.

  Additional nit-checks as a senior reviewer:

  - Toggle handler when null returns `{ type: "thread.updated", thread }` — sends a thread.updated with unchanged thread; slight redundant broadcast but harmless. Could be a nit.
  - Helper: `thread.run_progress != null && items.length > 0` — note that for a caller-set `{ items: [] }`, it seeds (pre-existing behavior, documented). Fine.
  - One subtlety: when `run_progress === undefined` and seed yields items but tool doesn't match — `applyToolResult(current, ...)` returns current unchanged if no match? Then `next !== current` false; then `run_progress === undefined && next.items.length > 0` → writes seeded. Matches spec item 2/3 and old behavior.
  - Old behavior: `!th.run_progress && next.items.length > 0` — old `!th.run_progress` was true for null too; new restricts to undefined only. Correct.
  - When run_progress is an existing object with items and tool matches → next !== current → write. Good.
  - Edge: existing object with items, applyToolResult returns same ref when no match → no write. Good.
  - Type check passed (tsc compiled clean).
  - seedRunProgress signature accepts the helper's thread param shape (run_progress extra prop is fine structurally).

  One potential nit: in the toggle handler, returning `thread.updated` for a no-op triggers a broadcast of an unchanged thread — could return silently, but it preserves response type contract; minor. Also `??` on next line still there but unreachable for null now — fine.

  Another check: does anything else call seedRunProgress in adapter? The import was replaced; grep lock ensures. Also confirm no other failure path calls — abort path `persistInterruptedRemainder` checked by test.

  Verdict: APPROVE or APPROVE_WITH_NITS. The toggle returning a `thread.updated` echo for a null no-op is a minor nit (unnecessary broadcast, and UI receives thread.updated even though nothing changed — could confuse diff-based UI). I'd say APPROVE_WITH_NITS. But does it violate anything? No. The spec says "Toggle: if === null, return thread unchanged (no write)" — implementation matches exactly ("return thread unchanged"). So the implementation matches the spec; the broadcast of unchanged thread is what the spec literally describes? Spec says "return thread unchanged (no write)" — the handler returns `{ type: "thread.updated", thread }`, no `update()` call. That matches. So it's per-spec. Any nits? The doc comment on the helper is good.

  Actually one thing to double check: does `handleRunProgressToggle`'s caller broadcast the returned thread? If so the unchanged thread gets broadcast — per spec though. Not a reject.

  I'll go APPROVE. Maybe a tiny nit about the unchanged-thread broadcast, but spec mandates that behavior. APPROVE is cleanest.

• ## Review: run_progress adapter tri-state

  **Scope reviewed**: spec `docs/superpowers/specs/2026-08-31-runprogress-adapter-tristate.md`, diff vs `main` on the four files, plus the surrounding adapter call site (`companion/src/llm/adapter.ts:1338-1356`) and helper/seed/toggle implementations.

  **Machine check**: rebuilt test dist (`tsc -p tsconfig.test.json`) from current sources, then `node --test .test-dist/tests/run-progress.test.js` — **29/29 pass** (confirmed against a fresh compile, not a stale dist).

  ### REJECT criteria

  - **Null thread + matching tool reseeds?** No. `nextRunProgressAfterToolSuccess` returns `undefined` on `run_progress === null` before any seeding (`companion/src/threads/run-progress.ts:124`), covered by the sticky-null test. ✅
  - **Adapter success window inlines seed/tick?** No. The window calls only `nextRunProgressAfterToolSuccess`; the import of `seedRunProgress`/`applyToolResult` was dropped, and the source-grep lock now asserts neither name appears in the success window. ✅
  - **Toggle on null writes `{ items: [] }`?** No. `handleRunProgressToggle` early-returns the unchanged thread on `=== null` before the `?? { items: [] }` line (`companion/src/message-router/handlers/run-progress.ts:18-21`), with a dedicated test asserting `run_progress` stays `null`. ✅
  - **Helper on failure/abort paths?** No. The only call site is inside `if (toolResult.success)` (adapter.ts:1339); grep lock covers abort (`persistInterruptedRemainder`), parse, and validation windows. ✅

  ### Independent checks beyond the criteria

  - Write-condition logic is faithful to the spec: `next !== current` → write; `undefined` + seeded items > 0 → write even if no tick; existing-object-with-items and unmatched tool → no write (tested). The spec's warning about naive `!= null` (a tick on a seeded copy of null still writing) is structurally avoided because null exits before seeding.
  - `{ items: [] }` caller-set still reseeds — pre-existing adapter behavior, explicitly documented in the helper's doc comment; matches spec design clause 3.
  - `tsc` compiles clean; the helper's thread param type is structurally compatible with `seedRunProgress`.
  - Toggle handler's null path returns `thread.updated` with the unchanged thread (a redundant broadcast) — but this is exactly what the spec's design section prescribes ("return thread unchanged"), so not a deviation.

  No findings at MAJOR or MINOR level.

  VERDICT: APPROVE

To resume this session: kimi -r session_9d925c4b-720b-4708-abe8-83ee9e6c8301
