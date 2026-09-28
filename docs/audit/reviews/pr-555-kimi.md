kimi version 0.42.0
• Let me start by examining the PR changes. I need to read the diff, the code, run tests, and do mutation testing.f81c4fb3 fix(browser): wait_for 不再吞 CDP 异常，补上 scripting 兜底（#554）
c0f17dd3 docs(memory): 记录 v0.6.10 发布事实（Release URL / SHA256 / tag==HEAD）
fc5935e2 docs(audit): 归档 #551 / #553 的四路对抗评审材料
?? .alma-snapshots/
?? .alma/
?? docs/audit/reviews/502-punchlist-20260919/code-310-dual-grok.md
?? docs/audit/reviews/502-punchlist-20260919/code-310-dual-kimi.md
?? docs/audit/reviews/502-punchlist-20260919/code-310-dual-prompt.md
?? docs/audit/reviews/502-punchlist-20260919/folder-pick-dual-kimi.md
?? docs/audit/reviews/502-punchlist-20260919/folder-pick-dual-prompt.md
?? docs/audit/reviews/502-punchlist-20260919/issue-coding-monitor-stop-enter.md
?? docs/audit/reviews/502-punchlist-20260919/issue-l1-bounded-action-space.md
?? docs/audit/reviews/502-punchlist-20260919/pr-512-body.md
?? docs/audit/reviews/502-punchlist-20260919/pr-517-body.md
?? docs/audit/reviews/502-punchlist-20260919/pr-519-body.md
?? docs/audit/reviews/502-punchlist-20260919/pr-win-handoff-body.md
?? docs/audit/reviews/502-punchlist-20260919/win-handoff-pr-dual-kimi.md
?? docs/audit/reviews/502-punchlist-20260919/win-handoff-pr-dual-prompt.md
?? docs/audit/reviews/pr-555-claude-20260928-231803.md
?? docs/audit/reviews/pr-555-diff-20260928-231803.patch
?? docs/audit/reviews/pr-555-grok.md
?? docs/audit/reviews/pr-555-kimi.md
?? docs/audit/reviews/pr-555-review-prompt.md
commit f81c4fb3efee824a9e41d929ee06198b013c37dd
Author: HuChen <huchen@cmspark.dev>
Date:   Mon Sep 28 23:17:23 2026 +0800

    fix(browser): wait_for 不再吞 CDP 异常，补上 scripting 兜底（#554）
    
    Closes #554
    
    ## 实机证据（不是推断）
    
    Windows + Chrome，经 companion 的 outbound MCP 调用：日志统计 **wait_for 6 次
    调用 6 次失败（100%）**；同一标签页同一时刻 `click` 能正常查到 DOM（返回真实
    ELEMENT_NOT_FOUND），说明扩展与页面都没问题。
    
    判别实验 `wait_for({selector:"#nope", state:"hidden"})`：
    `resolveWaitForMode` 给出 `expectVisible=false`，实现判据是
    `exists === mode.expectVisible`，元素不存在时 `!!querySelector` 为 false →
    **false === false 本应立即成功**。实测：超时。`selector:"body"`（必然存在）也超时。
    ⇒ 唯一解释是每次 `sendCdp` 都在抛异常。
    
    ## 根因
    
    ```ts
    while (Date.now() - start < timeout) {
      try {
        const result = await this.sendCdp(tabId, "Runtime.evaluate", {...})
        ...
      } catch { /* ignore */ }     // ← 吞掉 attach/权限/协议错误
      await sleep(interval)
    }
    throw new Error(`Timeout waiting for selector "${...}" (...)`)
    ```
    
    1. 空 catch 把真实错误全丢掉，循环空转到 deadline，再报一个**归因错误**的
       「selector 超时」——把基础设施故障说成页面元素不存在。这与 #528 是同一类
       问题（把「缺 selector」误判成「origin 被禁交互」）。`locator-classify.ts:77`
       的注释「Broaden attach messages so "Debugger is not attached" is not
       ELEMENT_NOT_FOUND」说明这类错误仓库里已经犯过一次。
    2. `ensureAttached()` 里写着「Try scripting API as fallback for page read tools」，
       下一行却是 `throw` —— fallback 被注释承诺了、却从未实现。
    3. wait_for 的判据只是一次纯 DOM 布尔查询（`!!document.querySelector`），
       `chrome.scripting` 就能做且**不需要 debugger**；`click` 走 scripting 正常、
       `wait_for` 走 CDP 挂，正是可被兜底覆盖的场景。
    
    ## 影响
    
    - CDP 不可用时，「等待元素」这一主功能**完全不可用**，而页面其实完全可读；
    - 模型拿到错误归因（「元素/选择器不对」而非「CDP 挂了」）→ 可能放弃本该重试的路径；
    - 错误文本含 timeout → `classifyError` 判 recoverable → **白耗 same-tool 熔断预算**
      （3 次后触发换策略），预算花在一个不存在的「定位失败」上；
    - 排障极难（根因不可见，还叠加 #539 的现场证据缺口）。
    
    ## 修法
    
    1. 新增 `probeSelectorExists()`：先 CDP，失败回落 `scriptingProbeSelector()`；
       两条都死时抛出**带两个通道真实原因**的错误。
    2. 新增 `scriptingProbeSelector()`：用**注入函数**做 `!!document.querySelector`
       （ISOLATED → MAIN），不吃页面 CSP —— 不用 `new Function`/`eval`。
    3. `waitFor` 的 selector 分支：
       - 探测失败 **有界重试 3 轮**（`MAX_WAIT_PROBE_FAILURES`，与 companion 的
         `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3` 同量级）—— 瞬时故障（页面导航中）
         不再中断等待，持续故障则**远早于 deadline 快速失败**；
       - 放弃时走既有 `failInteractive()`，拿到 `CDP_ATTACH_FAILED` 之类的**真实码**，
         不再冒充元素缺失；
       - 真超时（探测正常、条件始终不满足）→ `WAIT_TIMEOUT` + `probe_channel` +
         `elapsed_ms`；文案保留 "timeout" 一词，使 `classifyError` 仍判 recoverable，
         **不改变既有分类**（避免从「烧预算」变成「硬停」的反向回归）；
       - 成功时 data 增加 `probe_channel`，便于现场判断走的哪条通道。
    4. 把 `ensureAttached()` 里那句「承诺了 fallback」的误导注释改成如实描述。
    
    ## 测试

    
    新增 `chrome-extension/tests/wait-for-probe.test.ts`（此前 wait_for **零测试**），
    6 个用例：CDP 正常成功 / **元素不存在 + state=hidden 立即成功**（修复前必挂）/
    CDP 挂时 scripting 兜底成功 / 探测用注入函数而非源码字符串（CSP 安全）/
    两条都死 → 报真实原因且不冒充 selector 超时 / 真超时 → WAIT_TIMEOUT。
    每个用例带 anti-vacuity 断言（确认对应通道真的被调用过）。
    
    **两轮突变验证**（确认断言真在守行为，不是假绿）：
    - 去掉 scripting 兜底 → 恰好 3 个用例变红（兜底 / 注入函数 / 两条都死）；
    - 去掉有界快速失败（退回「吞异常 + 空转到超时」）→ 该用例变红，且**红的正是旧
      病症**：空转完整 8000ms 后报 `WAIT_TIMEOUT: timeout after 8000ms ...`，
      而不是真实原因 `Cannot access`。
    
    回归：extension **1464/1464 通过**（原 1458 + 新增 6），`tsc --noEmit` 与
    `plasmo build` 通过，打包门禁 **156/0**。
    
    ## 能力声明（ADR-020）
    
    Surface: n/a（无新 UI 入口）· L2-classes: (none) · Compose: none ·
    Autonomy: n/a · Trust: 无变化（不触碰 L2/授权/确认方言）· Channel: n/a
    
    Notes: 仅修既有工具的错误传播与通道兜底；未新增工具、未扩 outbound profile
    （#228 保持冻结）、未改权限语义。

 chrome-extension/src/background/browser-bridge.ts | 120 ++++++++++++++--
 chrome-extension/tests/wait-for-probe.test.ts     | 162 ++++++++++++++++++++++
 2 files changed, 272 insertions(+), 10 deletions(-)
