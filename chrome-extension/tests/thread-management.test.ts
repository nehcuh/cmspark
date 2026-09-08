import test from "node:test"
import assert from "node:assert/strict"
import { threadTags, aiThreadGroup, saveThreadMetadata } from "../src/sidepanel/utils/thread-management"
import { buildTagColorIndex, UNTAGGED_COLOR } from "../src/thread-graph/tag-colors"
import { buildTagIndex, filterThreadsByQuery } from "../src/sidepanel/utils/thread-timeline"

test("human labels join AI labels for search while AI grouping never uses manual labels or folder", () => {
  const thread = { id: "one", user_tags: ["Owner", "PAY"], topic_folder: "My folder", digest: { tags: ["pay", "AI"] } }
  assert.deepEqual(threadTags(thread), ["owner", "pay", "ai"])
  assert.equal(buildTagIndex([thread]).get("pay")?.length, 1)
  assert.equal(filterThreadsByQuery([thread], "owner").length, 1)
  assert.equal(aiThreadGroup(thread), "pay")
  assert.equal(aiThreadGroup({user_tags:["Human"]}), null)
  assert.equal(thread.topic_folder, "My folder")
})

test("metadata save waits for matching persisted reply, ignores ACK and unrelated replies, rejects server errors", async () => {
  const previous=(globalThis as any).chrome
  const listeners=new Set<(message:any)=>void>();let request:any
  ;(globalThis as any).chrome={runtime:{onMessage:{addListener:(fn:any)=>listeners.add(fn),removeListener:(fn:any)=>listeners.delete(fn)},sendMessage:async(message:any)=>{request=message;return {ok:true}}}}
  try {
    let completed=false
    const saved=saveThreadMetadata("one",{user_tags:["pay"],topic_folder:null},new AbortController().signal).then(value=>{completed=true;return value})
    await Promise.resolve();assert.equal(completed,false)
    for(const listener of listeners) listener({type:"thread.updated",id:"another",thread:{id:"one"}})
    assert.equal(completed,false)
    for(const listener of listeners) listener({type:"thread.updated",id:request.id,thread:{id:"wrong-thread",user_tags:["pay"],topic_folder:null}})
    assert.equal(completed,false)
    const actual={id:"one",user_tags:["pay"],topic_folder:null}
    for(const listener of listeners) listener({type:"thread.updated",id:request.id,thread:actual})
    assert.equal(await saved,actual);assert.equal(listeners.size,0)
    const ignored=saveThreadMetadata("one",{user_tags:["new tag"],topic_folder:null},new AbortController().signal)
    for(const listener of listeners) listener({type:"thread.updated",id:request.id,thread:{id:"one",topic_folder:null}})
    assert.equal(await ignored.then(()=>"unexpected",error=>error.message.includes("未确认")),true)
    const aborter=new AbortController()
    const aborted=saveThreadMetadata("one",{user_tags:[],topic_folder:null},aborter.signal)
    aborter.abort()
    assert.equal(await aborted.then(()=>"unexpected",error=>error.message.includes("已取消等待")),true)
    assert.equal(listeners.size,0)
    const failed=saveThreadMetadata("one",{user_tags:[],topic_folder:null},new AbortController().signal)
    for(const listener of listeners) listener({type:"error",id:request.id,error:"Disk full"})
    assert.equal(await failed.then(()=>"unexpected success",error=>error.message),"Disk full");assert.equal(listeners.size,0)
  } finally { (globalThis as any).chrome=previous }
})


test("metadata timeout releases listeners and cannot become success from a late reply", async () => {
  const originalChrome = (globalThis as any).chrome
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const listeners = new Set<(message: any) => void>()
  let expire: () => void = () => {}
  let request: any
  let cleared = false
  ;(globalThis as any).chrome = { runtime: {
    onMessage: { addListener: (fn: any) => listeners.add(fn), removeListener: (fn: any) => listeners.delete(fn) },
    sendMessage: async (message: any) => { request = message; return { ok: true } },
  } }
  ;(globalThis as any).setTimeout = (fn: () => void, ms: number) => { assert.equal(ms, 15_000); expire = fn; return 1 }
  ;(globalThis as any).clearTimeout = () => { cleared = true }
  try {
    const result = saveThreadMetadata("one", { user_tags: ["human"], topic_folder: null }, new AbortController().signal)
      .then(() => "unexpected", error => error.message)
    expire()
    assert.equal(await result, "尚未收到保存确认，请检查连接后重试")
    assert.equal(cleared, true)
    assert.equal(listeners.size, 0)
    for (const listener of listeners) listener({ type: "thread.updated", id: request.id, thread: { id: "one", user_tags: ["human"] } })
    assert.equal(await result, "尚未收到保存确认，请检查连接后重试")
  } finally {
    ;(globalThis as any).chrome = originalChrome
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
})


test("graph human-only tags retain AI extraction eligibility and untagged color", () => {
  const thread = { id: "human-only", user_tags: ["负责人"], digest: { tags: [] } }
  assert.equal(aiThreadGroup(thread), null)
  const colors = buildTagColorIndex([thread])
  assert.equal(colors.tagById.get(thread.id), null)
  assert.equal(colors.colorById.get(thread.id), UNTAGGED_COLOR)
  assert.equal(colors.groups[0].tag, "未标注")
  assert.equal(threadTags(thread)[0], "负责人")
})
