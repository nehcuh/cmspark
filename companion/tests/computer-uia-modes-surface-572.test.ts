/** Execute actual test-helper functions with inert OS boundaries and the real filesystem lease. */
import test, {type TestContext} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import {acquireSurface650,withSurface650} from './fixtures/native-surface-650'

type Registered={name:string;options:{skip:boolean;timeout:number};run:(t:TestContext)=>Promise<void>}
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve))
async function owned(t:TestContext,run:(root:string,data:string)=>Promise<void>){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-test-run-'))),data=fs.mkdtempSync(path.join(root,'process-')),oldRoot=process.env.CMSPARK_TEST_RUN_DIR,oldData=process.env.CMSPARK_DATA_DIR
 process.env.CMSPARK_TEST_RUN_DIR=root;process.env.CMSPARK_DATA_DIR=data
 try{await run(root,data)}finally{if(oldRoot===undefined)delete process.env.CMSPARK_TEST_RUN_DIR;else process.env.CMSPARK_TEST_RUN_DIR=oldRoot;if(oldData===undefined)delete process.env.CMSPARK_DATA_DIR;else process.env.CMSPARK_DATA_DIR=oldData;fs.rmSync(root,{recursive:true,force:true})}
}
function actual(data:string,options:{deferClose?:boolean;actionError?:Error;removeError?:Error;killFalse?:boolean;gate?:Promise<void>}={}){
 const file=path.resolve(__dirname,'../../tests/helpers/uia-no-focus-native-572.ts'),source=fs.readFileSync(file,'utf8'),sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true)
 const names=new Set(['waitModeFile572','cleanupMode572','assertModeDesktop572','replaceNoFocusLibrary572','peInfo572','withoutActionExport572','runMode572','registerNoFocusNativeTests572'])
 const fragments=sf.statements.filter(n=>ts.isFunctionDeclaration(n)&&!!n.name&&names.has(n.name.text)||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(sf)==='modes572')).map(n=>n.getText(sf))
 assert.equal(fragments.length,9,'actual complete function/constant extraction')
 const code=ts.transpileModule(fragments.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
 const registered:Registered[]=[],children:Array<{closed:boolean;finish():void;role:string;marker:string}>=[],ps:Array<{script:string;timeout:number|undefined}>=[],removed:string[]=[],kills:string[]=[];let starts=0,actions=0
 const shot={foreground:202,cursor:{got:true,x:3,y:4},zorder:[202,101]},pending=new Map<string,string>();
 const start=(args:string[])=>{
  starts++;const arg=(key:string)=>args[args.indexOf(key)+1],role=arg('-Role'),marker=arg('-Marker');pending.set(role,marker)
  let resolve!:()=>void;const closed=new Promise<void>(r=>resolve=r),entry={closed:false,role,marker,finish(){this.closed=true;resolve()}};children.push(entry)
  fs.writeFileSync(arg('-Ready'),JSON.stringify({schema:1,hwnd:role==='target'?101:202,foreground:role==='target'?101:202,active:true,initialUnchanged:true}))
  return{child:{ref(){},kill(){kills.push(role);if(options.killFalse){queueMicrotask(()=>entry.finish());return false}if(!options.deferClose)entry.finish();return true}},closed,isClosed:()=>entry.closed,launchError:()=>undefined}
 }
 const runner=async(script:string,args:string[],opts?:{timeoutMs?:number})=>{
  ps.push({script:path.basename(script),timeout:opts?.timeoutMs});const kind=args[args.indexOf('-Mode')+1],out=args[args.indexOf('-Out')+1]
  if(kind==='snapshot')fs.writeFileSync(out,JSON.stringify(shot));else if(kind==='compare')fs.writeFileSync(out,JSON.stringify({ok:true,delivery:'uia-pattern',target_hwnd:101,focus_kept:true,zorder_kept:true,cursor_kept:true,no_leaked_input:true,background_verified:true,no_leaked_input_kind:'derived'}));else throw Error('OWNED_UNEXPECTED_PS')
  return '{}'
 }
 const onlyOwned=(file:string)=>{const relative=path.relative(data,path.resolve(file));assert.ok(relative!==".."&&!relative.startsWith(".."+path.sep)&&!path.isAbsolute(relative),"inert fixture FS stays owned");return file}
 const sandbox:any={exports:{},assert,Buffer,process:{arch:'x64',platform:'win32'},path,performance,Promise,Error,Set,Number,Math,console:{log(){}},withSurface650,
  test:(name:string,settings:Registered['options'],run:Registered['run'])=>registered.push({name,options:settings,run}),
  mkdtempSync:fs.mkdtempSync,tmpdir:()=>data,readFileSync:(file:string,encoding?:BufferEncoding)=>fs.readFileSync(onlyOwned(file),encoding),writeFileSync:(file:string,value:string|Buffer)=>fs.writeFileSync(onlyOwned(file),value),copyFileSync:(a:string,b:string)=>fs.copyFileSync(onlyOwned(a),onlyOwned(b)),watch:fs.watch,
  existsSync:(f:string)=>f==='OWNED_INERT_PS'||fs.existsSync(f),rmSync:(dir:string,args:fs.RmOptions)=>{if(options.removeError)throw options.removeError;fs.rmSync(dir,args);removed.push(dir)},setTimeout,clearTimeout,startMode572:start,runPs:runner,resolvePowerShellExe:()=> 'OWNED_INERT_PS',resolveWinScript:(name:string)=>name,resolveComputerUiaNoFocusDll:()=> 'OWNED_NOT_LOADED.dll',
  PsUiaLocator:class{async locate(_target:number,name:string){const ids:Record<string,string>={OwnedSetValue572:'owned_setvalue572',OwnedSelect572:'owned_select572',OwnedToggle572:'owned_toggle572',OwnedScroll572:'owned_scroll572'};return{name,automationId:ids[name],controlType:'OwnedInert'}}},
  PsInputInjector:class{async invokeUia(_target:number,_name:string,mode:string){actions++;if(options.gate)await options.gate;if(options.actionError)throw options.actionError;fs.writeFileSync(pending.get('target')!,JSON.stringify({schema:1,role:'target',mode,changed:true}));return{ok:true,mode,foreground:false}}}
 }
 vm.runInNewContext(code+'\nregisterNoFocusNativeTests572();',sandbox,{timeout:1000})
 return{registered,children,removed,kills,ps,starts:()=>starts,actions:()=>actions,closeAll(){for(const c of children)c.finish()}}
}
const context=(t:TestContext,signal=t.signal)=>({signal,diagnostic:(s:string)=>t.diagnostic(s)})as TestContext

