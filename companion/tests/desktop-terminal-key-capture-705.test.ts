import { parsedMarker747 as nodeParsedMarker747 } from './helpers/terminal-observer-747'
/** CPU propagation model using the actual pinned xterm methods and whole native form.
 * This neither dispatches a DOM event nor supplies a native-input receipt. */
import test, {afterEach} from 'node:test'
import {cpuTerminalAdapter747,cleanupCpuTerminalAdapters747,createNoOpenTerminal747} from './fixtures/desktop-476/terminal-parser-cpu'
afterEach(cleanupCpuTerminalAdapters747)
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

async function scenario(options:{trusted?:boolean;wrongTarget?:boolean;wrongActive?:boolean;duplicate?:boolean}={}) {
 const frames:any[]=[],listeners=new Map<string,{fn:(e:any)=>void;capture:boolean}>()
 const nodes=new Map<string,any>()
 const document:any={activeElement:null,addEventListener(name:string,fn:(e:any)=>void,capture?:boolean){
  assert.equal(listeners.has(name),false);listeners.set(name,{fn,capture:capture===true})
 },getElementById(id:string){return nodes.get(id)}}
 // This is the existing inert keyboard/identity seam, not native DOM truth.
 function element(id:string,rootConnected=true){const node:any={id,disabled:false,textContent:'',children:[],attributes:{},ownerDocument:document,parentElement:null,get isConnected():boolean{return rootConnected||this.parentElement?.isConnected===true},contains(target:any):boolean{return this===target||this.children.some((child:any)=>child.contains(target))},setAttribute(k:string,v:string){this.attributes[k]=v},getAttribute(k:string){return this.attributes[k]},append(child:any){child.parentElement=this;this.children.push(child)},focus(){document.activeElement=node}};nodes.set(id,node);return node}
 for(const id of ['status','local-terminal-open','local-refresh','local-stop','local-select','local-return','dialog-history','local-feedback'])element(id)
 const row=element('owned-row'),dialog=element('owned-dialog'),textarea=element('owned-textarea')
 row.getAttribute=dialog.getAttribute=()=> 'native-terminal-A'
 element('list').querySelectorAll=(selector:string)=>selector.includes('local')?[row]:[dialog]
 element('local-terminals').querySelector=(selector:string)=>{assert.equal(selector,'.xterm-helper-textarea');return textarea}
 const terminals:any[]=[],operation='owned-key-capture',Terminal=cpuTerminalAdapter747(id=>id==='owned-xterm-textarea'?textarea:element(id,false),terminals)
 const window:any={Terminal,cmsparkDesktopReceive(frame:any){
  if(frame.type==='desktop.terminal.open.result'&&frame.ok===true){const holder=element('owned-terminal-holder',false);holder.setAttribute('data-local-terminal',frame.operation_id);nodes.get('local-terminals').append(holder);const terminal=new window.Terminal();terminal.open(holder)}
  if(frame.type==='desktop.terminal.data'&&frame.operation_id===operation)terminals[0].write(Uint8Array.from(Buffer.from(frame.b64,'base64')),()=>{})
 },chrome:{webview:{postMessage:(f:any)=>frames.push(f)}}}
 vm.runInNewContext(form,{window,document,documentGeneration:'owned-generation',TextDecoder,TextEncoder,Uint8Array,atob},{timeout:1000})
 const receive=window.cmsparkDesktopReceive
 const down=listeners.get('keydown')!
 const pressButton=()=>down.fn({key:'Enter',isTrusted:true,target:document.activeElement})
 const state=()=>receive({type:'desktop.local.state.result',ok:true,thread_id:'native-terminal-A',state:{bound:true,modules:{terminal:true,agent:false},platform:'macos'}})
 receive({type:'thread.list'});pressButton();state();pressButton()
 receive({type:'desktop.terminal.open.result',thread_id:'native-terminal-A',ok:false,error_code:'LOCAL_DENIED'});pressButton();state();pressButton()
 receive({type:'desktop.terminal.open.result',thread_id:'native-terminal-A',ok:false,error_code:'LOCAL_DENIED'});pressButton();state();pressButton()
 receive({type:'desktop.terminal.open.result',thread_id:'native-terminal-A',operation_id:operation,ok:true,status:'running'})
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
 const output=Buffer.from('D476_TERMINAL_中'+'x'.repeat(17000)),parts=[output.subarray(0,16384),output.subarray(16384)]
 for(let index=0;index<parts.length;index++)receive({type:'desktop.terminal.data',thread_id:'native-terminal-A',operation_id:operation,seq:index+1,b64:parts[index].toString('base64')})
 await terminals[0].drain()
 for(let index=0;index<parts.length;index++)receive({type:'desktop.terminal.ack.result',thread_id:'native-terminal-A',operation_id:operation,ok:true,seq:index+1})
 return {frames,receive,pressButton,document,nodes,listeners}
}

