import { useEffect, useRef, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"

type Counter = { thread_id: string; context_tab_id: number; origin: string; target_key: string; fails: number; last_code: string;
  threshold: number; health: "unknown"; locator_ban: boolean; attach_frozen: boolean; busy: boolean; reset: boolean }
const feedback: Record<string,string> = {
  SITE_COUNTER_BUSY: "当前对话仍有任务或确认未结束，请完成后重试。",
  SITE_COUNTER_STALE: "对话或站点已变化，请刷新站点状态。",
  SITE_COUNTER_UNAVAILABLE: "无法确认当前站点，请打开网页后刷新。",
  SITE_COUNTER_CALLER_DENIED: "当前界面无法操作站点计数。",
  SITE_COUNTER_INVALID: "请求被拒绝，请刷新站点状态。",
}
function counterReply(message: any): Counter | undefined {
  if (message?.type !== "site.counter.state" || typeof message.thread_id !== "string" || !Number.isSafeInteger(message.context_tab_id) || message.context_tab_id < 0
    || typeof message.origin !== "string" || typeof message.target_key !== "string" || !/^[a-f0-9]{64}$/.test(message.target_key)
    || !Number.isSafeInteger(message.fails) || message.fails < 0 || message.threshold !== 4 || message.health !== "unknown"
    || typeof message.last_code !== "string" || !/^[A-Z][A-Z0-9_]{0,79}$/.test(message.last_code)
    || [message.locator_ban,message.attach_frozen,message.busy,message.reset].some(v => typeof v !== "boolean")) return undefined
  try { if (new URL(message.origin).origin !== message.origin || !/^https?:\/\//.test(message.origin)) return undefined } catch { return undefined }
  return { thread_id:message.thread_id,context_tab_id:message.context_tab_id,origin:message.origin,target_key:message.target_key,fails:message.fails,last_code:message.last_code,threshold:message.threshold,health:message.health,locator_ban:message.locator_ban,attach_frozen:message.attach_frozen,busy:message.busy,reset:message.reset }
}

export function SiteCounterSettingsSection({ visible }: { visible: boolean }) {
  const { state } = useAgentStore(), threadId = state.activeThreadId, selectionRevision = state.activeThreadSelectionRevision, connected = state.connectionState === "connected"
  const [counter,setCounter] = useState<Counter>(), [notice,setNotice] = useState(""), [waiting,setWaiting] = useState(false)
  const counterRef = useRef(counter); counterRef.current = counter
  const owner = useRef({ threadId, selectionRevision, connected, visible }); owner.current = { threadId, selectionRevision, connected, visible }
  const pending = useRef<{ id: string; threadId: string; selectionRevision: number; reset: boolean; tabId?: number; early?: Counter; timer: ReturnType<typeof setTimeout> }>()
  const clearPending = () => { if (pending.current) clearTimeout(pending.current.timer); pending.current=undefined; setWaiting(false) }
  // Canonical explicit selection epoch also detects a batched A -> B -> A;
  // ordinary rerenders keep it unchanged and cannot revoke a valid request.
  const current = (id: string, ownedThread: string) => pending.current?.id === id && pending.current.selectionRevision === owner.current.selectionRevision && owner.current.threadId === ownedThread && owner.current.visible && owner.current.connected
  const receive = (message: any) => {
    const p = pending.current
    if (!p || !current(message?.id,p.threadId) || (message.thread_id !== undefined && message.thread_id !== p.threadId)) return
    if (message.type === "site.counter.error" || message.type === "error") { clearPending(); setNotice(feedback[message.code] || "请求被拒绝，请刷新站点状态。"); return }
    const result = counterReply(message)
    if (!result || result.thread_id !== p.threadId || result.reset !== p.reset) return
    // Chrome forwarding acknowledges the actual browser-selected tab. Keep at
    // most one canonical early reply if WS arrives before that ack; never accept
    // another tab's state or treat the ack itself as operation completion.
    if (p.tabId === undefined) { p.early=result; return }
    if (result.context_tab_id !== p.tabId) return
    clearPending(); setCounter(result); setNotice(result.reset ? "失败计数已重置；站点可用性仍未确认恢复。" : "")
  }
  const request = (reset: boolean) => {
    if (!owner.current.threadId || !owner.current.visible || !owner.current.connected || (reset && !counter)) return
    clearPending(); setNotice(""); setWaiting(true)
    const id = `site-counter-${crypto.randomUUID()}`, ownedThread = owner.current.threadId
    const timer = setTimeout(() => { if (current(id,ownedThread)) { clearPending(); setNotice("站点状态响应超时，请刷新后重试。") } }, 5000)
    pending.current = { id,threadId:ownedThread,selectionRevision:owner.current.selectionRevision,reset,timer }
    try {
      chrome.runtime.sendMessage({ type: reset ? "site.counter.reset" : "site.counter.status", source:"settings",id,thread_id:ownedThread,
        ...(reset ? { target_key:counter!.target_key,user_gesture:true } : {}) }, response => {
        const failed = !!chrome.runtime.lastError || response?.ok !== true || !Number.isSafeInteger(response?.context_tab_id) || response.context_tab_id < 0
        if (!current(id,ownedThread)) return
        if (failed) { clearPending(); setNotice("请求未送达，请检查连接后重试。"); return }
        pending.current!.tabId = response.context_tab_id
        const early = pending.current!.early
        if (early) receive({ ...early,type:"site.counter.state",id })
        // A forwarding ack never changes a counter or completes a reset.
      })
    } catch { if (current(id,ownedThread)) { clearPending(); setNotice("请求未送达，请检查连接后重试。") } }
  }
  useEffect(() => {
    clearPending(); setCounter(undefined); setNotice("")
    if (!visible || !connected || !threadId) return
    const handler = receive
    const invalidate = () => { clearPending(); setCounter(undefined); setNotice("对话或站点已变化，请刷新站点状态。") }
    const changed = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      const knownTab = pending.current?.tabId ?? counterRef.current?.context_tab_id
      if (info.url && (knownTab === undefined || tabId === knownTab)) invalidate()
    }
    chrome.runtime.onMessage.addListener(handler); chrome.tabs.onActivated.addListener(invalidate); chrome.tabs.onUpdated.addListener(changed)
    request(false)
    return () => { if (pending.current) clearTimeout(pending.current.timer); pending.current=undefined;
      chrome.runtime.onMessage.removeListener(handler); chrome.tabs.onActivated.removeListener(invalidate); chrome.tabs.onUpdated.removeListener(changed) }
  }, [visible,connected,threadId,selectionRevision])
  return <section aria-label="站点失败计数" style={{marginBottom:16,padding:12,border:`1px solid ${tokens.border}`,borderRadius:8}}>
    <h3 style={{margin:"0 0 8px",fontSize:13}}>站点失败计数</h3>
    {counter ? <>
      <p style={{fontSize:12,overflowWrap:"anywhere"}}>当前对话 · {counter.origin}</p>
      <p>失败计数：{counter.fails} / {counter.threshold}</p><p>最后错误码：{counter.last_code}</p>
      <p style={{fontSize:12,color:tokens.textMuted}}>站点可用性未确认恢复。{counter.locator_ban ? "已有定位失败规则继续生效。" : "未记录定位限制。"}{counter.attach_frozen ? "当前标签连接限制仍保留。" : "未记录标签连接限制。"}</p>
    </> : <p style={{fontSize:12}}>{!threadId ? "请先选择对话。" : !connected ? "Companion 未连接。" : "尚未确认当前站点。"}</p>}
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <button type="button" disabled={!connected || !threadId || waiting} onClick={() => request(false)}>刷新站点状态</button>
      <button type="button" disabled={!connected || !threadId || !counter || counter.busy || waiting} onClick={() => request(true)}>重置当前对话此站点的失败计数</button>
    </div>
    <p style={{fontSize:12,color:tokens.textMuted}}>仅重置此对话、此站点的运行失败计数；定位规则、历史经验、连接限制和权限保持不变。</p>
    {notice && <p role="status" style={{fontSize:12}}>{notice}</p>}
  </section>
}
