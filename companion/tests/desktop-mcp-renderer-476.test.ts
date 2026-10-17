import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
function element(id: string): any { return { id, textContent: "", value: "", checked: false, hidden: false, disabled: false, children: [], dataset: {}, events: {}, setAttribute() {}, replaceChildren(...v: any[]) { this.children=v }, append(v: any) {this.children.push(v)}, addEventListener(k: string, f: any) {this.events[k]=f} } }
function fixture() {
  const ids: any = Object.fromEntries(["title","notice","list","preview","status","view","mcp-editor","mcp-new","mcp-name","mcp-command","mcp-args","mcp-cwd","mcp-enabled","mcp-save","mcp-cancel","mcp-feedback"].map(k=>[k,element(k)]))
  const nav=["thread.list","mcp.list","skill.list","knowledge.list"].map(page=>{const e=element(page);e.dataset.page=page;return e})
  const posted:any[]=[];const window:any={webkit:{messageHandlers:{desktop:{postMessage:(v:any)=>posted.push(JSON.parse(JSON.stringify(v)))}}}}
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,"../../src/desktop/assets/app.js"),"utf8"),{window,document:{getElementById:(k:string)=>ids[k],querySelectorAll:()=>nav,createElement:element}},{timeout:1000})
  const receive=(v:any)=>window.cmsparkDesktopReceive(v);receive({type:"desktop.document",generation:"owned-generation"});nav[1].events.click()
  return {ids,nav,posted,receive}
}
function requestEdit(f: ReturnType<typeof fixture>, name="owned_existing") {
 f.receive({type:"mcp.list",servers:[{name}]})
 f.ids.list.children[0].children[1].events.click()
 const request=f.posted.at(-1);assert.equal(request.type,"desktop.mcp.edit");return request
}
function editReply(f: ReturnType<typeof fixture>, request:any) {
 f.receive({type:"desktop.mcp.edit.result",id:request.id,name:request.name,config:{command:"owned_old_command",args:["old argument"],cwd:"",enabled:false}})
}
function newDraft(f: ReturnType<typeof fixture>) {
 f.ids["mcp-new"].events.click();f.ids["mcp-name"].value="owned_new_draft";f.ids["mcp-command"].value="owned_new_command";f.ids["mcp-args"].value='["new argument"]'
}
function assertNewDraft(f: ReturnType<typeof fixture>) {
 assert.equal(f.ids["mcp-name"].value,"owned_new_draft");assert.equal(f.ids["mcp-command"].value,"owned_new_command");assert.equal(f.ids["mcp-args"].value,'["new argument"]')
}
test("#476 obsolete edit reply cannot replace a newer New draft or its save action",()=>{
 const f=fixture(),old=requestEdit(f);newDraft(f);editReply(f,old);assertNewDraft(f)
 f.ids["mcp-save"].events.click();const save=f.posted.at(-1);assert.equal(save.action,"add");assert.equal(save.name,"owned_new_draft");assert.equal(JSON.parse(save.payload_json).command,"owned_new_command")
})
test("#476 closing the draft retires its pending edit reply",()=>{
 const f=fixture();newDraft(f);const old=requestEdit(f);f.ids["mcp-cancel"].events.click();editReply(f,old)
 assert.equal(f.ids["mcp-editor"].hidden,true);assertNewDraft(f)
})
test("#476 late edit cannot overwrite a submitted draft while native confirmation is pending",()=>{
 const f=fixture();newDraft(f);const old=requestEdit(f);f.ids["mcp-save"].events.click();const save=f.posted.at(-1);editReply(f,old)
 assertNewDraft(f);assert.equal(f.ids["mcp-save"].disabled,true);assert.equal(save.action,"add")
 f.receive({type:"desktop.mcp.save.result",id:save.id,ok:false});assertNewDraft(f);assert.equal(f.ids["mcp-save"].disabled,false)
})
test("#476 current intended edit still opens the matching entry",()=>{
 const f=fixture(),current=requestEdit(f);editReply(f,current)
 assert.equal(f.ids["mcp-name"].value,current.name);assert.equal(f.ids["mcp-command"].value,"owned_old_command");assert.equal(f.ids["mcp-name"].disabled,true);assert.equal(f.ids["mcp-editor"].hidden,false)
})
test("#476 only the latest of two edit requests may open a form",()=>{
 const f=fixture(),old=requestEdit(f,"owned_old"),current=requestEdit(f,"owned_current");editReply(f,old)
 assert.equal(f.ids["mcp-name"].value,"");editReply(f,current);assert.equal(f.ids["mcp-name"].value,"owned_current")
})
test("#476 cancelled edit cannot overwrite a subsequently reopened New draft",()=>{
 const f=fixture();newDraft(f);const old=requestEdit(f);f.ids["mcp-cancel"].events.click();newDraft(f);editReply(f,old);assertNewDraft(f)
 assert.equal(f.ids["mcp-editor"].hidden,false)
})
test("#476 real renderer add submits exactly four editable values and cannot decide",()=>{
 const f=fixture();assert.equal(typeof f.ids["mcp-new"].events.click,"function");f.ids["mcp-new"].events.click()
 f.ids["mcp-name"].value="owned";f.ids["mcp-command"].value="inert";f.ids["mcp-args"].value='["中文 空格"]';f.ids["mcp-cwd"].value="";f.ids["mcp-enabled"].checked=false;f.ids["mcp-save"].events.click()
 const out=f.posted.at(-1);assert.equal(out.type,"desktop.mcp.save");assert.equal(out.thread_id,null);assert.equal(out.action,"add");assert.deepEqual(JSON.parse(out.payload_json),{command:"inert",args:["中文 空格"],cwd:"",enabled:false})
 assert.equal(f.ids["mcp-save"].disabled,true);assert.equal(f.ids["mcp-feedback"].textContent.includes("已保存"),false)
 f.receive({type:"desktop.confirmation.request",action_json:'{"env":"private"}'});assert.equal(JSON.stringify(f.ids).includes("private"),false);assert.equal(f.posted.some(v=>v.type==="desktop.confirmation.decision"),false)
 f.receive({type:"desktop.mcp.save.result",id:out.id,ok:false,error_code:"OWNED"});assert.equal(f.ids["mcp-command"].value,"inert");assert.equal(f.ids["mcp-save"].disabled,false)
})
test("#476 renderer ACK honest, malformed args rejected, stale reply ignored after reconnect",()=>{
 const f=fixture();f.ids["mcp-new"].events.click();f.ids["mcp-name"].value="owned";f.ids["mcp-command"].value="inert";f.ids["mcp-args"].value='{"args":[]}';const count=f.posted.length;f.ids["mcp-save"].events.click();assert.equal(f.posted.length,count)
 f.ids["mcp-args"].value="[]";f.ids["mcp-save"].events.click();const out=f.posted.at(-1);f.receive({type:"desktop.offline"});f.receive({type:"desktop.document",generation:"new-owned"});f.receive({type:"desktop.mcp.save.result",id:out.id,ok:true});assert.equal(f.ids["mcp-feedback"].textContent.includes("已保存"),false)
})
test("#476 bundled hosted form driver follows actual renderer add/update/deny ACK sequence",()=>{
 const f=fixture();for(const e of Object.values(f.ids) as any[])e.click=()=>e.events.click?.()
 const walk=(e:any,tag:string):any=>e.children.find((v:any)=>v.id===tag)||e.children.map((v:any)=>walk(v,tag)).find(Boolean)
 // A fresh VM uses the same full renderer and full test-only JS; backend replies
 // below are inert DTO seams, not a claim of native or configuration execution.
 const ids=f.ids,posted:any[]=[],nav=f.nav
 const elementWithClick=(tag:string):any=>{const e=element(tag);e.click=()=>e.events.click?.();e.querySelector=(tag:string)=>walk(e,tag);return e}
 const window:any={webkit:{messageHandlers:{desktop:{postMessage:(v:any)=>posted.push(JSON.parse(JSON.stringify(v)))}}}}
 const document:any={body:{textContent:""},getElementById:(k:string)=>ids[k],querySelectorAll:()=>nav,querySelector:()=>nav[1],createElement:elementWithClick}
 for(const b of nav)b.click=()=>b.events.click?.()
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,"../../src/desktop/assets/app.js"),"utf8"),{window,document},{timeout:1000});window.cmsparkDesktopReceive({type:"desktop.document",generation:"owned-driver"});posted.length=0
 vm.runInNewContext("const documentGeneration='owned-driver';"+fs.readFileSync(path.resolve(__dirname,"../../tests/fixtures/desktop-476/native-form.js"),"utf8"),{window,document},{timeout:1000})
 let saves=0;const actions:string[]=[]
 for(let i=0;posted.length&&i<40;i++){
  const frame=posted.shift();if(frame.type==="mcp.list")window.cmsparkDesktopReceive({type:"mcp.list",servers:[{name:"owned_native_476"}]})
  else if(frame.type==="desktop.mcp.edit")window.cmsparkDesktopReceive({type:"desktop.mcp.edit.result",id:frame.id,name:frame.name,config:{command:"owned_original",args:[],enabled:false,cwd:""}})
  else if(frame.type==="desktop.mcp.save"){actions.push(frame.action);saves++;window.cmsparkDesktopReceive({type:"desktop.mcp.save.result",id:frame.id,ok:saves!==2,saved:saves!==2})}
  else if(frame.type==="system.ping"&&frame.id==="D476_NATIVE_DONE"){assert.equal(saves,3);assert.deepEqual(actions,["update","update","add"]);return}
  else if(frame.type==="system.ping")assert.equal(frame.id.startsWith("D476_FAIL_"),false,frame.id)
 }
 assert.fail("Actual bundled native driver did not finish the expected UI sequence")
})
