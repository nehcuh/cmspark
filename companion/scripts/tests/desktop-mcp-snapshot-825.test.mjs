import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import {desktopMcpFixture} from '../desktop-mcp-fixture.mjs'
import {desktopMcpBootstrapObservationFixture773} from '../desktop-bootstrap-observation-fixture.mjs'
import {runMcpSnapshotCpu825} from '../desktop-mcp-snapshot-cpu-runtime-825.mjs'
import {mcpSnapshotCpuMethod825 as method} from '../desktop-mcp-snapshot-cpu-driver-825.mjs'
import './desktop-mcp-snapshot-cpu-build-826.test.mjs'
const root=path.resolve(import.meta.dirname,'../..'),read=file=>fs.readFileSync(path.join(root,file),'utf8'),require=createRequire(path.join(root,'package.json')),ts=require('typescript')
const original=read('src/desktop/native/DesktopHost.cpp'),control=read('tests/fixtures/desktop-476/native-acceptance.cpp'),form=read('tests/fixtures/desktop-476/native-form.js'),snapshot=read('tests/fixtures/desktop-476/mcp-snapshot-825.h')

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


if(process.platform!=='win32')test('825 actual native worker/file reader distinguishes same-wire schedules, coherent publication, nested dispatch and UNKNOWNs',{timeout:30000},runMcpSnapshotCpu825)

test('826 actual CPU callback preserves compiler failure through cleanup failure and never hides cleanup-only failure',async()=>{
 const source=read('scripts/desktop-mcp-snapshot-cpu-runtime-825.mjs'),ast=ts.createSourceFile('actual.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
 const cases=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='runMcpSnapshotCpu825')
 assert.equal(cases.length,1);const callback=cases[0],attempts=callback.body.statements.filter(ts.isTryStatement);assert.equal(attempts.length,1)
 for(const platform of new Set([process.platform==='win32'?'linux':process.platform]))for(const fault of ['timeout','firstOpen','secondOpen','spawn','nonzero','diagnosticRead','closeWithTimeout','closeOnly']){
  const timeout=Object.assign(Error('owned-compiler-timeout'),{code:'ETIMEDOUT'}),cleanup=Object.assign(Error('owned-cleanup-busy'),{code:'EBUSY'}),openError=Error('owned-open-failure'),spawnError=Error('owned-spawn-failure'),closeError=Error('owned-close-failure')
  const owned=path.join(os.tmpdir(),'owned-case-826'),closed=[],reads=[];let opens=0,removed=0,compiled=0
  const fsPort={mkdtempSync:()=>owned,writeFileSync(){},existsSync:()=>true,
   openSync(file,flags,mode){opens++;assert.equal(file,path.join(owned,opens===1?'compiler.stdout':'compiler.stderr'));assert.equal(flags,'wx+');assert.equal(mode,0o600);if(fault==='firstOpen'||fault==='secondOpen'&&opens===2)throw openError;return 10+opens},
   closeSync(fd){closed.push(fd);if(fd===11&&['closeWithTimeout','closeOnly'].includes(fault))throw closeError},
   readSync(fd,bytes,offset,length,position){reads.push(fd);assert.equal(length,64*1024);assert.equal(position,0);if(fault==='diagnosticRead')throw Error('owned-diagnostic-read');return Buffer.from('owned compiler output\n').copy(bytes,offset)},
   rmSync(){removed++;throw cleanup}}
  const compilerPort=(file,args,options)=>{
   compiled++;assert.equal(options.cwd,root);assert.equal(options.timeout,20000);assert.deepEqual(Array.from(options.stdio),['ignore',11,12])
   if(fault==='spawn')throw spawnError
   return{error:['nonzero','closeOnly'].includes(fault)?undefined:timeout,status:fault==='nonzero'?1:fault==='closeOnly'?0:null,signal:null}
  }
  const run=vm.runInNewContext('('+callback.getText(ast).replace(/^export /,'')+')',{Buffer,Date,root,fs:fsPort,nodeHelper:()=>({}),os,path,process:{platform},cppDriver:()=> 'owned inert cpp',spawnSync:compilerPort,assert})
  const expected=fault==='firstOpen'||fault==='secondOpen'?openError:fault==='spawn'?spawnError:fault==='closeOnly'?closeError:undefined
  await assert.rejects(run(),error=>expected?error===expected:error.code==='ERR_ASSERTION'&&error.actual===(fault==='nonzero'?1:timeout))
  assert.equal(compiled,['firstOpen','secondOpen'].includes(fault)?0:1);assert.equal(removed,1)
  assert.deepEqual(closed,fault==='firstOpen'?[]:fault==='secondOpen'?[11]:[11,12]);assert.deepEqual(reads,['firstOpen','secondOpen','spawn','closeOnly'].includes(fault)?[]:[11,12])
 }
 const cleanup=Error('owned-cleanup-only'),body=attempts[0].finallyBlock.getText(ast),finalize=new Function('fs','dir','primary825',body)
 assert.throws(()=>finalize({rmSync(){throw cleanup}},'owned-case',undefined),error=>error===cleanup)
})
