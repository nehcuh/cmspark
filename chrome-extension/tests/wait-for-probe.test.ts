import test from "node:test"
import assert from "node:assert/strict"

/**
 * #554 — wait_for 的 selector 分支。
 *
 * 实机 6/6 失败的根因：探测走 CDP，CDP 不可用时异常被空 catch 吞掉，
 * 循环空转到 deadline，再报一个**归因错误**的「Timeout waiting for selector」
 * —— 把基础设施故障说成页面元素不存在。
 *
 * 这些用例把修复钉住：探测要有 scripting 兜底；两条通道都死了要报真实原因
 * 而不是冒充元素缺失；真超时要带 WAIT_TIMEOUT 码。
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
      attach: async (target: any) => {
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

test("#554 selector 存在 + 期望 visible → 成功，且走 CDP 通道", async () => {
  await withBridge(
    { send: async (m) => (m === "Runtime.evaluate" ? { result: { value: true } } : {}) },
    async (bridge, calls) => {
      const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 2000 })
      assert.equal(r.success, true)
      assert.equal(r.data.probe_channel, "cdp")
      assert.ok(calls.cdp > 0, "anti-vacuity: CDP 必须真的被调用过")
    },
  )
})

test("#554 元素不存在 + state=hidden → 立即成功（修复前此处会挂到超时）", async () => {
  await withBridge(
    // 探针工作正常，只是元素不存在 → querySelector 返回 null → false
    { send: async (m) => (m === "Runtime.evaluate" ? { result: { value: false } } : {}) },
    async (bridge) => {
      const started = Date.now()
      const r = await bridge.execute("wait_for", { tabId: 7, selector: "#nope", state: "hidden", timeout: 5000 })
      const elapsed = Date.now() - started
      assert.equal(r.success, true, "'不存在' 就满足 'hidden'，必须立即成功")
      assert.ok(elapsed < 2000, `不该等待到 deadline（实际 ${elapsed}ms）`)
    },
  )
})

test("#554 CDP 不可用时回落 chrome.scripting（fallback 真的被实现）", async () => {
  await withBridge(
    {
      // ensureAttached 的 attach 失败 —— 实机就是这个形态
      attach: async () => {
        throw new Error("Another debugger is already attached to the tab")
      },
      scriptExec: async () => [{ result: true }],
    },
    async (bridge, calls) => {
      const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 2000 })
      assert.equal(r.success, true, "CDP 挂了但 DOM 可读 → 必须仍然成功")
      assert.equal(r.data.probe_channel, "scripting")
      assert.ok(calls.attach > 0, "anti-vacuity: 必须先真的试过 CDP（attach 失败即在此中断）")
      assert.ok(calls.script > 0, "anti-vacuity: 必须真的用了 scripting 兜底")
    },
  )
})

test("#554 scripting 探测用注入函数（不吃页面 CSP），不用 new Function", async () => {
  await withBridge(
    {
      attach: async () => {
        throw new Error("Debugger attach failed")
      },
      scriptExec: async () => [{ result: true }],
    },
    async (bridge, calls) => {
      await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 2000 })
      const opts = calls.scriptOpts[0]
      assert.equal(typeof opts.func, "function", "必须注入函数，而非源码字符串")
      assert.match(String(opts.func), /querySelector/)
      assert.equal(opts.args?.[0], "#app")
    },
  )
})

test("#554 两条通道都死 → 报真实原因，绝不冒充「Timeout waiting for selector」，且立即返回", async () => {
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
      const started = Date.now()
      const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 8000, interval: 30 })
      const elapsed = Date.now() - started
      assert.equal(r.success, false)
      assert.ok(!/Timeout waiting for selector/.test(r.error), `不得再报 selector 超时，实际: ${r.error}`)
      assert.match(r.error, /Cannot access|attach failed/i, "必须带上真实原因")
      // 消息含 "Cannot access" → isAttachFailureMessage 命中 → CDP_ATTACH_FAILED
      // （不是 WRONG_ORIGIN：那个只由 tab URL 是否 privileged 决定）
      assert.equal(r.data?.error_code, "CDP_ATTACH_FAILED")
      assert.ok(elapsed < 1500, `基础设施故障必须快速失败，不该空转到 deadline（实际 ${elapsed}ms）`)
      assert.equal(calls.attach, 3, "有界重试：恰好 3 轮后放弃，不是无限空转")
      assert.ok(calls.attach > 0, "anti-vacuity: 确实试过 CDP 通道")
      assert.ok(calls.script > 0, "anti-vacuity: 确实试过 scripting 通道")
    },
  )
})

test("#554 真超时（条件始终不满足）→ WAIT_TIMEOUT，且不冒充元素缺失", async () => {
  await withBridge(
    { send: async (m) => (m === "Runtime.evaluate" ? { result: { value: false } } : {}) },
    async (bridge) => {
      const r = await bridge.execute("wait_for", { tabId: 7, selector: "#app", timeout: 300, interval: 50 })
      assert.equal(r.success, false)
      assert.equal(r.data?.error_code, "WAIT_TIMEOUT")
      assert.match(r.error, /timeout/i)
      assert.equal(r.data?.probe_channel, "cdp")
    },
  )
})
