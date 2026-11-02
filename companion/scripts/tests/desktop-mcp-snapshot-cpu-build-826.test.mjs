import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import * as cp from 'node:child_process'
import * as driver from '../desktop-mcp-snapshot-cpu-driver-825.mjs'
import {currentMcpSnapshotCpu825,MCP_SNAPSHOT_CPU_DIRECTORY_825} from '../desktop-mcp-snapshot-cpu-artifact-825.mjs'
import {desktopMcpFixture} from '../desktop-mcp-fixture.mjs'
import {desktopMcpBootstrapObservationFixture773} from '../desktop-bootstrap-observation-fixture.mjs'
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(path.join(root,'package.json')),ts=require('typescript'),read=name=>fs.readFileSync(path.join(root,name),'utf8')
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
function load(file,ports={},processPort=process){
 const source=read(file).replace("path.resolve(import.meta.dirname,'..')",JSON.stringify(root)).replace('require=createRequire','runtimeRequire=createRequire').replace("ts=require('typescript')","ts=runtimeRequire('typescript')").replace(':require(id),clock)',':runtimeRequire(id),clock)'),exports={}
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText
 vm.runInNewContext('(function(exports,require){'+js+'\n})',{Buffer,console,process:processPort,Date,Promise,URL,TextDecoder,setTimeout,clearTimeout})(exports,id=>Object.hasOwn(ports,id)?ports[id]:require(id))
 return exports
}
const windows={...process,platform:'win32',arch:'x64',version:'v22.23.4',stderr:{write(){}}}
function artifact(fsPort=fs,processPort=windows){return load('scripts/desktop-mcp-snapshot-cpu-artifact-825.mjs',{'node:fs':fsPort,'./desktop-mcp-snapshot-cpu-driver-825.mjs':driver},processPort)}
function actualChecked(spawnSync){const source=read('scripts/build-desktop-windows.mjs'),ast=ts.createSourceFile('builder.mjs',source,ts.ScriptTarget.Latest,true),fn=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='checked');assert.equal(fn.length,1);return vm.runInNewContext('('+fn[0].getText(ast)+')',{spawnSync,process:windows,Error})}

test('826 pure driver equals the sealed actual 0666 producer under all source EOL profiles without test registration',()=>{
 const fixture=fs.readFileSync(path.join(root,'scripts/tests/fixtures/mcp-snapshot-cpu-0666.json'));assert.ok(['39f4eeafa730078eb0986c094c06f494d981b70bdf0142c26ffa382242a2096f','814df1c82a4485b69cbe9f975a1abc82039611d0c52c41845fbd97e51c853c1b'].includes(digest(fixture)))
 const legacy=JSON.parse(fixture),inputs=Object.fromEntries(driver.MCP_SNAPSHOT_CPU_INPUTS_825.map(name=>[name,read(name)]))
 for(const host of ['\n','\r\n'])for(const control of ['\n','\r\n'])for(const header of ['\n','\r\n']){
  const derived={...inputs};for(const [name,eol]of [['src/desktop/native/DesktopHost.cpp',host],['tests/fixtures/desktop-476/native-acceptance.cpp',control],['tests/fixtures/desktop-476/mcp-snapshot-825.h',header]])derived[name]=inputs[name].replace(/\r?\n/g,eol)
  const original=derived['src/desktop/native/DesktopHost.cpp'],fixture=derived['tests/fixtures/desktop-476/native-acceptance.cpp'],form=derived['tests/fixtures/desktop-476/native-form.js'],snapshot=derived['tests/fixtures/desktop-476/mcp-snapshot-825.h'],generated=desktopMcpBootstrapObservationFixture773(desktopMcpFixture('cpp',original,fixture,form).source,snapshot).source
  const actual=vm.runInNewContext(legacy.method+'\n'+legacy.cppDriver+';cppDriver()',{assert,read:name=>derived[name],snapshot,generated})
  assert.equal(driver.mcpSnapshotCpuDriver825(derived),actual)
 }
 const source=read('scripts/desktop-mcp-snapshot-cpu-driver-825.mjs');assert.doesNotMatch(source,/node:test|node:child_process|spawnSync\(|test\(/)
 const builder=ts.createSourceFile('builder.mjs',read('scripts/build-desktop-windows.mjs'),ts.ScriptTarget.Latest,true);const calls=[]
 function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(builder)==='buildMcpSnapshotCpu825'){let p=n.parent,guard=false;while(p){if(ts.isIfStatement(p)&&p.expression.getText(builder)==='testFixtures')guard=true;p=p.parent}calls.push(guard)}ts.forEachChild(n,visit)}visit(builder);assert.deepEqual(calls,[true])
})

