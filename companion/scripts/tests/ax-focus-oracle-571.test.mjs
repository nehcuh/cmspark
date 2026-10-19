import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')
const shell=fs.readFileSync(path.join(root,'scripts/computer-bg-oracles.sh'),'utf8')
const helper=(name,input=shell)=>{const found=input.replace(/\r\n/g,'\n').match(new RegExp(name+"\\(\\) \\{\\n  cat <<'JSEOF'\\n([\\s\\S]*?)\\nJSEOF\\n\\}"));assert.ok(found);return found[1]}
function execute(body,inputs,env){let output;const io={readFileSync:p=>{assert.ok(Object.hasOwn(inputs,p));return JSON.stringify(inputs[p])},writeFileSync:(p,value)=>{assert.equal(p,'out');output=JSON.parse(value)}};vm.runInNewContext(body,{require:n=>{assert.equal(n,'node:fs');return io},process:{env,stderr:{write:()=>assert.fail('unexpected stderr')},exit:()=>assert.fail('unexpected exit')},Date,JSON,Math},{timeout:1000});return output}
const shot=(windows,foregroundWindowId)=>execute(helper('snapshot_js'),{wl:{ok:true,windows,...(foregroundWindowId===undefined?{}:{foregroundWindowId})},cur:{ok:true,x:1,y:2}},{ORACLE_WL:'wl',ORACLE_CUR:'cur',ORACLE_OUT:'out'})
const compare=(b,a,delivery='ax-action')=>execute(helper('compare_js'),{b,a},{ORACLE_BEFORE:'b',ORACLE_AFTER:'a',ORACLE_OUT:'out',ORACLE_DELIVERY:delivery})
const rows=[{windowId:90,pid:9,layer:25},{windowId:12,pid:1,layer:0},{windowId:11,pid:1,layer:0}]
test('#571 actual snapshot: actual focused ID wins over overlay, entire raw zorder retained',()=>{const v=shot(rows,12);assert.equal(v.foreground,12);assert.deepEqual(v.zorder,[90,12,11])})
test('#571 actual snapshot: no legacy top-row, layer or frontmost-PID fallback',()=>{for(const id of [undefined,null,0,-1,1.5,NaN,Infinity,'12',13])assert.equal(shot(rows,id).foreground,null)})
test('#571 actual snapshot: duplicate listed identity cannot be focus evidence',()=>assert.equal(shot([...rows,{windowId:12}],12).foreground,null))
test('#571 actual comparator retains sibling focus, full-zorder, cursor, null and delivery refusals',()=>{const b=shot(rows,12);assert.equal(compare(b,b).background_verified,true);for(const a of [shot(rows,11),shot(rows,null),{...b,zorder:[90,11,12]},{...b,zorder:[12,11]},{...b,cursor:{x:2,y:2}}])assert.equal(compare(b,a).background_verified,false);assert.equal(compare(b,b,'sendinput').background_verified,false)})