test('whole native form observes trusted terminal Enter before actual xterm stops bubbling',async()=>{
 const s=await scenario(),ids=s.frames.map(f=>f.id)
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
for(const [name,options] of Object.entries({untrusted:{trusted:false},wrongTarget:{wrongTarget:true},wrongActive:{wrongActive:true},duplicate:{duplicate:true}}))test('terminal capture preserves '+name+' rejection',async()=>{
 const s=await scenario(options);assert.ok(s.frames.some(f=>f.id==='D476_TERMINAL_FAIL'))
 if(name!=='duplicate')assert.equal(s.frames.some(f=>f.id==='D476_TERMINAL_OUTPUT'),false)
})
test('shipped nonce transform preserves the actual pinned keyboard methods',()=>{
 const transformed=transformXtermStyleNonce(vendor,XTERM_VERSION)
 assert.equal(keyboard(transformed.toString('utf8')).members,actual.members)
})

/** New parser/capture controls use the same pinned actual parser. The existing
 * CPU identity holders below are explicitly inert, never native DOM evidence. */
function parserFunctions747(){
 const file=ts.createSourceFile('terminal-form.js',form,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
 const names=['parsedMarker747','captureTerminal747'],definitions:ts.FunctionDeclaration[]=[]
 const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name&&names.includes(node.name.text))definitions.push(node);ts.forEachChild(node,visit)};visit(file)
 assert.deepEqual(definitions.map(node=>node.name!.text).sort(),[...names].sort())
 const context:any={};vm.runInNewContext(definitions.map(node=>node.getText(file)).join('\n')+';globalThis.helpers={parsedMarker747,captureTerminal747}',context,{timeout:1000})
 return context.helpers as {parsedMarker747(terminal:any,marker:string):boolean;captureTerminal747(host:any,document:any,generation:()=>string):{bind(operation:string):any;restore():void;count():number}}
}
const parser747=parserFunctions747(),completeMarker747='D476_TERMINAL_中'
async function parsedWrites747(terminal:ReturnType<typeof createNoOpenTerminal747>,parts:readonly Uint8Array[]){
 for(const bytes of parts)await new Promise<void>((resolve,reject)=>{try{terminal.write(Uint8Array.from(bytes),resolve)}catch(error){reject(error)}})
}
const parserVectors747:ReadonlyArray<{id:string;parts:readonly Uint8Array[];expected:boolean;cols?:number;rows?:number}>=[
 {id:'PARSE01',parts:[Buffer.from(completeMarker747)],expected:true},
 {id:'PARSE02',parts:[Buffer.from('D476_TERMINAL_\x1b[0m中')],expected:true},
 {id:'PARSE03',parts:[Buffer.from('D476_TERMINAL_?\x1b[15G中')],expected:true},
 {id:'PARSE04',parts:[Buffer.from(completeMarker747+'\r\x1b[2K')],expected:false},
 {id:'PARSE05',parts:[Buffer.from('D476_TERMINAL_\r\n中')],expected:false},
 {id:'PARSE06',parts:[Buffer.from(completeMarker747)],expected:true,cols:15,rows:4},
 {id:'PARSE07',parts:[Buffer.from(completeMarker747+'\x1b[?1049h')],expected:false},
 {id:'PARSE08',parts:[Buffer.from('D476_TERMINAL_')],expected:false},
 // A decoder control deliberately cuts a codepoint; actual emitChunks does not.
 {id:'PARSE09',parts:[Buffer.from(completeMarker747).subarray(0,15),Buffer.from(completeMarker747).subarray(15)],expected:true},
 {id:'PARSE10',parts:[Buffer.from('中')],expected:false},
]
for(const vector of parserVectors747)test('747 actual no-open public buffer '+vector.id,async()=>{
 const terminal=createNoOpenTerminal747({cols:vector.cols??80,rows:vector.rows??24}),independent=createNoOpenTerminal747({cols:vector.cols??80,rows:vector.rows??24})
 try{await parsedWrites747(terminal,vector.parts);await parsedWrites747(independent,vector.parts);assert.equal(nodeParsedMarker747(independent),vector.expected);assert.equal(parser747.parsedMarker747(terminal,completeMarker747),vector.expected);assert.equal(terminal.element,undefined,'no-open CPU must not acquire a DOM')
  if(vector.id==='PARSE06'){
   assert.equal(terminal.buffer.active.getLine(0)?.getCell(14)?.getCode(),0,'wide wrap leaves an unoccupied padding cell, not a literal space')
   assert.equal(terminal.buffer.active.getLine(0)?.translateToString(true),'D476_TERMINAL_')
   const spaced=createNoOpenTerminal747({cols:15,rows:4})
   try{await parsedWrites747(spaced,[Buffer.from('D476_TERMINAL_ 中')]);assert.equal(spaced.buffer.active.getLine(0)?.getCell(14)?.getCode(),32);assert.equal(spaced.buffer.active.getLine(0)?.translateToString(true),'D476_TERMINAL_ ');assert.equal(parser747.parsedMarker747(spaced,completeMarker747),false,'a real trailing space must survive the soft wrap');assert.equal(nodeParsedMarker747(spaced),false,'independent Node reader must preserve the real trailing space')}
   finally{spaced.dispose()}
  }
 }
 finally{terminal.dispose();independent.dispose()}
})
function actualConstructorCapture747(){
 const seed=createNoOpenTerminal747(),Original=seed.constructor as any;seed.dispose()
 const host={Terminal:Original},document={getElementById:()=>undefined},capture=parser747.captureTerminal747(host,document,()=> 'owned-capture')
 return{Original,host,capture}
}
test('747 constructor capture CAPTURE01 preserves the actual pinned constructor prototype and write callback',async()=>{
 const {Original,host,capture}=actualConstructorCapture747(),terminal=new host.Terminal({cols:17,rows:4,scrollback:5000})
 try{assert.equal(Object.getPrototypeOf(terminal),Original.prototype);assert.equal(terminal.constructor,Original);assert.equal(capture.count(),1);await parsedWrites747(terminal,[Buffer.from(completeMarker747)]);assert.equal(parser747.parsedMarker747(terminal,completeMarker747),true);capture.restore();assert.equal(host.Terminal,Original)}finally{capture.restore();terminal.dispose()}
})
test('747 constructor capture CAPTURE02 refuses an unopened actual instance without a holder',()=>{
 const {host,capture}=actualConstructorCapture747(),terminal=new host.Terminal()
 try{assert.equal(capture.count(),1);assert.equal(terminal.element,undefined);assert.equal(capture.bind('owned-operation'),undefined)}finally{capture.restore();terminal.dispose()}
})
test('747 constructor capture CAPTURE03 refuses two actual captured instances before ownership fallback',()=>{
 const {host,capture}=actualConstructorCapture747(),first=new host.Terminal(),second=new host.Terminal()
 try{assert.notEqual(first,second);assert.equal(capture.count(),2);assert.equal(capture.bind('owned-operation'),undefined)}finally{capture.restore();first.dispose();second.dispose()}
})
function inertCaptureIdentity747(){
 let generation='owned-generation';const terminals:any[]=[],document:any={}
 const element=(id:string,connected=false):any=>({id,ownerDocument:document,parentElement:null,children:[],attributes:{},get isConnected():boolean{return connected||this.parentElement?.isConnected===true},contains(other:any):boolean{return this===other||this.children.some((child:any)=>child.contains(other))},append(child:any){child.parentElement=this;this.children.push(child)},setAttribute(key:string,value:string){this.attributes[key]=value},getAttribute(key:string){return this.attributes[key]}})
 const container=element('local-terminals',true);document.getElementById=(id:string)=>id==='local-terminals'?container:undefined
 const host={Terminal:cpuTerminalAdapter747(id=>element(id),terminals)},capture=parser747.captureTerminal747(host,document,()=>generation)
 const terminal=new host.Terminal(),holder=element('holder');holder.setAttribute('data-local-terminal','owned-operation');container.append(holder);terminal.open(holder)
 return{capture,terminal,nextGeneration:()=>{generation='next-generation'}}
}
test('747 constructor capture CAPTURE04 rejects a foreign operation despite a real parsed buffer',async()=>{
 const {capture,terminal}=inertCaptureIdentity747()
 try{terminal.write(Buffer.from(completeMarker747),()=>{});await terminal.drain();assert.equal(parser747.parsedMarker747(terminal,completeMarker747),true);assert.equal(capture.bind('foreign-operation'),undefined)}finally{capture.restore()}
})
test('747 constructor capture CAPTURE05 rejects a prior document generation',()=>{
 const {capture,nextGeneration}=inertCaptureIdentity747();nextGeneration()
 try{assert.equal(capture.bind('owned-operation'),undefined)}finally{capture.restore()}
})