test('826 real private artifact producer/consumer binds generated inputs and opened binary bytes; every refusal precedes runtime', {timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-826-artifact-owned-')),native=path.join(dir,'native'),output=path.join(dir,'objects');fs.mkdirSync(native);fs.mkdirSync(output)
 try{
  const api=artifact();let invocations=0,actualBinary
  const checked=actualChecked((compiler,args,options)=>{
   invocations++;assert.equal(options.timeout,120000);assert.equal(options.cwd,root);assert.equal(options.stdio.length,3);assert.equal(options.stdio[0],'ignore')
   const source=args.find(x=>x.endsWith('.cpp')),binary=args.find(x=>x.startsWith('/OUT:')).slice(5)
   assert.equal(fs.readFileSync(source,'utf8'),currentMcpSnapshotCpu825(root).source);assert.ok(args.some(x=>x.startsWith('/Fo'+output)));assert.ok(args.some(x=>x.startsWith('/Fd'+output)))
   // Windows's actual C++ runtime executes only after its fixture build. This
   // early handoff control uses a controlled compiler leaf there, avoiding a
   // second in-test MSVC compilation. Other hosts compile the real shared TU.
   if(process.platform==='win32'){const system=process.env.SystemRoot||process.env.SYSTEMROOT;assert.ok(system);fs.copyFileSync(path.join(system,'System32/whoami.exe'),binary);actualBinary=fs.readFileSync(binary);return{status:0}}
   const result=cp.spawnSync(process.platform==='darwin'?'/usr/bin/clang++':'/usr/bin/c++',['-std=c++20','-pthread',source,'-o',binary],{...options,timeout:20000});if(result.status===0)actualBinary=fs.readFileSync(binary);return result
  })
  const produced=api.buildMcpSnapshotCpu825({root,dest:native,output,cl:'owned-compiler',env:process.env,checked});assert.equal(invocations,1)
  const directory=path.join(native,'acceptance',MCP_SNAPSHOT_CPU_DIRECTORY_825),manifest=path.join(directory,'manifest.json'),binary=path.join(directory,'probe.exe'),original=fs.readFileSync(manifest)
  assert.deepEqual(JSON.parse(original),JSON.parse(JSON.stringify(produced)))
  let number=0;const consume=()=>{const owned=path.join(dir,'runtime-'+number++);fs.mkdirSync(owned);return api.consumeMcpSnapshotCpu825(root,native,owned)}
  assert.deepEqual(fs.readFileSync(consume()),actualBinary)
  for(const change of [v=>{v.schema=2},v=>{v.target.platform='darwin'},v=>{v.target.arch='arm64'},v=>{v.target.node='v22.23.2'},v=>{v.sourceSha256='0'.repeat(64)},v=>{v.inputs[driver.MCP_SNAPSHOT_CPU_INPUTS_825[0]]='0'.repeat(64)},v=>{v.extra=true}]){
   const value=JSON.parse(original);change(value);fs.writeFileSync(manifest,JSON.stringify(value));assert.throws(consume);fs.writeFileSync(manifest,original)
  }
  fs.writeFileSync(manifest,'{');assert.throws(consume);fs.writeFileSync(manifest,original)
  fs.unlinkSync(manifest);assert.throws(consume);fs.writeFileSync(manifest,original)
  fs.writeFileSync(binary,Buffer.from('different binary'));assert.throws(consume);fs.writeFileSync(binary,actualBinary)
  const link=path.join(directory,'same-binary-link');fs.linkSync(binary,link);assert.throws(consume);fs.unlinkSync(link)
  const descriptors=new Map();let distinct=false,binaryReads=0
  const fsPort=new Proxy(fs,{get(target,key){
   if(key==='openSync')return(file,...args)=>{const fd=fs.openSync(file,...args);descriptors.set(fd,file);return fd}
   if(key==='closeSync')return fd=>{descriptors.delete(fd);fs.closeSync(fd)}
   if(key==='lstatSync')return(file,options)=>{const stat=fs.lstatSync(file,options);if(file===binary){assert.equal(options?.bigint,true);stat.ino=9007199254740992n+(distinct?1n:0n)}return stat}
   if(key==='fstatSync')return(fd,options)=>{const stat=fs.fstatSync(fd,options);if(descriptors.get(fd)===binary){assert.equal(options?.bigint,true);stat.ino=9007199254740992n}return stat}
   if(key==='readSync')return(fd,...args)=>{if(descriptors.get(fd)===binary)binaryReads++;return fs.readSync(fd,...args)}
   return Reflect.get(target,key)}})
  const idApi=artifact(fsPort),owned=path.join(dir,'identity');fs.mkdirSync(owned);assert.deepEqual(fs.readFileSync(idApi.consumeMcpSnapshotCpu825(root,native,owned)),actualBinary)
  assert.equal(binaryReads,1);distinct=true;const rejected=path.join(dir,'identity-rejected');fs.mkdirSync(rejected);assert.throws(()=>idApi.consumeMcpSnapshotCpu825(root,native,rejected));assert.equal(binaryReads,1,'distinct large file identity rejects before reading binary')
  for(const [index,changed]of [{platform:'darwin'},{arch:'arm64'},{version:'v22.23.2'}].entries()){const foreign=artifact(fs,{...windows,...changed}),denied=path.join(dir,'target-denied-'+index);fs.mkdirSync(denied);assert.throws(()=>foreign.consumeMcpSnapshotCpu825(root,native,denied));assert.deepEqual(fs.readdirSync(denied),[])}
  const sourceRoot=path.join(dir,'source');for(const name of driver.MCP_SNAPSHOT_CPU_INPUTS_825){const file=path.join(sourceRoot,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(root,name),file)}
  const currentOwned=path.join(dir,'current-source');fs.mkdirSync(currentOwned);api.consumeMcpSnapshotCpu825(sourceRoot,native,currentOwned)
  fs.appendFileSync(path.join(sourceRoot,'tests/fixtures/desktop-476/mcp-snapshot-825.h'),'\n// source changed after build\n');const staleOwned=path.join(dir,'stale-source');fs.mkdirSync(staleOwned);assert.throws(()=>api.consumeMcpSnapshotCpu825(sourceRoot,native,staleOwned));assert.deepEqual(fs.readdirSync(staleOwned),[])
  const symlinkFs=new Proxy(fs,{get(target,key){if(key==='lstatSync')return(file,...args)=>{const stat=fs.lstatSync(file,...args);if(file===manifest)stat.isSymbolicLink=()=>true;return stat};return Reflect.get(target,key)}})
  const redirected=path.join(dir,'manifest-link-denied');fs.mkdirSync(redirected);assert.throws(()=>artifact(symlinkFs).consumeMcpSnapshotCpu825(root,native,redirected));assert.deepEqual(fs.readdirSync(redirected),[])
  for(const result of [{status:7},{status:0,error:Object.assign(Error('owned-timeout'),{code:'ETIMEDOUT'})}]){
   assert.throws(()=>api.buildMcpSnapshotCpu825({root,dest:native,output,cl:'owned-compiler',checked:actualChecked(()=>result)}));assert.equal(fs.existsSync(manifest),false)
  }
  // Run the exact new Windows consumer branch with an actual locally compiled
  // executable leaf on non-Windows, including all original runtime assertions.
  if(process.platform!=='win32'){
   fs.writeFileSync(binary,actualBinary);fs.writeFileSync(manifest,original)
   let consumed=0
   const assertions={...assert,deepEqual(a,b,...rest){assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),...rest)}}
   const runtime=load('scripts/desktop-mcp-snapshot-cpu-runtime-825.mjs',{'node:assert/strict':assertions,'./desktop-mcp-snapshot-cpu-artifact-825.mjs':{consumeMcpSnapshotCpu825(r,n,owned){consumed++;assert.equal(r,root);assert.equal(n,path.join(root,'dist/desktop-native'));return api.consumeMcpSnapshotCpu825(root,native,owned)}},'node:child_process':{...cp,spawnSync(){throw Error('WINDOWS_RUNTIME_MUST_NOT_COMPILE')}}},windows)
   await runtime.runMcpSnapshotCpu825(t);assert.equal(consumed,1)
   fs.unlinkSync(manifest);await assert.rejects(runtime.runMcpSnapshotCpu825(t),error=>error.code==='ENOENT');assert.equal(consumed,2,'missing artifact fails through the actual runtime branch without compilation fallback')
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})

