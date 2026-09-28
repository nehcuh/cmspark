import test from "node:test"
import assert from "node:assert/strict"

/**
 * #554 — wait_for 的 selector 分支。
 *
 * 实机根因：探测走 CDP，探测失败时异常被空 catch 吞掉，循环空转到 deadline，
 * 再报一个**归因错误**的「Timeout waiting for selector」——把基础设施故障说成
 * 页面元素不存在。
 *
 * 这些用例把修复钉住：
 *  - 探测要有 scripting 兜底（纯 DOM 布尔查询不需要 debugger）
 *  - **等待窗口必须仍是整个 deadline**（dual-review pi：轮数预算会把容错窗口
 *    从 15s 塌到 ~2×interval，慢导航被过早放弃 —— 那是能力回归）
 *  - 循环结束时分清「一次都没探成功」与「探成功过、只是条件不满足」
 *  - 失败要带真实原因，绝不冒充元素缺失，也不能变成整轮终止
 */

type ProbeCalls = { attach: number; cdp: number; script: number; scriptOpts: any[] }

async function withBridge(
  stub: {
    attach?: () => Promise<void>
    send?: (method: string) => Promise<any>
    scriptExec?: (opts: any) => Promise<any>
  },
  fn: (bridge: any, calls: ProbeCalls) => Promise<void>,
): Promise<void> {
  const { BrowserBridge } = await import("../src/background/browser-bridge")
  const previous = (globalThis as any).chrome
  const calls: ProbeCalls = { attach: 0, cdp: 0, script: 0, scriptOpts: [] }
  ;(globalThis as any).chrome = {
    tabs: {
      get: async (id: number) => ({ id, url: "https://example.com/page" }),
      query: async () => [],
    },
    debugger: {
      onDetach: { addListener() {} },
      attach: async () => {
        calls.attach += 1
        if (stub.attach) await stub.attach()
      },
      sendCommand: async (_target: any, method: string) => {
        calls.cdp += 1
        return stub.send ? stub.send(method) : { result: { value: false } }
      },
    },
    scripting: {
      executeScript: async (opts: any) => {
        calls.script += 1
        calls.scriptOpts.push(opts)
        return stub.scriptExec ? stub.scriptExec(opts) : [{ result: false }]
      },
    },
  }
  try {
    await fn(new BrowserBridge(), calls)
  } finally {
    if (previous === undefined) delete (globalThis as any).chrome
    else (globalThis as any).chrome = previous
  }
}

/** 探测返回 true 的 CDP 桩（元素存在）。 */
const cdpTrue = async (m: string) => (m === "Runtime.evaluate" ? { result: { value: true } } : {})
/** 探测返回 false 的 CDP 桩（元素不存在）。 */
const cdpFalse = async (m: string) => (m === "Runtime.evaluate" ? { result: { value: false } } : {})
/** 让 scripting 通道不可用（注入失败 → run() 返回 undefined → 抛）。 */
const scriptingUnusable = async () => [{ error: "scripting blocked" }]
/** 两条通道都死：CDP attach 抛、scripting 注入失败。 */
const bothDead = {
  attach: async () => {
    throw new Error("Debugger attach failed for tab 7: transient")
  },
  scriptExec: scriptingUnusable,
}

test("#554 selector 存在 + 期望 visible → 成功，且走 CDP 通道", async () => {
  await withBridge({ send: cdpTrue }, async (bridge, calls) => {
    const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 2000 })
    assert.equal(r.success, true)
    assert.equal(r.data.probe_channel, "cdp")
    assert.ok(calls.cdp > 0, "anti-vacuity: CDP 必须真的被调用过")
  })
})

test("#554 元素不存在 + state=hidden → 立即成功（修复前此处会挂到超时）", async () => {
  await withBridge({ send: cdpFalse }, async (bridge) => {
    const started = Date.now()
    const r = await bridge.execute("wait_for", { tabId: 7, selector: "#nope", state: "hidden", timeout: 5000 })
    const elapsed = Date.now() - started
    assert.equal(r.success, true, "'不存在' 就满足 'hidden'，必须立即成功")
    assert.ok(elapsed < 2000, `不该等待到 deadline（实际 ${elapsed}ms）`)
  })
})

test("#554 CDP 不可用时回落 chrome.scripting（fallback 真的被实现）", async () => {
  await withBridge({ ...bothDead, scriptExec: async () => [{ result: true }] }, async (bridge, calls) => {
    const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 2000 })
    assert.equal(r.success, true, "CDP 挂了但 DOM 可读 → 必须仍然成功")
    assert.equal(r.data.probe_channel, "scripting")
    assert.ok(calls.attach > 0, "anti-vacuity: 必须先真的试过 CDP")
    assert.ok(calls.script > 0, "anti-vacuity: 必须真的用了 scripting 兜底")
  })
})

test("#554 scripting 探测用注入函数（不吃页面 CSP），不用 new Function", async () => {
  await withBridge({ ...bothDead, scriptExec: async () => [{ result: true }] }, async (bridge, calls) => {
    await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 2000 })
    const opts = calls.scriptOpts[0]
    assert.equal(typeof opts.func, "function", "必须注入函数，而非源码字符串")
    assert.match(String(opts.func), /querySelector/)
    assert.equal(opts.args?.[0], "#app")
  })
})

