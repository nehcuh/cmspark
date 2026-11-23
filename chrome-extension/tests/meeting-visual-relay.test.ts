import test from "node:test"
import assert from "node:assert/strict"
import { createMeetingVisualRelay } from "../src/background/meeting-visual-relay"

test("a live visual confirmation is bound to the actual top-level document and revoked when its port vanishes", () => {
  const frames:any[] = [], posted:any[] = []
  const client = { getState:() => "connected", desktopBrowserConnectionCurrent: () => () => true, send:(m:any) => { frames.push(m); return true } }
  const sender = { id:"fixture", url:"chrome-extension://fixture/tabs/workspace.html", frameId:0,documentId:"ebc888de-455d-4332-841e-cd0351e25f62" }
  const relay = createMeetingVisualRelay()
  let onMessage!: (m:any) => void, onDisconnect!: () => void
  const port = {sender, onMessage:{addListener:(cb:any) => onMessage=cb}, onDisconnect:{addListener:(cb:any) => onDisconnect=cb},
    postMessage:(m:any) => posted.push(m),disconnect(){}}
  const exec = {type:"meeting.visual.execute", id:"test-execute", meeting_id:"mtg_fixture", consent_token:"permit",owner_id:"forged"}
  assert.equal(relay.forward(exec,sender,"fixture",client).ok,false)
  relay.attach(port as unknown as chrome.runtime.Port,"fixture",client)
  onMessage(exec)
  assert.equal(frames[0].owner_id,sender.documentId)
  onDisconnect()
  assert.equal(frames[1].type,"meeting.visual.cancel")
  assert.equal(frames[1].consent_token,"permit")
  assert.equal(frames[1].owner_id,sender.documentId)
  assert.equal(relay.receive({type:"meeting.visual.finished",id:exec.id}),false)
})

test("an execution reply is delivered only to its live request port; closed connections cannot replay it", () => {
  const relay = createMeetingVisualRelay()
  const frames: any[] = [], posted: any[] = []
  const sender = {id:"fixture", url:"chrome-extension://fixture/sidepanel.html",frameId:0,documentId:"document1"}
  let generation = 1, closed = 0
  const client = {
    getState:() => "connected",
    desktopBrowserConnectionCurrent() {const original = generation; return () => generation === original},
    send(m:object) {frames.push(m); return true},
  }
  let transmit!: (m:object) => void, vanish!: () => void
  const port = {sender, onMessage:{addListener:(cb:any) => transmit=cb}, onDisconnect:{addListener:(cb:any) => vanish=cb},
    postMessage:(m:any)=>posted.push(m), disconnect(){closed++}}
  const source = port as unknown as chrome.runtime.Port
  relay.attach(source,"fixture",client)
  const request = {type:"meeting.visual.execute",id:"exec",meeting_id:"mtg_fixture",consent_token:"one-time-permit"}
  transmit(request)
  assert.equal(relay.receive({type:"meeting.visual.finished",id:"exec",meeting_id:"another_meeting"}),false)
  const success = {type:"meeting.visual.finished",id:"exec",meeting_id:"mtg_fixture"}
  assert.equal(relay.receive(success),true)
  assert.deepEqual(posted,[success])
  vanish()
  assert.equal(frames.length,1)
  relay.attach(source,"fixture",client)
  generation++
  transmit(request)
  assert.equal(closed,1)
  assert.equal(frames.length,1)
  sender.url = "https://foreign.invalid/"
  relay.attach(source,"fixture",client)
  assert.equal(closed,2)
})
