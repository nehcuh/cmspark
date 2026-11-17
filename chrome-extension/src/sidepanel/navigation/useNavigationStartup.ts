import { useEffect, useRef } from "react"
import { useAgentStore } from "../store/agentStore"
import { bumpListGeneration } from "./project-list-model"
import { commitStartupNavigation } from "./startup-destination"

const LAST_THREAD_KEY = "cmspark.navigation.lastThreadId"

/** The only reader of the last-thread key. Callbacks carry the generation they started with. */
export function useNavigationStartup() {
  const { state, dispatch } = useAgentStore()
  const generation = useRef(0)
  const threadsRef = useRef(state.threads)
  const activeRef = useRef(state.activeThreadId)
  const connectionRef = useRef(state.connectionState)
  const listArrivedRef = useRef(state.threadListArrived)
  threadsRef.current = state.threads
  activeRef.current = state.activeThreadId
  connectionRef.current = state.connectionState
  listArrivedRef.current = state.threadListArrived
  useEffect(() => {
    const commitGeneration = bumpListGeneration(generation.current)
    generation.current = commitGeneration
    chrome.storage.local.get(LAST_THREAD_KEY, stored => {
      const value = stored?.[LAST_THREAD_KEY]
      const remembered = typeof value === "string" ? value : null
      const decision = commitStartupNavigation({
        commitGeneration,
        currentGeneration: generation.current,
        rememberedThreadId: remembered,
        threads: threadsRef.current,
        activeThreadId: activeRef.current,
        connection: connectionRef.current,
        listArrived: listArrivedRef.current,
      })
      if ("reason" in decision) return
      dispatch({ type: "COMMIT_NAVIGATION", decision })
      if (typeof decision.selectThread === "string") chrome.runtime.sendMessage({ type: "thread.select", threadId: decision.selectThread })
      chrome.storage.local.set({ [LAST_THREAD_KEY]: decision.remembered })
    })
  }, [state.connectionState, state.threadListEpoch])
}
