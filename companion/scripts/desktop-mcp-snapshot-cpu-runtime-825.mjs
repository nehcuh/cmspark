// Actual CPU validation; Windows consumes its explicitly prebuilt private artifact.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import {execFileSync,spawnSync,spawn} from 'node:child_process'
import {once} from 'node:events'
import {currentMcpSnapshotCpu825,consumeMcpSnapshotCpu825} from './desktop-mcp-snapshot-cpu-artifact-825.mjs'
const root=path.resolve(import.meta.dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8'),require=createRequire(path.join(root,'package.json')),ts=require('typescript')
const plain=value=>JSON.parse(JSON.stringify(value)),cppDriver=()=>currentMcpSnapshotCpu825(root).source
function compileModule(text,file,ports=createRequire(file),clock=Date){
 const exports={},code=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText
 vm.runInNewContext('(function(exports,require){'+code+'\n})',{Buffer,console,Date:clock,Promise})(exports,ports);return exports
}
function nodeHelper(clock=Date,fsPort=fs){
 const file=path.join(root,'tests/fixtures/desktop-480/native-acceptance-controller.ts'),source=read('tests/fixtures/desktop-480/native-acceptance-controller.ts'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true)
 const declarations=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&['ownedDirectoryIdentity','requireOwnedDirectory','copyOwnedAcceptanceAssets'].includes(node.name?.text)||ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(ast)==='OFFLINE_ACCEPTANCE_ASSETS_480')).map(node=>node.getText(ast));assert.equal(declarations.length,4)
 const copier=compileModule("import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';\n"+declarations.join('\n'),file)
 const helperFile=path.join(root,'tests/helpers/mcp-snapshot-825.ts')
 return{...compileModule(read('tests/helpers/mcp-snapshot-825.ts'),helperFile,id=>id==='../fixtures/desktop-480/native-acceptance-controller'?copier:id==='node:fs'?fsPort:require(id),clock),copier}
}
export async function runMcpSnapshotCpu825(t){
 let clockValue=Date.now();class ControlledClock825 extends Date{static now(){return clockValue}}
 const helper=nodeHelper(ControlledClock825),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-snapshot-owned-825-'))
 let primary825
 try{
  let binary
  if(process.platform==='win32')binary=consumeMcpSnapshotCpu825(root,path.join(root,'dist/desktop-native'),dir)
  else{
  const cpp=path.join(dir,'probe.cpp');binary=path.join(dir,'probe');fs.writeFileSync(cpp,cppDriver())
  let compiler,args,env
  {compiler=process.platform==='darwin'?'/usr/bin/clang++':'/usr/bin/c++';args=['-std=c++20','-pthread',cpp,'-o',binary]}
  const compilerFds=[]
  try{
   for(const name of ['compiler.stdout','compiler.stderr'])compilerFds.push(fs.openSync(path.join(dir,name),'wx+',0o600))
   // Regular files do not make this call (or the outer test runner) wait for
   // a compiler descendant's inherited pipe EOF. Cwd stays outside the case.
   const built=spawnSync(compiler,args,{cwd:root,env,encoding:'utf8',timeout:20000,stdio:['ignore',...compilerFds]})
   let diagnostic=''
   if(built.error||built.status!==0)for(const fd of compilerFds){try{const bytes=Buffer.alloc(64*1024),count=fs.readSync(fd,bytes,0,bytes.length,0);diagnostic+=bytes.subarray(0,count).toString()}catch{/* Finite diagnostics cannot replace the compiler failure. */}}
   assert.equal(built.error,undefined,diagnostic);assert.equal(built.status,0,diagnostic)
  }catch(error){primary825=error;throw error}finally{
   let closeFailure;for(const fd of compilerFds)try{fs.closeSync(fd)}catch(error){closeFailure??=error}
   if(primary825===undefined&&closeFailure!==undefined)throw closeFailure
  }
  }
  // Run on Windows too: remove the whole owned output directory while an
  // actual live descendant holds both file handles, then require a late write.
  const liveDirectory=path.join(dir,'live-file-stdio');fs.mkdirSync(liveDirectory)
  const liveFds=[];let liveChild,liveClosed=false,closed
  try{
   for(const name of ['compiler.stdout','compiler.stderr'])liveFds.push(fs.openSync(path.join(liveDirectory,name),'wx+',0o600))
   const code="const fs=require('node:fs');fs.writeSync(1,'READY\\n');fs.writeSync(2,'READY_ERR\\n');process.on('message',value=>{if(value!=='write-after-rm')process.exit(2);fs.writeSync(1,'LATE\\n');fs.writeSync(2,'LATE_ERR\\n');process.send({phase:'written'});process.disconnect()});process.send({phase:'ready',cwd:process.cwd()});"
   liveChild=spawn(process.execPath,['-e',code],{cwd:root,stdio:['ignore',...liveFds,'ipc'],signal:t.signal})
   let childError;liveChild.on('error',error=>{childError=error})
   closed=new Promise(resolve=>liveChild.once('close',(status,signal)=>{liveClosed=true;resolve({status,signal,error:childError})}))
   const message=()=>Promise.race([once(liveChild,'message'),closed.then(result=>{throw result.error??Error('OWNED_FILE_STDIO_EARLY_CLOSE')})])
   const [ready]=await message();assert.equal(ready.phase,'ready');assert.equal(fs.realpathSync(ready.cwd),fs.realpathSync(root))
   fs.rmSync(liveDirectory,{recursive:true,force:true});assert.equal(fs.existsSync(liveDirectory),false);assert.equal(liveChild.exitCode,null)
   const written=message();liveChild.send('write-after-rm');assert.equal((await written)[0].phase,'written')
   const result=await closed;assert.equal(result.error,undefined);assert.equal(result.status,0);assert.equal(result.signal,null)
   for(const [index,expected]of ['READY\nLATE\n','READY_ERR\nLATE_ERR\n'].entries()){
    const bytes=Buffer.alloc(128),count=fs.readSync(liveFds[index],bytes,0,bytes.length,0);assert.equal(bytes.subarray(0,count).toString(),expected)
   }
  }catch(error){primary825=error;throw error}finally{
   if(liveChild&&!liveClosed)liveChild.kill('SIGKILL');if(closed)await closed
   let closeFailure;for(const fd of liveFds)try{fs.closeSync(fd)}catch(error){closeFailure??=error}
   if(primary825===undefined&&closeFailure!==undefined)throw closeFailure
  }
  const native=path.join(dir,'native'),source=path.join(native,'acceptance/mcp');fs.mkdirSync(path.join(source,'assets'),{recursive:true});fs.mkdirSync(path.join(native,'assets'))
  fs.writeFileSync(path.join(source,'cmspark-desktop.exe'),'owned-inert-binary')
  for(const name of helper.copier.OFFLINE_ACCEPTANCE_ASSETS_480){fs.writeFileSync(path.join(source,'assets',name),'owned '+name);fs.copyFileSync(path.join(source,'assets',name),path.join(native,'assets',name))}
  assert.equal(helper.copier.OFFLINE_ACCEPTANCE_ASSETS_480.length,9)
  const rows=[],observations=[]
  for(const mode of [0,1,2,3,4,5,6,7,8]){
   clockValue=Date.now();const owned=path.join(dir,'case '+mode);fs.mkdirSync(owned);const receipt=await helper.prepareMcpSnapshot825(native,owned,clockValue+1800)
   try{
    const executable=path.join(path.dirname(receipt.binary),path.basename(binary));fs.copyFileSync(binary,executable)
    assert.deepEqual(fs.readdirSync(path.join(path.dirname(receipt.binary),'assets')).sort(),[...helper.copier.OFFLINE_ACCEPTANCE_ASSETS_480].sort())
    const wire=execFileSync(executable,[String(mode)],{encoding:'utf8',timeout:6000}).trim().split(/\r?\n/)
    clockValue=receipt.seed.readUInt32LE(16)+receipt.seed.readUInt32LE(20)*0x100000000+500
    const value=plain(receipt.read());observations.push(value);rows.push(wire)
    if(mode<4){const bytes=fs.readFileSync(receipt.file),word=i=>bytes.readUInt32LE(i*4);assert.equal(value.status,'OBSERVED',JSON.stringify({mode,status:word(8),version:word(11),flags:word(12),kind:word(17),site:word(18),edge:word(19),stage:word(20),committed:word(31)===((helper.MCP_SNAPSHOT_MAGIC_825^word(3))>>>0),sampled:word(9)+word(10)*0x100000000,target:word(4)+word(5)*0x100000000,payload:word(22)+word(23)*0x100000000,now:Date.now()}))}else assert.equal(value.status,'UNKNOWN')
    if(mode===0){
     const actual=fs.readFileSync(receipt.file);assert.equal(helper.decodeMcpSnapshot825(receipt.seed,actual).status,'OBSERVED')
     // Actual helper + actual native-written receipt with controlled filesystem
     // identities above Number's exact integer range. The canonical directory
     // copier retains its original real fs port; only this receipt is adapted.
     const large=9007199254740992n;assert.equal(Number(large),Number(large+1n))
     let receiptFd=-1,mismatch='',identityReads=0
     const receiptPath=file=>typeof file==='string'&&path.basename(file)==='mcp-startup-825.bin'
     const identified=(stat,side)=>{stat.dev=large;stat.ino=large;stat.birthtimeNs=large;if(mismatch===side+'Id')stat.ino=large+1n;if(mismatch===side+'Birth')stat.birthtimeNs=large+1n;return stat}
     const fsPort=new Proxy(fs,{get(target,key){
      if(key==='openSync')return(file,...args)=>{const fd=fs.openSync(file,...args);if(receiptPath(file))receiptFd=fd;return fd}
      if(key==='lstatSync')return(file,options)=>{if(!receiptPath(file))return fs.lstatSync(file,options);assert.equal(options?.bigint,true,'receipt path identity must use BigIntStats');return identified(fs.lstatSync(file,options),'path')}
      if(key==='fstatSync')return(fd,options)=>{if(fd!==receiptFd)return fs.fstatSync(fd,options);assert.equal(options?.bigint,true,'receipt handle identity must use BigIntStats');return identified(fs.fstatSync(fd,options),'handle')}
      if(key==='readSync')return(fd,...args)=>{if(fd===receiptFd)identityReads++;return fs.readSync(fd,...args)}
      return Reflect.get(target,key)
     }})
     const bigHelper=nodeHelper(ControlledClock825,fsPort),bigOwned=path.join(dir,'large identities');fs.mkdirSync(bigOwned)
     clockValue=Date.now();const bigReceipt=await bigHelper.prepareMcpSnapshot825(native,bigOwned,clockValue+1800)
     try{
      const executable=path.join(path.dirname(bigReceipt.binary),path.basename(binary));fs.copyFileSync(binary,executable);execFileSync(executable,['0'],{encoding:'utf8',timeout:6000})
      clockValue=bigReceipt.seed.readUInt32LE(16)+bigReceipt.seed.readUInt32LE(20)*0x100000000+500
      assert.equal(bigReceipt.read().status,'OBSERVED','the same large identity must accept the actual native payload');assert.equal(identityReads,2)
      for(const changed of ['pathId','handleId','pathBirth','handleBirth']){
       mismatch=changed;const before=identityReads;assert.equal(bigReceipt.read().status,'UNKNOWN',changed);assert.equal(identityReads,before,'different full-width identities must reject before any readSync')
      }
      mismatch='';assert.equal(bigReceipt.read().status,'OBSERVED');assert.equal(identityReads,4)
     }finally{bigReceipt.close()}
     for(const [word,bad]of [[0,0],[8,0],[11,3],[12,1024],[16,2],[17,3],[20,7],[24,1],[31,0]]){const changed=Buffer.from(actual);changed.writeUInt32LE(bad,word*4);assert.equal(helper.decodeMcpSnapshot825(receipt.seed,changed).status,'UNKNOWN')}
     const late=Buffer.from(actual),target=late.readUInt32LE(16)+late.readUInt32LE(20)*0x100000000;late.writeUInt32LE((target+251)>>>0,36);late.writeUInt32LE(Math.floor((target+251)/0x100000000),40);assert.equal(helper.decodeMcpSnapshot825(receipt.seed,late).status,'UNKNOWN')
     assert.equal(helper.decodeMcpSnapshot825(receipt.seed,actual.subarray(0,124)).status,'UNKNOWN')
     const backup=receipt.file+'.original';fs.renameSync(receipt.file,backup);fs.writeFileSync(receipt.file,actual);assert.equal(receipt.read().status,'UNKNOWN');fs.unlinkSync(receipt.file);fs.renameSync(backup,receipt.file)
     fs.truncateSync(receipt.file,127);assert.equal(receipt.read().status,'UNKNOWN');fs.writeFileSync(receipt.file,actual)
    }
   }finally{receipt.close();assert.equal(receipt.read().status,'UNKNOWN')}
  }
  assert.deepEqual(rows[0],rows[1]);assert.deepEqual(rows[1],rows[2]);assert.equal(rows[0].length,8)
  assert.equal(observations[0].sendStage,6);assert.equal(observations[0].sendResultKnown,true);assert.equal(observations[0].flags&16,0);assert.equal(observations[0].flags&32,32)
  assert.equal(observations[1].sendStage,4);assert.equal(observations[1].sendKind,2);assert.equal(observations[1].sendResultKnown,false);assert.equal(observations[1].flags&8,0)
  assert.equal(observations[2].sendStage,4);assert.equal(observations[2].sendKind,1);assert.equal(observations[2].flags&16,16)
  assert.equal(observations[3].flags&32,0,'nested COM pump cannot lock the outer run-loop marker')
  // Missing writer, data corruption and copied-asset drift remain observations/setup failures.
  const owned=path.join(dir,'unavailable');fs.mkdirSync(owned);const receipt=await helper.prepareMcpSnapshot825(native,owned,clockValue+1800);assert.equal(receipt.read().status,'UNKNOWN');receipt.close()
  fs.writeFileSync(path.join(source,'assets','app.js'),'drift');const drift=path.join(dir,'drift');fs.mkdirSync(drift);await assert.rejects(()=>helper.prepareMcpSnapshot825(native,drift,Date.now()+1800),/OWNED_MCP_SNAPSHOT_ASSETS/)
 }catch(error){primary825=error;throw error}finally{try{fs.rmSync(dir,{recursive:true,force:true})}catch(cleanup){if(primary825===undefined)throw cleanup;}}
}
