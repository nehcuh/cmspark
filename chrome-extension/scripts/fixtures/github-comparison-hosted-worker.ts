// Hosted-only test entry. Real Chrome APIs and production implementations.
import { BrowserBridge } from "../../src/background/browser-bridge"
import { PageSanitizer } from "../../src/background/page-sanitizer"
import { WSClient } from "../../src/background/ws-client"

const URL = "https://github.com/nehcuh/cmspark/compare/30f4aa867ca1b9970f0fa4d72fc993a13af49972..e40857d70c58cdd50ad52f0f78efbce35ffbac48"
const bridge = new BrowserBridge(new PageSanitizer())
let ownedTab: number | undefined
let client: WSClient | undefined
let configured = false
let connected = false
let navigationStarted = false
chrome.runtime.onInstalled.addListener(() => {})
;(globalThis as any).cmspark464 = {
  async createTab() {
    if (ownedTab !== undefined) throw new Error("OWNED_TAB_ALREADY_CREATED")
    const tab = await chrome.tabs.create({ url: "about:blank", active: true })
    if (!Number.isSafeInteger(tab.id)) throw new Error("OWNED_TAB_UNAVAILABLE")
    ownedTab = tab.id
    return ownedTab
  },
  async navigateToPage(timeoutMs: number) {
    if (ownedTab === undefined || navigationStarted || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new Error("INVALID_OWNED_NAVIGATION")
    navigationStarted = true
    const tabId = ownedTab, deadline = Date.now() + timeoutMs
    return await new Promise<boolean>((resolve, reject) => {
      let settled = false, updateSucceeded = false, completeObserved = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (okay: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(onUpdated)
        chrome.tabs.onRemoved.removeListener(onRemoved)
        if (okay) resolve(true)
        else reject(new Error("OWNED_NAVIGATION_REFUSED"))
      }
      const check = () => {
        if (Date.now() >= deadline) finish(false)
        else if (updateSucceeded && completeObserved) finish(true)
      }
      const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
        if (id !== tabId || settled) return
        if (Date.now() >= deadline) { finish(false); return }
        if (tab.id !== tabId || tab.url !== URL || tab.status !== "complete") completeObserved = false
        else if (info.status === "complete") completeObserved = true
        check()
      }
      const onRemoved = (id: number) => { if (id === tabId) finish(false) }
      try {
        chrome.tabs.onUpdated.addListener(onUpdated)
        chrome.tabs.onRemoved.addListener(onRemoved)
        timer = setTimeout(() => finish(false), timeoutMs)
        if (Date.now() >= deadline) { finish(false); return }
        Promise.resolve(chrome.tabs.update(tabId, { url: URL })).then(tab => {
          if (settled) return
          if (tab?.id !== tabId) { finish(false); return }
          updateSucceeded = true
          check()
        }, () => finish(false))
      } catch { finish(false) }
    })
  },
  async pageTarget() {
    if (ownedTab === undefined) throw new Error("OWNED_TAB_UNAVAILABLE")
    const matches = (await chrome.debugger.getTargets()).filter(t => t.tabId === ownedTab && t.type === "page")
    if (matches.length !== 1 || !/^[A-Za-z0-9-]+$/.test(matches[0].id)) throw new Error("OWNED_TARGET_UNAVAILABLE")
    return matches[0].id
  },
  configure(port: number, secret: string) {
    if (configured || !Number.isSafeInteger(ownedTab) || !Number.isInteger(port) || port < 1024 || port > 65535 || !/^[a-f0-9]{64}$/.test(secret)) throw new Error("INVALID_OWNED_SETUP")
    configured = true
    client = new WSClient({ url: `ws://127.0.0.1:${port}`, onStateChange: state => { connected = state === "connected" },
      onMessage: async msg => {
        if (msg?.type !== "tool.execute" || msg.tool_name !== "get_page_text" || msg.params?.tabId !== ownedTab || typeof msg.params !== "object" || Array.isArray(msg.params) ||
          Object.keys(msg.params).length !== 1 || typeof msg.tool_call_id !== "string" || !/^owned464-[0-9]+$/.test(msg.tool_call_id)) return
        try {
          const result = await bridge.execute("get_page_text", { tabId: ownedTab })
          client!.send({ type: "tool.result", tool_call_id: msg.tool_call_id, result })
        } catch { client!.send({ type: "tool.result", tool_call_id: msg.tool_call_id, result: { success: false, error: "OWNED_PAGE_READ_FAILED" } }) }
      },
    })
    client.setSecret(secret)
    return true
  },
  status() { return { configured, connected } },
}