// Restricted source projection, not a Swift compiler or AppKit execution. Only these six
// read-only functions are accepted. Their actual guard expressions/control flow are executed
// with typed inert AX/CF seams; unsupported syntax fails the test rather than being ignored.
const swift=fs.readFileSync(path.join(root,'companion/src/host-use/darwin/host.swift'),'utf8')
function swiftBody(name){const start=swift.indexOf('private func '+name+'(');assert.ok(start>=0,name);const open=swift.indexOf('{',start);let depth=1,end=open+1;for(;end<swift.length&&depth;end++){if(swift[end]==='{')depth++;if(swift[end]==='}')depth--}assert.equal(depth,0);return swift.slice(open+1,end-1)}
function clauses(s){let q=false,depth=0,last=0,out=[];for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'&&s[i-1]!=='\\')q=!q;if(!q){if('(['.includes(c))depth++;if(')]'.includes(c))depth--;if(c===','&&depth===0){out.push(s.slice(last,i).trim());last=i+1}}}out.push(s.slice(last).trim());return out}
const same=(a,b)=>a===b||(a&&b&&typeof a==='object'&&typeof b==='object'&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>same(a[k],b[k])))
function expression(s){return s.replace(/ as CFString/g,'').replace(/ as! (?:AXUIElement|AXValue|CFArray)/g,'').replace(/\b(?:nil)\b/g,'null').replace(/\.success\b/g,'SUCCESS').replace(/\.cgPoint\b/g,'POINT').replace(/\.cgSize\b/g,'SIZE').replace(/\bCGPoint.zero\b/g,'({x:0,y:0})').replace(/\bCGSize.zero\b/g,'({width:0,height:0})').replace(/\b([a-zA-Z]+(?:\.[a-zA-Z]+)*)\.isFinite\b(?!\()/g,'Number.isFinite($1)').replace(/!title\.isEmpty/g,'title.length>0').replace(/\b(?:before\.allMetadata == after\.allMetadata)\b/g,'same(before.allMetadata,after.allMetadata)').replace(/\b(?:before\.metadata == after\.metadata)\b/g,'same(before.metadata,after.metadata)').replace(/observed == metadata/g,'same(observed,metadata)').replace(/windows\.filter\(\{ CFEqual\(\$0, window\) \}\)\.count/g,'windows.filter(x=>CFEqual(x,window)).length').replace(/allMetadata\.filter\(\{ \$0 == metadata \}\)\.count/g,'allMetadata.filter(x=>same(x,metadata)).length').replace(/\.count\b/g,'.length').replace(/\bCUFocus(Metadata|Evidence)\(([^\n]+)\)/g,'({$2})').replace(/AXUIElementGetPid\(([^,]+), &pid\)/g,'AXUIElementGetPid($1,v=>{pid=v})').replace(/AXValueGetValue\(([^,]+), ([^,]+), &(point|dimensions)\)/g,'AXValueGetValue($1,$2,v=>{$3=v})').replace(/AXUIElementCopyAttributeValue\(element, name, &value\)/g,'AXUIElementCopyAttributeValue(element,name,v=>{value=v})')}
function project(name,args){let body=swiftBody(name).replace(/\/\/[^\n]*/g,'');body=body.replace(/guard ([\s\S]*?) else \{ return nil \}/g,(_all,conditions)=>clauses(conditions).map(c=>{const m=c.match(/^let (\w+) = ([\s\S]+)$/);if(!m)return 'if (!('+expression(c)+')) return null;';let value=m[2],cast=value.match(/^([\s\S]+) as\? ([\s\S]+)$/);if(cast)value='cast('+expression(cast[1])+','+JSON.stringify(cast[2])+')';else value=expression(value);return 'let '+m[1]+' = '+value+'; if ('+m[1]+' == null) return null;'}).join('\n'));body=body.replace(/\bvar (\w+): CFTypeRef\?/g,'let $1 = null').replace(/\bvar (\w+): pid_t =/g,'let $1 =').replace(/\bvar (\w+): UInt32\? =/g,'let $1 =').replace(/var windows: \[AXUIElement\] = \[\], allMetadata: \[CUFocusMetadata\] = \[\]/g,'let windows = [], allMetadata = []').replace(/let position = rawPosition as! AXValue, size = rawSize as! AXValue/g,'let position = rawPosition, size = rawSize').replace(/var point = CGPoint.zero, dimensions = CGSize.zero/g,'let point = ({x:0,y:0}), dimensions = ({width:0,height:0})').replace(/for (\w+) in ([^\n]+) \{/g,'for (const $1 of $2) {').replace(/\.append\(/g,'.push(').replace(/before\.windows\.indices/g,'before.windows.keys()');body=expression(body).replace('let value = value;','').replace(/\bif (?!\()(.+?) \{/g,'if ($1) {');assert.ok(!/\bguard\b|\bas[?!]\b|\bCFTypeRef\b|\$0|\breturn nil\b/.test(body),name+' unsupported projection');return 'function '+name+'('+args.join(',')+'){'+body+'\n}'}
function focusHarness(mutate=()=>{}){
 const system={type:'element',id:'system'},app={type:'element',id:'app',pid:100},window={type:'element',id:'focused',pid:100,title:'Sibling',point:{x:10,y:20},size:{width:300,height:200}},other={type:'element',id:'other',pid:100,title:'Target',point:{x:40,y:50},size:{width:300,height:200}}
 const state={trusted:true,system,app,window,windows:[window,other],reads:0,mutate,attributeError:false,pidError:false,positionError:false}
 const environment={SUCCESS:0,POINT:'point',SIZE:'size',same,Number,
 kAXTitleAttribute:'title',kAXPositionAttribute:'position',kAXSizeAttribute:'size',kAXFocusedApplicationAttribute:'focusedApplication',kAXFocusedWindowAttribute:'focusedWindow',kAXWindowsAttribute:'windows',
 cast:(v,t)=>t==='String'?(typeof v==='string'?v:null):t==='pid_t'?(Number.isInteger(v)&&v>0&&v<=2147483647?v:null):t==='UInt32'?(Number.isInteger(v)&&v>0&&v<=4294967295?v:null):t==='[AnyObject]'?(Array.isArray(v)?v:null):t==='[String: CGFloat]'?(v&&typeof v==='object'&&!Array.isArray(v)?v:null):v,
 CFGetTypeID:v=>Array.isArray(v)?'array':typeof v==='string'?'string':v?.type,AXUIElementGetTypeID:()=> 'element',CFStringGetTypeID:()=> 'string',AXValueGetTypeID:()=> 'value',CFArrayGetTypeID:()=> 'array',CFArrayGetCount:a=>a.length,CFEqual:(a,b)=>a?.type==='element'&&b?.type==='element'&&a.id===b.id,
 AXUIElementGetPid:(e,set)=>{if(state.pidError)return 1;set(e.pid??0);return 0},AXIsProcessTrusted:()=>state.trusted,AXUIElementCreateSystemWide:()=>system,
 AXValueGetType:v=>v.kind,AXValueGetValue:(v,kind,set)=>{if(state.positionError)return false;set({...v.value});return v.kind===kind},
 AXUIElementCopyAttributeValue:(e,key,set)=>{if(state.attributeError)return 1;let v;if(key==='focusedApplication'){state.reads++;state.mutate(state);v=state.app}else if(key==='focusedWindow')v=state.window;else if(key==='windows')v=state.windows;else if(key==='title')v=e.title;else if(key==='position')v={type:'value',kind:'point',value:e.point};else if(key==='size')v={type:'value',kind:'size',value:e.size};if(v===undefined)return 1;set(v);return 0}}
 const code=[['cuFocusAttribute',['element','name']],['cuFocusElement',['value']],['cuFocusMetadata',['element','expectedPID']],['cuFocusEvidence',['system']],['cuFocusCGMetadata',['row','expectedPID']],['cuFocusUniqueCG',['metadata','rows']],['cuFocusedWindowId',['rows']]].map(([n,a])=>project(n,a)).join('\n')
 vm.createContext(environment);vm.runInContext(code+'\nthis.resolve=cuFocusedWindowId',environment,{timeout:1000})
 const cg=[{pid:900,name:'Overlay',windowId:90,bounds:{x:0,y:0,width:20,height:20}},{pid:100,name:'Sibling',windowId:12,bounds:{x:10,y:20,width:300,height:200}},{pid:100,name:'Target',windowId:11,bounds:{x:40,y:50,width:300,height:200}}]
 return {state,cg,resolve:()=>environment.resolve(cg),window,other}
}
test('#571 actual Swift read/selector projection: overlay is not focus; two complete reads',()=>{const h=focusHarness();assert.equal(h.resolve(),12);assert.equal(h.state.reads,2)})
test('#571 actual Swift read/selector projection: permission, status, type and metadata errors are unknown',()=>{for(const change of [h=>h.state.trusted=false,h=>h.state.attributeError=true,h=>h.state.pidError=true,h=>h.state.positionError=true,h=>h.window.title='',h=>h.window.title=42,h=>h.window.point.x=NaN,h=>h.window.size.width=Infinity,h=>h.window.size.width=0,h=>h.window.pid=200,h=>h.state.app=null,h=>h.state.window=null,h=>h.state.windows=null,h=>h.state.windows=[],h=>h.state.windows=[{type:'wrong'}],h=>h.state.windows=[h.other],h=>h.state.windows=[{...h.window,id:'not-focused'}],h=>h.state.windows=[h.window,{...h.window,title:'Other'}]]){const h=focusHarness();change(h);assert.equal(h.resolve(),null)}})
test('#571 actual Swift read/selector projection: full AX membership, duplicate metadata and 256 evidence cap',()=>{for(const change of [h=>h.state.windows=[h.window,h.window],h=>h.state.windows.push({...h.window,id:'ambiguous'}),h=>h.state.windows=[h.window,...Array.from({length:256},(_,i)=>({...h.other,id:'w'+i,title:'Other'+i}))],h=>h.state.windows[1].point.y=NaN,h=>h.state.windows[1].title='']){const h=focusHarness();change(h);assert.equal(h.resolve(),null)}const h=focusHarness();h.state.windows=Array.from({length:256},(_,i)=>i===0?h.window:{...h.other,id:'w'+i,title:'Other'+i});assert.equal(h.resolve(),12)})
test('#571 actual Swift read/selector projection: same-PID CG ambiguity/incomplete identity rejects',()=>{for(const change of [h=>h.cg.push({...h.cg[1],windowId:13}),h=>h.cg[1].pid=200,h=>h.cg[1].name='',h=>h.cg[1].bounds.x=NaN,h=>h.cg[1].windowId=0,h=>h.cg[1].bounds.width=0,h=>h.cg.push({pid:100,name:'',windowId:80,bounds:{}})]){const h=focusHarness();change(h);assert.equal(h.resolve(),null)}})
test('#571 actual Swift read/selector projection: focused pair/app/metadata/complete-array mutation rejects',()=>{for(const change of [s=>s.app={...s.app,id:'new-app'},s=>s.window=s.windows[1],s=>s.window.title='Changed',s=>s.window.point={x:11,y:20},s=>s.windows.reverse(),s=>s.windows.push({...s.windows[1],id:'new',title:'New'}),s=>s.windows[1].title='Later']){const h=focusHarness(s=>{if(s.reads===2)change(s)});assert.equal(h.resolve(),null)}})

test('#571 actual snapshot/compare heredocs retain meaning for LF and CRLF source',()=>{
 for(const source of [shell,shell.replace(/\r?\n/g,'\r\n')]){
  const body=helper('snapshot_js',source)
  const v=execute(body,{wl:{ok:true,windows:rows,foregroundWindowId:12},cur:{ok:true,x:1,y:2}},{ORACLE_WL:'wl',ORACLE_CUR:'cur',ORACLE_OUT:'out'})
  assert.equal(v.foreground,12);assert.deepEqual(v.zorder,[90,12,11])
  assert.equal(execute(helper('compare_js',source),{b:v,a:{...v,zorder:[90,11,12]}},{ORACLE_BEFORE:'b',ORACLE_AFTER:'a',ORACLE_OUT:'out'}).background_verified,false)
 }
})
test('#571 focused read boundary has no action/default/prefix fallback and publishes scalar only',()=>{
 const section=swift.slice(swift.indexOf('// #571 focus evidence'),swift.indexOf('// MARK: - window-list'))
 assert.doesNotMatch(section,/AXUIElementPerformAction|AXUIElementSetAttributeValue|AXIsProcessTrustedWithOptions|cuActivate|NSWorkspace|NSApp|CGEvent|usleep|sleep|fputs|print\(|cuJson|_AXUIElementGetWindow/)
 assert.match(section,/CFArrayGetCount\(array\) <= 256/)
 assert.ok(section.indexOf('CFArrayGetCount(array) <= 256')<section.indexOf('rawWindows as? [AnyObject]'))
 const list=swift.slice(swift.indexOf('func cuWindowList('),swift.indexOf('// MARK: - ax-probe'))
 assert.match(list,/foreground \? \(cuFocusedWindowId\(filtered\)/)
 assert.equal((list.match(/filtered\.append\(/g)||[]).length,1)
 assert.match(list,/return cuJson\(\["ok": true, "windows": filtered, "foregroundWindowId": focused\]\)/)
})
test('#571 raw CG sequence is never truncated by the separate AX 256-window evidence cap',()=>{
 const windows=Array.from({length:300},(_,i)=>({windowId:i+1,pid:i+1,layer:i%30}))
 const value=shot(windows,290);assert.equal(value.foreground,290);assert.equal(value.zorder.length,300)
 assert.deepEqual(value.zorder,windows.map(w=>w.windowId))
})

test('#571 exact correspondence rejects Unicode-normalized title aliases and out-of-range window IDs',()=>{
 const h=focusHarness();h.window.title='Cafe\u0301';h.cg[1].name='Café';assert.equal(h.resolve(),null)
 assert.match(swift,/lhs\.title\.utf8\.elementsEqual\(rhs\.title\.utf8\)/)
 assert.equal(shot([{windowId:2**32}],2**32).foreground,null)
})