test("#554 慢恢复：探测前几轮失败后恢复 → 必须仍然等到（不许因轮数过早放弃）", async () => {
  // dual-review pi 的回归点：轮数预算会把容错窗口从整个 deadline 塌到 ~2×interval。
  // 这里让 attach 前 3 次失败、之后成功；元素始终存在 → 必须成功。
  let attachTries = 0
  await withBridge(
    {
      attach: async () => {
        attachTries += 1
        if (attachTries <= 3) throw new Error("Debugger attach failed for tab 7: transient")
      },
      scriptExec: scriptingUnusable,
      send: cdpTrue,
    },
    async (bridge, calls) => {
      const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 3000, interval: 20 })
      assert.equal(r.success, true, "瞬时故障恢复后必须仍然成功（等待窗口 = 整个 deadline）")
      assert.ok(attachTries >= 4, `必须在失败数轮后仍继续重试（实际尝试 ${attachTries} 次）`)
      assert.equal(calls.script > 0, true, "anti-vacuity: 确实试过兜底通道")
    },
  )
})

test("#554 两条通道都死 → 报真实原因，绝不冒充「Timeout waiting for selector」", async () => {
  await withBridge(
    {
      attach: async () => {
        throw new Error("Cannot access a chrome:// URL (tab 7)")
      },
      scriptExec: async () => {
        throw new Error("Cannot access contents of the page")
      },
    },
    async (bridge, calls) => {
      const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 300, interval: 30 })
      assert.equal(r.success, false)
      assert.ok(!/Timeout waiting for selector/.test(r.error), `不得再报 selector 超时，实际: ${r.error}`)
      assert.match(r.error, /Cannot access|attach failed/i, "必须带上真实原因")
      // 消息含 "Cannot access" → isAttachFailureMessage 命中 → CDP_ATTACH_FAILED
      // （不是 WRONG_ORIGIN：那个只由 tab URL 是否 privileged 决定）
      assert.equal(r.data?.error_code, "CDP_ATTACH_FAILED")
      assert.ok(calls.attach > 0, "anti-vacuity: 确实试过 CDP 通道")
      assert.ok(calls.script > 0, "anti-vacuity: 确实试过 scripting 通道")
    },
  )
})

test("#554 短 timeout（塞不下多轮）也不得把探测失败冒充成 WAIT_TIMEOUT", async () => {
  // dual-review kimi 的边界：timeout ≈ 1–2×interval 时循环可能带着「从未探成功」
  // 退出。判定必须基于「有没有成功过」，而不是数轮数。
  await withBridge(bothDead, async (bridge) => {
    const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 1000, interval: 500 })
    assert.equal(r.success, false)
    assert.notStrictEqual(r.data?.error_code, "WAIT_TIMEOUT",
      "一次都没探成功时不得报超时 —— 那是 #554 要消灭的归因错误")
    assert.match(r.error, /Debugger attach failed|scripting/i, "必须带上真实原因")
  })
})

test("#554 真超时（探测正常、条件始终不满足）→ WAIT_TIMEOUT", async () => {
  await withBridge({ send: cdpFalse }, async (bridge) => {
    const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 300, interval: 50 })
    assert.equal(r.success, false)
    assert.equal(r.data?.error_code, "WAIT_TIMEOUT")
    assert.match(r.error, /timeout/i)
    assert.equal(r.data?.probe_channel, "cdp")
  })
})

test("#554 两通道都有返回值时以 CDP 为准", async () => {
  await withBridge(
    { send: cdpTrue, scriptExec: async () => [{ result: false }] },
    async (bridge) => {
      const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 2000 })
      assert.equal(r.success, true, "CDP 说存在、兜底说没有 → 以 CDP 为准（既有优先级）")
      assert.equal(r.data.probe_channel, "cdp")
    },
  )
})

test("#554 CDP 页面异常（非法 selector）算通道失败，不得折成「不存在」", async () => {
  // dual-review claude + pi 各自独立指出：exceptionDetails 曾被折算成 exists=false，
  // 于是非法 selector 被当成「元素不存在」并返回成功，而新的 probe_channel 还为它背书。
  await withBridge(
    {
      send: async (m: string) =>
        m === "Runtime.evaluate"
          ? { exceptionDetails: { text: "SyntaxError", exception: { description: "Failed to execute 'querySelector' on 'Document': '###' is not a valid selector." } } }
          : {},
      scriptExec: async () => {
        throw new Error("Failed to execute 'querySelector' on 'Document': '###' is not a valid selector.")
      },
    },
    async (bridge) => {
      const r = await bridge.execute("wait_for", { tabId: 7, selector: "###", state: "hidden", timeout: 300, interval: 30 })
      assert.equal(r.success, false, "非法 selector 不得被当成「元素不存在」而成功")
      assert.ok(!/Timeout waiting for selector/.test(r.error), `不得报 selector 超时，实际: ${r.error}`)
      assert.equal(r.data?.error_code, "INVALID_SELECTOR", "应报 INVALID_SELECTOR 让模型改选择器")
    },
  )
})

test("#554 CDP 页面异常时仍回落 scripting（异常 ≠ 元素不存在）", async () => {
  await withBridge(
    {
      send: async (m: string) => (m === "Runtime.evaluate" ? { exceptionDetails: { text: "SyntaxError" } } : {}),
      scriptExec: async () => [{ result: true }],
    },
    async (bridge) => {
      const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 2000 })
      assert.equal(r.success, true, "CDP 抛页面异常但 DOM 可读 → 必须靠兜底成功")
      assert.equal(r.data.probe_channel, "scripting")
    },
  )
})