commit f81c4fb3efee824a9e41d929ee06198b013c37dd
Author: HuChen <huchen@cmspark.dev>
Date:   Mon Sep 28 23:17:23 2026 +0800

    fix(browser): wait_for 不再吞 CDP 异常，补上 scripting 兜底（#554）
    
    Closes #554
    
    ## 实机证据（不是推断）
    
    Windows + Chrome，经 companion 的 outbound MCP 调用：日志统计 **wait_for 6 次
    调用 6 次失败（100%）**；同一标签页同一时刻 `click` 能正常查到 DOM（返回真实
    ELEMENT_NOT_FOUND），说明扩展与页面都没问题。
    
    判别实验 `wait_for({selector:"#nope", state:"hidden"})`：
    `resolveWaitForMode` 给出 `expectVisible=false`，实现判据是
    `exists === mode.expectVisible`，元素不存在时 `!!querySelector` 为 false →
    **false === false 本应立即成功**。实测：超时。`selector:"body"`（必然存在）也超时。
    ⇒ 唯一解释是每次 `sendCdp` 都在抛异常。
    
    ## 根因
    
    ```ts
    while (Date.now() - start < timeout) {
      try {
        const result = await this.sendCdp(tabId, "Runtime.evaluate", {...})
        ...
      } catch { /* ignore */ }     // ← 吞掉 attach/权限/协议错误
      await sleep(interval)
    }
    throw new Error(`Timeout waiting for selector "${...}" (...)`)
    ```
    
    1. 空 catch 把真实错误全丢掉，循环空转到 deadline，再报一个**归因错误**的
       「selector 超时」——把基础设施故障说成页面元素不存在。这与 #528 是同一类
       问题（把「缺 selector」误判成「origin 被禁交互」）。`locator-classify.ts:77`
       的注释「Broaden attach messages so "Debugger is not attached" is not
       ELEMENT_NOT_FOUND」说明这类错误仓库里已经犯过一次。
    2. `ensureAttached()` 里写着「Try scripting API as fallback for page read tools」，
       下一行却是 `throw` —— fallback 被注释承诺了、却从未实现。
    3. wait_for 的判据只是一次纯 DOM 布尔查询（`!!document.querySelector`），
       `chrome.scripting` 就能做且**不需要 debugger**；`click` 走 scripting 正常、
       `wait_for` 走 CDP 挂，正是可被兜底覆盖的场景。
    
    ## 影响
    
    - CDP 不可用时，「等待元素」这一主功能**完全不可用**，而页面其实完全可读；
    - 模型拿到错误归因（「元素/选择器不对」而非「CDP 挂了」）→ 可能放弃本该重试的路径；
    - 错误文本含 timeout → `classifyError` 判 recoverable → **白耗 same-tool 熔断预算**
      （3 次后触发换策略），预算花在一个不存在的「定位失败」上；
    - 排障极难（根因不可见，还叠加 #539 的现场证据缺口）。
    
    ## 修法
    
    1. 新增 `probeSelectorExists()`：先 CDP，失败回落 `scriptingProbeSelector()`；
       两条都死时抛出**带两个通道真实原因**的错误。
    2. 新增 `scriptingProbeSelector()`：用**注入函数**做 `!!document.querySelector`
       （ISOLATED → MAIN），不吃页面 CSP —— 不用 `new Function`/`eval`。
    3. `waitFor` 的 selector 分支：
       - 探测失败 **有界重试 3 轮**（`MAX_WAIT_PROBE_FAILURES`，与 companion 的
         `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3` 同量级）—— 瞬时故障（页面导航中）
         不再中断等待，持续故障则**远早于 deadline 快速失败**；
       - 放弃时走既有 `failInteractive()`，拿到 `CDP_ATTACH_FAILED` 之类的**真实码**，
         不再冒充元素缺失；
       - 真超时（探测正常、条件始终不满足）→ `WAIT_TIMEOUT` + `probe_channel` +
         `elapsed_ms`；文案保留 "timeout" 一词，使 `classifyError` 仍判 recoverable，
         **不改变既有分类**（避免从「烧预算」变成「硬停」的反向回归）；
       - 成功时 data 增加 `probe_channel`，便于现场判断走的哪条通道。
    4. 把 `ensureAttached()` 里那句「承诺了 fallback」的误导注释改成如实描述。
    
    ## 测试

    
    新增 `chrome-extension/tests/wait-for-probe.test.ts`（此前 wait_for **零测试**），
    6 个用例：CDP 正常成功 / **元素不存在 + state=hidden 立即成功**（修复前必挂）/
    CDP 挂时 scripting 兜底成功 / 探测用注入函数而非源码字符串（CSP 安全）/
    两条都死 → 报真实原因且不冒充 selector 超时 / 真超时 → WAIT_TIMEOUT。
    每个用例带 anti-vacuity 断言（确认对应通道真的被调用过）。
    
    **两轮突变验证**（确认断言真在守行为，不是假绿）：
    - 去掉 scripting 兜底 → 恰好 3 个用例变红（兜底 / 注入函数 / 两条都死）；
    - 去掉有界快速失败（退回「吞异常 + 空转到超时」）→ 该用例变红，且**红的正是旧
      病症**：空转完整 8000ms 后报 `WAIT_TIMEOUT: timeout after 8000ms ...`，
      而不是真实原因 `Cannot access`。
    
    回归：extension **1464/1464 通过**（原 1458 + 新增 6），`tsc --noEmit` 与
    `plasmo build` 通过，打包门禁 **156/0**。
    
    ## 能力声明（ADR-020）
    
    Surface: n/a（无新 UI 入口）· L2-classes: (none) · Compose: none ·
    Autonomy: n/a · Trust: 无变化（不触碰 L2/授权/确认方言）· Channel: n/a
    
    Notes: 仅修既有工具的错误传播与通道兜底；未新增工具、未扩 outbound profile
    （#228 保持冻结）、未改权限语义。

diff --git a/chrome-extension/src/background/browser-bridge.ts b/chrome-extension/src/background/browser-bridge.ts
index 7bdb75d0..68dc7c5a 100644
--- a/chrome-extension/src/background/browser-bridge.ts
+++ b/chrome-extension/src/background/browser-bridge.ts
@@ -55,6 +55,14 @@ interface ToolResult {
 // scriptingExecute type-checks (audit H7 — the build was shipping with these tsc errors).
 type ScriptingResult = chrome.scripting.InjectionResult<any> & { error?: string }
 
+/**
+ * #554: how many consecutive "both probe channels failed" rounds to tolerate
+ * before giving up. A bounded retry keeps a transient blip (tab mid-navigation)
+ * from aborting the wait, while a persistent transport failure still fails fast
+ * instead of spinning until the caller's deadline.
+ */
+const MAX_WAIT_PROBE_FAILURES = 3
+
 export class BrowserBridge {
   private attachedTabs: Set<number> = new Set()
   private sanitizer: PageSanitizer
@@ -217,7 +225,9 @@ export class BrowserBridge {
         await chrome.debugger.sendCommand({ tabId }, "Page.enable")
       } catch { /* ignore */ }
     } catch (e: any) {
-      // Try scripting API as fallback for page read tools
+      // Debugger path unavailable. This layer reports the reason only; callers
+      // that can serve the request without CDP must fall back to
+      // chrome.scripting themselves (see scriptingProbeSelector / #554).
       throw new Error(`Debugger attach failed for tab ${tabId}: ${e.message}`)
     }
   }
@@ -227,6 +237,73 @@ export class BrowserBridge {
     return chrome.debugger.sendCommand({ tabId }, method, params)
   }
 
