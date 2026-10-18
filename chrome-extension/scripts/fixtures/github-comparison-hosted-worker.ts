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
chrome.runtime.onInstalled.addListener(() => {})
;(globalThis as any).cmspark464 = {
  async createTab() {
    if (ownedTab !== undefined) throw new Error("OWNED_TAB_ALREADY_CREATED")
    const tab = await chrome.tabs.create({ url: URL, active: true })
    if (!Number.isSafeInteger(tab.id)) throw new Error("OWNED_TAB_UNAVAILABLE")
    ownedTab = tab.id
    return ownedTab
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