test('826 actual checked builder retains failure and closes every compiler fd before any publication',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-826-build-fd-'))
 try{
  for(const fault of ['firstOpen','secondOpen','spawn','nonzero','timeout','readFailure','closeWithFailure','closeOnly']){
   const native=path.join(dir,fault),output=path.join(native,'objects');fs.mkdirSync(output,{recursive:true})
   const logs=new Map(),closed=[],openError=Error('owned-open'),spawnError=Error('owned-spawn'),closeError=Error('owned-close');let opens=0,called=0,reads=0
   const fsPort=new Proxy(fs,{get(target,key){
    if(key==='openSync')return(file,...args)=>{const log=/compiler\.(stdout|stderr)$/.test(file);if(log){opens++;if(fault==='firstOpen'||fault==='secondOpen'&&opens===2)throw openError}const fd=fs.openSync(file,...args);if(log)logs.set(fd,file);return fd}
    if(key==='closeSync')return fd=>{const log=logs.get(fd);if(log){closed.push(log);logs.delete(fd)}fs.closeSync(fd);if(log&&log.endsWith('stdout')&&['closeWithFailure','closeOnly'].includes(fault))throw closeError}
    if(key==='readSync')return(fd,...args)=>{if(logs.has(fd)){reads++;assert.equal(args[2],64*1024);if(fault==='readFailure')throw Error('owned-diagnostic-read')}return fs.readSync(fd,...args)}
    return Reflect.get(target,key)}})
   const checked=actualChecked(()=>{called++;if(fault==='spawn')throw spawnError;return fault==='closeOnly'?{status:0}:fault==='timeout'?{status:0,error:Object.assign(Error('owned-timeout'),{code:'ETIMEDOUT'})}:{status:7}})
   const expected=fault==='firstOpen'||fault==='secondOpen'?openError:fault==='spawn'?spawnError:fault==='closeOnly'?closeError:undefined
   assert.throws(()=>artifact(fsPort).buildMcpSnapshotCpu825({root,dest:native,output,cl:'owned-compiler',checked}),error=>expected?error===expected:error.message==='DESKTOP_NATIVE_BUILD_COMMAND_FAILED')
   assert.equal(called,['firstOpen','secondOpen'].includes(fault)?0:1);assert.equal(closed.length,fault==='firstOpen'?0:fault==='secondOpen'?1:2);assert.equal(logs.size,0)
   assert.equal(fs.existsSync(path.join(native,'acceptance',MCP_SNAPSHOT_CPU_DIRECTORY_825,'manifest.json')),false)
   assert.equal(reads,['firstOpen','secondOpen','closeOnly'].includes(fault)?0:2)
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})

test('826 explicit compiled entry registers one Windows runtime consumer and preserves other platform routing',async()=>{
 const file='tests/desktop-mcp-snapshot-cpu-825.test.ts'
 for(const platform of ['win32','darwin','linux']){
  const registrations=[],exports={},js=ts.transpileModule(read(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;let ran=0
  const scope={process:{platform},__dirname:path.join(root,'.test-dist/tests'),Function:function(...args){assert.deepEqual(args,['url','return import(url)']);return async url=>{assert.ok(url.endsWith('/scripts/desktop-mcp-snapshot-cpu-runtime-825.mjs'));return{runMcpSnapshotCpu825:async t=>{assert.equal(t,'owned-context');ran++}}}}}
  vm.runInNewContext('(function(exports,require){'+js+'\n})',scope)(exports,id=>id==='node:test'?((...args)=>registrations.push(args)):require(id))
  assert.equal(registrations.length,platform==='win32'?1:0);if(registrations.length){assert.equal(registrations[0][1].timeout,30000);assert.equal('skip'in registrations[0][1],false);await registrations[0][2]('owned-context');assert.equal(ran,1)}
 }
 const early=read('scripts/tests/desktop-mcp-snapshot-825.test.mjs');assert.match(early,/if\(process\.platform!=='win32'\)test\(/);assert.doesNotMatch(early,/skip:/)
 const runtime=read('scripts/desktop-mcp-snapshot-cpu-runtime-825.mjs');assert.ok(runtime.indexOf("if(process.platform==='win32')binary=consumeMcpSnapshotCpu825")<runtime.indexOf('else{'));assert.equal((runtime.match(/timeout:6000/g)||[]).length,2)
})
