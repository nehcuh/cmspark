// One private Windows test artifact. Never a package asset or runtime compiler.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {MCP_SNAPSHOT_CPU_INPUTS_825,mcpSnapshotCpuDriver825} from './desktop-mcp-snapshot-cpu-driver-825.mjs'
export const MCP_SNAPSHOT_CPU_DIRECTORY_825='mcp-snapshot-cpu-825'
const fail=()=>Error('MCP_SNAPSHOT_CPU_ARTIFACT_825'),digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const fields=['dev','ino','birthtimeNs','ctimeNs','mtimeNs','size','nlink']
const same=(a,b)=>fields.every(key=>a[key]===b[key])
const regular=(s,cap)=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&s.size>0n&&s.size<=BigInt(cap)
function bytes825(file,cap){
 const named=fs.lstatSync(file,{bigint:true});if(!regular(named,cap))throw fail()
 const fd=fs.openSync(file,'r')
 try{
  const opened=fs.fstatSync(fd,{bigint:true});if(!regular(opened,cap)||!same(named,opened))throw fail()
  const bytes=Buffer.alloc(Number(opened.size));if(fs.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)throw fail()
  const final=fs.fstatSync(fd,{bigint:true}),after=fs.lstatSync(file,{bigint:true})
  if(!regular(final,cap)||!regular(after,cap)||!same(opened,final)||!same(opened,after))throw fail()
  return bytes
 }finally{fs.closeSync(fd)}
}
function directory825(directory){const s=fs.lstatSync(directory,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink())throw fail();return{dev:s.dev,ino:s.ino,birthtimeNs:s.birthtimeNs}}
function unchanged825(directory,expected){const current=directory825(directory);if(Object.keys(expected).some(key=>current[key]!==expected[key]))throw fail()}
function target825(){if(process.platform!=='win32'||process.arch!=='x64'||process.version!=='v22.23.4')throw fail();return{platform:process.platform,arch:process.arch,node:process.version}}
export function currentMcpSnapshotCpu825(root){
 const inputs={},hashes={}
 for(const name of MCP_SNAPSHOT_CPU_INPUTS_825){const bytes=bytes825(path.join(root,name),2*1024*1024);inputs[name]=bytes.toString('utf8');hashes[name]=digest(bytes)}
 const source=mcpSnapshotCpuDriver825(inputs)
 return{source,sourceSha256:digest(source),inputs:hashes}
}
export function buildMcpSnapshotCpu825({root,dest,output,cl,env,checked}){
 const target=target825(),acceptance=path.join(dest,'acceptance');directory825(dest)
 if(!fs.existsSync(acceptance))fs.mkdirSync(acceptance);directory825(acceptance)
 const directory=path.join(acceptance,MCP_SNAPSHOT_CPU_DIRECTORY_825)
 if(!fs.existsSync(directory))fs.mkdirSync(directory,{mode:0o700})
 const owned=directory825(directory),manifest=path.join(directory,'manifest.json'),binary=path.join(directory,'probe.exe')
 // Invalidate the prior finite publication before any new compiler invocation.
 for(const file of [manifest,binary])if(fs.existsSync(file)){if(!regular(fs.lstatSync(file,{bigint:true}),32*1024*1024))throw fail();fs.unlinkSync(file)}
 const current=currentMcpSnapshotCpu825(root),stage=fs.mkdtempSync(path.join(output,'snapshot-cpu-825-')),cpp=path.join(stage,'probe.cpp'),compiled=path.join(stage,'probe.exe'),fds=[]
 fs.writeFileSync(cpp,current.source,{flag:'wx',mode:0o600});let primary
 try{
  for(const name of ['compiler.stdout','compiler.stderr'])fds.push(fs.openSync(path.join(stage,name),'wx+',0o600))
  try{
   // No timeout override: the existing checked build contract is 120000ms.
   checked(cl,['/nologo','/std:c++20','/EHsc','/DUNICODE','/D_UNICODE','/Fo'+path.join(stage,'probe.obj'),'/Fd'+path.join(stage,'probe.pdb'),cpp,'/link','/OUT:'+compiled],{cwd:root,env,stdio:['ignore',...fds]})
  }catch(error){for(const fd of fds)try{const b=Buffer.alloc(64*1024),n=fs.readSync(fd,b,0,b.length,0);process.stderr.write(b.subarray(0,n))}catch{};throw error}
 }catch(error){primary=error;throw error}finally{
  let closeFailure;for(const fd of fds)try{fs.closeSync(fd)}catch(error){closeFailure??=error}
  if(primary===undefined&&closeFailure!==undefined)throw closeFailure
 }
 const bytes=bytes825(compiled,32*1024*1024)
 unchanged825(directory,owned);fs.writeFileSync(binary,bytes,{flag:'wx',mode:0o700})
 const value={schema:1,target,sourceSha256:current.sourceSha256,inputs:current.inputs,binarySha256:digest(bytes)}
 unchanged825(directory,owned);fs.writeFileSync(manifest,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600})
 return value
}
export function consumeMcpSnapshotCpu825(root,native,ownedRuntime){
 const target=target825(),parents=[native,path.join(native,'acceptance'),path.join(native,'acceptance',MCP_SNAPSHOT_CPU_DIRECTORY_825),ownedRuntime],identities=parents.map(directory825),directory=parents[2]
 const manifest=JSON.parse(bytes825(path.join(directory,'manifest.json'),16384).toString('utf8')),current=currentMcpSnapshotCpu825(root)
 if(!manifest||Array.isArray(manifest)||Object.keys(manifest).sort().join()!=='binarySha256,inputs,schema,sourceSha256,target'||manifest.schema!==1||JSON.stringify(manifest.target)!==JSON.stringify(target)||manifest.sourceSha256!==current.sourceSha256||JSON.stringify(manifest.inputs)!==JSON.stringify(current.inputs)||typeof manifest.binarySha256!=='string'||!/^[a-f0-9]{64}$/.test(manifest.binarySha256))throw fail()
 const bytes=bytes825(path.join(directory,'probe.exe'),32*1024*1024);if(digest(bytes)!==manifest.binarySha256)throw fail()
 parents.forEach((directory,index)=>unchanged825(directory,identities[index]))
 const executable=path.join(ownedRuntime,'probe.exe');fs.writeFileSync(executable,bytes,{flag:'wx',mode:0o700})
 parents.forEach((directory,index)=>unchanged825(directory,identities[index]));return executable
}
