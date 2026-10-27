/** Real normal-emitted marker contract only. Never imports the native test module. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'

const companion=path.resolve(__dirname,'../..')
const root=fs.existsSync(path.join(companion,'scripts/windows-census-reporter.mjs'))?companion:path.resolve(companion,'..')
const {terminalDiagnostic,publicTerminalDiagnostic}=require(path.join(root,'scripts/windows-census-reporter.mjs'))
const {createNativeObservation788}=require(path.join(__dirname,'fixtures/native-observation-788.js'))
const marker='D476_TERMINAL_NATIVE_PHASE '
const title='#476 terminal-only native confirmation→real user PTY→selected partial excerpt→canonical reopen'
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value))

function actualTerminalProducer(){
 const file=path.join(__dirname,'desktop-native-thread-metadata-476.test.js'),source=fs.readFileSync(file,'utf8')
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS)
 assert.equal((ast as any).parseDiagnostics.length,0)
 const helpers=['createTerminalFirstFailure747','createTerminalReadiness747'].map(name=>{
  const found=ast.statements.filter((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text===name)
  assert.equal(found.length,1,name);return found[0].getText(ast)
 })
 const registrations:ts.CallExpression[]=[]
 const find=(n:ts.Node)=>{if(ts.isCallExpression(n)&&n.arguments.length>=3&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text===title)registrations.push(n);ts.forEachChild(n,find)}
 find(ast);assert.equal(registrations.length,1)
 const emitters:ts.VariableDeclaration[]=[],required:ts.Expression[]=[],diagnostics:ts.Expression[]=[]
 const select=(n:ts.Node)=>{
  if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer){
   if(n.name.text==='emitTerminalPhase')emitters.push(n)
   if(n.name.text==='required')required.push(n.initializer)
  }
  ts.forEachChild(n,select)
 }
 select(registrations[0]);assert.equal(emitters.length,1);assert.equal(required.length,1)
 const diagnostic=(n:ts.Node)=>{
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='diagnostic'&&n.arguments.length===1){
   const a=n.arguments[0]
   if(ts.isBinaryExpression(a)&&a.operatorToken.kind===ts.SyntaxKind.PlusToken&&ts.isStringLiteral(a.left)&&a.left.text===marker)diagnostics.push(a)
  }
  ts.forEachChild(n,diagnostic)
 }
 diagnostic(emitters[0]);assert.equal(diagnostics.length,1)
 // Synthetic lexical inputs only. Helpers, receipt-mask/order/JSON expression,
 // one-shot emission and the complete output object are original normal JS.
 const code=`(()=>{
  ${helpers.join('\n')}
  const firstFailure=createTerminalFirstFailure747(),readiness=createTerminalReadiness747(),nativeObservation788=createNativeObservation788();
  const required=${required[0].getText(ast)},receipts=new Set(),outputSeq=new Set(),ackSeq=new Set(),dimensions=new Set();
  let inputEnterObserved=false,rawOutputMarkerSeen=false,failed=true,actualSpawns=0,openAttempts=0,confirmationRequests=0,decisions=0,deniedResults=0,outputBytes=0,largestFrame=0,inputUnicode=false,outputUnicode=false,stops=0,actualProcessExit=false,authenticated=false,windowRequested=false,connections=0,childExited=false;
  let terminalPhaseEmitted=false,terminalPhaseEmitting=false;
  const lines=[],t={diagnostic(value){lines.push(value)}};
  const ${emitters[0].getText(ast)};
  return {firstFailure,readiness,nativeObservation788,emit(moment){emitTerminalPhase(moment);return lines.slice()},receipt(index){receipts.add(required[index])}};
 })()`
 const make=()=>vm.runInNewContext(code,{Set,createNativeObservation788},{timeout:1000})
 const hash=(text:string)=>createHash('sha256').update(text).digest('hex')
 return{make,proof:{normalJavaScriptSHA256:hash(source),helperSHA256:helpers.map(hash),emitterSHA256:hash(emitters[0].getText(ast)),payloadExpressionSHA256:hash(diagnostics[0].getText(ast)),requiredExpressionSHA256:hash(required[0].getText(ast)),wholeNativeModuleExecuted:false}}
}

function produced(moment:'ABORT'|'FINALLY'='FINALLY'){
 const actual=actualTerminalProducer(),p=actual.make()
 p.firstFailure.observe({type:'system.ping',id:'D476_TERMINAL_FIRST_R_10'})
 p.readiness.observe({type:'system.ping',id:'D476_TERMINAL_READY_1_1_0'})
 // Fixed inputs already emitted by the actual CPU form trajectory; outputs
 // come only from the real observer and native marker constructors.
 for(const id of ['D476_OBS788_T_5','D476_OBS788_T_8','D476_OBS788_T_6','D476_OBS788_T_9','D476_OBS788_T_10'])p.nativeObservation788.native(id)
 p.nativeObservation788.native('D476_OBS788_SKIP_V');p.receipt(0);p.receipt(1)
 const lines=p.emit(moment);assert.equal(lines.length,1);assert.equal(p.emit(moment==='ABORT'?'FINALLY':'ABORT').length,1)
 assert.equal(typeof lines[0],'string');assert.ok(lines[0].startsWith(marker))
 return{message:lines[0] as string,actual,observer:p.nativeObservation788}
}

test('788 actual normal-emitted Terminal marker reaches the public parser with its finite observation and original order',()=>{
 for(const moment of ['ABORT','FINALLY'] as const){
  const p=produced(moment),payload=p.message.slice(marker.length),finite=terminalDiagnostic(p.message)
  assert.equal(finite.status,'OBSERVED');assert.equal(finite.snapshot.moment,moment)
  assert.equal(JSON.stringify(finite.snapshot),payload,'the complete actual producer property order remains canonical')
  assert.deepEqual(publicTerminalDiagnostic(finite),finite)
  assert.deepEqual(finite.snapshot.observation788,clone(p.observer.snapshot()))
  assert.equal(finite.snapshot.receiptMask,3);assert.equal(finite.snapshot.failed,true)
  assert.equal(finite.snapshot.firstFailure.first.origin,'R');assert.equal(finite.snapshot.firstFailure.first.site,10)
  assert.equal(finite.snapshot.observation788.terminal.firstSkip,'NOT_VISIBLE')
  assert.equal(finite.snapshot.observation788.terminal.seenMask,944)
  assert.equal(p.actual.proof.wholeNativeModuleExecuted,false)
  assert.equal(p.message.includes('PRIVATE_'),false)
 }
})

test('788 Terminal marker keeps the legacy projection and rejects noncanonical or nonfinite observation variants',()=>{
 const p=produced(),finite=terminalDiagnostic(p.message);assert.equal(finite.status,'OBSERVED')
 const actual=JSON.parse(p.message.slice(marker.length))
 // Explicit compatibility projection of the real new producer. This is not
 // relabeled as a historical normal emission or an OS/native observation.
 const legacy=Object.fromEntries(Object.entries(actual).filter(([key])=>key!=='observation788'))
 const old=terminalDiagnostic(marker+JSON.stringify(legacy));assert.equal(old.status,'OBSERVED');assert.deepEqual(publicTerminalDiagnostic(old),old)
 assert.equal(Object.hasOwn(old.snapshot,'observation788'),false)
 const moved=clone(actual);delete moved.observation788;moved.observation788=actual.observation788
 assert.equal(terminalDiagnostic(marker+JSON.stringify(moved)).status,'UNKNOWN','moving the new field to the end cannot weaken canonical order')
 const mutations:Array<(value:any)=>void>=[
  value=>{value.extra='PRIVATE_SENTINEL'},value=>{value.observation788.extra='PRIVATE_SENTINEL'},
  value=>{value.observation788=null},value=>{value.observation788=[]},value=>{value.observation788.schema=2},
  value=>{value.observation788.terminal.seenMask=1024},value=>{value.observation788.terminal.firstSkip='PRIVATE_SENTINEL'},
  value=>{value.observation788.local={activationReturned:true,focusSucceeded:false,relation:'OTHER_PROCESS'}},
  value=>{value.observation788.archive={activationReturned:1,focusSucceeded:true,relation:'NULL'}},
  value=>{value.firstFailure.source='PRIVATE_SENTINEL'},value=>{value.receiptMask=256},value=>{value.actualSpawns=-1},
 ]
 for(const mutate of mutations){const changed=clone(actual);mutate(changed);const result=terminalDiagnostic(marker+JSON.stringify(changed));assert.deepEqual(result,{status:'UNKNOWN',reason:'INVALID_SNAPSHOT'});assert.equal(JSON.stringify(result).includes('PRIVATE_'),false)}
 for(const message of [marker+' '+JSON.stringify(actual),p.message+' ',p.message.replace('"schema":1','"schema":1,"schema":1'),p.message.replace('"schema":1','"schema":1.0')])assert.deepEqual(terminalDiagnostic(message),{status:'UNKNOWN',reason:'INVALID_SNAPSHOT'})
 assert.deepEqual(terminalDiagnostic(marker+'x'.repeat(4097)),{status:'UNKNOWN',reason:'OVERSIZE'})
 assert.equal(terminalDiagnostic('D476_LOCAL_NATIVE_PHASE '+JSON.stringify(actual)),null)
 // The newly admitted nested observation is a closed own-data value; no
 // unknown getter, inherited serializer or Proxy may escape into public data.
 let touched=0
 const getter=clone(finite);Object.defineProperty(getter.snapshot.observation788,'terminal',{enumerable:true,get(){touched++;throw Error('PRIVATE_GETTER')}})
 assert.throws(()=>publicTerminalDiagnostic(getter),{message:'CENSUS_METADATA_INVALID'});assert.equal(touched,0)
 const symbol=clone(finite);symbol.snapshot.observation788[Symbol('PRIVATE_SYMBOL')]=true
 assert.throws(()=>publicTerminalDiagnostic(symbol),{message:'CENSUS_METADATA_INVALID'})
 const proxy=clone(finite);proxy.snapshot.observation788.terminal=new Proxy(proxy.snapshot.observation788.terminal,{ownKeys(){touched++;throw Error('PRIVATE_PROXY')}})
 assert.throws(()=>publicTerminalDiagnostic(proxy),{message:'CENSUS_METADATA_INVALID'});assert.equal(touched,0)
 for(const [value,select,key]of [
  [finite,(v:any)=>v.snapshot,'actualSpawns'],[old,(v:any)=>v.snapshot,'schema'],
  [finite,(v:any)=>v.snapshot.observation788,'schema'],[finite,(v:any)=>v.snapshot.observation788.terminal,'seenMask'],
 ]as const){const hidden=clone(value),row=select(hidden),descriptor=Object.getOwnPropertyDescriptor(row,key)!;Object.defineProperty(row,key,{...descriptor,enumerable:false});assert.throws(()=>publicTerminalDiagnostic(hidden),{message:'CENSUS_METADATA_INVALID'})}
 const extraHidden=clone(finite);Object.defineProperty(extraHidden.snapshot.observation788,'hidden',{value:'PRIVATE_HIDDEN',enumerable:false})
 assert.throws(()=>publicTerminalDiagnostic(extraHidden),{message:'CENSUS_METADATA_INVALID'})
 const inherited=clone(finite);Object.setPrototypeOf(inherited.snapshot.observation788,{toJSON(){touched++;throw Error('PRIVATE_SERIALIZER')}})
 assert.deepEqual(publicTerminalDiagnostic(inherited),finite);assert.equal(touched,0)
})
