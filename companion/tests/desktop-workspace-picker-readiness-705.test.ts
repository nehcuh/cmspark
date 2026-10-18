/** Source-derived fixture scheduling controls; no AppKit/COM/native execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
function panelBody(){
 const source=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/workspace-acceptance.swift'),'utf8').replace(/\r\n/g,'\n')
 const matches=[...source.matchAll(/ static func panel\(_ h:NativeDesktop\)\{([\s\S]*?)\n \}/g)];assert.equal(matches.length,1);let body=matches[0][1]
 for(const [from,to]of[
 ['guard pickerTimer != nil else{return}','if(pickerTimer===null)return'],
 ['guard owner === h,h.generation==documentGeneration,let p=h.workspaceSelection,h.pickerCurrent(p),!p.settled else{pickerTimer?.invalidate();pickerTimer=nil;return}','const p=h.workspaceSelection;if(!(owner === h&&h.generation==documentGeneration&&p&&h.pickerCurrent(p)&&!p.settled)){pickerTimer?.invalidate();pickerTimer=null;return}'],
 ['guard panel.isVisible else{return}','if(!panel.isVisible)return'],
 ['guard panel.sheetParent === h.window,selection != nil,!uiNonce.isEmpty else{pickerTimer?.invalidate();pickerTimer=nil;fail(h,6);return}','if(!(panel.sheetParent===h.window&&selection!==null&&uiNonce.length>0)){pickerTimer?.invalidate();pickerTimer=null;fail(h,6);return}']
 ]){assert.equal(body.split(from).length,2);body=body.replace(from,to)}
 body=body.replace(/\bnil\b/g,'null');assert.doesNotMatch(body,/\bguard\b|defaultButtonCell|directoryURL|performClick/)
 return vm.runInNewContext('(function(s){with(s){'+body+'}})',{},{timeout:1000}) as(s:any)=>void
}
function fixture(options:{visible?:boolean;foreign?:boolean;cancel?:boolean;stale?:boolean}={}){
 const calls:string[]=[],h:any={generation:'owned-document',window:{},authenticated:true,requests:{'desktop.workspace.pick':{}},pickerCurrent:()=>!options.stale};const panel={isVisible:options.visible!==false,sheetParent:options.foreign?{}:h.window}
 h.workspaceSelection={panel,settled:false};const s:any={owner:h,documentGeneration:h.generation,selection:{owned:true},uiNonce:'a'.repeat(64),cancelPicker:!!options.cancel,panels:options.cancel?1:0,pickerTimer:{invalidate(){calls.push('RETIRE_TIMER')}},note:()=>{},emit:(_h:any,id:string)=>calls.push(id),fail:()=>calls.push('FAIL'),h};return{s,calls,panel}
}
test('705 actual Mac retained panel publishes readiness without programmatic selection',()=>{const f=fixture(),run=panelBody();run(f.s);assert.deepEqual(f.calls,['RETIRE_TIMER','D476_WS_PICKER_SELECTED']);assert.equal(f.s.panels,1);run(f.s);assert.equal(f.s.panels,1)})
test('705 Mac readiness waits for genuine visibility without navigating',()=>{const f=fixture({visible:false}),run=panelBody();run(f.s);assert.equal(f.calls.length,0);f.panel.isVisible=true;run(f.s);assert.equal(f.calls.includes('D476_WS_PICKER_SELECTED'),true)})
test('705 Mac unowned panel cannot publish readiness',()=>{const f=fixture({foreign:true});panelBody()(f.s);assert.equal(f.calls.includes('FAIL'),true);assert.equal(f.s.panels,0)})
test('705 Mac retired tuple cannot publish readiness',()=>{const f=fixture({stale:true});panelBody()(f.s);assert.deepEqual(f.calls,['RETIRE_TIMER']);assert.equal(f.s.panels,0)})
test('705 Mac second panel only reports cancellation readiness without synthesizing cancel',()=>{const f=fixture({cancel:true});panelBody()(f.s);assert.deepEqual(f.calls,['RETIRE_TIMER','D476_WS_PICKER_CANCELLED']);assert.equal(f.s.panels,2)})
test('705 Mac empty correlator refuses without any UI event',()=>{const f=fixture();f.s.uiNonce='';panelBody()(f.s);assert.equal(f.calls.includes('FAIL'),true);assert.equal(f.s.panels,0)})

test('705 actual workspace fixture generator keeps both normal providers byte exact for LF and CRLF',async()=>{
 const {pathToFileURL}=await import('node:url'),url=pathToFileURL(path.resolve('scripts/desktop-mcp-fixture.mjs')).href
 const maker=await (new Function('url','return import(url)'))(url)
 const form=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/workspace-form.js'),'utf8')
 for(const language of ['cpp','swift'])for(const eol of ['\n','\r\n']){
  const normal=fs.readFileSync(path.resolve('src/desktop/native/DesktopHost.'+language),'utf8').replace(/\r?\n/g,eol)
  const fixture=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/workspace-acceptance.'+language),'utf8').replace(/\r?\n/g,eol)
  const variant=maker.desktopWorkspaceFixture(language,normal,fixture,form)
  assert.equal(variant.inverse,normal);assert.ok(variant.source.includes('D476_WS_PICKER_SELECTED'))
  if(language==='swift')assert.ok(variant.source.includes('setAccessibilityIdentifier(nonce)'))
 }
})


// Exact current C++ panel body; COM/window boundaries are inert, never native execution.
function windowsPanelBody(override?:string){
 const source=(override??fs.readFileSync(path.resolve('tests/fixtures/desktop-476/workspace-acceptance.cpp'),'utf8')).replace(/\r\n/g,'\n')
 const start=source.indexOf('void D476Acceptance::panel(Desktop& h){');assert.ok(start>=0);const open=source.indexOf('{',start);let depth=1,end=open+1
 while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++}assert.equal(depth,0)
 let body=source.slice(open+1,end-1)
 body=body.replace(/ComPtr<([^>]+)> (\w+);/g,'let $2=box();').replace(/HWND (\w+)=nullptr;/g,'let $1=box();').replace(/int (\w+)=1;/g,'let $1=box(1);')
 body=body.replace(/auto (\w+)=/g,'let $1=').replace(/->/g,'.').replace(/\.As\(&owned\)/g,'.As(owned)').replace(/GetWindow\(&dialog\)/g,'GetWindow(dialog)').replace(/,&order\)/g,',order)')
 body=body.replace(/\border!=0\b/g,'order.value!=0')
 // HWND uses a box only in the legacy body; other native handles are already opaque values.
 body=body.replace(/!IsWindowVisible\(dialog\)/g,'!IsWindowVisible(unbox(dialog))').replace(/d476OwnedDialog705\(dialog,h.window\)/g,'d476OwnedDialog705(unbox(dialog),h.window)').replace(/GetForegroundWindow\(\)==dialog/g,'GetForegroundWindow()==unbox(dialog)').replace(/GetDlgItem\(dialog,IDOK\)/g,'GetDlgItem(unbox(dialog),IDOK)').replace(/IsWindow\(dialog\)/g,'IsWindow(unbox(dialog))')
 body=body.replace(/\(void\)/g,'').replace(/L"/g,'"').replace(/\bnullptr\b/g,'null').replace(/(?<!&)&h\b/g,'h').replace(/\b(\d+)u\b/g,'$1').replace(/owned\.GetWindow/g,'owned.Get().GetWindow').replaceAll('pickerNonce.clear()','pickerNonce=\"\"').replace(/folder\.Compare/g,'folder.Get().Compare').replace('!folder||!expectedDirectory','!folder.Get()||!expectedDirectory.Get()')
 assert.doesNotMatch(body,/ComPtr|\bHWND\b|\bint\b|->|GetWindow\(&|,&order/)
 return vm.runInNewContext('(function(state){with(state){'+body+'}})',{},{timeout:1000}) as (s:any)=>void
}
function windowsFixture(options:any={}){
 const calls:string[]=[],window={},actualWindow={};let arrived=!!options.arrived,valid=true
 const box=(value:any=null)=>({value,Get(){return this.value},GetAddressOf(){return this},Reset(){this.value=null}}),unbox=(x:any)=>x&&Object.hasOwn(x,'value')?x.value:x
 const item=(kind:any)=>({Compare(other:any,hint:any,out:any){calls.push('COMPARE');if(options.compareReentrant)valid=false;out.value=options.orderMismatch?1:kind===other.kind?0:1;return options.compareFail?-1:options.compareFalse?1:kind===other.kind?0:1},kind})
 const dialog:any={As(out:any){out.value={GetWindow(out:any){out.value=actualWindow;return 0}};return 0},SetFolder(value:any){calls.push('SET_FOLDER');options.onSet?.(state);if(options.reentrant)valid=false;if(options.dialogReplacement)p.dialog=box({foreign:true});return options.setFail?-1:0},GetFolder(out:any){calls.push('GET_FOLDER');if(options.folderReentrant)valid=false;out.value=options.folderNull?null:item(arrived?'expected':'foreign');return options.folderFail?-1:options.folderFalse?1:0},Close(){calls.push('CANCEL');return 0}}
 const p:any={dialog:box(dialog),nonce:'owned-nonce',settled:false};const h:any={workspace_selection:p,window,generation:'owned-generation',picker_current:(candidate:any)=>candidate===h.workspace_selection&&valid&&!options.staleCurrent}
 const state:any={h,owner:options.staleOwner?{}:h,documentGeneration:options.staleGeneration?'old':'owned-generation',pickerNonce:options.staleNonce?'old':'owned-nonce',cancelPicker:!!options.cancel,panels:0,navigationStarted:false,expectedDirectory:box(),selection:{c_str:()=>'/owned/target'},box,unbox,
 FAILED:(n:number)=>n<0,S_OK:0,SICHINT_CANONICAL:0x10000000,IID_PPV_ARGS:(x:any)=>x,SHCreateItemFromParsingName(_s:any,_n:any,out:any){calls.push('CREATE_ITEM');out.value=item('expected');options.onCreate?.(state);return 0},
 KillTimer(){calls.push('KILL_TIMER')},d476OwnedDialog705:(_d:any,_w:any)=>!options.foreignWindow,IsWindowVisible:()=>true,GetForegroundWindow:()=>actualWindow,GetDlgItem:()=>options.noButton?null:{owned:true},IDOK:1,IsWindowEnabled:()=>!options.disabledButton,IsWindow:()=>true,
 fail:(_h:any,code:number)=>calls.push('FAIL_'+code),note:()=>{},emit:()=>calls.push('ATTEMPT'),SendMessageW:()=>calls.push('CLICK'),BM_CLICK:245,HRESULT_FROM_WIN32:(x:any)=>x,ERROR_CANCELLED:1223}
 // Pointer methods on the inert ComPtr retain the actual same dialog identity.
 state.owned=undefined;Object.assign(p.dialog,{As:dialog.As.bind(dialog),SetFolder:dialog.SetFolder.bind(dialog),GetFolder:dialog.GetFolder.bind(dialog),Close:dialog.Close.bind(dialog)})
 return{state,calls,arrive(){arrived=true}}
}
test('705 actual Windows panel waits for canonical current folder before its unique OK',()=>{const f=windowsFixture(),run=windowsPanelBody();run(f.state);assert.equal(f.calls.filter(v=>v==='SET_FOLDER').length,1);assert.equal(f.calls.includes('CLICK'),false);assert.equal(f.calls.includes('KILL_TIMER'),false);f.arrive();run(f.state);assert.equal(f.calls.filter(v=>v==='SET_FOLDER').length,1);assert.equal(f.calls.filter(v=>v==='CLICK').length,1);run(f.state);assert.equal(f.calls.filter(v=>v==='CLICK').length,1)})
for(const option of ['staleOwner','staleGeneration','staleNonce','staleCurrent','foreignWindow','setFail','folderFail','folderFalse','folderNull','compareFail','compareFalse','orderMismatch','folderReentrant','compareReentrant','dialogReplacement','noButton','disabledButton','reentrant'])test('705 actual Windows panel refuses premature OK: '+option,()=>{const f=windowsFixture({arrived:true,[option]:true}),run=windowsPanelBody();run(f.state);assert.equal(f.calls.includes('CLICK'),false);if(['staleOwner','staleGeneration','staleNonce','staleCurrent','foreignWindow'].includes(option))assert.equal(f.calls.includes('SET_FOLDER'),false);assert.ok(f.calls.filter(v=>v==='SET_FOLDER').length<=1)})
test('705 actual Windows cancel remains the same owned dialog Close with no navigation or OK',()=>{const f=windowsFixture({cancel:true}),run=windowsPanelBody();run(f.state);assert.equal(f.calls.filter(v=>v==='CANCEL').length,1);assert.equal(f.calls.includes('SET_FOLDER'),false);assert.equal(f.calls.includes('CLICK'),false)})

test('705 actual Windows ready folder permits one real OK without an explicit child selection API',()=>{const f=windowsFixture({arrived:true}),run=windowsPanelBody();run(f.state);run(f.state);assert.equal(f.calls.filter(v=>v==='CLICK').length,1);assert.equal(f.calls.filter(v=>v==='SET_FOLDER').length,1);assert.equal(f.calls.filter(v=>v==='GET_FOLDER').length,1);assert.equal(f.calls.filter(v=>v==='COMPARE').length,1)})
test('705 Windows readiness controls reject bypassed folder and canonical-order predicates',()=>{
 const file=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/workspace-acceptance.cpp'),'utf8')
 for(const [from,to,options]of [
  ['folder->Compare(expectedDirectory.Get(),SICHINT_CANONICAL,&order)!=S_OK||order!=0','false',{arrived:false}],
  ['folder->Compare(expectedDirectory.Get(),SICHINT_CANONICAL,&order)!=S_OK','(folder->Compare(expectedDirectory.Get(),SICHINT_CANONICAL,&order),false)',{arrived:true,compareFalse:true}],
  ['||order!=0','',{arrived:true,orderMismatch:true}],
  ['activeDialog->GetFolder(folder.GetAddressOf())!=S_OK','(activeDialog->GetFolder(folder.GetAddressOf()),false)',{arrived:true,folderFail:true}],
 ]as const){assert.equal(file.split(from).length,2);const f=windowsFixture(options);windowsPanelBody(file.replace(from,to))(f.state);assert.equal(f.calls.includes('CLICK'),true,from)}
})

for(const eol of ['\n','\r\n'])test('705 actual Windows panel canonical arrival is newline independent '+JSON.stringify(eol),()=>{const source=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/workspace-acceptance.cpp'),'utf8').replace(/\r?\n/g,eol),run=windowsPanelBody(source),f=windowsFixture();run(f.state);run(f.state);assert.equal(f.calls.filter(v=>v==='SET_FOLDER').length,1);assert.equal(f.calls.includes('CLICK'),false);f.arrive();run(f.state);run(f.state);assert.equal(f.calls.filter(v=>v==='CLICK').length,1)})

test('705 failed one-shot navigation cannot act from a queued observation after timer retirement',()=>{const f=windowsFixture({arrived:true,setFail:true}),run=windowsPanelBody();run(f.state);run(f.state);assert.equal(f.calls.filter(v=>v==='SET_FOLDER').length,1);assert.equal(f.calls.includes('GET_FOLDER'),false);assert.equal(f.calls.includes('CLICK'),false);assert.equal(f.calls.filter(v=>v==='FAIL_12').length,1)})

// Actual whole C++ callback: reentrant shell creation must not navigate a retired tuple.
for(const mode of ['generation','settled','nonce','dialog'])test('705 root shell creation retirement forbids navigation: '+mode,()=>{
 const options:any={arrived:true,onCreate(s:any){if(mode==='generation')s.h.generation='retired';else if(mode==='settled')s.h.workspace_selection.settled=true;else if(mode==='nonce')s.pickerNonce='retired';else s.h.workspace_selection.dialog=s.box({foreign:true})}}
 const f=windowsFixture(options);windowsPanelBody()(f.state);assert.equal(f.calls.filter(x=>x==='CREATE_ITEM').length,1);assert.equal(f.calls.includes('SET_FOLDER'),false);assert.equal(f.calls.includes('CLICK'),false)
})
for(const phase of ['onCreate','onSet'])test('705 root nested panel cannot consume navigation in flight: '+phase,()=>{
 const options:any={arrived:true},f=windowsFixture(options),run=windowsPanelBody();let nested=0
 options[phase]=(s:any)=>{nested++;const before=f.calls.length;run(s);assert.equal(f.calls.slice(before).includes('SET_FOLDER'),false);assert.equal(f.calls.slice(before).includes('GET_FOLDER'),false);assert.equal(f.calls.slice(before).includes('CLICK'),false);assert.equal(s.pickerNonce,'owned-nonce')}
 run(f.state);assert.equal(nested,1);assert.equal(f.calls.filter(x=>x==='CREATE_ITEM').length,1);assert.equal(f.calls.filter(x=>x==='SET_FOLDER').length,1);assert.equal(f.calls.filter(x=>x==='CLICK').length,1)
})

test('705 root retired navigation cannot stop a new request observation timer',()=>{
 const f=windowsFixture({arrived:true,onCreate(s:any){s.h.workspace_selection={...s.h.workspace_selection,nonce:'next-owned-nonce',dialog:s.box({next:true})}}});windowsPanelBody()(f.state);assert.equal(f.calls.includes('SET_FOLDER'),false);assert.equal(f.calls.includes('KILL_TIMER'),false);assert.equal(f.calls.includes('CLICK'),false)
})
