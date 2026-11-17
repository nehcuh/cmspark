import { useEffect } from "react"
import { createRoot } from "react-dom/client"
import { AgentStoreProvider, initialState, useAgentStore } from "../src/sidepanel/store/agentStore"
import { useNavigationStartup } from "../src/sidepanel/navigation/useNavigationStartup"
import { useWebSocket } from "../src/sidepanel/hooks/useWebSocket"

function Harness() {
  useNavigationStartup()
  useWebSocket()
  const { state, dispatch } = useAgentStore()
  useEffect(() => {
    const pageWindow = window as any
    pageWindow.fixtureState = state
    pageWindow.dispatchUI = dispatch
  })
  return <p data-testid="transcript">{state.messages.map(message => message.content).join("\n")}</p>
}

const runtimeListeners = new Set<(message: any) => void>()
const pageWindow = window as any
pageWindow.sent = []
pageWindow.storageWaiters = []
pageWindow.storageGeneration = {}
pageWindow.storageSeed = {}
pageWindow.emitRuntime = (message: any) => { for (const listener of runtimeListeners) listener(message) }
pageWindow.chrome = {
  runtime: {
    sendMessage: (message: any) => { pageWindow.sent.push(message); return Promise.resolve({ ok: true }) },
    connect: () => ({ disconnect() {} }),
    onMessage: {
      addListener: (listener: (message: any) => void) => runtimeListeners.add(listener),
      removeListener: (listener: (message: any) => void) => runtimeListeners.delete(listener),
    },
  },
  storage: {
    local: {
      get: (key: string | string[], callback: (value: Record<string, unknown>) => void) => {
        const name = typeof key === "string" ? key : "unknown"
        const generation = pageWindow.storageGeneration[name] || 0
        pageWindow.storageGeneration[name] = generation + 1
        pageWindow.storageWaiters.push({ key: name, generation, callback })
      },
      set: (value: Record<string, unknown>, callback?: () => void) => {
        pageWindow.storageSeed = { ...pageWindow.storageSeed, ...value }
        callback?.()
      },
      remove: (key: string, callback?: () => void) => {
        delete pageWindow.storageSeed[key]
        callback?.()
      },
    },
  },
}
;(globalThis as any).chrome = pageWindow.chrome

createRoot(document.getElementById("root")!).render(
  <AgentStoreProvider initialState={{ ...initialState, connectionState: "connected", threads: [] }}>
    <Harness />
  </AgentStoreProvider>,
)
