import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import {execFileSync,spawnSync,spawn} from 'node:child_process'
import {once} from 'node:events'
import {desktopMcpFixture} from '../desktop-mcp-fixture.mjs'
import {desktopMcpBootstrapObservationFixture773} from '../desktop-bootstrap-observation-fixture.mjs'
import {desktopWindowsToolchain} from '../build-desktop-windows.mjs'
const root=path.resolve(import.meta.dirname,'../..'),read=file=>fs.readFileSync(path.join(root,file),'utf8'),require=createRequire(path.join(root,'package.json')),ts=require('typescript')
const plain=value=>JSON.parse(JSON.stringify(value))
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
function method(source,signature){
 assert.equal(source.split(signature).length,2);const start=source.indexOf(signature),begin=start+signature.length;let depth=1,quote='',line=false,block=false
 for(let i=begin;i<source.length;i++){const c=source[i],next=source[i+1];if(line){if(c==='\n')line=false;continue}if(block){if(c==='*'&&next==='/'){block=false;i++}continue}if(quote){if(c==='\\'){i++;continue}if(c===quote)quote='';continue}if(c==='/'&&next==='/'){line=true;i++;continue}if(c==='/'&&next==='*'){block=true;i++;continue}if(c==='"'||c==="'"){quote=c;continue}if(c==='{')depth++;if(c==='}'&&--depth===0)return source.slice(start,i+1)}throw Error('actual method boundary')
}
const original=read('src/desktop/native/DesktopHost.cpp'),control=read('tests/fixtures/desktop-476/native-acceptance.cpp'),form=read('tests/fixtures/desktop-476/native-form.js'),snapshot=read('tests/fixtures/desktop-476/mcp-snapshot-825.h')
const generated=desktopMcpBootstrapObservationFixture773(desktopMcpFixture('cpp',original,control,form).source,snapshot).source

