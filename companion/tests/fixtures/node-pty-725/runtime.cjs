'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const ts=require('typescript');
const U=__dirname+'/source',R=path.resolve(__dirname,'../../../..'),reads=new Map();
const {transformWindowsPtyAgent}=require(R+'/scripts/patch-node-pty-worker.cjs');
function read(p){const b=fs.readFileSync(p);reads.set(p,{path:p,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});return b.toString('utf8')}
async function scenario({patched=true,duplicate=false,replacement=false,mode="natural-exit"}={}){
 const timers=new Map(),workers=[],sockets=[],servers=[],calls={nativeKill:0,treeKill:0,fork:0,closed:0};let onProcessExit;const cache=new Map();
 const timer=(fn,ms)=>{const t={fn,ms,unref(){}};timers.set(t,t);return t},clear=t=>timers.delete(t);
 class Socket extends EventEmitter {constructor(){super();this.readable=true;sockets.push(this)}setEncoding(){}connect(name,fn){this.pipeName=name;fn?.();return this}write(){}pipe(dest){return dest}destroy(){if(this.destroyed)return;this.destroyed=true;this.emit('close')}pause(){}resume(){}}
 class Worker extends EventEmitter {constructor(file,options){super();this.file=file;this.referenced=true;this.ownedServers=[];workers.push(this);const owner=this;vm.runInNewContext(read(file.replace(/\\/g,'/')),{exports:{},require(id){if(id==='worker_threads')return{workerData:options.workerData,parentPort:{postMessage(){}}};if(id==='net')return{Socket,createServer(fn){const server={listening:false,listen(){this.listening=true},close(){this.listening=false}};servers.push(server);owner.ownedServers.push(server);return server}};if(id==='../shared/conout')return load('shared/conout.js');throw Error('UNADMITTED_WORKER_IMPORT '+id)}})}terminate(){this.terminated=true;this.ownedServers.forEach(s=>s.close());return Promise.resolve(0)}unref(){this.referenced=false}}
 const native={startProcess(){return{fd:0,pty:1,conout:'OWNED_FAKE_CONOUT',conin:'OWNED_FAKE_CONIN'}},connect(_a,_b,_c,_d,_e,cb){onProcessExit=cb;return{pid:12345}},kill(){calls.nativeKill++},resize(){},clear(){}};
 function load(name){if(cache.has(name))return cache.get(name).exports;const m={exports:{}};cache.set(name,m);const file=U+'/'+name;vm.runInNewContext(name==='windowsPtyAgent.js'&&patched?transformWindowsPtyAgent(Buffer.from(read(file)),'x64').toString():read(file),{module:m,exports:m.exports,__dirname:path.dirname(file),setTimeout:timer,clearTimeout:clear,Buffer,console,process:{env:{},platform:'win32',kill(){throw Error('REAL_PID_KILL_FORBIDDEN')}},require(id){if(id==='events')return{EventEmitter};if(id==='worker_threads')return{Worker};if(id==='net')return{Socket};if(id==='path')return path.win32;if(id==='fs')return{openSync(){return 10}};if(id==='child_process')return{fork(){calls.fork++;throw Error('NO_FORK_IN_THIS_SCHEDULE')}};if(id==='./utils')return{assign:Object.assign,loadNativeModule(){return{module:native}}};if(id.startsWith('.'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(name),id))+'.js');throw Error('UNADMITTED_UPSTREAM_IMPORT '+id)}},{filename:file,timeout:2000});return m.exports}
 const {WindowsTerminal}=load('windowsTerminal.js');
 const exports={};const sessionSource=read(R+'/companion/src/pty/session.ts');vm.runInNewContext(ts.transpileModule(sessionSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,Buffer,Map,WeakMap,Set,Date,performance,console,setTimeout:timer,clearTimeout:clear,setInterval:timer,clearInterval:clear,process:{platform:'win32',env:{},on(){},kill(){throw Error('REAL_OS_FORBIDDEN')}},require(id){if(id==='node:path')return path.win32;if(id==='./windows-tree')return{killWindowsPtyTree(_pid,release){calls.treeKill++;release()}};if(id==='../packs/audit-log')return{appendCapabilityAudit(){}};if(id==='./load-native')return{loadNodePty(){throw Error('NATIVE_IMPORT_FORBIDDEN')}};if(id==='./env')return{buildTerminalEnv:()=>({})};if(id==='./kimi-task-prefill')return{createKimiTaskPrefill:()=>()=>false};if(id==='./tail')return{};throw Error('UNADMITTED_PRODUCT_IMPORT '+id)}},{filename:R+'/companion/src/pty/session.ts',timeout:3000});
 let terminal;exports.__testSetPtySpawn((file,args,opts)=>terminal=new WindowsTerminal(file,args,opts));
 const opened=exports.spawnPtySession({id:'inert-owned',file:'C:\\owned\\node.exe',args:['C:\\owned\\child.cjs'],cwd:'C:\\owned',cols:80,rows:24,send(frame){if(frame.type==='terminal.closed')calls.closed++}});assert.equal(opened.ok,true);
 if(mode!=='close-before-ready'){
  workers[0].emit('message',1);terminal._socket.emit('connect');terminal._socket.emit('data','NATIVE725_READY\r\n');assert.equal(terminal.pid,12345);
 }
 if(mode==='natural-exit'){
  onProcessExit(0);const flush=[...timers.values()].filter(t=>t.ms===1000);assert.equal(flush.length,1);timers.delete(flush[0]);flush[0].fn();assert.equal(calls.closed,1);assert.equal(exports.isPtyBusy(),false);
 }else{exports.closePty('inert-owned');}
 const afterFirstClose={closedFrames:calls.closed,workerTerminated:workers.filter(w=>w.terminated).length,workerDelayMs:[...timers.values()].filter(t=>t.ms===1000).map(t=>t.ms)};
 const retiredExit=onProcessExit;
 if(replacement){exports.spawnPtySession({id:'replacement',file:'C:\\owned\\node.exe',args:['C:\\owned\\child.cjs'],cwd:'C:\\owned',cols:80,rows:24,send(){}});}
 if(duplicate)retiredExit(0);
 for(let steps=0;steps<4;steps++){const flush=[...timers.values()].find(t=>t.ms===1000);if(!flush)break;timers.delete(flush);flush.fn();await Promise.resolve();}
 const facts={patched,duplicate,replacement,afterFirstClose,oldWorkerTerminated:workers[0].terminated===true,replacementWorkerTerminated:workers[1]?.terminated===true,mode,productBusy:exports.isPtyBusy(),closedFrames:calls.closed,nativeKill:calls.nativeKill,treeKill:calls.treeKill,fork:calls.fork,upstreamReady:terminal._isReady,upstreamDeferred:terminal._deferreds.length,workersCreated:workers.length,workerTerminated:workers.filter(w=>w.terminated).length,workerReferenced:workers.filter(w=>w.referenced).length,workerOwnedServersListening:servers.filter(s=>s.listening).length,agentConoutDisposed:terminal._agent._conoutSocketWorker._isDisposed,remainingTimerMs:[...timers.values()].map(t=>t.ms)};
 if(mode==='natural-exit'){assert.equal(facts.nativeKill,0);assert.equal(facts.treeKill,0);assert.equal(facts.fork,0);}
 if(mode==='close-before-ready'){assert.equal(facts.upstreamDeferred,1);assert.equal(facts.nativeKill,0);assert.equal(facts.productBusy,false);}
 return facts;
}
module.exports={scenario};
