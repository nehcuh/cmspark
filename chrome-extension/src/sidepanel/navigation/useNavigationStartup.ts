import { useEffect, useRef } from "react"
import { useAgentStore } from "../store/agentStore"
import { bumpListGeneration } from "./project-list-model"
import { commitStartupNavigation } from "./startup-destination"

const LAST_THREAD_KEY = "cmspark.navigation.lastThreadId"

function navigationStorage(): chrome.storage.LocalStorageArea | null {
  const local = globalThis.chrome?.storage?.local
  if (!local || typeof local.get !== "function" || typeof local.set !== "function") return null
  return local
}

/** The only reader of the last-thread key. Callbacks carry the generation they started with. */
export function useNavigationStartup() {
  const { state, dispatch } = useAgentStore()
  const generation = useRef(0)
  const needsTranscript = useRef(true)
  const threadsRef = useRef(state.threads)
  const activeRef = useRef(state.activeThreadId)
  const connectionRef = useRef(state.connectionState)
  const listArrivedRef = useRef(state.threadListArrived)
  threadsRef.current = state.threads
  activeRef.current = state.activeThreadId
  connectionRef.current = state.connectionState
  listArrivedRef.current = state.threadListArrived
  useEffect(() => {
    const storage = navigationStorage()
    const active = state.threads.find(thread => thread.id === state.activeThreadId && !thread.trashed_at)
    if (!storage || !active || state.navigationRemembered === active.id) return
    dispatch({ type: "REMEMBER_THREAD", threadId: active.id })
    storage.set({ [LAST_THREAD_KEY]: active.id })
  }, [state.activeThreadId, state.navigationRemembered, state.threads])
  useEffect(() => {
    const storage = navigationStorage()
    if (!storage) return
    if (state.connectionState !== "connected") needsTranscript.current = true
    const commitGeneration = bumpListGeneration(generation.current)
    generation.current = commitGeneration
    storage.get(LAST_THREAD_KEY, stored => {
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
        needsTranscript: needsTranscript.current,
      })
      if ("reason" in decision) return
      const live = threadsRef.current.find(thread => thread.id === activeRef.current && !thread.trashed_at)
      if (live && remembered !== live.id) {
        dispatch({ type: "REMEMBER_THREAD", threadId: live.id })
        storage.set({ [LAST_THREAD_KEY]: live.id })
        return
      }
      if (connectionRef.current === "connected" && listArrivedRef.current) needsTranscript.current = false
      dispatch({ type: "COMMIT_NAVIGATION", decision })
      if (typeof decision.selectThread === "string") {
        chrome.runtime.sendMessage({ type: "thread.select", threadId: decision.selectThread })
      }
      storage.set({ [LAST_THREAD_KEY]: decision.remembered })
    })
    return () => { generation.current++ }
  }, [state.connectionState, state.threadListEpoch, state.threadListArrived])
}