test('825 MCP snapshot generator restores exact bytes and one original call/outer-dispatch consumer under all EOL pairs',()=>{
 for(const hostEol of ['\n','\r\n'])for(const fixtureEol of ['\n','\r\n'])for(const snapshotEol of ['\n','\r\n']){
  const host=original.replace(/\r?\n/g,hostEol),fixture=control.replace(/\r?\n/g,fixtureEol),base=desktopMcpFixture('cpp',host,fixture,form),sampled=desktopMcpBootstrapObservationFixture773(base.source,snapshot.replace(/\r?\n/g,snapshotEol))
  assert.equal(sampled.inverse,base.source)
  for(const api of ['WinHttpWebSocketSend(','CreateCoreWebView2EnvironmentWithOptions(','env->CreateCoreWebView2Controller(','host->get_CoreWebView2(','web->Navigate(','TranslateMessage(&msg);','DispatchMessageW(&msg);'])assert.equal(sampled.source.split(api).length,base.source.split(api).length,api)
  assert.equal(sampled.source.split('DispatchMessageW(&msg);D476Snapshot825::outerDispatch();').length,2)
  assert.equal(sampled.source.split('D476Snapshot825::CallbackScope callback825(8,code,host!=nullptr);DESKTOP_TEST_NOTE(controller_callback)').length,2)
  assert.ok(sampled.source.includes('D476Snapshot825::sendStage(4);auto sent825=WinHttpWebSocketSend('))
 }
 const header=snapshot;assert.match(header,/is_always_lock_free/);assert.match(header,/offsetof\(Shared,value\)==4/)
 assert.ok(header.indexOf('state.version.fetch_add(1);change();state.version.fetch_add(1)')>=0)
 assert.equal((header.match(/sleep_for\(/g)||[]).length,1)
 assert.doesNotMatch(method(header,'static void worker() noexcept {'),/socket_lock|send\(|PostMessage|DispatchMessage|while\s*\(/)
 const native=read('tests/desktop-native-mcp-476.test.ts'),entry=native.indexOf('const snapshotDeadline825=Date.now()+20000'),lease=native.indexOf('return withSurface650(')
 assert.ok(entry>=0&&entry<lease);assert.match(native,/timeout:20000/);assert.match(read('tests/helpers/mcp-snapshot-825.ts'),/putNumber\(seed, 4, deadline - 1500\)/)
})

function cppDriver(){
 const a=generated.indexOf('struct D476Acceptance {'),b=generated.indexOf('static unsigned count;',a);assert.ok(a>=0&&b>a)
 const declaration=generated.slice(a,b)+'static void emit(Desktop&,wchar_t const*); };'
 const functions=['unsigned D476Acceptance::obBegin773(unsigned point){','void D476Acceptance::obRecord773(unsigned point,unsigned ordinal,unsigned edge,unsigned code,unsigned present){','void D476Acceptance::obFlush773(){','void D476Acceptance::emit(Desktop& h,std::wstring const& value){','void D476Acceptance::emit(Desktop& h,wchar_t const* id){'].map(signature=>method(generated,signature)).join('\n')
 // Only CPU schedules/OS leaves are controlled: the worker and reader bodies
 // remain actual source. Mode 6 injects the UI's version change between the
 // actual two capture loads; mode 7 fails the real worker's WriteFile leaf.
 const actualHeader=snapshot.replace('return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());','return probeNow825();')
  .replace('auto after=state.version.load();','if(mode825==6)state.version.fetch_add(2);auto after=state.version.load();')
  .replaceAll('WriteFile(','writeProbe825(')
 assert.ok(actualHeader!==snapshot)
 return `
#include <atomic>
#include <cassert>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <io.h>
using HINTERNET=void*;
#else
${read('tests/fixtures/desktop-476/mcp-snapshot-825-posix.h')}
#endif
int mode825=0;std::atomic<unsigned> clockCalls825{0};uint64_t target825=0;uint64_t probeNow825();
BOOL writeProbe825(HANDLE f,void const* data,DWORD size,DWORD* wrote,std::nullptr_t){if(mode825==7){*wrote=0;return false;}return WriteFile(f,data,size,wrote,nullptr);}
${actualHeader}
std::atomic<ULONGLONG> clock773{1000};ULONGLONG GetTickCount773(){return clock773.load();}
struct JsonObject{std::wstring id;std::wstring Stringify()const{return id;}};
void put(JsonObject& out,std::wstring const& key,std::wstring const& value){if(key==L"id")out.id=value;}
std::string utf8(std::wstring const& value){return std::string(value.begin(),value.end());}
std::mutex wireMutex;std::condition_variable changed;std::vector<std::string> wire;bool release825=false,writerDone825=false,uiReady825=false,parked825=false;
uint64_t probeNow825(){
 if(clockCalls825.fetch_add(1)==0){std::unique_lock<std::mutex> lock(wireMutex);bool arrived=changed.wait_for(lock,std::chrono::seconds(2),[]{return mode825==1||mode825==2?parked825:uiReady825;});assert(arrived);return target825-1;}
 return target825+(mode825==5?300:1);
}
constexpr int WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE=0;
DWORD WinHttpWebSocketSend(HINTERNET,int,void* bytes,DWORD count){
 std::string id((char*)bytes,count);std::unique_lock<std::mutex> lock(wireMutex);
 if(mode825==2&&id=="DESKTOP_480_PHASE_controller_callback"){parked825=true;changed.notify_all();changed.wait_for(lock,std::chrono::seconds(3),[]{return release825;});}
 wire.push_back(id);
 if(mode825==1&&id=="D480A_BOOT_5_1_1_9_0_2"){parked825=true;changed.notify_all();changed.wait_for(lock,std::chrono::seconds(3),[]{return release825;});}
 return NO_ERROR;
}
class Desktop;
${declaration}
class Desktop{std::mutex socket_lock;HINTERNET socket=(void*)1;std::atomic<bool> ready{true};unsigned test_phase_attempts=0;
 public:enum class TestPhase:unsigned{ready_accepted,env_callback,controller_callback,navigation_callback,document_post_attempted,renderer_callback,renderer_admitted,renderer_send_attempted};
 ${method(generated,'bool send(JsonObject const& value){')}
 ${method(generated,'void test_note(TestPhase value) noexcept {')}
};
${functions.replaceAll('GetTickCount64()','GetTickCount773()')}
void nestedComPump825(){ /* A nested COM/SDK dispatch never executes run()'s hook. */ }
int main(int argc,char** argv){assert(argc==2);mode825=std::stoi(argv[1]);
 std::string seedPath825(argv[0]);seedPath825.resize(seedPath825.find_last_of("\\\\/")+1);seedPath825+="mcp-startup-825.bin";
 {FILE* file=std::fopen(seedPath825.c_str(),"rb");assert(file);uint32_t seed[32]{};auto count=std::fread(seed,1,sizeof(seed),file);std::fclose(file);assert(count==sizeof(seed));target825=uint64_t(seed[4])|(uint64_t(seed[5])<<32);}
 if(mode825==8){FILE* file=std::fopen(seedPath825.c_str(),"r+b");assert(file);
#ifdef _WIN32
 int resized=_chsize_s(_fileno(file),127);
#else
 int resized=ftruncate(fileno(file),127);
#endif
 std::fclose(file);assert(resized==0);}
#ifndef _WIN32
 std::string executable(argv[0]);module825=std::wstring(executable.begin(),executable.end());
#endif
 Desktop h;std::thread worker([]{D476Snapshot825::worker();std::lock_guard<std::mutex> lock(wireMutex);writerDone825=true;changed.notify_all();});
 std::thread ui([&]{h.test_note(Desktop::TestPhase::ready_accepted);D476Acceptance::obBind773(h);
 D476Acceptance::obApi773(5,[&]{D476Snapshot825::CallbackScope callback825(6,0,true);clock773=2750;h.test_note(Desktop::TestPhase::env_callback);D476Acceptance::obCallback773(6,0,true);D476Acceptance::obApi773(7,[&]{clock773=3250;return HRESULT(0);});return HRESULT(0);});
 if(mode825==3)nestedComPump825();else D476Snapshot825::outerDispatch();
 if(mode825==2){D476Snapshot825::CallbackScope callback825(8,0,true);h.test_note(Desktop::TestPhase::controller_callback);D476Acceptance::obCallback773(8,0,true);}
 if(mode825==4)D476Snapshot825::state.version.fetch_add(1); // Controlled updating-state negative.
 {std::lock_guard<std::mutex> lock(wireMutex);uiReady825=true;changed.notify_all();}
 });
 {std::unique_lock<std::mutex> lock(wireMutex);bool done=changed.wait_for(lock,std::chrono::seconds(4),[]{return writerDone825;});assert(done);
  for(auto const& id:wire){std::fwrite(id.data(),1,id.size(),stdout);std::fputs("\\n",stdout);}
  release825=true;changed.notify_all();}
 ui.join();worker.join();return 0;
}
`
}

test('825 actual native worker/file reader distinguishes same-wire schedules, coherent publication, nested dispatch and UNKNOWNs', {timeout:30000}, async t=>{
 let clockValue=Date.now();class ControlledClock825 extends Date{static now(){return clockValue}}
 const helper=nodeHelper(ControlledClock825),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-snapshot-owned-825-'))
 let primary825
 try{
  const cpp=path.join(dir,'probe.cpp'),binary=path.join(dir,process.platform==='win32'?'probe.exe':'probe');fs.writeFileSync(cpp,cppDriver())
  let compiler,args,env
  if(process.platform==='win32'){const tools=desktopWindowsToolchain();compiler=tools.cl;env=tools.env;args=['/nologo','/std:c++20','/EHsc','/DUNICODE','/D_UNICODE','/Fo'+path.join(dir,'probe.obj'),'/Fd'+path.join(dir,'probe.pdb'),cpp,'/link','/OUT:'+binary]}
  else{compiler=process.platform==='darwin'?'/usr/bin/clang++':'/usr/bin/c++';args=['-std=c++20','-pthread',cpp,'-o',binary]}
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
})

test('826 actual CPU callback preserves compiler failure through cleanup failure and never hides cleanup-only failure',async()=>{
 const source=read('scripts/tests/desktop-mcp-snapshot-825.test.mjs'),ast=ts.createSourceFile('actual.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
 const cases=ast.statements.filter(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==='test'&&node.expression.arguments[0]?.text?.startsWith('825 actual native worker'))
 assert.equal(cases.length,1);const callback=cases[0].expression.arguments[2],attempts=callback.body.statements.filter(ts.isTryStatement);assert.equal(attempts.length,1)
 for(const platform of new Set([process.platform,'win32']))for(const fault of ['timeout','firstOpen','secondOpen','spawn','nonzero','diagnosticRead','closeWithTimeout','closeOnly']){
  const timeout=Object.assign(Error('owned-compiler-timeout'),{code:'ETIMEDOUT'}),cleanup=Object.assign(Error('owned-cleanup-busy'),{code:'EBUSY'}),openError=Error('owned-open-failure'),spawnError=Error('owned-spawn-failure'),closeError=Error('owned-close-failure')
  const owned=path.join(os.tmpdir(),'owned-case-826'),closed=[],reads=[];let opens=0,removed=0,compiled=0
  const fsPort={mkdtempSync:()=>owned,writeFileSync(){},existsSync:()=>true,
   openSync(file,flags,mode){opens++;assert.equal(file,path.join(owned,opens===1?'compiler.stdout':'compiler.stderr'));assert.equal(flags,'wx+');assert.equal(mode,0o600);if(fault==='firstOpen'||fault==='secondOpen'&&opens===2)throw openError;return 10+opens},
   closeSync(fd){closed.push(fd);if(fd===11&&['closeWithTimeout','closeOnly'].includes(fault))throw closeError},
   readSync(fd,bytes,offset,length,position){reads.push(fd);assert.equal(length,64*1024);assert.equal(position,0);if(fault==='diagnosticRead')throw Error('owned-diagnostic-read');return Buffer.from('owned compiler output\n').copy(bytes,offset)},
   rmSync(){removed++;throw cleanup}}
  const compilerPort=(file,args,options)=>{
   compiled++;assert.equal(options.cwd,root);assert.equal(options.timeout,20000);assert.deepEqual(Array.from(options.stdio),['ignore',11,12])
   if(platform==='win32'){assert.ok(args.includes('/Fo'+path.join(owned,'probe.obj')));assert.ok(args.includes('/Fd'+path.join(owned,'probe.pdb')))}
   if(fault==='spawn')throw spawnError
   return{error:['nonzero','closeOnly'].includes(fault)?undefined:timeout,status:fault==='nonzero'?1:fault==='closeOnly'?0:null,signal:null}
  }
  const run=vm.runInNewContext('('+callback.getText(ast)+')',{Buffer,Date,root,fs:fsPort,nodeHelper:()=>({}),os,path,process:{platform},desktopWindowsToolchain:()=>({cl:'owned-compiler',env:{}}),cppDriver:()=> 'owned inert cpp',spawnSync:compilerPort,assert})
  const expected=fault==='firstOpen'||fault==='secondOpen'?openError:fault==='spawn'?spawnError:fault==='closeOnly'?closeError:undefined
  await assert.rejects(run(),error=>expected?error===expected:error.code==='ERR_ASSERTION'&&error.actual===(fault==='nonzero'?1:timeout))
  assert.equal(compiled,['firstOpen','secondOpen'].includes(fault)?0:1);assert.equal(removed,1)
  assert.deepEqual(closed,fault==='firstOpen'?[]:fault==='secondOpen'?[11]:[11,12]);assert.deepEqual(reads,['firstOpen','secondOpen','spawn','closeOnly'].includes(fault)?[]:[11,12])
 }
 const cleanup=Error('owned-cleanup-only'),body=attempts[0].finallyBlock.getText(ast),finalize=new Function('fs','dir','primary825',body)
 assert.throws(()=>finalize({rmSync(){throw cleanup}},'owned-case',undefined),error=>error===cleanup)
})
