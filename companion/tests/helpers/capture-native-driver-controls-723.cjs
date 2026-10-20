'use strict';
// Whole real native callback VM. Only PS/Win32/window boundary is inert; never native PASS.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),util=require('node:util'),ts=require('typescript');
exports.runNativeCallbacks723=async function(sourceFile,data,helpers,mutate,refusalErrors){
 const source=fs.readFileSync(sourceFile,'utf8'),code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const callbacks=[],scopes=[],facts=[],children=[],events=[];let active,cachedRun,postChecks=0,lastRefusal;const verificationWaiters=new Map();
 // The fake window publishes via an explicit inert notification. Once it has
 // published, run the real waiter initial-snapshot/parser/owner/signal path.
 // Actual OS fs.watch behavior has separate real-owned-FS permanent controls.
 function waitWindowReceipt(file,owner,deadline,signal){
  if(fs.existsSync(file))return helpers.waitReceipt723(file,owner,Math.min(deadline,performance.now()+500),signal);
  assert.equal(verificationWaiters.has(file),false);
  return new Promise((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timer);verificationWaiters.delete(file);signal.removeEventListener('abort',abort)};
   const abort=()=>{cleanup();reject(signal.reason||Error('CPU_WINDOW_ABORTED'))};
   const timer=setTimeout(()=>{cleanup();reject(Error('CPU_WINDOW_NOTIFICATION_MISSING'))},500);
   verificationWaiters.set(file,()=>{cleanup();helpers.waitReceipt723(file,owner,Math.min(deadline,performance.now()+500),signal).then(resolve,reject)});
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
 }
 function child(){const c=new EventEmitter();c.exitCode=null;c.signalCode=null;c.kill=()=>{if(c.exitCode!==null||c.signalCode!==null)return false;c.signalCode='SIGTERM';c.emit('exit',null,'SIGTERM');queueMicrotask(()=>c.emit('close',null,'SIGTERM'));return true};children.push(c);return c}
 const fakeExec=(exe,args,options,done)=>{
  assert.equal(args[6],path.join(path.dirname(sourceFile),'fixtures/win/capture-wpf-723.ps1'));assert.equal(options.timeout<=45000,true);
  const arg=n=>args[args.indexOf(n)+1],mode=arg('-Mode');active={mode,ready:arg('-Ready'),request:arg('-VerifyRequest'),verified:arg('-Verified')};
  active.receipt={hwnd:7,other:['minimized','nonforeground','occluded'].includes(mode)?9:0,foreground:['minimized','nonforeground'].includes(mode)?9:7,minimized:mode==='minimized',desktop51:true};
  fs.writeFileSync(active.ready,JSON.stringify(active.receipt));return child();
 };
 fakeExec[util.promisify.custom]=(...args)=>{
  const observed=active;assert.ok(observed);assert.equal(args[2].timeout,15000);
  const c=child();let resolve;const p=new Promise(r=>resolve=r);p.child=c;
  queueMicrotask(()=>{c.exitCode=0;c.emit('exit',0,null);resolve('actual native boundary inert');queueMicrotask(()=>c.emit('close',0,null))});return p;
 };
 const cp={execFile:fakeExec};
 const fakefs=new Proxy(fs,{get(target,key){if(key==='writeFileSync')return(file,...args)=>{const result=fs.writeFileSync(file,...args);events.push([path.basename(file),!!active&&file===active.request]);if(active&&file===active.request){const value={...active.receipt};if(mutate==='postForeground')value.foreground=11;fs.writeFileSync(active.verified,JSON.stringify(value));const notify=verificationWaiters.get(active.verified);assert.ok(notify,'exact fake-window request must have one waiter');notify()}return result};return target[key]}});
 const script=path.resolve(path.dirname(sourceFile),'../src/host-use/win/scripts/computer-capture.ps1');
 const runPs=async(file,args,opts)=>{if(!cachedRun)cachedRun=util.promisify(cp.execFile);return cachedRun('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,...args],{timeout:opts?.timeoutMs??15000})};
 class Capturer {
  constructor(runner){this.runner=runner||runPs}
  async captureWindow(hwnd,opts){assert.equal(opts.passive,true);await this.runner(script,['-Hwnd',String(hwnd),'-AllowFallback','-Passive']);
   if(active.mode==='minimized'||active.mode==='nonforeground'){assert.ok(refusalErrors&&refusalErrors[active.mode],'actual adapter refusal required');lastRefusal={mode:active.mode,error:refusalErrors[active.mode]};throw refusalErrors[active.mode]};
   const out=path.join(path.dirname(active.ready),'tmp','cap.png');fs.writeFileSync(out,'owned fixed dummy pixels');
   return {path:out,hwnd,capture_method:active.mode==='printwindow'?'printwindow':'bitblt',observation_quality:active.mode==='printwindow'?'ok':active.mode,fallbackUsed:active.mode!=='printwindow',black:false,occludedBy:active.mode==='occluded'?[{hwnd:9}]:[]};
  }
 }
 let retained=false;
 const surface={withSurface650:async(t,action)=>{const token=scopes.length;scopes.push(token);retained=false;const lease={retain(){retained=true},checkpoint(){assert.equal(token,scopes.length-1,'previous case lease reused')},settled(){retained=false}};try{return await action(t,lease)}finally{assert.equal(retained,false)}}};
 const register=(name,options,cb)=>callbacks.push({name,options,cb});
 const require723=id=>{
  if(id==='node:test')return register;if(id==='node:fs')return fakefs;if(id==='node:child_process')return cp;
  if(id==='./fixtures/native-surface-650')return surface;if(id==='./helpers/capture-native-723')return {...helpers,assertUnchanged723:(a,b)=>{postChecks++;return helpers.assertUnchanged723(a,b)},waitReceipt723:waitWindowReceipt};
  if(id==='../src/computer/types')return{ComputerError:refusalErrors.minimized.constructor};
  if(id==='../src/computer/win-adapters')return{PsScreenCapturer:Capturer};if(id==='../src/host-use/win/powershell')return{runPs,resolveWinScript:()=>script};
  if(id.startsWith('node:'))return require(id);throw Error('VM_UNDECLARED_IMPORT');
 };
 const context=vm.createContext({require:require723,exports:{},__dirname:path.dirname(sourceFile),process:{platform:'win32',env:{GITHUB_ACTIONS:'true',RUNNER_OS:'Windows',CMSPARK_DATA_DIR:data}},performance,Buffer,queueMicrotask,console:{log(){},error(){}}});
 vm.runInContext(code,context,{filename:sourceFile});assert.equal(callbacks.length,5);
 for(const entry of callbacks){const control=new AbortController();assert.equal(entry.options.skip,false);assert.equal(entry.options.timeout,45000);try { await entry.cb({signal:control.signal,diagnostic(value){assert.match(value,/^D1_CAPTURE_723_[A-Z]+_NATIVE_PASS$/)}}) } catch(e) { if(mutate==='postForeground')assert.equal(postChecks,1,'negative must reach actual postcondition, not timeout');e.inertRefusal=lastRefusal&&{...lastRefusal,postChecks,events:events.slice()};e.message += " VM_EVENTS="+JSON.stringify(events); throw e } ;facts.push(entry.name)}
 assert.equal(verificationWaiters.size,0);assert.deepEqual(fs.readdirSync(data),[]);return{callbacks:facts,scopes:scopes.length,retained:false,native:0,subprocess:0,postChecks,events};
};
