/** CPU propagation model using the actual pinned xterm methods and whole native form.
 * This neither dispatches a DOM event nor supplies a native-input receipt. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root=path.resolve(__dirname,path.basename(path.dirname(__dirname))==='.test-dist'?'../..':'..')
const form=fs.readFileSync(path.join(root,'tests/fixtures/desktop-476/terminal-form.js'),'utf8')
const vendor=fs.readFileSync(require.resolve('@xterm/xterm'))
const {transformXtermStyleNonce,XTERM_VERSION}=require(path.join(root,'scripts/desktop-xterm-style-nonce.cjs'))

function keyboard(source:string) {
 const ast=ts.createSourceFile('xterm.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
 const factories=new Map<number,ts.FunctionExpression|ts.ArrowFunction>(),classes:ts.ClassLikeDeclaration[]=[]
 const names=['_keyDown','_isThirdLevelShift','cancel']
 function visit(n:ts.Node){
  if(ts.isPropertyAssignment(n)&&ts.isNumericLiteral(n.name)&&(ts.isFunctionExpression(n.initializer)||ts.isArrowFunction(n.initializer)))factories.set(+n.name.text,n.initializer)
  if((ts.isClassExpression(n)||ts.isClassDeclaration(n))&&names.every(name=>n.members.some(m=>m.name?.getText(ast)===name)))classes.push(n)
  ts.forEachChild(n,visit)
 }
 visit(ast);assert.equal(classes.length,1)
 const loaded=new Map<number,any>()
 function load(id:number):any{
  if(loaded.has(id))return loaded.get(id)
  assert.ok(factories.has(id));assert.ok(loaded.size<2,'only actual keyboard and escape constants, no DOM module')
  const exports={};loaded.set(id,exports)
  const fn=vm.runInNewContext('('+factories.get(id)!.getText(ast)+')',{}, {timeout:1000})
  fn({exports},exports,load);return exports
 }
 const keys=load(706),constants=[...loaded.values()].find(x=>x.C0)
 assert.deepEqual([...loaded.keys()],[706,3534]);assert.ok(constants)
 const members=classes[0].members.filter(m=>names.includes(m.name?.getText(ast)??'')).map(m=>m.getText(ast)).join('\n')
 const Actual=vm.runInNewContext('(function(D,E){return class{'+members+'}})',{}, {timeout:1000})(keys,constants)
 return {Actual,members}
}
const actual=keyboard(vendor.toString('utf8'))

function scenario(options:{trusted?:boolean;wrongTarget?:boolean;wrongActive?:boolean;duplicate?:boolean}={}) {
 const frames:any[]=[],listeners=new Map<string,{fn:(e:any)=>void;capture:boolean}>()
 const nodes=new Map<string,any>()
 const document:any={activeElement:null,addEventListener(name:string,fn:(e:any)=>void,capture?:boolean){
  assert.equal(listeners.has(name),false);listeners.set(name,{fn,capture:capture===true})
 },getElementById(id:string){return nodes.get(id)}}
 function element(id:string){const node:any={id,disabled:false,textContent:'',focus(){document.activeElement=node}};nodes.set(id,node);return node}
 for(const id of ['status','local-terminal-open','local-refresh','local-stop','local-select','local-return','dialog-history','local-feedback'])element(id)
 const row=element('owned-row'),dialog=element('owned-dialog'),textarea=element('owned-textarea')
 row.getAttribute=dialog.getAttribute=()=> 'native-terminal-A'
 element('list').querySelectorAll=(selector:string)=>selector.includes('local')?[row]:[dialog]
 element('local-terminals').querySelector=(selector:string)=>{assert.equal(selector,'.xterm-helper-textarea');return textarea}
 const window:any={cmsparkDesktopReceive(){},chrome:{webview:{postMessage:(f:any)=>frames.push(f)}}}
 vm.runInNewContext(form,{window,document,documentGeneration:'owned-generation',TextDecoder,TextEncoder,Uint8Array,atob},{timeout:1000})
 const receive=window.cmsparkDesktopReceive
 const down=listeners.get('keydown')!
 const pressButton=()=>down.fn({key:'Enter',isTrusted:true,target:document.activeElement})
 const state=()=>receive({type:'desktop.local.state.result',ok:true,thread_id:'native-terminal-A',state:{bound:true,modules:{terminal:true,agent:false},platform:'macos'}})
 receive({type:'thread.list'});pressButton();state();pressButton()
 receive({type:'desktop.terminal.open.result',thread_id:'native-terminal-A',ok:false,error_code:'LOCAL_DENIED'});pressButton();state();pressButton()
 receive({type:'desktop.terminal.open.result',thread_id:'native-terminal-A',ok:false,error_code:'LOCAL_DENIED'});pressButton();state();pressButton()
 receive({type:'desktop.terminal.open.result',thread_id:'native-terminal-A',ok:true,status:'running'})
 assert.equal(document.activeElement,textarea)
 let stopped=false,prevented=false
 const emitted:string[]=[]
 const core:any={browser:{isMac:true,isWindows:false},options:{macOptionIsMeta:false,scrollOnUserInput:false},optionsService:{rawOptions:{screenReaderMode:false}},_compositionHelper:{keydown:()=>true},coreService:{decPrivateModes:{applicationCursorKeys:false},triggerDataEvent:(key:string)=>emitted.push(key)},textarea,_onKey:{fire(){}},_showCursor(){},updateCursorStyle(){},_isThirdLevelShift:actual.Actual.prototype._isThirdLevelShift,cancel:actual.Actual.prototype.cancel}
 if(options.wrongActive)document.activeElement=row
 const event={key:'Enter',keyCode:13,which:13,type:'keydown',isTrusted:options.trusted!==false,target:options.wrongTarget?row:textarea,ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,getModifierState:()=>false,preventDefault(){prevented=true},stopPropagation(){stopped=true}}
 // Standard propagation order: document capture -> xterm target -> document bubble.
 if(down.capture)down.fn(event)
 actual.Actual.prototype._keyDown.call(core,event)
 if(!stopped&&!down.capture)down.fn(event)
 if(options.duplicate)down.fn(event)
 assert.deepEqual(emitted,['\r']);assert.equal(stopped,true);assert.equal(prevented,true)
 receive({type:'desktop.terminal.data',thread_id:'native-terminal-A',b64:Buffer.from('D476_TERMINAL_中'+'x'.repeat(17000)).toString('base64')})
 receive({type:'desktop.terminal.ack.result',thread_id:'native-terminal-A',ok:true})
 return {frames,receive,pressButton,document,nodes,listeners}
}

test('whole native form observes trusted terminal Enter before actual xterm stops bubbling',()=>{
 const s=scenario(),ids=s.frames.map(f=>f.id)
 assert.ok(ids.includes('D476_TERMINAL_OUTPUT'),'real fixture must observe Enter as well as output and ACK')
 assert.ok(ids.includes('D476_TERMINAL_RESIZE'));assert.equal(ids.includes('D476_TERMINAL_FAIL'),false)
 // Retain the original remaining button/key masks and the selection keyup path.
 s.receive({type:'desktop.terminal.resize.result',ok:true});s.pressButton()
 s.receive({type:'desktop.terminal.close.result',ok:true,status:'closed'});s.pressButton()
 s.nodes.get('local-feedback').textContent='已选择'
 s.listeners.get('keyup')!.fn({key:'Enter',isTrusted:true,target:s.nodes.get('local-select')});s.pressButton()
 s.receive({type:'desktop.terminal.return.result',ok:true,status:'saved',partial:true});s.pressButton()
 s.nodes.get('dialog-history').textContent='D476_TERMINAL_中 partial'
 s.receive({type:'desktop.thread.open.result',ok:true,thread_id:'native-terminal-A',history:{messages:[{content:'D476_TERMINAL_中 partial'}]}})
 assert.ok(s.frames.some(f=>f.id==='D476_TERMINAL_DONE'));assert.equal(s.frames.some(f=>f.id==='D476_TERMINAL_FAIL'),false)
 assert.equal(s.listeners.get('keyup')!.capture,false)
})
for(const [name,options] of Object.entries({untrusted:{trusted:false},wrongTarget:{wrongTarget:true},wrongActive:{wrongActive:true},duplicate:{duplicate:true}}))test('terminal capture preserves '+name+' rejection',()=>{
 const s=scenario(options);assert.ok(s.frames.some(f=>f.id==='D476_TERMINAL_FAIL'))
 if(name!=='duplicate')assert.equal(s.frames.some(f=>f.id==='D476_TERMINAL_OUTPUT'),false)
})
test('shipped nonce transform preserves the actual pinned keyboard methods',()=>{
 const transformed=transformXtermStyleNonce(vendor,XTERM_VERSION)
 assert.equal(keyboard(transformed.toString('utf8')).members,actual.members)
})
