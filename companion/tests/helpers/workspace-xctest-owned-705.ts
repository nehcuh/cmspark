/** Unshipped macOS acceptance owner. No product imports or bearer credentials. */
import fs from 'node:fs'
import path from 'node:path'
import {randomBytes,createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {spawn,ChildProcess} from 'node:child_process'
const refused=()=>Error('OWNED_WORKSPACE_UI_REFUSED')
const canonical=(o:any)=>JSON.stringify(Object.fromEntries(Object.keys(o).sort().map(k=>[k,o[k]])))
const regular=(s:fs.Stats)=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&(s.mode&0o777)===0o600&&s.uid===process.getuid!()
export const UI705_RUNNER_ID='com.cmspark.tests.workspace-ui-705.xctrunner'
export const UI705_FILES=['input.json','runner-start.json','owner-ack.json','ui-begin.json','ui-quiescent.json','runner-closed.json','cancel.json','picker-first.json','picker-second.json','ui-refusal.json','ui-progress.json','ui-choose-census.json'] as const
type Xcode705Status='NOT_CLOSED'|'MISSING'|'EMPTY'|'INVALID'|'CHANGED'|'OVERSIZE'|'READ_FAILED'|'OBSERVED'
type Xcode705Observation={status:Xcode705Status;firstMarker:'NONE'|'XCODEBUILD_ERROR'|'XCODE_SELECT_ERROR'|'TESTING_FAILED';firstNSError:{kind:'NONE'|'PAIR'|'UNKNOWN';domain:'COCOA'|'POSIX'|'MACH'|'OSSTATUS'|'OTHER'|'UNKNOWN';code:number|null}}
const xcode705Unavailable=(status:Xcode705Status):Xcode705Observation=>({status,firstMarker:'NONE',firstNSError:{kind:'NONE',domain:'UNKNOWN',code:null}})
// Closed tokens only. The two streams have no global ordering; a parent close is
// not inherited-writer EOF. Ignore an unterminated tail rather than parse a prefix.
function xcode705Parse(text:string):Xcode705Observation {
 const out=xcode705Unavailable(text.length?'OBSERVED':'EMPTY')
 for(const line of text.split('\n').slice(0,-1)){
  const value=line.endsWith('\r')?line.slice(0,-1):line
  if(out.firstMarker==='NONE'){
   if(value.startsWith('xcodebuild: error:'))out.firstMarker='XCODEBUILD_ERROR'
   else if(value.startsWith('xcode-select: error:'))out.firstMarker='XCODE_SELECT_ERROR'
   else if(value==='Testing failed:')out.firstMarker='TESTING_FAILED'
  }
  if(out.firstNSError.kind==='PAIR')continue
  if(value.includes('Error Domain='))out.firstNSError={kind:'UNKNOWN',domain:'UNKNOWN',code:null}
  const match=/(?:^|[ \t])Error Domain=([A-Za-z][A-Za-z0-9_.-]{0,127}) Code=(-?(?:0|[1-9][0-9]{0,9}))(?=$|[ \t,;)}])/.exec(value)
  if(!match||match[2]==='-0')continue
  const code=Number(match[2]);if(!Number.isInteger(code)||code<-2147483648||code>2147483647)continue
  const domain:Xcode705Observation['firstNSError']['domain']=match[1]==='NSCocoaErrorDomain'?'COCOA':match[1]==='NSPOSIXErrorDomain'?'POSIX':match[1]==='NSMachErrorDomain'?'MACH':match[1]==='NSOSStatusErrorDomain'?'OSSTATUS':'OTHER'
  out.firstNSError={kind:'PAIR',domain,code:domain==='OTHER'?null:code}
 }
 return out
}
// One bounded snapshot of an already-captured fixed log, never an authority or
// cleanup receipt. Descriptor retirement precedes its sole close attempt.
function xcode705Snapshot(scene:OwnedUI705Boundary,name:'xcode.stdout'|'xcode.stderr'):Xcode705Observation {
 let fd:number|undefined,identity:fs.BigIntStats|undefined,out=xcode705Unavailable('READ_FAILED'),foreign=false
 const sameIdentity=(a:fs.BigIntStats,b:fs.BigIntStats)=>a.dev===b.dev&&a.ino===b.ino
 const safe=(s:fs.BigIntStats)=>s.isFile()&&!s.isSymbolicLink()&&s.uid===BigInt(process.getuid!())&&(s.mode&0o7777n)===0o600n&&s.nlink===1n&&s.size>=0n
 const same=(a:fs.BigIntStats,b:fs.BigIntStats)=>sameIdentity(a,b)&&a.isFile()===b.isFile()&&a.isSymbolicLink()===b.isSymbolicLink()&&a.uid===b.uid&&a.mode===b.mode&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs
 const check=()=>{scene.check();const root=fs.lstatSync(scene.root,{bigint:true});if(!root.isDirectory()||root.isSymbolicLink()||root.uid!==BigInt(process.getuid!())||(root.mode&0o7777n)!==0o700n)throw refused()}
 try{
  out=(()=>{
   check();const file=path.join(scene.root,name)
   try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK)}catch(error){return xcode705Unavailable(error&&typeof error==='object'&&Object.getOwnPropertyDescriptor(error,'code')?.value==='ENOENT'?'MISSING':'READ_FAILED')}
   identity=fs.fstatSync(fd,{bigint:true})
   if(!safe(identity))return xcode705Unavailable('INVALID')
   if(identity.size>262144n)return xcode705Unavailable('OVERSIZE')
   const data=Buffer.alloc(262145),length=fs.readSync(fd,data,0,data.length,0)
   if(length>262144)return xcode705Unavailable('OVERSIZE')
   const after=fs.fstatSync(fd,{bigint:true})
   if(!sameIdentity(identity,after)){foreign=true;return xcode705Unavailable('CHANGED')}
   const named=fs.lstatSync(file,{bigint:true})
   if(BigInt(length)!==identity.size||!same(identity,after)||!same(identity,named))return xcode705Unavailable('CHANGED')
   check()
   let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data.subarray(0,length))}catch{return xcode705Unavailable('INVALID')}
   const result=xcode705Parse(text),lastNamed=fs.lstatSync(file,{bigint:true})
   if(!same(identity,lastNamed))return xcode705Unavailable('CHANGED')
   check();return result
  })()
 }catch{out=xcode705Unavailable('READ_FAILED')}
 finally{
  if(fd!==undefined){
   const owned=fd;fd=undefined
   if(!foreign){
    if(identity){try{const last=fs.fstatSync(owned,{bigint:true});if(!sameIdentity(identity,last)){foreign=true;out=xcode705Unavailable('CHANGED')}else if(!same(identity,last))out=xcode705Unavailable('CHANGED')}catch{out=xcode705Unavailable('READ_FAILED')}}
    if(!foreign)try{fs.closeSync(owned)}catch{out=xcode705Unavailable('READ_FAILED')}
   }
  }
 }
 return out
}
// Two post-close, read-only test-result queries share 5s/1MiB per stream each.
// This is not awaited by the case, cleanup, lease, complete(), or canSettle().
type Result705Projection={schema:1;status:'UNKNOWN'|'OBSERVED';reason:'NOT_CLOSED'|'BUNDLE_UNAVAILABLE'|'SOURCE_UNAVAILABLE'|'TOOL_FAILURE'|'LIMIT'|'INVALID_RESULT'|'OBSERVED';testCaseID:1;testPresent:boolean|null;testResult:'Passed'|'Failed'|'Skipped'|'Expected Failure'|'unknown'|'UNKNOWN';failureNodeCount:number|null;sourceCoordinates:{sourceID:1|2;startingLineRaw:number;startingColumnRaw:number|null;coordinateBase:'UNKNOWN'}[];coordinatesMore:boolean;activities:'SCHEMA_NOT_ADMITTED';nativePassClaim:false}
const result705Unknown=(reason:Result705Projection['reason']):Result705Projection=>({schema:1,status:'UNKNOWN',reason,testCaseID:1,testPresent:null,testResult:'UNKNOWN',failureNodeCount:null,sourceCoordinates:[],coordinatesMore:false,activities:'SCHEMA_NOT_ADMITTED',nativePassClaim:false})
const RESULT705_IDS=new Set(['WorkspacePicker705/testOwnedPanel','WorkspacePicker705/testOwnedPanel()','OwnedPickerUITests/WorkspacePicker705/testOwnedPanel','OwnedPickerUITests/WorkspacePicker705/testOwnedPanel()'])
const RESULT705_TYPES=new Set(['Test Plan','Unit test bundle','UI test bundle','Test Suite','Test Case','Device','Test Plan Configuration','Arguments','Repetition','Test Case Run','Failure Message','Source Code Reference','Attachment','Expression','Test Value','Runtime Warning'])
// Both hashes are independently bound to b975 actual source; paths never come from runtime JSON.
const RESULT705_SOURCES=[['WorkspacePickerUITests.swift','182d2773a37134d289fec9c80a27107b5359c51d2cab1545bdfd62c3f6a2cee4'],['OwnedUIProtocol.swift','fbad4db2905d6bb58a40062ec844716554fb4bb8f52ae73f3f5b094ec27c979c']] as const
// Actual Tests response: nodeIdentifier is optional in the official schema.
// Only a present allowlisted Test Case identifier counts; never derive one from name.
function result705Select(data:Buffer):string {
 if(data.length>1048576)throw refused()
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)),object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v)
 if(!object(value)||!Array.isArray(value.testNodes))throw refused()
 let nodes=0;const matches:string[]=[]
 const walk=(rows:any[],depth:number)=>{
  if(depth>24||!Array.isArray(rows))throw refused()
  for(const n of rows){
   if(++nodes>512||!object(n)||!RESULT705_TYPES.has(n.nodeType)||typeof n.name!=='string'||Buffer.byteLength(n.name)>8192)throw refused()
   if(Object.hasOwn(n,'nodeIdentifier')&&(typeof n.nodeIdentifier!=='string'||Buffer.byteLength(n.nodeIdentifier)>1024))throw refused()
   if(n.nodeType==='Test Case'&&RESULT705_IDS.has(n.nodeIdentifier))matches.push(n.nodeIdentifier)
   if(Object.hasOwn(n,'children'))walk(n.children,depth+1)
  }
 }
 walk(value.testNodes,0);if(matches.length!==1)throw refused();return matches[0]
}
function result705Project(data:Buffer,sourceRoot:string,identifier:string):Result705Projection {
 if(data.length>1048576)throw refused()
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)),object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v)
 if(!object(value)||!RESULT705_IDS.has(identifier)||value.testIdentifier!==identifier||!['Passed','Failed','Skipped','Expected Failure','unknown'].includes(value.testResult)||!Array.isArray(value.testRuns))throw refused()
 const coordinates=new Map<string,Result705Projection['sourceCoordinates'][number]>();let nodes=0,failures=0
 const source=(url:string)=>{
  // Schema supplies a string URL, but NOT its fragment grammar or coordinate base.
  // Recognize only this literal grammar; report raw numbers, never a converted source line.
  if(url.length>8192||/[\x00-\x1f\x7f]/.test(url)||/%(?:2f|5c|00)/i.test(url))return
  const u=new URL(url);if(u.protocol!=='file:'||!['','localhost'].includes(u.hostname)||u.username||u.password||u.port||u.search)return
  let file:string;try{file=decodeURIComponent(u.pathname)}catch{return}
  const i=RESULT705_SOURCES.findIndex(row=>file===path.join(sourceRoot,row[0]));if(i<0)return
  const bytes=fs.readFileSync(path.join(sourceRoot,RESULT705_SOURCES[i][0]));if(createHash('sha256').update(bytes).digest('hex')!==RESULT705_SOURCES[i][1])throw refused()
  const fragment=u.hash.slice(1),fields=new URLSearchParams(fragment),allowed=new Set(['StartingLineNumber','EndingLineNumber','StartingColumnNumber','EndingColumnNumber','CharacterRangeLoc','CharacterRangeLen'])
  const keys=[...fields.keys()];if(!keys.length||keys.some(k=>!allowed.has(k))||new Set(keys).size!==keys.length)return
  const decimal=(key:string,max:number)=>{const raw=fields.get(key);if(raw===null||!/^(?:0|[1-9][0-9]{0,5})$/.test(raw))return null;const n=Number(raw);return n<=max?n:null}
  const line=decimal('StartingLineNumber',bytes.toString('utf8').split('\n').length);if(line===null)return
  const col=fields.has('StartingColumnNumber')?decimal('StartingColumnNumber',65535):null;if(fields.has('StartingColumnNumber')&&col===null)return
  const row={sourceID:(i+1)as 1|2,startingLineRaw:line,startingColumnRaw:col,coordinateBase:'UNKNOWN' as const};coordinates.set(JSON.stringify(row),row)
 }
 const walk=(rows:any[],depth:number)=>{
  if(depth>24||!Array.isArray(rows))throw refused()
  for(const n of rows){if(++nodes>512||!object(n)||!RESULT705_TYPES.has(n.nodeType)||typeof n.name!=='string'||Buffer.byteLength(n.name)>8192)throw refused()
   if(n.nodeType==='Failure Message')failures++
   if(n.nodeType==='Source Code Reference'&&typeof n.nodeIdentifierURL==='string')try{source(n.nodeIdentifierURL)}catch{throw refused()}
   if(Object.hasOwn(n,'children'))walk(n.children,depth+1)
   // name/details/descriptions/attachment IDs/URLs are never copied to output.
  }
 }
 walk(value.testRuns,0)
 const rows=[...coordinates.values()].sort((a,b)=>a.sourceID-b.sourceID||a.startingLineRaw-b.startingLineRaw||(a.startingColumnRaw??-1)-(b.startingColumnRaw??-1))
 return{schema:1,status:'OBSERVED',reason:'OBSERVED',testCaseID:1,testPresent:true,testResult:value.testResult,failureNodeCount:failures,sourceCoordinates:rows.slice(0,4),coordinatesMore:rows.length>4,activities:'SCHEMA_NOT_ADMITTED',nativePassClaim:false}
}
function result705AfterActualClose(scene:OwnedUI705Boundary,sourceRoot:string,emit:(value:Result705Projection)=>void){
 const CAP=1048576,expires=performance.now()+5000;let sent=false,limited=false,current:ChildProcess|undefined,timer:ReturnType<typeof setTimeout>|undefined
 const send=(v:Result705Projection)=>{if(sent)return;sent=true;if(timer)clearTimeout(timer);try{if(v.status==='OBSERVED'&&performance.now()>=expires)v=result705Unknown('LIMIT');emit(Buffer.byteLength(JSON.stringify(v),'utf8')<=1024?v:result705Unknown('LIMIT'))}catch{}}
 let bundleStat:fs.Stats
 const bundle=path.join(scene.root,'Result.xcresult')
 const sameBundle=()=>{scene.check();const s=fs.lstatSync(bundle);return s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid!()&&s.dev===bundleStat.dev&&s.ino===bundleStat.ino&&fs.realpathSync(bundle)===bundle}
 try{scene.check();bundleStat=fs.lstatSync(bundle);if(!sameBundle()){send(result705Unknown('BUNDLE_UNAVAILABLE'));return}}catch{send(result705Unknown('BUNDLE_UNAVAILABLE'));return}
 const sourcesCurrent=()=>{for(const [name,digest]of RESULT705_SOURCES){const file=path.join(sourceRoot,name),s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size<1||s.size>CAP||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==digest)throw refused()}}
 try{sourcesCurrent()}catch{send(result705Unknown('SOURCE_UNAVAILABLE'));return}
 // Two distinct APIs, lookup then details, share this ONE deadline. No alias retry.
 timer=setTimeout(()=>{limited=true;try{if(current)current.kill('SIGKILL');else send(result705Unknown('LIMIT'))}catch{}},Math.max(0,expires-performance.now()))
 const capture=(args:string[],consume:(data:Buffer)=>void)=>{
  if(sent)return
  if(limited||performance.now()>=expires){send(result705Unknown('LIMIT'));return}
  let child:ChildProcess|undefined,spawnError=false,outEOF=false,errEOF=false,outBytes=0,errBytes=0
  const chunks:Buffer[]=[]
  try{
   child=spawn('/usr/bin/xcrun',['xcresulttool','get','test-results',...args],{cwd:scene.root,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C',LC_ALL:'C'},stdio:['ignore','pipe','pipe']});current=child
   child.on('error',()=>{spawnError=true})
   child.stdout!.on('data',(b:Buffer)=>{try{if(!Buffer.isBuffer(b)){spawnError=true;return};outBytes+=b.length;if(outBytes>CAP){limited=true;chunks.length=0}else if(!limited)chunks.push(Buffer.from(b))}catch{spawnError=true;chunks.length=0}})
   child.stderr!.on('data',(b:Buffer)=>{try{if(!Buffer.isBuffer(b)){spawnError=true;return};errBytes+=b.length;if(errBytes>CAP)limited=true}catch{spawnError=true}})
   child.stdout!.on('end',()=>{outEOF=true});child.stderr!.on('end',()=>{errEOF=true})
   child.stdout!.on('error',()=>{spawnError=true});child.stderr!.on('error',()=>{spawnError=true})
   // Continuously drain refusal/flood; do not destroy a pipe to manufacture close.
   child.once('close',(code,signal)=>{
    if(current===child)current=undefined
    if(limited||performance.now()>=expires){chunks.length=0;send(result705Unknown('LIMIT'));return}
    if(spawnError||code!==0||signal!==null||!outEOF||!errEOF||errBytes!==0){chunks.length=0;send(result705Unknown('TOOL_FAILURE'));return}
    try{if(!sameBundle()){send(result705Unknown('BUNDLE_UNAVAILABLE'));return};sourcesCurrent();const data=Buffer.concat(chunks);chunks.length=0;consume(data)}catch{send(result705Unknown('INVALID_RESULT'))}finally{chunks.length=0}
   })
  }catch{
   if(child){current=child;child.stdout?.resume();child.stderr?.resume();child.once('close',()=>{if(current===child)current=undefined;send(result705Unknown('TOOL_FAILURE'))});try{child.kill('SIGKILL')}catch{}}
   else send(result705Unknown('TOOL_FAILURE'))
  }
 }
 capture(['tests','--schema-version','0.1.0','--path',bundle,'--compact'],data=>{
  const identifier=result705Select(data)
  capture(['test-details','--schema-version','0.1.0','--path',bundle,'--compact','--test-id',identifier],details=>send(result705Project(details,sourceRoot,identifier)))
 })
}

type File705=typeof UI705_FILES[number]
export class OwnedUI705Boundary {
 readonly identity:{dev:number;ino:number;uid:number}
 constructor(readonly root:string,readonly nonce:string){
  if(!/^[0-9a-f]{64}$/.test(nonce)||path.basename(root)!=='cmspark-workspace-ui-705-'+nonce||!path.isAbsolute(root))throw refused()
  const s=fs.lstatSync(root);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o777)!==0o700||s.uid!==process.getuid!()||fs.realpathSync(root)!==root)throw refused();this.identity={dev:s.dev,ino:s.ino,uid:s.uid}
 }
 check(){const s=fs.lstatSync(this.root);if(!s.isDirectory()||s.isSymbolicLink()||s.dev!==this.identity.dev||s.ino!==this.identity.ino||s.uid!==this.identity.uid||(s.mode&0o777)!==0o700||fs.realpathSync(this.root)!==this.root)throw refused()}
 read(name:File705):any|undefined {
  if(!UI705_FILES.includes(name))throw refused();this.check();const file=path.join(this.root,name);let fd:number
  try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw refused()}
  try{const a=fs.fstatSync(fd);if(a.nlink===2&&a.isFile()&&(a.mode&0o777)===0o600&&a.uid===process.getuid!()){const pending=fs.lstatSync(path.join(this.root,'.'+name+'.pending'));if(pending.isFile()&&!pending.isSymbolicLink()&&pending.dev===a.dev&&pending.ino===a.ino&&pending.nlink===2)return;throw refused()};if(!regular(a)||a.size<1||a.size>4096)throw refused();const b=Buffer.alloc(a.size+1),n=fs.readSync(fd,b,0,b.length,0),z=fs.fstatSync(fd),named=fs.lstatSync(file);if(n!==a.size||!regular(z)||!regular(named)||a.dev!==z.dev||a.ino!==z.ino||a.size!==z.size||z.dev!==named.dev||z.ino!==named.ino)throw refused();this.check();let v:any;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,n)))}catch{throw refused()};if(!v||typeof v!=='object'||Array.isArray(v)||canonical(v)!==b.subarray(0,n).toString('utf8'))throw refused();return v}finally{fs.closeSync(fd)}
 }
 write(name:File705,value:Record<string,unknown>){
  if(!UI705_FILES.includes(name))throw refused();this.check();const data=Buffer.from(canonical(value));if(data.length>4096)throw refused();const pending=path.join(this.root,'.'+name+'.pending'),file=path.join(this.root,name),fd=fs.openSync(pending,'wx',0o600),owned=fs.fstatSync(fd);let temporary=true
  try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);this.check();fs.linkSync(pending,file);fs.unlinkSync(pending);temporary=false;this.check()}finally{fs.closeSync(fd);if(temporary){try{const now=fs.lstatSync(pending);if(now.dev===owned.dev&&now.ino===owned.ino)fs.unlinkSync(pending)}catch{}}}
 }
 fields(v:any,keys:string[]){if(!v||Object.keys(v).sort().join()!==[...keys].sort().join()||v.schema!==1||v.nonce!==this.nonce)throw refused()}
 runner(){return path.join(this.root,'Products/Debug/OwnedPickerUITests-Runner.app')}
 runnerExecutable(){return path.join(this.runner(),'Contents/MacOS/OwnedPickerUITests-Runner')}
 startup(){const v=this.read('runner-start.json');if(!v)return;this.fields(v,['schema','nonce','pid','bundle_url','executable_url','bundle_id']);if(!Number.isSafeInteger(v.pid)||v.pid<=1||v.pid>2147483647||v.pid===process.pid||v.bundle_id!==UI705_RUNNER_ID||v.bundle_url!==pathToFileURL(this.runner()+path.sep).href||v.executable_url!==pathToFileURL(this.runnerExecutable()).href)throw refused();return v.pid as number}
 // Failure-only fixed UI observation. Never a lifecycle/cleanup authority.
 uiRefusal():{stage:number;detail:number}|null {
  try{const v=this.read('ui-refusal.json');if(v===undefined)return null;this.fields(v,['schema','nonce','stage','detail']);if(!Number.isInteger(v.stage)||v.stage<1||v.stage>20||!Number.isInteger(v.detail)||v.detail<0||v.detail>5)return null;return{stage:v.stage,detail:v.detail}}catch{return null}
 }
 // Last published main-thread stage only; may lag if an observation write fails.
 // It proves neither a UI refusal, success, completed call nor cleanup.
 uiProgress():{stage:number;detail:number}|null {
  try{const v=this.read('ui-progress.json');if(v===undefined)return null;this.fields(v,['schema','nonce','stage','detail']);if(!Number.isInteger(v.stage)||v.stage<1||v.stage>20||!Number.isInteger(v.detail)||v.detail<0||v.detail>5)return null;return{stage:v.stage,detail:v.detail}}catch{return null}
 }
 // Fixed saturated counts and local identity enums only; never UI/closure authority.
 uiChooseCensus():{schema:1;status:'OBSERVED'|'UNKNOWN';sheetLabelCount:number|null;sheetButtonCount:number|null;ownerLabelCount:number|null;buttonCount:number|null;buttonsMore:boolean|null;buttonIdentityRows:Array<[number,number]>|null} {
  const unknown=()=>({schema:1 as const,status:'UNKNOWN' as const,sheetLabelCount:null,sheetButtonCount:null,ownerLabelCount:null,buttonCount:null,buttonsMore:null,buttonIdentityRows:null})
  try{
   const v=this.read('ui-choose-census.json');if(v===undefined)return unknown()
   this.fields(v,['schema','nonce','status','sheetLabelCount','sheetButtonCount','ownerLabelCount','buttonCount','buttonsMore','buttonIdentityRows'])
   if(v.status!=='OBSERVED'||![v.sheetLabelCount,v.sheetButtonCount,v.ownerLabelCount].every(n=>Number.isInteger(n)&&n>=0&&n<=2)||!Number.isInteger(v.buttonCount)||v.buttonCount<0||v.buttonCount>8||typeof v.buttonsMore!=='boolean'||v.buttonsMore&&v.buttonCount!==8||v.sheetButtonCount!==Math.min(v.buttonCount,2))return unknown()
   if(!Array.isArray(v.buttonIdentityRows)||v.buttonIdentityRows.length!==v.buttonCount||!v.buttonIdentityRows.every((row:unknown)=>Array.isArray(row)&&row.length===2&&row.every(n=>Number.isInteger(n)&&n>=0&&n<=5)))return unknown()
   return{schema:1,status:'OBSERVED',sheetLabelCount:v.sheetLabelCount,sheetButtonCount:v.sheetButtonCount,ownerLabelCount:v.ownerLabelCount,buttonCount:v.buttonCount,buttonsMore:v.buttonsMore,buttonIdentityRows:v.buttonIdentityRows.map((row:number[])=>[row[0],row[1]] as [number,number])}
  }catch{return unknown()}
 }
 // Passive, non-atomic observation only. Neither a success nor a cleanup receipt.
 receiptMask():number|null {
  try{
   this.check()
   const observed=(name:File705)=>{const value=this.read(name);if(value===undefined){
    // read() deliberately hides a two-link publication in progress; that is not absence.
    try{fs.lstatSync(path.join(this.root,name));throw refused()}catch(error){if(!error||typeof error!=='object'||Object.getOwnPropertyDescriptor(error,'code')?.value!=='ENOENT')throw refused()}
   };return value}
   const pid=this.startup();if(pid===undefined&&observed('runner-start.json')!==undefined)return null
   const ack=observed('owner-ack.json'),begin=observed('ui-begin.json'),returned=observed('ui-quiescent.json'),closed=observed('runner-closed.json')
   if(pid===undefined&&(ack!==undefined||begin!==undefined||returned!==undefined||closed!==undefined))return null
   if(begin!==undefined&&ack===undefined||returned!==undefined&&begin===undefined)return null
   if(ack!==undefined){this.fields(ack,['schema','nonce','pid','identity_bound']);if(ack.pid!==pid||ack.identity_bound!==true)return null}
   for(const [value,phase]of[[begin,'UI_SEQUENCE_STARTED'],[returned,'UI_SEQUENCE_RETURNED']]as const)if(value!==undefined){this.fields(value,['schema','nonce','pid','phase']);if(value.pid!==pid||value.phase!==phase)return null}
   if(closed!==undefined){this.fields(closed,['schema','nonce','pid','terminated']);if(closed.pid!==pid||closed.terminated!==true)return null}
   this.check();if(this.startup()!==pid)return null
   return(pid===undefined?0:1)|(ack===undefined?0:2)|(begin===undefined?0:4)|(returned===undefined?0:8)|(closed===undefined?0:16)
  }catch{return null}
 }
 closure(observerClosed:boolean,xcodeClosed:boolean){
  try{const pid=this.startup();if(!pid)return false;const ack=this.read('owner-ack.json'),closed=this.read('runner-closed.json');if(!ack||!closed)return false;this.fields(ack,['schema','nonce','pid','identity_bound']);this.fields(closed,['schema','nonce','pid','terminated']);if(ack.pid!==pid||ack.identity_bound!==true||closed.pid!==pid||closed.terminated!==true)return false
   const begin=this.read('ui-begin.json'),returned=this.read('ui-quiescent.json');if(returned&&!begin)return false
   for(const [value,phase]of[[begin,'UI_SEQUENCE_STARTED'],[returned,'UI_SEQUENCE_RETURNED']]as const)if(value){this.fields(value,['schema','nonce','pid','phase']);if(value.pid!==pid||value.phase!==phase)return false}
   return observerClosed&&xcodeClosed&&(!begin||!!returned)
  }catch{return false}
 }
}
function copyManifest(source:string,target:string){
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'package-manifest.json'),'utf8'));if(manifest.schema!==1||!Array.isArray(manifest.files))throw refused();fs.mkdirSync(target,{mode:0o700})
 const links:{to:string;target:string}[]=[],seen=new Set<string>()
 for(const row of manifest.files){if(!row||typeof row.path!=='string'||!row.path||path.isAbsolute(row.path)||row.path.split(/[\\/]/).some((s:string)=>s==='..'||s===''||s==='.')||seen.has(row.path))throw refused();seen.add(row.path)
  const from=path.join(source,row.path),to=path.join(target,row.path);fs.mkdirSync(path.dirname(to),{recursive:true,mode:0o700})
  if(row.kind==='link'){if(Object.keys(row).sort().join()!=='kind,path,target'||typeof row.target!=='string'||path.isAbsolute(row.target))throw refused();const resolved=path.resolve(path.dirname(to),row.target);if(!resolved.startsWith(target+path.sep))throw refused();const stat=fs.lstatSync(from);if(!stat.isSymbolicLink()||fs.readlinkSync(from)!==row.target)throw refused();links.push({to,target:row.target});continue}
  if(Object.keys(row).sort().join()!=='bytes,kind,mode,path,sha256'||row.kind!=='file'||!Number.isSafeInteger(row.bytes)||row.bytes<0||!/^([0-9a-f]{64})$/.test(row.sha256)||![0o644,0o755,0o600,0o700].includes(row.mode))throw refused()
  const stat=fs.lstatSync(from);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==row.bytes)throw refused();const data=fs.readFileSync(from);if(createHash('sha256').update(data).digest('hex')!==row.sha256)throw refused();fs.writeFileSync(to,data,{flag:'wx',mode:row.mode})
 }
 for(const link of links)fs.symlinkSync(link.target,link.to)
 for(const link of links)if(!fs.realpathSync(link.to).startsWith(target+path.sep))throw refused()

 for(const required of['Products/OwnedPickerUI.xctestrun','Products/Debug/OwnedPickerUITests-Runner.app/Contents/MacOS/OwnedPickerUITests-Runner','OwnedPicker705.app/Contents/MacOS/cmspark-desktop','owner-observer'])if(!manifest.files.some((f:any)=>f.path===required))throw refused()
}
export class OwnedWorkspaceUI705 {
 readonly scene:OwnedUI705Boundary;readonly appExecutable:string
 private xcodeResultObservationStarted=false
 private readonly resultSourceRoot:string
 private xcodeCloseObservationRegistered=false
 private observer?:ChildProcess;private xcode?:ChildProcess;private observerClosed=false;private xcodeClosed=false;private observerCode:number|null=null;private xcodeCode:number|null=null;private changed=new Set<()=>void>();private watcher:fs.FSWatcher;private begun=false;private invalid=false
 constructor(native:string,parent:string,readonly deadline:number,readonly signal:AbortSignal){
  this.resultSourceRoot=path.resolve(native,'../../tests/fixtures/workspace-ui-705')
  if(process.platform!=='darwin'||!Number.isSafeInteger(deadline)||deadline<=Date.now()||deadline>Date.now()+45000)throw refused()
  const nonce=randomBytes(32).toString('hex'),root=path.join(parent,'cmspark-workspace-ui-705-'+nonce);copyManifest(path.join(native,'acceptance/workspace-ui'),root);this.scene=new OwnedUI705Boundary(root,nonce);this.appExecutable=path.join(root,'OwnedPicker705.app/Contents/MacOS/cmspark-desktop');this.scene.write('input.json',{schema:1,nonce,deadline_ms:deadline})
  this.watcher=fs.watch(root,()=>this.notify());this.watcher.on('error',()=>{this.invalid=true;this.notify()})
  signal.addEventListener('abort',()=>this.cancel(),{once:true})
 }
 private notify(){for(const fn of this.changed)fn()}
 start(){if(this.begun||this.signal.aborted)throw refused();this.begun=true;this.scene.check();const env={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:path.join(this.scene.root,'home'),TMPDIR:this.scene.root,LANG:'en_US.UTF-8',TEST_RUNNER_CMSPARK_UI_SCENE:this.scene.root};fs.mkdirSync(env.HOME,{mode:0o700})
  const spawnOwned=(binary:string,args:string[],kind:'observer'|'xcode')=>{const out=fs.openSync(path.join(this.scene.root,kind+'.stdout'),'wx',0o600),err=fs.openSync(path.join(this.scene.root,kind+'.stderr'),'wx',0o600);try{const child=spawn(binary,args,{cwd:this.scene.root,env,stdio:['ignore',out,err]});child.on('error',()=>{this.invalid=true;this.notify()});child.on('close',code=>{if(kind==='observer'){this.observerClosed=true;this.observerCode=code}else{this.xcodeClosed=true;this.xcodeCode=code};this.notify()});return child}finally{fs.closeSync(out);fs.closeSync(err)}}
  this.observer=spawnOwned(path.join(this.scene.root,'owner-observer'),[this.scene.root],'observer')
  this.xcode=spawnOwned('/usr/bin/xcodebuild',['test-without-building','-xctestrun',path.join(this.scene.root,'Products/OwnedPickerUI.xctestrun'),'-destination','platform=macOS','-parallel-testing-enabled','NO','-maximum-parallel-testing-workers','1','-only-testing:OwnedPickerUITests/WorkspacePicker705/testOwnedPanel','-resultBundlePath',path.join(this.scene.root,'Result.xcresult')],'xcode')
 }
 ready(number:1|2){this.scene.write(number===1?'picker-first.json':'picker-second.json',{schema:1,nonce:this.scene.nonce,number})}
 cancel(){try{const v=this.scene.read('cancel.json');if(v)this.scene.fields(v,['schema','nonce']);else this.scene.write('cancel.json',{schema:1,nonce:this.scene.nonce})}catch{this.invalid=true};this.xcode?.kill('SIGTERM');this.notify()}
 diagnostic(){const code=(value:number|null)=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=255?value:null;return{begun:this.begun,invalid:this.invalid,observerClosed:this.observerClosed,observerCode:code(this.observerCode),xcodeClosed:this.xcodeClosed,xcodeCode:code(this.xcodeCode)}}
 xcodeFailureObservation(){
  if(!this.xcodeClosed)return{schema:1,stdout:xcode705Unavailable('NOT_CLOSED'),stderr:xcode705Unavailable('NOT_CLOSED')}
  // Access and per-stream faults cannot replace the existing primary/cleanup.
  const observe=(name:'xcode.stdout'|'xcode.stderr')=>{try{return xcode705Snapshot(this.scene,name)}catch{return xcode705Unavailable('READ_FAILED')}}
  return{schema:1,stdout:observe('xcode.stdout'),stderr:observe('xcode.stderr')}
 }
 // One passive close listener only. Never a wait, lifecycle or cleanup authority.
 observeXcodeCloseOnce(observe:()=>void){
  if(this.xcodeCloseObservationRegistered)return;this.xcodeCloseObservationRegistered=true
  let observed=false;const once=()=>{if(observed)return;observed=true;try{observe()}catch{}}
  try{if(this.xcodeClosed)once();else this.xcode?.once('close',once)}catch{}
 }
 // This reads only after this exact ChildProcess close; caller never supplies a flag/path.
 observeClosedXcodeResultOnce(emit:(value:Result705Projection)=>void){
  if(this.xcodeResultObservationStarted)return;this.xcodeResultObservationStarted=true
  if(!this.xcodeClosed){try{emit(result705Unknown('NOT_CLOSED'))}catch{};return}
  try{result705AfterActualClose(this.scene,this.resultSourceRoot,emit)}catch{try{emit(result705Unknown('INVALID_RESULT'))}catch{}}
 }
 canSettle(){if(!this.begun)return true;return !this.invalid&&this.observerCode===0&&this.scene.closure(this.observerClosed,this.xcodeClosed)}
 async complete(){await this.wait(()=>this.canSettle()||this.invalid||(this.xcodeClosed&&this.xcodeCode!==0)||(this.observerClosed&&this.observerCode!==0));if(!this.canSettle()||this.xcodeCode!==0)throw refused()}
 private wait(done:()=>boolean){return new Promise<void>((resolve,reject)=>{const finish=()=>{this.changed.delete(check);this.signal.removeEventListener('abort',abort)},abort=()=>{finish();reject(refused())},check=()=>{try{if(done()){finish();resolve()}else if(this.signal.aborted)abort()}catch{abort()}};this.changed.add(check);this.signal.addEventListener('abort',abort,{once:true});check()})}
 async cleanup(){if(!this.begun){this.watcher.close();return};this.cancel();try{await this.wait(()=>this.canSettle()||(this.observerClosed&&this.observerCode!==0));if(!this.canSettle())throw refused();this.watcher.close()}catch{this.watcher.unref();this.xcode?.unref();this.observer?.unref();throw refused()}}
}
