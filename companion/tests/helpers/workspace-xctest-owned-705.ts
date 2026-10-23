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
export const UI705_FILES=['input.json','runner-start.json','owner-ack.json','ui-begin.json','ui-quiescent.json','runner-closed.json','cancel.json','picker-first.json','picker-second.json'] as const
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
 private observer?:ChildProcess;private xcode?:ChildProcess;private observerClosed=false;private xcodeClosed=false;private observerCode:number|null=null;private xcodeCode:number|null=null;private changed=new Set<()=>void>();private watcher:fs.FSWatcher;private begun=false;private invalid=false
 constructor(native:string,parent:string,readonly deadline:number,readonly signal:AbortSignal){
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
 canSettle(){if(!this.begun)return true;return !this.invalid&&this.observerCode===0&&this.scene.closure(this.observerClosed,this.xcodeClosed)}
 async complete(){await this.wait(()=>this.canSettle()||this.invalid||(this.xcodeClosed&&this.xcodeCode!==0)||(this.observerClosed&&this.observerCode!==0));if(!this.canSettle()||this.xcodeCode!==0)throw refused()}
 private wait(done:()=>boolean){return new Promise<void>((resolve,reject)=>{const finish=()=>{this.changed.delete(check);this.signal.removeEventListener('abort',abort)},abort=()=>{finish();reject(refused())},check=()=>{try{if(done()){finish();resolve()}else if(this.signal.aborted)abort()}catch{abort()}};this.changed.add(check);this.signal.addEventListener('abort',abort,{once:true});check()})}
 async cleanup(){if(!this.begun){this.watcher.close();return};this.cancel();try{await this.wait(()=>this.canSettle()||(this.observerClosed&&this.observerCode!==0));if(!this.canSettle())throw refused();this.watcher.close()}catch{this.watcher.unref();this.xcode?.unref();this.observer?.unref();throw refused()}}
}
