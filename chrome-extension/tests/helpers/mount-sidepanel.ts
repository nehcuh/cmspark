import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import vm from "node:vm"
import * as store from "../../src/sidepanel/store/agentStore"
export type Frame = { type: string; [key: string]: unknown }

export function mountPanel(initial = store.initialState) {
  let state = initial
  const dispatch = (action: store.AgentAction) => { state = store.agentReducer(state, action) }
  const requests: Frame[] = []
  const notices: string[] = []
  let listener: (frame: Frame) => void
  const chrome = {
    runtime: {
      onMessage: { addListener(fn: typeof listener) { listener = fn } },
      sendMessage(frame: Frame) { requests.push(frame) },
      connect: () => ({ disconnect() {} }),
    },
    storage: { local: { get() {} } },
  }

  // Mount the compiled hook with its real message classifiers, reducer and effect dependencies.
  const refs: Array<{ current: unknown }> = []
  const dependencies: Array<unknown[] | undefined> = []
  const effects: Array<() => void> = []
  let refIndex = 0, effectIndex = 0
  const react = {
    useRef(value: unknown) { return refs[refIndex++] ??= { current: value } },
    useEffect(fn: () => void, deps?: unknown[]) {
      const previous = dependencies[effectIndex]
      dependencies[effectIndex++] = deps
      if (!previous || !deps || deps.length !== previous.length || deps.some((v, i) => !Object.is(v, previous[i]))) {
        effects.push(fn)
      }
    },
  }
  const filename = resolve(__dirname, "../../src/sidepanel/hooks/useWebSocket.js")
  const requireDependency = createRequire(filename)
  const hook = { exports: {} as typeof import("../../src/sidepanel/hooks/useWebSocket") }
  vm.runInNewContext(readFileSync(filename, "utf8"), {
    exports: hook.exports, chrome, console,
    require(id: string) {
      if (id === "react") return react
      if (id === "../store/agentStore") return { ...store, useAgentStore: () => ({ state, dispatch }) }
      return requireDependency(id)
    },
    document: { addEventListener() {} }, CustomEvent,
    window: { dispatchEvent(event: CustomEvent<string>) { if (event.type === "cmspark:toast") notices.push(event.detail) } },
    setInterval: () => 1, clearInterval() {},
  }, { filename })

  function render() {
    refIndex = effectIndex = 0
    hook.exports.useWebSocket()
    for (const effect of effects.splice(0)) effect()
  }
  render()
  return {
    addLocal(message: import("../../src/sidepanel/types").Message) { dispatch({ type: "ADD_MESSAGE", message }); render() },
    select(threadId: string, renderImmediately = true) {
      dispatch({ type: "SET_ACTIVE_THREAD", threadId })
      chrome.runtime.sendMessage({ type: "thread.select", threadId })
      if (renderImmediately) render()
    },
    receive(frame: Frame, renderImmediately = true) { listener(frame); if (renderImmediately) render() },
    state: () => state,
    notices, requests,
  }
}
