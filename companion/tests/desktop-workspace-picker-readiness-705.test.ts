/** Source-derived fixture scheduling controls; no AppKit/COM/native execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
function panelBody(){
 const source=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/workspace-acceptance.swift'),'utf8').replace(/\r\n/g,'\n')
 const matches=[...source.matchAll(/ static func panel\(_ h:NativeDesktop\)\{([\s\S]*?)\n \}/g)];assert.equal(matches.length,1)
 let body=matches[0][1]
 const pairs=[
 ['guard owner === h,h.generation==documentGeneration,let p=h.workspaceSelection,h.pickerCurrent(p),!p.settled else{pickerTimer?.invalidate();pickerTimer=nil;return}','const p=h.workspaceSelection;if(!(owner === h&&h.generation==documentGeneration&&p&&h.pickerCurrent(p)&&!p.settled)){pickerTimer?.invalidate();pickerTimer=null;return}'],
 ['guard panel.isVisible else{return}','if(!panel.isVisible)return'],
 ['guard panel.sheetParent === h.window,let directory=selection else{pickerTimer?.invalidate();pickerTimer=nil;fail(h,6);return}','const directory=selection;if(!(panel.sheetParent === h.window&&directory)){pickerTimer?.invalidate();pickerTimer=null;fail(h,6);return}'],
 ['if !cancelPicker {guard let button=panel.defaultButtonCell,button.isEnabled else{return}}','if(!cancelPicker){const button=panel.defaultButtonCell;if(!button||!button.isEnabled)return}'],
 ['else {guard let button=panel.defaultButtonCell,button.isEnabled else{fail(h,7);return};','else {const button=panel.defaultButtonCell;if(!button||!button.isEnabled){fail(h,7);return};'],
 ['if cancelPicker {','if(cancelPicker){'],
 ]
 for(const [from,to]of pairs){assert.equal(body.split(from).length-1,1,from);body=body.replace(from,to)}
 body=body.replace('if !directoryPrepared {','if(!directoryPrepared){').replace(/\bnil\b/g,'null')
 assert.doesNotMatch(body,/\bguard\b|\belse\s*\{\s*return\s*\}/)
 return vm.runInNewContext('(function(state){with(state){'+body+'}})',{},{timeout:1000}) as (s:any)=>void
}
function fixture(options:{disabled?:boolean;missing?:boolean;delayed?:boolean;visible?:boolean;foreign?:boolean;cancel?:boolean}={}){
 const calls:string[]=[],h:any={generation:'owned-document',window:{},authenticated:true,requests:{'desktop.workspace.pick':{}},pickerCurrent:()=>true};let enabled=!options.disabled&&!options.delayed
 const button={get isEnabled(){return enabled},performClick(){calls.push('CLICK')}}
 const panel:any={isVisible:options.visible!==false,sheetParent:options.foreign?{}:h.window,cancel(){calls.push('CANCEL')}}
 Object.defineProperty(panel,'directoryURL',{set(){calls.push('DIRECTORY');if(!options.delayed)enabled=true}})
 Object.defineProperty(panel,'defaultButtonCell',{get(){calls.push('BUTTON');return options.missing?undefined:button}})
 h.workspaceSelection={panel,settled:false}
 const s:any={owner:h,documentGeneration:h.generation,selection:{owned:true},cancelPicker:!!options.cancel,directoryPrepared:false,panels:0,pickerTimer:{invalidate(){calls.push('RETIRE_TIMER')}},note:()=>{},emit:()=>calls.push('ATTEMPT_RECEIPT'),fail:()=>calls.push('FAIL'),h}
 return{s,calls,ready:()=>{enabled=true}}
}
test('705 actual Mac panel body selects the owned directory before requiring an enabled OK button',()=>{const f=fixture({disabled:true});panelBody()(f.s);assert.equal(f.calls.filter(x=>x==='DIRECTORY').length,1);assert.equal(f.calls.filter(x=>x==='CLICK').length,1);assert.ok(f.calls.indexOf('DIRECTORY')<f.calls.indexOf('BUTTON'))})
test('705 actual Mac panel body does not repeatedly reset a directory while waiting for the real button',()=>{const f=fixture({delayed:true}),call=panelBody();call(f.s);assert.equal(f.calls.filter(x=>x==='DIRECTORY').length,1);assert.equal(f.calls.includes('CLICK'),false);assert.equal(f.calls.includes('RETIRE_TIMER'),false);f.ready();call(f.s);assert.equal(f.calls.filter(x=>x==='DIRECTORY').length,1);assert.equal(f.calls.filter(x=>x==='CLICK').length,1)})
test('705 actual Mac missing public button remains pending, never fabricates success',()=>{const f=fixture({missing:true});panelBody()(f.s);assert.equal(f.calls.includes('CLICK'),false);assert.equal(f.calls.includes('ATTEMPT_RECEIPT'),false);assert.equal(f.calls.includes('RETIRE_TIMER'),false)})
for(const options of [{visible:false},{foreign:true}])test('705 actual Mac panel rejects an unobserved or foreign-owned panel '+JSON.stringify(options),()=>{const f=fixture(options);panelBody()(f.s);assert.equal(f.calls.includes('DIRECTORY'),false);assert.equal(f.calls.includes('CLICK'),false)})
test('705 actual Mac exact cancellation keeps real panel cancel with no OK action',()=>{const f=fixture({cancel:true,missing:true});panelBody()(f.s);assert.equal(f.calls.filter(x=>x==='CANCEL').length,1);assert.equal(f.calls.includes('CLICK'),false)})


test('705 actual workspace fixture generator keeps both normal providers byte exact for LF and CRLF',async()=>{
 const {pathToFileURL}=await import('node:url'),url=pathToFileURL(path.resolve('scripts/desktop-mcp-fixture.mjs')).href
 const maker=await (new Function('url','return import(url)'))(url)
 const form=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/workspace-form.js'),'utf8')
 for(const language of ['cpp','swift'])for(const eol of ['\n','\r\n']){
  const normal=fs.readFileSync(path.resolve('src/desktop/native/DesktopHost.'+language),'utf8').replace(/\r?\n/g,eol)
  const fixture=fs.readFileSync(path.resolve('tests/fixtures/desktop-476/workspace-acceptance.'+language),'utf8').replace(/\r?\n/g,eol)
  const variant=maker.desktopWorkspaceFixture(language,normal,fixture,form)
  assert.equal(variant.inverse,normal);assert.ok(variant.source.includes('D476_WS_PICKER_SELECTED'))
  if(language==='swift')assert.ok(variant.source.includes('directoryPrepared=true'))
 }
})
