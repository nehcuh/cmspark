/** Test-only script-install predicate. No WebView, native input, shell, or PTY. */
import test, {afterEach} from 'node:test'
import {cpuTerminalAdapter747,cleanupCpuTerminalAdapters747} from './fixtures/desktop-476/terminal-parser-cpu'
afterEach(cleanupCpuTerminalAdapters747)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
const root=path.resolve(__dirname,'../..')
const read=(p:string)=>fs.readFileSync(path.join(root,p),'utf8')
const form=read('tests/fixtures/desktop-476/terminal-form.js')
function controller(language:'cpp'|'swift'){return read('tests/fixtures/desktop-476/terminal-acceptance.'+language)}
function installScript(language:'cpp'|'swift') {
 const source=controller(language),line=source.split(/\r?\n/).filter(s=>s.includes('code=')&&s.includes('D705_TERMINAL_FORM_SOURCE'))
 assert.equal(line.length,1,'unique actual native script construction')
 const tail=line[0].split('D705_TERMINAL_FORM_SOURCE')[1].replace(/;$/,'').trim()
 const suffix=tail?JSON.parse(tail.replace(/^\+L?/,'')):''
 return 'const documentGeneration="owned-install";'+form+suffix
}
function evaluate(code:string,throwInActualForm=false) {
 const frames:unknown[]=[],events:string[]=[],window:any={Terminal:cpuTerminalAdapter747(()=>{throw Error('INSTALL_MUST_NOT_OPEN_CPU_TERMINAL')},[]),cmsparkDesktopReceive() {},chrome:{webview:{postMessage:(frame:unknown)=>frames.push(frame)}}}
 const document={addEventListener:(name:string)=>events.push(name),getElementById(){if(throwInActualForm)throw Error('CONTROLLED_FORM_FAILURE');return{textContent:'waiting'}}}
 let value:unknown,error:unknown
 try{value=vm.runInNewContext(code,{window,document,TextDecoder,TextEncoder,Uint8Array},{timeout:2000})}catch(e){error=e}
 return {value,error,frames,events,window}
}
for(const language of ['cpp','swift'] as const)test('actual '+language+' install script returns only fixed true after whole form installs',()=>{
 const good=evaluate(installScript(language));assert.equal(good.error,undefined);assert.equal(good.value,true);assert.equal(good.frames.length,0);assert.deepEqual(good.events,['keydown','keyup'])
 const bad=evaluate(installScript(language),true);assert.ok(bad.error);assert.equal(bad.value,undefined);assert.equal(bad.frames.length,0)
})
test('actual C++ completion rejects null/false/wrong result and retains HRESULT/current fences',()=>{
 const source=controller('cpp'),matches=[...source.matchAll(/\[&h\]\(HRESULT status,LPCWSTR(?: scriptResult)?\)->HRESULT\{if\(([^\n]+?)\)failure\(h(?:,[1-9][0-9]?)?\);return S_OK;\}/g)]
 assert.equal(matches.length,1,'unique actual ExecuteScript callback')
 const condition=matches[0][1].replace('FAILED(status)','(status<0)').replace('current(h)','isCurrent').replace('std::wstring(scriptResult)!=L"true"','scriptResult!=="true"')
 const refuses=new Function('status','scriptResult','isCurrent','return '+condition) as (status:number,result:unknown,isCurrent:boolean)=>boolean
 assert.equal(refuses(0,'true',true),false)
 for(const result of [null,undefined,'null','false','1','"true"',' true','true ',{},true])assert.equal(refuses(0,result,true),true)
 assert.equal(refuses(-1,'true',true),true);assert.equal(refuses(0,'true',false),true)
})
test('actual Swift completion requires CFBoolean true, error-free and current owner',()=>{
 const source=controller('swift'),start=source.indexOf('web.evaluateJavaScript(code)'),end=source.indexOf('\n    }',start);assert.ok(start>=0&&end>start)
 const callback=source.slice(start,end)
 for(const exact of ['{result,error in','error == nil,current(h),let installed=result as? NSNumber','CFGetTypeID(installed)==CFBooleanGetTypeID(),installed.boolValue','else{failure(h);return}'])assert.ok(callback.includes(exact),exact)
 assert.equal(callback.includes('as? Bool'),false,'NSNumber(1) must not be accepted as an actual JS Boolean')
})
test('both test-only variants invert whole product sources in LF/CRLF and preserve actual form',()=>{
 const {desktopTerminalFixture}=require(path.join(root,'scripts/desktop-terminal-fixture.mjs'))
 for(const language of ['cpp','swift'] as const)for(const crlf of [false,true]){
  const raw=read('src/desktop/native/DesktopHost.'+language),original=crlf?raw.replace(/\r?\n/g,'\r\n'):raw,variant=desktopTerminalFixture(language,original,controller(language),form)
  assert.equal(variant.inverse,original);assert.ok(variant.source.includes(JSON.stringify(form)));assert.equal(variant.source.includes('D705_TERMINAL_FORM_SOURCE'),false)
 }
})
