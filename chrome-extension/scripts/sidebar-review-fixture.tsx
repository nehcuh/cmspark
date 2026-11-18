import { createRoot } from "react-dom/client"
import { App } from "../src/sidepanel/App"

const sent: unknown[] = []
const listeners = new Set<(message: unknown) => void>()
const page = window as Window & {
  sent: unknown[]
  emitRuntime: (message: unknown) => void
  companionStore: { externalKey: string; config?: Record<string, unknown> }
  __connection: string
  chrome: typeof chrome
}
page.sent = sent
page.emitRuntime = (message) => { listeners.forEach((fn) => fn(message)) }
page.companionStore = { externalKey: "" }
page.__connection = "disconnected"
page.chrome = {
  runtime: {
    sendMessage: (msg: { type?: string; config?: Record<string, unknown> }, cb?: (value: unknown) => void) => {
      sent.push(msg)
      if (msg?.type === "config.set" && msg.config) {
        page.companionStore.config = { ...(page.companionStore.config || {}), ...msg.config }
      }
      const status = page.__connection || "disconnected"
      if (msg?.type === "getStatus") cb?.({ connectionState: status })
      else cb?.({ ok: true, connectionState: status })
      return Promise.resolve({ ok: true, connectionState: status })
    },
    onMessage: {
      addListener(fn: (message: unknown) => void) { listeners.add(fn) },
      removeListener(fn: (message: unknown) => void) { listeners.delete(fn) },
    },
    connect: () => ({
      onMessage: { addListener() {}, removeListener() {} },
      onDisconnect: { addListener() {}, removeListener() {} },
      postMessage() {},
      disconnect() {},
    }),
    getURL: (path: string) => path,
    lastError: null,
  },
  storage: {
    local: {
      get: (_key: unknown, cb?: (value: Record<string, unknown>) => void) => cb?.({}),
      set: (_value: unknown, cb?: () => void) => cb?.(),
    },
  },
  tabs: {
    query: (_query: unknown, cb?: (value: unknown[]) => void) => cb?.([]),
    create: () => Promise.resolve({}),
    onActivated: { addListener() {}, removeListener() {} },
    onUpdated: { addListener() {}, removeListener() {} },
  },
} as unknown as typeof chrome
createRoot(document.getElementById("root")!).render(<App />)
