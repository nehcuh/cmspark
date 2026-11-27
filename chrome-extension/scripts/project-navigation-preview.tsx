import { useEffect } from "react"
import { createRoot } from "react-dom/client"
import { AgentStoreProvider, initialState, useAgentStore } from "../src/sidepanel/store/agentStore"
import { WorkspaceFrame } from "../src/sidepanel/components/WorkspaceFrame"
import { ContextPanelHostProvider } from "../src/sidepanel/components/ContextPanelHost"
import { workspaceCSS } from "../src/sidepanel/ui/workspace-styles"
import type { CapabilityLevel } from "../src/sidepanel/types"

function Bridge() {
  const { state, dispatch } = useAgentStore()
  useEffect(() => {
    ;(window as any).fixtureState = state
    ;(window as any).dispatchUI = dispatch
  })
  const level = ((window as any).__CMSPARK_LEVEL || "chat") as CapabilityLevel
  return <ContextPanelHostProvider capabilityLevel={level}>
    <WorkspaceFrame level={level} top={() =>
      <button className="cm-navigation-toggle" onClick={() => window.dispatchEvent(new Event("cmspark:toggle-navigation"))}>打开工作区导航</button>
    }>{null}</WorkspaceFrame>
  </ContextPanelHostProvider>
}

const demoThreads = [{
  id: "demo-0",
  alias: "笔记",
  created_at: "2026-11-17T00:00:00.000Z",
  updated_at: "2026-11-17T00:00:00.000Z",
  config_override: {},
  tool_whitelist: null,
  pinned_tabs: [],
  active_skill_ids: [],
}]

const runtimeListeners = new Set<(message: any) => void>()
const pageWindow = window as any
pageWindow.demoThreads = demoThreads
pageWindow.sent = []
pageWindow.storageWaiters = []
pageWindow.storageGeneration = {}
pageWindow.storageSeed = {}
pageWindow.emitRuntime = (message: any) => { for (const listener of runtimeListeners) listener(message) }
pageWindow.chrome = {
  runtime: {
    sendMessage: (message: any) => { pageWindow.sent.push(message); return Promise.resolve({ ok: true }) },
    onMessage: {
      addListener: (listener: (message: any) => void) => runtimeListeners.add(listener),
      removeListener: (listener: (message: any) => void) => runtimeListeners.delete(listener),
    },
  },
  storage: {
    local: {
      get: (key: string, callback: (value: Record<string, unknown>) => void) => {
        const name = typeof key === "string" ? key : "unknown"
        const generation = pageWindow.storageGeneration[name] || 0
        pageWindow.storageGeneration[name] = generation + 1
        pageWindow.storageWaiters.push({ key: name, generation, callback })
      },
      set: (value: Record<string, unknown>, callback?: () => void) => {
        pageWindow.storageSeed = { ...pageWindow.storageSeed, ...value }
        callback?.()
      },
    },
  },
}
;(globalThis as any).chrome = pageWindow.chrome

createRoot(document.getElementById("root")!).render(
  <AgentStoreProvider initialState={{ ...initialState, connectionState: "connected", threads: [] }}>
    <div className="cm-workspace">
      <style>{workspaceCSS}</style>
      <Bridge />
    </div>
  </AgentStoreProvider>,
)