+  /**
+   * CSP-safe selector existence probe via an injected *function* (never
+   * new Function()/eval, which the page CSP can block). ISOLATED world first,
+   * then MAIN — the same two-world dance as scriptingExecute, kept separate so
+   * that helper's contract stays untouched.
+   */
+  private async scriptingProbeSelector(tabId: number, selector: string): Promise<boolean> {
+    const probe = (sel: string) => !!document.querySelector(sel)
+    const run = async (world?: "MAIN"): Promise<boolean | undefined> => {
+      const results = await chrome.scripting.executeScript({
+        target: { tabId },
+        injectImmediately: true,
+        ...(world ? { world } : {}),
+        func: probe,
+        args: [selector],
+      })
+      const first = results?.[0] as ScriptingResult | undefined
+      // No frame entry / injected error → unusable, let the caller fall through
+      // (mirrors hasUsableResult in scriptingExecute).
+      if (!first || first.error || !("result" in first)) return undef
ined
+      return first.result === true
+    }
+    try {
+      const isolated = await run()
+      if (isolated !== undefined) return isolated
+    } catch { /* fall through to MAIN world */ }
+    try {
+      const main = await run("MAIN")
+      if (main !== undefined) return main
+    } catch { /* fall through to the combined throw below */ }
+    throw new Error("scripting selector probe failed in ISOLATED and MAIN worlds")
+  }
+
+  /**
+   * Probe whether a selector currently exists, preferring CDP and falling back
+   * to chrome.scripting (#554).
+   *
+   * A boolean DOM read needs no debugger, so the debugger path being
+   * unavailable must not make this a dead end. When BOTH channels fail this
+   * throws with the real reason attached — never let a transport failure reach
+   * the caller disguised as "the element is not there".
+   */
+  private async probeSelectorExists(
+    tabId: number,
+    selector: string,
+  ): Promise<{ exists: boolean; channel: "cdp" | "scripting" }> {
+    let cdpErr: unknown = null
+    try {
+      const result = await this.sendCdp(tabId, "Runtime.evaluate", {
+        // Safe interpolation: JSON.stringify produces a valid JS string literal.
+        expression: `!!document.querySelector(${JSON.stringify(selector)})`,
+        returnByValue: true,
+      })
+      return { exists: result?.result?.value === true, channel: "cdp" }
+    } catch (e) {
+      cdpErr = e
+    }
+    try {
+      return { exists: await this.scriptingProbeSelector(tabId, selector), channel: "scripting" }
+    } catch (e: any) {
+      const cdpMsg = String((cdpErr as any)?.message || cdpErr || "unknown")
+      throw new Error(
+        `selector probe failed on both channels — cdp: ${cdpMsg}; scripting: ${String(e?.message || e)}`,
+      )
+    }
+  }
+
   private async getOuterHTMLViaDom(tabId: number, selector?: string): Promise<PageReadSnapshot> {
     await this.ensureAttached(tabId)
     try {
@@ -1515,19 +1592,42 @@ export class BrowserBridge {
       const timeout = typeof params.timeout === "number" && params.timeout > 0 ? params.timeout : 15000
       const interval = params.interval || 500
       const start = Date.now()
+      let probeFailure: unknown = null
+      let probeFailures = 0
+      let channel: "cdp" | "scripting" = "cdp"
       while (Date.now() - start < timeout) {
         try {
-          const result = await this.sendCdp(tabId, "Runtime.evaluate", {
-            // Safe interpolation: JSON.stringify produces a valid JS string literal.
-            expression: `!!document.querySelector(${JSON.stringify(mode.selector)})`,
-            returnByValue: true,
-          })
-          const exists = result.result?.value === true
-          if (exists === mode.expectVisible) return { success: true, data: { elapsed_ms: Date.now() - start } }
-        } catch { /* ignore */ }
+          const probe = await this.probeSelectorExists(tabId, mode.selector)
+          channel = probe.channel
+          probeFailures = 0
+          if (probe.exists === mode.expectVisible) {
+            return { success: true, data: { elapsed_ms: Date.now() - start, probe_channel: probe.channel } }
+          }
+        } catch (e) {
+          // Both probe channels failed. That is infrastructure, not "the element
+          // is absent". Retry a bounded number of rounds so a transient blip
+          // (tab mid-navigation) does not abort the wait, then give up carrying
+          // the REAL reason — never spin to the deadline and report a selector
+          // timeout (#554).
+          probeFailures += 1
+          if (probeFailures >= MAX_WAIT_PROBE_FAILURES) {
+            probeFailure = e
+            break
+          }
+        }
         await new Promise(r => setTimeout(r, interval))
       }
-      throw new Error(`Timeout waiting for selector "${mode.selector}" (${mode.expectVisible ? "visible" : "hidden"})`)
+      if (probeFailure) {
+        return await this.failInteractive(tabId, probeFailure, "WAIT_PROBE_FAILED")
+      }
+      // Genuine timeout: the probe was working, the condition just never held.
+      // The message keeps the word "timeout" so classifyError still scores it
+      // recoverable (unchanged from before this fix) rather than a fatal halt.
+      return codedToolError(
+        "WAIT_TIMEOUT",
+        `timeout after ${timeout}ms waiting for selector ${JSON.stringify(mode.selector)} to be ${mode.expectVisible ? "visible" : "hidden"}`,
+        { suggested_action: "get_page_text", probe_channel: channel, elapsed_ms: Date.now() - start },
+      )
     }
 
     await this.waitForTabLoad(tabId, mode.timeoutMs)
Now let me look at the test file, and key surrounding code: `failInteractive`, `codedToolError`, `classifyError` in companion/src/security.ts, `scriptingExecute`'s hasUsableResult, `classifyInteractiveFailure`, `resolveWaitForMode`. Also check callers of wait_for result data shape.Now let me look at the full waitFor function context (lines ~1580-1660), `resolveWaitForMode` in wait-for-mode.ts, `scriptingExecute` (for the hasUsableResult mirror), and `classifyError` in companion/src/security.ts. Also check what callers assume about wait_for's data shape.Let me see the rest of classifyError to check if error_code is used, and how the new "WAIT_TIMEOUT" message and new failInteractive message ("selector probe failed on both channels — cdp: Cannot access...") would be classified.

  Key point: `classifyError(errorMessage, context)` — old error was `Timeout waiting for selector "#app" (visible)` — contains "timeout" → recoverable. New genuine timeout: `WAIT_TIMEOUT: timeout after 8000ms waiting for selector...` — contains "timeout" → recoverable. Consistent. ✓

  New probe-failure error: `CDP_ATTACH_FAILED: selector probe failed on both channels — cdp: Cannot access a chrome:// URL (tab 7); scripting: Cannot access contents of the page` — contains "cannot access" → recoverable too. Hmm, what was old behavior for that? Old behavior would have been timeout → recoverable. So both recoverable; but the "same-tool recoverable failure budget" of 3 still burns. Not a regression though.

  Wait — but one question from the review prompt: does classifyError consider error_code? Let me read more of classifyError to check whether there's an error_code-based mapping before message check. Let me read lines 918-1020.Now let me check a few things:

  1. Where is `probeSelectorExists` calling CDP — does it call `ensureAttached`? Looking at `sendCdp` at line 237: `return chrome.debugger.sendCommand(...)` — no ensureAttached. But the old waitFor code also called `this.sendCdp` directly without ensureAttached. Wait — but the test asserts `calls.attach === 3`. So somewhere attach is being attempted. Let me check `sendCdp` — line 236-238. Actually wait, the test shows attach is called 3 times. Let me look at sendCdp more carefully — maybe it calls ensureAttached internally. Line 235-238 shows `private async sendCdp... return chrome.debugger.sendCommand`. Hmm, but the test counts attach calls. Let me look at the full sendCdp and where ensureAttached is called in the probe path.

  Actually, let me re-read: in the diff, `probeSelectorExists` calls `this.sendCdp(tabId, ...)`. If sendCdp doesn't ensure attach... but the test stub shows attach called 3 times in the both-dead test with interval=30. So sendCdp must call ensureAttached. Let me read lines 230-240 exactly.Now I understand the structure. Key points to verify:

  1. **P0 early-abort concern**: With CDP failing AND scripting failing for a transient period (e.g., tab mid-navigation), new behavior gives up after 3 consecutive failures. With interval=500ms, that's ~1.5s. Old behavior would keep retrying until deadline. Scenario: `wait_for` called while page is navigating — attach fails ("Cannot access" during navigation? actually attach usually succeeds during navigation; but `sendCommand` may fail with "Inspected target navigated or closed"). scripting executeScript during navigation can also fail. If navigation takes > ~1.5-2s (3 rounds × 500ms interval), the wait would now abort with CDP_ATTACH_FAILED where old behavior would have eventually succeeded once navigation completes. This is a real behavioral tradeoff. Is it blocking? It's a plausible regression in the "wait during navigation" scenario — actually this is a *primary use case* for wait_for (wait for element after clicking/navigating). Hmm. But wait — the "transient blip" comment claims bounded retry keeps transient blips from aborting. 3 rounds × interval(500ms default) = ~1s-1.5s of tolerance. Navigation + attach availability can take 2s+. So yes, there's a real risk of premature abort.

  But note: the reset logic — probeFailures resets to 0 on any success. So intermittent failures (2 fail, 1 success) never abort; they just keep waiting until deadline, and the condition check on success rounds still applies. That handles "intermittent" fine. Only *3 consecutive* failures abort. During a navigation, are both channels failing continuously? attach during navigation — chrome.debugger.attach generally works during navigation. sendCommand during navigation works too (new target). Hmm, actually what fails during navigation? If the tab is mid-navigation, Runtime.evaluate can fail with "Inspected target navigated or closed" or "Cannot find context". And scripting executeScript with injectImmediately can fail "The frame was removed" or return error. So a brief window where both fail is plausible but typically sub-second. 3 consecutive failures at 500ms interval = covers ~1-1.5s window of total outage. A full page navigation where debugger attach itself fails for 2s — attach failure happens when another debugger is attached or the tab is privileged; those are persistent, not transient. Chrome doesn't typically refuse attach during navigation.

  Actually the more important transient case: tab crashed / reloading. Tab reload takes a couple seconds; during early reload, attach may fail? I believe attach works once the tab exists. The main failure during reload is sendCommand to a closing context, but sendCommand on the tab target usually just works on the new document.

  So the premature-abort scenario requires both CDP AND scripting to fail simultaneously for 3 consecutive rounds (~1s+ with default interval). Possible but narrow. Also consider interval extreme: user passes interval=50 with timeout=15000 — 3 failures = 150ms of tolerance. That's much less tolerant. But with interval that small the caller asked for rapid polling.

  Also: is the analogy to MAX_SAME_TOOL_RECOVERABLE_FAILURES=3 apt? That constant is about how many times the LLM may retry the same tool across turns — different semantics indeed. The review prompt asks to evaluate. The value 3 is somewhat arbitrary but bounded; the comment in code doesn't claim the analogy, only the commit message does ("同量级" = same order of magnitude). Mild over-justification but not a code defect.

  2. **Deadline vs 3-failure abort timing**: Can abort happen later than deadline? No — the while loop checks deadline each iteration; break happens inside the loop. Fail-fast is always earlier than deadline. ✓. But edge: if timeout is small (e.g., 100ms) and interval default 500ms, the loop runs once, failure → probeFailures=1 <3 → sleep 500ms → loop condition now past deadline → exits loop with probeFailure=null → returns WAIT_TIMEOUT even though the probe was failing (infrastructure), misattributing again! Wait: probeFailure is only set when probeFailures >= MAX. If the deadline hits before 3 consecutive failures accumulate, the loop exits and returns WAIT_TIMEOUT — which is the *old misattribution bug* in miniature: infrastructure failure reported as timeout. E.g., timeout=1000, interval=500: rounds at t=0 (fail), t=500 (fail), t=1000 loop exits → probeFailures=2 <3 → WAIT_TIMEOUT reported even though both channels are dead. The old bug (misattribution) persists for short timeouts. Is that blocking? The default timeout is 15000 and interval 500 → 30 rounds, so 3 failures at ~1.5s aborts correctly. For short timeouts (a legitimate use: timeout=1000), the misattribution persists. It's an edge case; arguably a NIT or P1. The fix's purpose was real-machine failure at default timeout; small-timeout misattribution remains but with bounded magnitude. Hmm, but the fix claims "探测失败有界重试 3 轮后走 failInteractive()，拿到真实错误码" — true only if 3 failures fit within the deadline. With default 15s/500ms that's fine. I'd call this a NIT (document behavior) rather than blocking — actually is it? The review prompt P1 explicitly asks: "核实 MAX_WAIT_PROBE_FAILURES 不会与 timeout 组合出「比 deadline 还晚才放弃」的怪行为" — the opposite怪行为 exists: deadline earlier than 3 failures → misattributed WAIT_TIMEOUT. Worth a finding. Severity: it reintroduces the original bug class for timeout < 3×interval (e.g. timeout=1000, interval=500). But impact is limited: the WAIT_TIMEOUT message no longer says "element not there" explicitly... actually it says "timeout after 1000ms waiting for selector ... to be visible" — the old misattribution. I'd rank P1, possibly blocking? The rule says any BLOCKING → REJECT. Let me think about whether this is blocking. The mainline scenario (default timeout) works. Short-timeout misattribution is a residual edge of the same bug. I'd call it a NIT/P1 non-blocking, since worst case = old behavior for an edge config, not a regression.

  Wait, actually one more subtlety: a *single* probe round where CDP fails and scripting fails may take time (two executeScript calls). The elapsed accounting is fine.

  3. **probeFailures reset**: on success reset to 0 — with alternating fail/success, waits forever until deadline; that's fine (that's the wait's purpose). But note the infinite-drag concern in the prompt: "每 2 次失败就成功 1 次" — never reaches 3 consecutive, so runs to deadline and reports WAIT_TIMEOUT. But there were successes — probes did work intermittently. WAIT_TIMEOUT is acceptable-ish there. Fine.

  4. **WAIT_TIMEOUT classification**: message "timeout after ... " lowercase contains "timeout" → recoverable (line 984). Before: "Timeout waiting for selector" → also contains "timeout" (lowercased) → recoverable. Consistent ✓.

  Wait — also check: does anything upstream rely on the exact old message "Timeout waiting for selector"? Let me grep.

  5. **Scripting fallback equivalence**: CDP `Runtime.evaluate` runs in main world of the page. scripting ISOLATED world shares the same DOM (isolated world = separate JS globals, same DOM). document.querySelector gives the same result for the DOM. Shadow DOM: querySelector doesn't pierce shadow roots in either. Cross-origin iframes: querySelector from top frame doesn't see into cross-origin iframe documents in either case (both evaluate in main frame only). Also executeScript targets all frames? No — target {tabId} without allFrames → main frame only; results[0] is main frame. CDP Runtime.evaluate also evaluates in the main frame's default context. Equivalent. ✓

  One difference: CDP path on a page where the execution context is destroyed mid-evaluate returns an error → falls to scripting which reinjects → could give answer. Fine.

  Another difference: pages with CSP — irrelevant for injected func. ✓

  6. **failInteractive fallbackCode "WAIT_PROBE_FAILED"**: classifyInteractiveFailure(url, msg, "WAIT_PROBE_FAILED"): if URL privileged → WRONG_ORIGIN; if msg matches invalid selector → INVALID_SELECTOR; if msg matches attach failure (which "Cannot access"/"Debugger attach failed"/"scripting selector probe failed"... wait, does "script injection" match? The combined message is "selector probe failed on both channels — cdp: Debugger attach failed...; scripting: scripting selector probe failed in ISOLATED and MAIN worlds". Contains "attach failed" → matches isAttachFailureMessage → CDP_ATTACH_FAILED. If neither matches → returns fallbackCode "WAIT_PROBE_FAILED" with suggested_action "list_tabs" (not locatorish). Is "WAIT_PROBE_FAILED" a code companion knows? classifyError checks specific codes; WAIT_PROBE_FAILED isn't special-cased → falls to message matching. Message contains e.g. "cannot access" → recoverable. If both channels failed with unusual messages (e.g. "The tab was closed"), message may not match recoverable list → non_recoverable. Old behavior: timeout → recoverable. So new behavior can flip some failure messages from recoverable to non_recoverable — is that bad? Arguably more accurate (infra failure persisting 3 rounds = not worth same-tool retry). But it's an undeclared classification change for messages outside the recoverable list. Hmm. E.g. scripting error "Cannot access contents of the page" — matches "cannot access" → recoverable. Chrome's executeScript errors include "Cannot access contents of url...", "The tab was closed", "No tab with id", "The frame was removed". "The tab was closed" — not in recoverable list... wait check: "no tab with id" is. "The tab was closed" isn't in the list shown. Then non_recoverable → could halt the chat. Old behavior for a closed tab: wait_for would spin... actually sendCdp ensureAttached → tabs.get throws "No tab with given id" → recoverable via "no tab with given id" in old path? No — old path swallowed everything and reported "Timeout waiting for selector" → recoverable. New: combined message "cdp: No tab with given id 7.; scripting: The tab was closed" — contains "no tab with given id" → recoverable. OK.

  What about a chrome:// URL: attach throws "Cannot access chrome:// URL (tab 7)"; scripting executeScript throws "Cannot access contents of the page" or "Cannot access a chrome:// URL". classifyInteractiveFailure: url starts with chrome: → WRONG_ORIGIN. Is WRONG_ORIGIN right for wait_for on chrome://? Yes — same as click on chrome://. Consistent with other tools. The review prompt asks if it's misattribution — it's the same attribution all interactive tools give; consistent. And classifyError: message "WRONG_ORIGIN: Cannot access chrome:// URL..." — contains "cannot access" → recoverable. Old: timeout → recoverable. Same level. OK.

  7. **Injection frequency / side effects**: probe runs each round; CDP down → up to 2 injections per round (ISOLATED fails → MAIN). 12s/500ms = 24 rounds → up to 48 injections. Injecting a function via chrome.scripting has no persistent side effect (no DOM change; func just queries). Rate limiting: Chrome doesn't throttle executeScript meaningfully at this rate. Cost: each injection creates a context; negligible. Not a real issue. NIT at most — actually not even worth a NIT? The func is side-effect free. Fine, mention as verified.

  8. **probe_channel in data breaking downstream**: grep callers of wait_for results. Let me grep companion for wait_for handling / data shape assumptions.

  9. **Old message grep**: "Timeout waiting for selector" anywhere else (docs/tests)?

  Let me also check `execute("wait_for")` dispatch path — is waitFor result passed through untouched? And check where wait_for data is consumed (companion src? bridge client?).

  10. **ensureAttached comment change** — verified in diff, fine.

  11. Mutation testing: run the tests, then do my own mutation (remove fallback → expect 3 red; remove bounded fail-fast → expect 1 red). Also run full extension test suite and tsc.

  Also check: the third test's stub — attach throws; sendCdp → ensureAttached throws → probeSelectorExists catches, falls to scripting. scriptingProbeSelector: run() ISOLATED → scriptExec returns [{result:true}] → success. ✓ anti-vacuity calls.attach > 0. Note: in that test `calls.cdp` — sendCommand never reached since attach threw. Fine.

  Test 5 asserts `calls.attach === 3`: each probe round → sendCdp → ensureAttached → attachedTabs doesn't have tab → attach attempt (throws). 3 rounds × 1 attach = 3 ✓. But wait — ensureAttached also does the tab URL check loop (chrome.tabs.get) first... line 200-219: for chrome:// URL it throws "Cannot access chrome:// URL" before attach. In the test, tabs.get returns https://example.com → passes, then attach throws "Cannot access a chrome:// URL (tab 7)" (the stub's message, simulating). OK.

  Also verify: does `execute` wrap waitFor errors? If probeSelectorExists's error escapes... no, waitFor catches everything in-loop and returns codedToolError. But what about errors thrown outside the loop — e.g. failInteractive itself can't throw (tabs.get guarded). codedToolError fine.

  One more check: line 1593 `const interval = params.interval || 500` — unchanged from before? In old code, same. interval=0 → 500; negative → busy loop, pre-existing.

  Now potential issue: **interval negative or tiny with probe failures** — 3 failures happen fast, abort early; fine.

  Another check — **`probe_channel` on genuine timeout when all probes failed but < 3 consecutive**: channel variable stays "cdp" default even though CDP was failing and scripting also failing. Misleading metadata in the misattributed case. Minor, part of the same finding.

  Also `data.elapsed_ms` in WAIT_TIMEOUT — new field, fine.

  Let me now grep downstream consumers of wait_for data shape and "Timeout waiting for selector".

• 核心代码已读完。现在查下游消费方与旧消息引用，然后跑测试。

• Interesting — `docs/audit/reviews/pr-555-kimi.md` appears to contain a previous draft of MY review (this conversation's content, likely being written to a file by the harness as I go? No wait — it contains my internal reasoning verbatim, including text I produced in this turn). That's the review file being live-updated. Not relevant to the verdict; ignore.

  Note `companion/src/tool/wait-for-params.ts` — normalizes wait_for args. Let me read it to see if timeout/interval are constrained (e.g., capped) — that affects the short-timeout misattribution finding.Schema allows timeout: positive number, no minimum. So timeout=500, interval=500 is valid → only 1 probe round → if infrastructure failing, misattributed as WAIT_TIMEOUT. Confirmed edge exists.

  Now run the tests. First full extension test suite (~15s), plus tsc, plus the single test file. Then mutation tests.✔ checkAndReconnect treats a CONNECTING socket as alive: no close, no new socket (0.5527ms)
✔ stale onclose from a replaced socket does not tear down the new connection (1.6578ms)
✔ challenge reply is never sent after the challenged socket was replaced (21.3839ms)
✔ checkAndReconnect closes a dead socket before discarding it (15.0902ms)
✔ shouldRefuseWsFrame refuses a 10MB JSON payload (0.392ms)
✔ shouldRefuseWsFrame allows an 8MB JSON payload (0.0694ms)
✔ isFrameBudgetRefusal: only the stamped SW refusal matches (F6) (0.0804ms)
ℹ tests 1464
ℹ suites 0
ℹ pass 1464
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9470.3289
1464/1464 confirmed. Now tsc --noEmit and plasmo build? plasmo build takes longer; run tsc at least, and package gates. Let me run tsc --noEmit and the package gate in background/parallel.

• 1464/1464 确认。接着类型检查与打包门禁：TSC_OK
[dynamic] windows-x64 GATE-ONLY fails without qwen-vl-worker.py
[static] package.sh gates Qwen3-VL worker (not TinyClick/ORT)
[static] launchers prefer node.exe+cmspark-agent.js before leftover SEA
[dynamic] release-guard.sh 六路径行为（临时 git repo）

=== Results: 156 passed, 0 failed ===


• tsc OK, gates 156/0. Now mutation testing. Two mutations:

  **Mutation 1: remove the scripting fallback** in `probeSelectorExists` — expect exactly 3 red (fallback / injected-func / both-dead). Implementer's claim: "去掉兜底 → 红 3". I'll mutate by making probeSelectorExists rethrow after CDP fails (skip scripting). Easiest: comment out the scripting try block and `throw cdpErr`.

  **Mutation 2: remove bounded fast-fail** — revert catch to `catch { /* ignore */ }` and remove the probeFailure break... Actually the implementer's mutation: "去掉有界快速失败（退回「吞异常 + 空转到超时」）→ 红 1". I'll mutate the catch block to just ignore (remove probeFailures logic) and remove the probeFailure return. Expect the both-dead test red.

  Let me do mutation 1 with Edit, run the single test file, revert. Use git stash? Better: apply edit, run test, git checkout the file.

  For running single test: `cd chrome-extension && ./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/wait-for-probe.test.js`. But npm test compiles everything already; .test-dist exists. After editing src, need recompile.

• 门禁 156/0、tsc 干净。现在做独立突变验证。**突变 1：去掉 scripting 兜底**：

✔ #554 selector 存在 + 期望 visible → 成功，且走 CDP 通道 (7.3385ms)
✔ #554 元素不存在 + state=hidden → 立即成功（修复前此处会挂到超时） (0.1785ms)
✖ #554 CDP 不可用时回落 chrome.scripting（fallback 真的被实现） (1009.5721ms)
✖ #554 scripting 探测用注入函数（不吃页面 CSP），不用 new Function (1016.1386ms)
✖ #554 两条通道都死 → 报真实原因，绝不冒充「Timeout waiting for selector」，且立即返回 (64.2975ms)
✔ #554 真超时（条件始终不满足）→ WAIT_TIMEOUT，且不冒充元素缺失 (313.1243ms)
ℹ tests 6
ℹ pass 3
ℹ fail 3
✖ failing tests:
✖ #554 CDP 不可用时回落 chrome.scripting（fallback 真的被实现） (1009.5721ms)
✖ #554 scripting 探测用注入函数（不吃页面 CSP），不用 new Function (1016.1386ms)
✖ #554 两条通道都死 → 报真实原因，绝不冒充「Timeout waiting for selector」，且立即返回 (64.2975ms)
• Mutation 1 confirmed: exactly 3 red, matching the claim. Note interesting: the fallback test took ~1000ms — meaning when fallback removed and CDP fails, the wait loop ran the bounded 3 rounds then aborted? Actually with my mutation, probeSelectorExists throws every round → 3 failures → failInteractive → CDP_ATTACH_FAILED, but the test expects success → fail. The 1009ms is the 3 rounds × interval 500 (2 sleeps). OK.

  Now revert and do mutation 2: remove bounded fast-fail (revert to swallow + spin). I'll restore the file first, then apply mutation 2: change catch block to ignore and drop the probeFailure path. Simplest mutation: set MAX_WAIT_PROBE_FAILURES to Infinity? That changes constant; but then probeFailures never >= MAX → loop spins until deadline → probeFailure stays null → WAIT_TIMEOUT. That replicates old behavior. But note probeFailures=0 reset... with Infinity, catch increments forever. That works as a mutation.

  Actually the implementer's mutation was reverting the catch to ignore. Using MAX=Infinity is equivalent behavior for the both-dead test: spin to 8000ms deadline → WAIT_TIMEOUT. Expect that one test red. But also — would "真超时" test still pass? Yes. Others pass. Expect exactly 1 red.

• 突变 1 确认：恰好 3 红，与声明一致。还原后做**突变 2：去掉有界快速失败**（退回吞异常空转）：

✔ #554 selector 存在 + 期望 visible → 成功，且走 CDP 通道 (7.7601ms)
✔ #554 元素不存在 + state=hidden → 立即成功（修复前此处会挂到超时） (0.184ms)
✔ #554 CDP 不可用时回落 chrome.scripting（fallback 真的被实现） (0.3133ms)
✔ #554 scripting 探测用注入函数（不吃页面 CSP），不用 new Function (0.2453ms)
✖ #554 两条通道都死 → 报真实原因，绝不冒充「Timeout waiting for selector」，且立即返回 (8017.6869ms)
✔ #554 真超时（条件始终不满足）→ WAIT_TIMEOUT，且不冒充元素缺失 (311.801ms)
ℹ tests 6
ℹ pass 5
ℹ fail 1
✖ failing tests:
✖ #554 两条通道都死 → 报真实原因，绝不冒充「Timeout waiting for selector」，且立即返回 (8017.6869ms)
    actual: 'WAIT_TIMEOUT: timeout after 8000ms waiting for selector "#app" to be visible',
    expected: /Cannot access|attach failed/i,
• Mutation 2 confirmed: exactly 1 red, and it spins the full 8000ms and reports the fake `WAIT_TIMEOUT: timeout after 8000ms...` instead of "Cannot access" — exactly the old pathology, as claimed.

  Revert mutation 2, recompile, verify 6/6 again. Then examine remaining checks:

  - Run a quick sanity on the short-timeout misattribution hypothesis (my own edge-case probe): write a quick ad-hoc test with timeout=600, interval=500, both channels dead → expect WAIT_TIMEOUT (misattribution). Let me actually verify this empirically rather than only by reasoning.Now empirically test the short-timeout edge: timeout=600, interval=500, both channels dead. Rounds at t≈0 (fail, probeFailures=1), sleep 500, t≈500 (fail, probeFailures=2), sleep 500, t≈1000 > 600 → exit loop, probeFailure=null → WAIT_TIMEOUT. Write a scratch test file.  → error: WAIT_TIMEOUT: timeout after 600ms waiting for selector "#app" to be visible
  → error_code: WAIT_TIMEOUT
✔ edge: timeout(600) < 3 rounds × interval(500), both channels dead (1037.4061ms)
  → error: CDP_ATTACH_FAILED: selector probe failed on both channels — cdp: Debugger attach failed for tab 7: Another debugger is already attached; scripting: scripting selector probe failed in ISOLATED and MAIN worlds
  → error_code: CDP_ATTACH_FAILED
✔ edge: invalid selector string via scripting fallback (CDP down) (217.5757ms)
ℹ pass 2
ℹ fail 0
Both edge hypotheses confirmed empirically:

  1. **Short-timeout misattribution**: timeout=600, interval=500, both channels dead → reports `WAIT_TIMEOUT: timeout after 600ms waiting for selector "#app"` — the exact original misattribution (infra failure reported as selector timeout). This happens whenever `timeout < MAX_WAIT_PROBE_FAILURES × interval` (roughly; precisely when fewer than 3 probe rounds fit before deadline). Note it took 1037ms — the loop actually slept past the deadline (sleep 500 after t≈500 round → exits at ~1000ms). Minor: elapsed exceeds timeout due to unconditional sleep; pre-existing pattern though.

  2. **Invalid selector via scripting fallback**: selector "###" with CDP down → injected func throws SyntaxError → Chrome reports it as result.error → both worlds "fail" → combined infra error → CDP_ATTACH_FAILED, NOT INVALID_SELECTOR. With CDP up, Runtime.evaluate of `!!document.querySelector("###")` — what does CDP return? Runtime.evaluate with an expression that throws returns exceptionDetails, not a rejected promise... Actually sendCommand resolves with `{result:..., exceptionDetails:...}`. The code does `result?.result?.value === true` — for a throwing expression, result.result is the exception object or undefined, value !== true → exists=false! So with CDP up, invalid selector "###" is silently treated as "element does not exist" → wait for hidden succeeds immediately, wait for visible times out with WAIT_TIMEOUT. That's pre-existing behavior (old code identical: `result.result?.value === true` — exceptionDetails ignored). So the invalid-selector misclassification predates the PR in the CDP path; but the PR's scripting fallback *adds* a new flavor: bad selector reported as CDP_ATTACH_FAILED after 3 rounds (~1s+). Before the PR, with CDP down + bad selector: spin to deadline → timeout. After: 3 rounds → CDP_ATTACH_FAILED with a confusing message. Neither is INVALID_SELECTOR. Not a regression in classification quality, arguably slightly better (fails fast with a message). Hmm — but the message "scripting selector probe failed in ISOLATED and MAIN worlds" hides the SyntaxError entirely. scriptingProbeSelector drops `first.error` content (treats as unusable, returns undefined). So the SyntaxError never surfaces. classifyInteractiveFailure checks isInvalidSelectorMessage(msg) on the combined message — but the combined message doesn't contain the SyntaxError text, so INVALID_SELECTOR never triggers via fallback. Whereas the CDP path (when up) silently treats invalid selector as absent. So wait_for has no invalid-selector detection at all — pre-existing gap, not introduced. The fallback's dropping of `first.error` detail is a minor diagnostic-quality nit (the thrown combined error loses the scripting world's actual error string — it only says "failed in ISOLATED and MAIN worlds" without the underlying reason).

  Wait — check: scriptingProbeSelector's `run` catches executeScript rejections via outer try/catch, but result.error case returns undefined silently. The final throw "scripting selector probe failed in ISOLATED and MAIN worlds" includes no detail. Compare with scriptingExecute's final throw "Script injection failed in both ISOLATED and MAIN worlds" — same pattern, also no detail. So consistent with existing code. NIT at most.

  3. Now the "premature abort" question (P0). Both channels must fail 3 consecutive rounds. When can that happen transiently? Tab mid-navigation: attach typically OK; sendCommand OK. Actually during navigation Runtime.evaluate may fail briefly. scripting executeScript during navigation: "The frame was removed" or "Cannot access contents of the page" briefly. Both simultaneously for 3 rounds × 500ms = ~1-1.5s+ — possible on slow navigations but narrow. With small interval (e.g. 100ms), 3 rounds = ~300ms window — a brief navigation blip could abort a wait that old code would have ridden out. This is a real behavioral tradeoff, but old behavior in that situation produced the wrong error anyway after the full deadline if it never recovered; if it recovered, old succeeded, new aborts early with a real error code (CDP_ATTACH_FAILED, recoverable). Model gets recoverable error → can retry. So impact: a wait that would have succeeded after ~1s of total transport outage now returns a recoverable error early. The model can re-issue wait_for. It's a tradeoff, disclosed in the commit ("瞬时故障不再中断等待，持续故障快速失败"). The claim that 3 rounds tolerates transient blips is only true for blips shorter than 3×interval. Worth a NIT about the threshold basis (the MAX_SAME_TOOL_RECOVERABLE_FAILURES analogy is semantically different — that one counts cross-turn same-tool failures; not a strong basis, but 3 is defensible).

  4. `probe_channel` downstream: data consumers — grep showed no companion code reads wait_for's `data` fields (wait-for-params.ts only normalizes input). Tool results flow back as JSON to the model. Adding a field is safe. ✓ Verified by grep: no code reads `.data.elapsed_ms`/`probe_channel` except tests.

  5. `elapsed_ms` overshoot: WAIT_TIMEOUT data.elapsed_ms = Date.now()-start which can exceed timeout by up to one interval (unconditional sleep). Pre-existing loop shape; harmless.

  6. Test quality: anti-vacuity assertions present (calls.attach === 3, calls.script > 0). Missing coverage: 
     - fallback returns false while CDP would have returned true — divergence untested (but semantically both run `!!document.querySelector` in the same DOM; ISOLATED world shares DOM, so equivalence holds; cross-origin iframe: both probe main frame only. Shadow DOM: neither pierces).
     - timeout < 3×interval misattribution (my edge test above) — untested in PR.
     - interval extreme values — untested.
     
  7. ensureAttached comment — verified accurate now.

  8. Claim 2 "ISOLATED → MAIN" — verified in code (run() then run("MAIN")).

  9. Claim 3: "有界重试 3 轮后走 failInteractive" — verified, and empirically calls.attach === 3.

  10. Claim 6: 1464/1464 verified, tsc verified, gates 156/0 verified. plasmo build — implementer claims it passes; I didn't run it (tsc --noEmit passed; plasmo build is heavier). List under "未能验证" or run it? It takes a while. I'll list as not-verified or run quickly in background. Let me just run it to be thorough — `cd chrome-extension && npm run build`? Check package.json scripts. Actually the harness says `plasmo build`. It can take ~30-60s. Let's run it.

  11. One more check: `assert.equal(r.data?.error_code, "CDP_ATTACH_FAILED")` in test 5 — verified passing. And classifyInteractiveFailure with fallbackCode "WAIT_PROBE_FAILED": when neither privileged nor attach-message nor invalid-selector matches, error_code would literally be "WAIT_PROBE_FAILED" — a code companion doesn't special-case in classifyError; classification falls to message substring. Any message reachability? Combined message always contains "selector probe failed on both channels — cdp: <msg>". If cdp msg is e.g. "No tab with given id 7." → contains "no tab with given id" → recoverable. If some weird error like "Protocol error" — not in recoverable list → non_recoverable (HALT). Old behavior would have been recoverable timeout. This is a possible classification flip for exotic errors, but isAttachFailureMessage is broad ("debugger|not attached|attach failed|cannot access|script injection|inspected target|target closed|chrome..."). Most transport errors match. Edge: "Tab 7 not found"? ensureAttached throws "No tab with given id 7." (matches recoverable "no tab with given id"). "The tab was closed" from scripting — combined with cdp msg "Debugger attach failed ... target closed"? "target closed" matches. Reasonable coverage. NIT-level.

  Also ADR-020 checklist — read the template briefly to apply it.

• 两个边缘假设均被实证。清理临时测试，跑 plasmo build 验证最后一条声明，并看 ADR-020 清单模板："build": "tsc --noEmit && plasmo build"
🔵 INFO   | Prepare to bundle the extension...
🔵 INFO   | Building for target: chrome-mv3
🔵 INFO   | Loaded environment variables from: []
🟢 DONE   | Finished in 10309ms!


• plasmo build passed (10.3s). Temp test file removed. Verify final repo state is clean (file restored, test file removed).

  ADR-020 check: declaration present in commit body (Surface n/a, L2-classes none, Compose none, Trust 无变化， Channel n/a). Change is a bugfix to an existing tool — no new tools/gates/UI → declaration adequate. P1-3 (evaluate integrity): touches browser-bridge but not evaluate/sanitizer/token bind — the new probe uses Runtime.evaluate with JSON.stringify interpolation, same pattern as before. No new injection vector (selector string is JSON.stringify'd; injected func receives selector as args). ✓

  One remaining P0 question: premature abort. Let me think once more about severity. Conditions for a regression vs old behavior: both CDP and scripting must fail simultaneously for 3 consecutive rounds, then recover — old code would succeed after recovery; new code aborts early with a recoverable CDP_ATTACH_FAILED. Since the error is recoverable and carries a truthful reason, the model can retry wait_for. The old code, in the same situation, would have kept waiting and succeeded. This is a real behavioral narrowing, but: (a) requires simultaneous two-channel failure lasting >3×interval yet <timeout — narrow; (b) the failure mode it trades away (spin to deadline with wrong attribution) was the actual production bug (6/6 failures). The threshold 3 is arbitrary but bounded; with default interval 500ms it tolerates ~1-1.5s of outage. Reasonable engineering tradeoff, disclosed. NIT, not blocking.

  The short-timeout misattribution: verified empirically. timeout=600/interval=500 both dead → "WAIT_TIMEOUT: timeout after 600ms waiting for selector" — original misattribution. Trigger condition: fewer than 3 probe rounds fit in the deadline (timeout < ~3×interval, e.g. timeout ≤ 1500 with default interval 500, or small timeout with small interval... wait with interval=100, timeout=600: rounds at 0,100,200,300,400,500 → 3rd failure at t=200 → abort properly. So condition is specifically when rounds fitting in timeout < 3, i.e. timeout < 3×interval roughly). With default interval=500 and timeout up to ~1500, misattribution possible. timeout=1000 is a plausible LLM-chosen value. Severity: bounded (waits at most `timeout` + one interval, then reports timeout). Same class as original bug but small magnitude. P1 but non-blocking? Hmm. The review prompt says "有任一 BLOCKING → REJECT". Is this blocking? It means the fix's core promise ("探测失败 → 真实错误码，绝不冒充超时") doesn't hold for a legitimate parameter range. The test file doesn't cover it. But the practical impact: misattribution magnitude ≤ ~2s, and production failure mode (default 15s timeout) is fixed. I'll rank it as a NIT (P1 severity but non-blocking)? The format distinguishes BLOCKING (P0|P1|P2) vs NITS. I need to decide: does this "必须修才能合"? Given the original bug was 100% failure at default timeout and this edge is a degraded-attribution corner with ≤2s cost, I'd say non-blocking but should be fixed (e.g., track lastProbeError and if the final round(s) were all failures with zero successes, report probe failure instead of WAIT_TIMEOUT). I'll put it as the top NIT with P1 label.

  Also the unconditional sleep after last round means elapsed can exceed timeout by one interval (observed: 1037ms for timeout=600). Pre-existing shape (old code identical), not introduced. Could mention in passing.

  Invalid-selector via fallback → CDP_ATTACH_FAILED misattribution: empirically verified. But note CDP-up path also mishandles invalid selector (exceptionDetails ignored → treated as absent) — pre-existing. The fallback drops first.error content. NIT.

  WRONG_ORIGIN on chrome:// — consistent with all other interactive tools via classifyInteractiveFailure; appropriate, and recoverable classification preserved. Verified by reading locator-classify.ts:85-104.

  Injected-function frequency: CDP-down scenario → ≤2 executeScript per round; 12s/500ms → ≤~46 injections over a wait. The func is side-effect-free (`!!document.querySelector`). Chrome doesn't rate-limit executeScript at this rate. Risk negligible. Verified by code reading (couldn't verify Chrome's production throttling behavior — mark inferred).

  probe_channel downstream: grep shows only tests reference it; companion treats tool result data as opaque JSON to the model. No shape assumptions broken. Verified.

  Claim-by-claim:
  1. probeSelectorExists dual-channel — verified code + mutation 1.
  2. scriptingProbeSelector injected func ISOLATED→MAIN — verified code lines 246-271 + test 4 asserts typeof func === "function".
  3. Bounded retry 3 rounds → failInteractive — verified + test 5 (calls.attach===3) + mutation 2.
  4. WAIT_TIMEOUT + probe_channel + elapsed_ms, "timeout" wording keeps recoverable — verified security.ts:984; old message also contained "timeout" → same classification. Consistent.
  5. Success data probe_channel; ensureAttached comment — verified.
  6. 1464/1464 ✓ (ran npm test), tsc ✓, plasmo build ✓ (ran, 10.3s), gates 156/0 ✓.
  7. Mutation claims — independently reproduced both, exactly matching (3 red; 1 red with fake reason after full 8000ms).

  Over-claiming check: commit says "与 companion 的 MAX_SAME_TOOL_RECOVERABLE_FAILURES=3 同量级" — verified the constant exists at adapter.ts:255 = 3, but semantics differ (cross-turn same-tool circuit breaker vs intra-wait probe rounds). "同量级" is a weak analogy, noted as nit. Also claim 3 says "瞬时故障（页面导航中）不再中断等待" — only true for outages < 3 rounds; slight over-statement but code comment itself says "a transient blip" which is accurate enough.

  Everything verified. Final verdict: no blockers → APPROVE_WITH_NITS.

  Write the review. Should I save it to a file? The prompt just asks for the output format. The existing convention shows reviews saved under docs/audit/reviews/. The prompt didn't ask to save. There are already pr-555-*.md files there (kimi, grok, claude). I'll just output the review in my reply; saving wasn't requested. Actually the deliverable is the review text itself. Keep to the format.

• 所有验证完成，工作区已还原干净。以下是评审结果。

  ---

  ## BLOCKING（必须修才能合）

  无。

  ## NITS（非阻塞）

  - **[P1] chrome-extension/src/background/browser-bridge.ts:1612-1630 — 短 timeout 下原归因错误仍然存在（已实证）**。`probeFailure` 只在 `probeFailures >= 3` 时赋值；当 deadline 先于第 3 次连续失败到来（`timeout < ~3×interval`，如 `timeout=1000, interval=500`，是 LLM 完全可能取的值），循环以 `probeFailure=null` 退出 → 报 `WAIT_TIMEOUT: timeout after 600ms waiting for selector "#app"` —— 正是本 PR 要消灭的「基础设施故障冒充 selector 超时」。我写临时用例实证（两通道全死、timeout=600/interval=500）：返回 `WAIT_TIMEOUT`，且因无条件 sleep 实际耗时 1037ms（超出 deadline 一个 interval，此点为既有循环形态）。非阻塞理由：幅值有界（≤2s）、默认参数（15s/500ms）下主路径正确。建议：循环内记录 `lastProbeError`，退出时若本轮等待**零次探测成功**且有 `lastProbeError`，走 `failInteractive` 而非 `WAIT_TIMEOUT`。
  - **[P1] browser-bridge.ts:256-270 — scripting 兜底丢弃注入错误细节，非法 selector 经兜底被误报为 `CDP_ATTACH_FAILED`（已实证）**。`run()` 把 `first.error`（含 Chrome 回报的 `SyntaxError: ... is not a valid selector`）当「不可用」静默吞掉，最终 throw 只有 "failed in ISOLATED and MAIN worlds"，于是 `classifyInteractiveFailure` 的 `isInvalidSelectorMessage` 永远匹配不到（`locator-classify.ts:70`）。实证：`selector:"###"` + CDP 挂 → 报 `CDP_ATTACH_FAILED: ... scripting: scripting selector probe failed in ISOLATED and MAIN worlds`。注意 CDP 通道对非法 selector 同样有误判（`Runtime.evaluate` 抛异常走 `exceptionDetails`，代码只看 `result.value === true` → 当作「不存在」），属既有缺陷，本 PR 未加重也未修。建议：`run()` 在 `first.error` 匹配 `isInvalidSelectorMessage` 时直接抛出带原文的错。
  - **[P2] browser-bridge.ts:59-62 与提交说明 — `MAX_WAIT_PROBE_FAILURES=3` 的「同量级」类比站不住（但不影响取值合理性）**。`MAX_SAME_TOOL_RECOVERABLE_FAILURES=3`（`companion/src/llm/adapter.ts:255`，已核实存在且值确为 3）是**跨轮次同一工具熔断**语义，与「单次等待内的探测重试」完全不同；把它当依据是 over-justification。另外「瞬时故障（页面导航中）不再中断等待」只在故障窗口 < 3×interval 时成立：`interval` 取小值（如 100ms）时容忍窗仅 ~300ms，导航中的等待可能被过早放弃——但放弃报的是 recoverable 真实错误码，模型可重试，属可接受的、已披露的形态转换。3 本身作为有界阈值合理，建议注释只陈述取舍、删掉类比。
  - **[P2] 测试缺口（不否现有 6 例的质量）**：未覆盖 (a) 上述短 timeout 误判路径；(b) CDP 曾返回 true 而兜底返回 false 的分歧（代码上两通道都在主 frame 同一 DOM 上求同一表达式，ISOLATED world 共享 DOM、均不穿 shadow root、均只看 main frame——我判断语义等价，但这是推断非实证）；(c) `interval` 极端值。现有 anti-vacuity 断言（`calls.attach === 3`、`calls.script > 0`、`typeof opts.func === "function"`）是实打实的，我的两轮独立突变均精确复现声明的红绿分布。

  ## 未能验证

  - Chrome 生产环境下对每 500ms 一次 `executeScript` 注入是否有实际限流/副作用：代码上注入函数是纯 `!!document.querySelector`（无副作用），12s 窗口最坏 ~46 次注入，判断无风险，但未在真 Chrome 上长跑验证。
  - 「页面导航 attach 需 2 秒才可用」这一具体场景在真机上的发生频率：代码层面 attach 失败即回落 scripting，两通道同时持续失败 >1.5s（默认 interval）才会过早放弃，推断该窗口很窄，未实机复现。

  ## 已核实为正确的声明

  - **声明 1（双通道探测）**：`browser-bridge.ts:282-305`，CDP 优先、失败回落 scripting、两通道皆死抛带双通道原因的错。**我独立重做突变 1**（去掉兜底）：恰好 3 红（兜底/注入函数/两条都死），与声明完全一致。
  - **声明 2（注入函数 ISOLATED→MAIN）**：`browser-bridge.ts:246-271`，`func: probe` + `args`，不用 `new Function`/`eval`；用例 4 断言 `typeof opts.func === "function"`。
  - **声明 3（有界重试 3 轮 → failInteractive）**：`browser-bridge.ts:1612-1621`；用例 5 断言 `calls.attach === 3`、错误码 `CDP_ATTACH_FAILED`、<1500ms 快速失败。**我独立重做突变 2**（退回吞异常空转）：恰好 1 红，且该用例空转完整 8017ms 后报假原因 `WAIT_TIMEOUT: timeout after 8000ms ...`——与声明逐字吻合。
  - **声明 4（WAIT_TIMEOUT 分类不变）**：`companion/src/security.ts:984` recoverable 子串含 "timeout"；旧文案 "Timeout waiting for selector" 与新文案 "timeout after Nms ..." 均命中 → 均为 recoverable，分类确实一致。chrome:// 场景经 `classifyInteractiveFailure`（`locator-classify.ts:90`）报 `WRONG_ORIGIN`——与 click/type 等所有交互工具同一归因路径，恰当且一致。
  - **声明 5（成功 data 加 probe_channel）**：grep 全仓，除测试外无任何下游代码读取 `wait_for` 的 data 字段（companion 只经 `wait-for-params.ts` 规范化入参，结果 data 作为不透明 JSON 回给模型），不破坏形状假设。`ensureAttached` 注释已如实化（`browser-bridge.ts:228-230`）。
  - **声明 6（回归全绿）**：我实跑 `npm test` → **1464/1464 pass**；`tsc --noEmit` → 干净；`npm run build`（含 plasmo build）→ DONE 10.3s；`test-package-gates.sh` → **156/0**。
  - **声明 7（两轮突变验证）**：见声明 1、3，我独立复现，红绿分布与失败形态均与声明精确一致。
  - **ADR-020**：提交体含完整能力声明（Surface n/a / L2-classes none / Compose none / Trust 无变化 / Channel n/a）。改动为既有工具的错误传播修复，无新工具/门禁/UI，声明充分；不触碰 P1 watchlist 的 evaluate 完整性路径（selector 经 `JSON.stringify` 插值/注入 args，无新注入面）。突变后文件已 `git checkout` 还原，临时测试文件已删除，工作区干净。

  VERDICT: APPROVE_WITH_NITS

To resume this session: kimi -r session_d3d8761c-2cdf-49b2-a526-233ef26221eb
KIMI_EXIT=0
