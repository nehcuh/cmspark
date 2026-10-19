import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')
const source=fs.readFileSync(path.join(root,'companion/src/host-use/darwin/host.swift'),'utf8').replace(/\r\n/g,'\n')
// Narrow expression-by-expression projection of actual Swift, inert AX seams only.
// The projection neither runs Swift nor establishes current hosted AX node properties.
function traversal(source){
const locate=source.slice(source.indexOf('func cuAXLocate(windowId:'),source.indexOf('// MARK: - ax-invoke'))
assert.ok(locate.includes('cuAX571Traversal.depth = depth'),'actual traversal observation missing');
let s=locate.slice(locate.indexOf('    var queue:')).trim();assert.equal(s.at(-1),'}');s=s.slice(0,-1)
function once(a,b){assert.equal(s.split(a).length,2,'actual source anchor '+a);s=s.replace(a,b)}
s=s.replace(/\/\/[^\n]*/g,'').replace(/^#if CMSPARK_AX571_DIAGNOSTICS\n([\s\S]*?)^#endif\n/gm,'$1')
for(const [a,b] of [
 ['var queue: [AXUIElement] = [windowElement]','let queue = [windowElement]'],['var depth = 0','let depth = 0'],
 ['while !queue.isEmpty && depth < 50 {','while (queue.length !== 0 && depth < 50) {'],['var nextLevel: [AXUIElement] = []','let nextLevel = []'],['for element in queue {','for (const element of queue) {'],
 ['var hiddenRef: CFTypeRef?','let hiddenRef'],['if let hidden = hiddenRef as? Bool, hidden { continue }',"if (typeof hiddenRef==='boolean' && hiddenRef) { continue }"],
 ['var sizeRef: CFTypeRef?','let sizeRef'],['var sz = CGSize.zero','let sz = {width:0,height:0}'],['if let s = sizeRef { AXValueGetValue(s as! AXValue, .cgSize, &sz) }',"if(sizeRef!=null){sz=value(sizeRef,'size')}"],
 ['if sz.width <= 1 && sz.height <= 1 { continue }','if (sz.width <= 1 && sz.height <= 1) { continue }'],
 ['var nameRef: CFTypeRef?; var roleRef: CFTypeRef?','let nameRef; let roleRef'],['let name = (nameRef as? String) ?? ""',"const name=typeof nameRef==='string'?nameRef:''"],
 ['if name.lowercased() == target.lowercased() || name.contains(target) {','if(name.toLowerCase()===target.toLowerCase() || name.includes(target)) {'],
 ['var posRef: CFTypeRef?;','let posRef;'],['var pos = CGPoint.zero; var size = CGSize.zero','let pos = {x:0,y:0}; let size = {width:0,height:0}'],
 ['if let p = posRef { AXValueGetValue(p as! AXValue, .cgPoint, &pos) }',"if(posRef!=null){pos=value(posRef,'point')}"],
 ['if let s = sizeRef { AXValueGetValue(s as! AXValue, .cgSize, &size) }',"if(sizeRef!=null){size=value(sizeRef,'size')}"],
 ['cuAX571Note(.elementFound)',"note('ELEMENT_FOUND')"],['return cuAX571LocateResult([\n','return result({\n'],
 ['"bbox": ["x": pos.x, "y": pos.y, "width": size.width, "height": size.height]','"bbox": {"x": pos.x, "y": pos.y, "width": size.width, "height": size.height}'],
 ['(roleRef as? String) ?? "unknown"',"(typeof roleRef==='string'?roleRef:'unknown')"],['                ])','                })'],
 ['var children: CFTypeRef?','let children'],['if let childArray = children as? [AXUIElement] { nextLevel.append(contentsOf: childArray) }','if(Array.isArray(children)){nextLevel.push(...children)}'],
 ['cuAX571Note(.treeExhausted)',"note('TREE_EXHAUSTED')"],['return cuAX571LocateResult(["found": false])','return result({"found": false})'],
 ])once(a,b)
for(const [attribute,out]of [['Hidden','hiddenRef'],['Size','sizeRef'],['Title','nameRef'],['Role','roleRef'],['Position','posRef'],['Children','children']]){
 const a=`AXUIElementCopyAttributeValue(element, kAX${attribute}Attribute as CFString, &${out})`
 once(a,`${out}=read(element,'${attribute.toLowerCase()}')`)
}
s=s.replace(/cuAX571Traversal\./g,'observation.')
s=s.replace('if let hidden = hiddenRef as? Bool, hidden { observation.hidden = true }',"if(typeof hiddenRef==='boolean'&&hiddenRef){observation.hidden=true}")
s=s.replace('if sizeRef == nil { observation.sizeMissing = true }','if(sizeRef==null){observation.sizeMissing=true}')
s=s.replace('if sz.width <= 1 && sz.height <= 1 { observation.sizeSmall = true }','if(sz.width<=1&&sz.height<=1){observation.sizeSmall=true}')
s=s.replace('if name.isEmpty { observation.nameEmpty = true }','if(name.length===0){observation.nameEmpty=true}')
s=s.replace('if !name.isEmpty { observation.nameDifferent = true }','if(name.length!==0){observation.nameDifferent=true}')
s=s.replace('if children == nil { observation.childrenMissing = true }','if(children==null){observation.childrenMissing=true}')
s=s.replace('else if let childArray = children as? [AXUIElement] {','else if(Array.isArray(children)){const childArray=children;')
s=s.replace('if childArray.isEmpty { observation.childrenEmpty = true }','if(childArray.length===0){observation.childrenEmpty=true}')
s=s.replace('observation.end = queue.isEmpty ? "EMPTY_FRONTIER" : "DEPTH_LIMIT"','observation.end = queue.length===0 ? "EMPTY_FRONTIER" : "DEPTH_LIMIT"')
assert.doesNotMatch(s,/\bvar\b|\bas\??!?\b|\bCFTypeRef\b|\bAXValueGetValue\b|\.isEmpty|\bfor element\b|\blet childArray\b/)

const node=(title='',children=[],extra={})=>({title,children,size:{width:600,height:400},hidden:false,role:'AXGroup',position:{x:0,y:0},...extra})
const button=()=>node('OwnedAX571Press',[],{role:'AXButton',size:{width:280,height:60}})
function run(root){const reads=[],notes=[];const observation={schema:1,hidden:false,sizeMissing:false,sizeSmall:false,nameEmpty:false,nameDifferent:false,childrenMissing:false,childrenWrongType:false,childrenEmpty:false,childrenNonempty:false,depth:0,end:'EMPTY_FRONTIER'};const context={observation,windowElement:root,target:'OwnedAX571Press',read(e,k){reads.push({node:e,attribute:k});return e[k]},value:(v,k)=>{assert.ok(v&&typeof v==='object');return v},note:v=>notes.push(v),result:v=>v};vm.createContext(context);const output=vm.runInContext('(function(){'+s+'})()',context,{timeout:1000});return{output,reads,notes,observation}}
return {run,node,button,projected:s}
}
function consumer(){
 const require=createRequire(path.join(root,'companion/package.json')),ts=require('typescript'),text=fs.readFileSync(path.join(root,'companion/tests/computer-ax-native-571.test.ts'),'utf8'),ast=ts.createSourceFile('owned.ts',text,ts.ScriptTarget.Latest,true)
 const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ax571Traversal');assert.ok(n,'actual consumer missing')
 const out=ts.transpileModule(n.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true});assert.equal(out.diagnostics.length,0)
 const c={};vm.createContext(c);vm.runInContext(out.outputText,c);return c.ax571Traversal
}
const fixture=()=>({schema:1,hidden:false,sizeMissing:false,sizeSmall:false,nameEmpty:false,nameDifferent:false,childrenMissing:false,childrenWrongType:false,childrenEmpty:false,childrenNonempty:false,depth:2,end:'EMPTY_FRONTIER'})
test('#571 actual traversal distinguishes pruning branches with no extra attribute reads',()=>{
 const t=traversal(source),{node,button}=t
 for(const [flag,change,absent]of[['hidden',{hidden:true},'size'],['sizeMissing',{size:null},'title'],['sizeSmall',{size:{width:0,height:0}},'title']]){
  const middle=node('Owned middle',[button()],change),r=t.run(node('Owned root',[middle]));assert.equal(r.output.found,false);assert.equal(r.observation[flag],true);assert.equal(r.observation.end,'EMPTY_FRONTIER');assert.equal(r.reads.some(v=>v.node===middle&&v.attribute===absent),false)
 }
 const good=t.run(node('Owned root',[button()]));assert.equal(good.output.found,true);assert.equal(good.notes.at(-1),'ELEMENT_FOUND');assert.equal(good.reads.length,10)
})
test('#571 actual traversal captures empty/different name and unavailable/wrong/empty/nonempty children',()=>{
 const t=traversal(source)
 for(const [children,flag]of[[null,'childrenMissing'],[{},'childrenWrongType'],[[],'childrenEmpty'],[[t.node('No match',[])],'childrenNonempty']]){
  const r=t.run(t.node('',children));assert.equal(r.output.found,false);assert.equal(r.observation.nameEmpty,true);assert.equal(r.observation[flag],true)
 }
 const r=t.run(t.node('Different',[]));assert.equal(r.observation.nameDifferent,true);assert.equal(r.observation.nameEmpty,false)
})
test('#571 actual exhausted frontier vs depth50 remain distinct without changing depth refusal',()=>{
 const t=traversal(source)
 for(const d of [49,50]){let tree=t.button();for(let i=0;i<d;i++)tree=t.node('Container',[tree]);const r=t.run(tree);assert.equal(r.output.found,d===49);if(d===50){assert.equal(r.observation.depth,50);assert.equal(r.observation.end,'DEPTH_LIMIT')}}
 const r=t.run(t.node('No match',[]));assert.equal(r.observation.depth,1);assert.equal(r.observation.end,'EMPTY_FRONTIER')
})
test('#571 all new traversal statements are compileflag-only with unchanged AX reads/actions',()=>{
 const start=source.indexOf('func cuAXLocate('),end=source.indexOf('// MARK: - ax-invoke',start),loc=source.slice(start,end)
 const shipping=loc.replace(/^#if CMSPARK_AX571_DIAGNOSTICS\n[\s\S]*?^#endif\n/gm,'')
 assert.doesNotMatch(shipping,/cuAX571Traversal/)
 for(const attr of ['Hidden','Size','Title','Role','Position','Children'])assert.equal((loc.match(new RegExp('kAX'+attr+'Attribute','g'))||[]).length,1)
 assert.equal((loc.match(/AXUIElementCopyAttributeValue\(/g)||[]).length,6)
 assert.doesNotMatch(loc,/AXUIElementPerformAction|AXUIElementSetAttributeValue|CGWindowList|cuActivate|sleep|Timer/)
 assert.match(shipping,/if let hidden = hiddenRef as\? Bool, hidden \{ continue \}/)
 assert.match(shipping,/if sz.width <= 1 && sz.height <= 1 \{ continue \}/)
})
test('#571 consumer projects exact finite own fields and refuses malformed/privacy shapes',()=>{
 const parse=consumer(),x=fixture();assert.deepEqual(JSON.parse(JSON.stringify(parse({ax571Traversal:x}))),x)
 for(const item of [null,[],{}, {...x,extra:'PRIVATE'}, {...x,end:'PRIVATE'}, {...x,depth:51}, {...x,depth:NaN}, {...x,depth:1.5}, {...x,schema:2}, {...x,hidden:1},{...x,end:'DEPTH_LIMIT',depth:49}])assert.equal(parse({ax571Traversal:item}),null)
 assert.equal(parse({ax571Traversal:{...x,end:'DEPTH_LIMIT',depth:50}}).end,'DEPTH_LIMIT')
 const sym={...x};sym[Symbol('PRIVATE')]=true;assert.equal(parse({ax571Traversal:sym}),null)
 let gets=0;assert.equal(parse(Object.defineProperty({},'ax571Traversal',{get(){gets++;throw Error('PRIVATE')}})),null)
 assert.equal(parse({ax571Traversal:Object.defineProperty({...x},'depth',{get(){gets++;return 2}})}),null);assert.equal(gets,0)
 const inherited=Object.create({ax571Traversal:x});assert.equal(parse(inherited),null)
 const revoked=Proxy.revocable({},{});revoked.revoke();assert.equal(parse(revoked.proxy),null)
 assert.equal(parse(new Proxy({},{getOwnPropertyDescriptor(){throw Error('PRIVATE')}})),null)
 assert.equal(JSON.stringify(parse({ax571Traversal:{...x,message:'PRIVATE'}})), 'null')
})
test('#571 only tree-exhausted failure attaches observation; valid found and other failure DTOs unchanged',()=>{
 const a=source.indexOf('private func cuAX571LocateResult('),b=source.indexOf('// #571 traverse only',a),section=source.slice(a,b)
 assert.ok(section.includes('if (value["found"] as? Bool) == false && cuAX571CurrentReason == .treeExhausted { result["ax571Traversal"] = cuAX571Traversal.value }'))
 const native=section.split('#if CMSPARK_AX571_DIAGNOSTICS\n')[1].split('\n#else')[0]
 const js=native.replace('var result = value','let result = {...value}').replaceAll('cuAX571CurrentReason.rawValue','reason').replace('if (value["found"] as? Bool) == false && cuAX571CurrentReason == .treeExhausted { result["ax571Traversal"] = cuAX571Traversal.value }', 'if(value.found===false&&reason==="TREE_EXHAUSTED"){result["ax571Traversal"]=observation}')
 const f=vm.compileFunction(js,['value','reason','observation','cuJson']),x=fixture()
 for(const reason of ['ELEMENT_FOUND','AX_TARGET_ABSENT'])assert.equal(JSON.parse(f({found:reason==='ELEMENT_FOUND'},reason,x,JSON.stringify)).ax571Traversal,undefined)
 assert.deepEqual(JSON.parse(f({found:false},'TREE_EXHAUSTED',x,JSON.stringify)).ax571Traversal,x);assert.equal(JSON.parse(f({found:true},'TREE_EXHAUSTED',x,JSON.stringify)).ax571Traversal,undefined)
 const ts=fs.readFileSync(path.join(root,'companion/tests/computer-ax-native-571.test.ts'),'utf8')
 const line=ts.split('\n').find(l=>l.includes("t.diagnostic('AX571_TRAVERSAL '")),blockStart=ts.indexOf('const hit='),blockEnd=ts.indexOf('const args=',blockStart),block=ts.slice(blockStart,blockEnd);assert.ok(line&&blockStart>=0&&blockEnd>blockStart);assert.ok(line.indexOf('if(hit.found===false)')<line.indexOf("t.diagnostic('AX571_TRAVERSAL '"));assert.ok(block.indexOf('catch')<block.indexOf("assert.equal(hit.found,true"));assert.ok(block.includes("assert.equal(hit.found,true,'AX571_LOCATE_FAILED')"))
})
test('#571 LF/CRLF preserve actual traversal observation and existing canonical discovers this module',()=>{
 for(const input of [source,source.replace(/\n/g,'\r\n')]){const t=traversal(input.replace(/\r\n/g,'\n'));assert.equal(t.run(t.node('No match',[])).observation.end,'EMPTY_FRONTIER')}
 const entry=fs.readFileSync(path.join(root,'companion/scripts/tests/ax-native-571.test.mjs'),'utf8');assert.equal(entry.split("import './ax-traversal-observation-571.test.mjs'").length,2)
})
test('#571 actual passive TAP sink fault cannot replace the original locate assertion',async()=>{
 const text=fs.readFileSync(path.join(root,'companion/tests/computer-ax-native-571.test.ts'),'utf8'),start=text.indexOf('const hit='),end=text.indexOf('const args=',start)
 assert.ok(start>=0&&end>start);const piece=text.slice(start,end)
 const require=createRequire(path.join(root,'companion/package.json')),ts=require('typescript'),ast=ts.createSourceFile('actual.ts',text,ts.ScriptTarget.Latest,true)
 const predicate=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ax571KnownWKGap')
 const predicateJS=predicate?ts.transpileModule(predicate.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText:''
 assert.ok(piece.includes("assert.equal(hit.found,true,'AX571_LOCATE_FAILED')"))
 const parse=consumer();let commands=0,sinks=0
 const c={command:async()=>{commands++;return{found:false,ax571Traversal:fixture()}},t:{diagnostic(){sinks++;throw Error('OWNED_SINK_FAULT')}},target:1,framework:'APPKIT',ax571LocateReason:()=> 'TREE_EXHAUSTED',ax571Traversal:parse,assert,JSON}
 const execution=ts.transpileModule('(async()=>{'+piece+'})()',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true});assert.equal(execution.diagnostics.length,0)
 vm.createContext(c);await assert.rejects(vm.runInContext(predicateJS+'\n'+execution.outputText,c),/AX571_LOCATE_FAILED/);assert.equal(commands,1);assert.equal(sinks,1)
})
