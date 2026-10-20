import { DESKTOP_ASSET_NAMES } from "../desktop-assets.mjs"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { desktopIntegrity, stageDesktop } from "../desktop-artifacts.mjs"
function fixture(t, platform="darwin") {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"cmspark-desktop-build-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const source=path.join(root,"input");fs.mkdirSync(path.join(source,"assets"),{recursive:true})
 for(const name of [platform==="win32"?"cmspark-desktop.exe":"cmspark-desktop","desktop-launcher.node",...DESKTOP_ASSET_NAMES.map(name=>"assets/"+name),...(platform==="win32"?["licenses/WebView2.LICENSE.txt"]:[])]){fs.mkdirSync(path.dirname(path.join(source,name)),{recursive:true});fs.writeFileSync(path.join(source,name),`inert build-only fixture ${name}\n`)}
 const expected=desktopIntegrity(source,platform);fs.writeFileSync(path.join(source,"integrity.json"),JSON.stringify(expected));return{root,source,expected}
}
test("fixed exact desktop files stage into bin/desktop-native for each platform",t=>{
 for(const platform of ["darwin","win32"]){const {root,source,expected}=fixture(t,platform),out=path.join(root,"out");fs.writeFileSync(path.join(source,"not-shipped"),"inert");stageDesktop(source,out,platform);const target=path.join(out,"bin/desktop-native");assert.deepEqual(desktopIntegrity(target,platform),expected);assert.equal(fs.existsSync(path.join(target,"not-shipped")),false);assert.throws(()=>stageDesktop(source,out,platform),/ALREADY_EXISTS/)}
})
test("changed signed bytes or missing resource stop before staging",t=>{
 const {root,source}=fixture(t);fs.appendFileSync(path.join(source,"desktop-launcher.node"),"changed");assert.throws(()=>stageDesktop(source,path.join(root,"out"),"darwin"),/DRIFT/);assert.equal(fs.existsSync(path.join(root,"out")),false);fs.unlinkSync(path.join(source,"assets/app.js"));assert.throws(()=>desktopIntegrity(source,"darwin"),/ENOENT/)
})
test("symlink source, resource and package bin cannot redirect copies",{skip:process.platform==="win32"},t=>{
 const {root,source}=fixture(t),alias=path.join(root,"alias");fs.symlinkSync(source,alias);assert.throws(()=>desktopIntegrity(alias,"darwin"),/REDIRECT/)
 fs.renameSync(path.join(source,"assets/app.js"),path.join(root,"saved.js"));fs.symlinkSync(path.join(root,"saved.js"),path.join(source,"assets/app.js"));assert.throws(()=>desktopIntegrity(source,"darwin"),/REDIRECT/)
 fs.unlinkSync(path.join(source,"assets/app.js"));fs.renameSync(path.join(root,"saved.js"),path.join(source,"assets/app.js"));const out=path.join(root,"out");fs.mkdirSync(out);fs.mkdirSync(path.join(root,"foreign"));fs.symlinkSync(path.join(root,"foreign"),path.join(out,"bin"));assert.throws(()=>stageDesktop(source,out,"darwin"),/REDIRECT/);assert.deepEqual(fs.readdirSync(path.join(root,"foreign")),[])
})

test("declared package root cannot be a directory symlink",{skip:process.platform==="win32"},t=>{
 const {root,source}=fixture(t),sibling=path.join(root,"sibling"),out=path.join(root,"declared-output");fs.mkdirSync(sibling);fs.symlinkSync(sibling,out);assert.throws(()=>stageDesktop(source,out,"darwin"),/REDIRECT/);assert.deepEqual(fs.readdirSync(sibling),[])
})

// Execute the shipped asset, rather than a second owner-state implementation.
function desktopPageFixture() {
 const source=fs.readFileSync(new URL("../../src/desktop/assets/app.js",import.meta.url),"utf8")
 function node(tag="div"){return{tag,textContent:"",children:[],listeners:{},dataset:{},replaceChildren(){this.children=[];this.textContent=""},append(n){this.children.push(n)},setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn}}}
 const ids=Object.fromEntries(["title","notice","list","preview","status","view"].map(n=>[n,node()]))
 const buttons=["thread.list","mcp.list","skill.list","knowledge.list"].map(page=>Object.assign(node("button"),{dataset:{page}}))
 const sent=[],window={webkit:{messageHandlers:{desktop:{postMessage(frame){sent.push(frame)}}}}}
 const document={getElementById:id=>ids[id],querySelectorAll:()=>buttons,createElement:node}
 vm.runInNewContext(source,{window,document})
 const receive=frame=>window.cmsparkDesktopReceive(frame)
 receive({type:"desktop.document",generation:"owned-generation"})
 const list=()=>receive({type:"thread.list",threads:[{id:"owned-A",title:"A"},{id:"owned-B",title:"B"}]})
 const select=index=>ids.list.children[index].children[0].listeners.click()
 list();return{ids,buttons,sent,receive,list,select}
}
test("desktop page matching selected-thread preview remains visible",()=>{
 const f=desktopPageFixture();f.select(0);assert.equal(f.sent.at(-1).thread_id,"owned-A")
 f.receive({type:"thread.peek_result",thread_id:"owned-A",markdown:"owned A"});assert.equal(f.ids.preview.textContent,"owned A")
})
test("desktop page late thread result cannot populate another page",()=>{
 const f=desktopPageFixture();f.select(0);f.buttons[1].listeners.click();assert.equal(f.ids.title.textContent,"MCP")
 f.receive({type:"thread.peek_result",thread_id:"owned-A",markdown:"late A"});assert.equal(f.ids.preview.textContent,"")
})
test("desktop page late A result cannot overwrite selected B",()=>{
 const f=desktopPageFixture();f.select(0);f.select(1)
 f.receive({type:"thread.peek_result",thread_id:"owned-B",markdown:"owned B"});assert.equal(f.ids.preview.textContent,"owned B")
 f.receive({type:"thread.peek_result",thread_id:"owned-A",markdown:"late A"});assert.equal(f.ids.preview.textContent,"owned B")
})
test("desktop page navigation back does not restore a previous selection",()=>{
 const f=desktopPageFixture();f.select(0);f.buttons[1].listeners.click();f.buttons[0].listeners.click();f.list()
 f.receive({type:"thread.peek_result",thread_id:"owned-A",markdown:"old visit A"});assert.equal(f.ids.preview.textContent,"")
 f.select(1);f.receive({type:"thread.peek_result",thread_id:"owned-B",markdown:"new visit B"});assert.equal(f.ids.preview.textContent,"new visit B")
})
test("desktop page reconnect load clears selected-thread ownership",()=>{
 const f=desktopPageFixture();f.select(0);f.receive({type:"desktop.document",generation:"owned-next-generation"})
 f.receive({type:"thread.peek_result",thread_id:"owned-A",markdown:"old connection A"});assert.equal(f.ids.preview.textContent,"")
})
test("desktop page offline and missing-thread results cannot display previews",()=>{
 const f=desktopPageFixture();f.select(0);f.receive({type:"thread.peek_result",markdown:"missing owner"});assert.equal(f.ids.preview.textContent,"")
 f.receive({type:"desktop.offline"});f.receive({type:"thread.peek_result",thread_id:"owned-A",markdown:"offline A"});assert.equal(f.ids.preview.textContent,"")
})