test('all nine actual mode callbacks wait behind an existing real surface lease; aborted waiters cause no starts',{timeout:5000},async t=>owned(t,async(root,data)=>{
 const first=await acquireSurface650(root,data,t.signal),claim=path.join(root,'native-surface-650/claim'),bytes=fs.readFileSync(claim),h=Array.from({length:9},()=>actual(data)),abort=new AbortController(),pending=h.map((producer,i)=>producer.registered[i].run(context(t,AbortSignal.any([t.signal,abort.signal]))).then(()=>undefined,e=>e)),starts=()=>h.reduce((n,v)=>n+v.starts(),0)
 try{assert.ok(h.every(v=>v.registered.length===9));await turn();assert.equal(starts(),0);first.checkpoint();assert.deepEqual(fs.readFileSync(claim),bytes);abort.abort(Error('OWNED_CONTENDER_ABORT'));for(const error of await Promise.all(pending))assert.equal(error,abort.signal.reason);assert.equal(starts(),0);assert.deepEqual(fs.readFileSync(claim),bytes)}finally{abort.abort();await Promise.all(pending);first.release()}
}))
test('actual callback starts only after release and keeps original action and four-oracle path',{timeout:5000},async t=>owned(t,async(root,data)=>{
 const first=await acquireSurface650(root,data,t.signal),h=actual(data),pending=h.registered[0].run(context(t));await turn();assert.equal(h.starts(),0);first.release();await pending
 assert.equal(h.starts(),2);assert.equal(h.actions(),1);assert.equal(h.children.every(c=>c.closed),true);assert.equal(h.removed.length,1);assert.equal(fs.existsSync(path.join(root,'native-surface-650/claim')),false)
 assert.deepEqual(h.ps.map(r=>r.script),['computer-bg-oracles.ps1','computer-bg-oracles.ps1','computer-bg-oracles.ps1']);assert.ok(h.ps.every(r=>typeof r.timeout==='number'&&r.timeout>0&&r.timeout<=15000));for(const r of h.registered){assert.equal(r.options.timeout,45000);assert.equal(r.options.skip,false)}
}))
test('lease excludes contenders through both observed child closes and directory cleanup',{timeout:5000},async t=>owned(t,async(root,data)=>{
 const h=actual(data,{deferClose:true}),pending=h.registered[0].run(context(t)).then(()=>({error:undefined as unknown}),error=>({error})),abort=new AbortController();let entered=false,next:ReturnType<typeof acquireSurface650>|undefined
 try{await turn();assert.equal(h.starts(),2);assert.equal(h.kills.length,1);next=acquireSurface650(root,data,AbortSignal.any([t.signal,abort.signal])).then(v=>{entered=true;assert.equal(h.children.every(c=>c.closed),true);assert.equal(h.removed.length,1);return v});void next.catch(()=>{});await turn();assert.equal(entered,false);h.closeAll();const result=await pending;if(result.error!==undefined)throw result.error;const lease=await next;lease.release();assert.equal(entered,true)}finally{abort.abort();h.closeAll();await pending;if(next)await next.catch(()=>{})}
}))
test('primary assertion survives successful teardown while lease is released for the next callback',{timeout:5000},async t=>owned(t,async(root,data)=>{
 const primary=Error('OWNED_ACTION_PRIMARY'),h=actual(data,{actionError:primary});await assert.rejects(h.registered[0].run(context(t)),e=>e===primary);assert.equal(h.children.every(c=>c.closed),true);assert.equal(h.removed.length,1);const next=await acquireSurface650(root,data,t.signal);next.release()
}))
for(const kind of ['remove','kill']as const)test('unknown '+kind+' cleanup retains the real claim and does not mask primary',{timeout:5000},async t=>owned(t,async(root,data)=>{
 const primary=Error('OWNED_ACTION_PRIMARY'),cleanup=Error('OWNED_REMOVE_FAILURE'),h=actual(data,{actionError:primary,...(kind==='remove'?{removeError:cleanup}:{killFalse:true})});await assert.rejects(h.registered[0].run(context(t)),e=>e===primary)
 const claim=path.join(root,'native-surface-650/claim');assert.equal(fs.existsSync(claim),true);const bytes=fs.readFileSync(claim),abort=new AbortController();let entered=false
 const next=acquireSurface650(root,data,AbortSignal.any([t.signal,abort.signal])).then(v=>{entered=true;return v});await turn();assert.equal(entered,false);abort.abort();await assert.rejects(next);assert.deepEqual(fs.readFileSync(claim),bytes)
}))
test('in-flight cancellation prevents the next PS dispatch and releases only after real inert cleanup',{timeout:5000},async t=>owned(t,async(root,data)=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r),abort=new AbortController(),h=actual(data,{gate}),pending=h.registered[0].run(context(t,AbortSignal.any([t.signal,abort.signal])));await turn();assert.equal(h.actions(),1);assert.equal(h.ps.length,1);abort.abort(Error('OWNED_ACTIVE_ABORT'));release();await assert.rejects(pending,e=>e===abort.signal.reason);assert.equal(h.ps.length,1);assert.equal(h.children.every(c=>c.closed),true);assert.equal(h.removed.length,1);assert.equal(fs.existsSync(path.join(root,'native-surface-650/claim')),false)
}))
