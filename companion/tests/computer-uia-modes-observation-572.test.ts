// Pure actual-callback controls. No original module/native test registration is imported.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import path from 'node:path'
import * as vm from 'node:vm'
import ts from 'typescript'
const filename=path.resolve('tests/helpers/uia-no-focus-native-572.ts'),source=fs.readFileSync(filename,'utf8')
const sf=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),wanted=['runMode572','assertModeDesktop572','cleanupMode572'],found:Record<string,string>={}
for(const n of sf.statements)if(ts.isFunctionDeclaration(n)&&n.name&&wanted.includes(n.name.text))found[n.name.text]=n.getText(sf)
assert.equal(Object.keys(found).length,3)
const compiled=ts.transpileModule(wanted.map(n=>found[n]).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true})
assert.equal(compiled.diagnostics?.length,0)
const specifications:any[]=[
 {id:'UNCHANGED',expectedPass:true},
 {id:'EXTERNAL_BEFORE_LOCATOR',beforeLocator:1,expectedPass:false,actions:0,pre:true},
 {id:'LOCATOR_CHANGES_ROLE',locatorRole:1,expectedPass:false,actions:0,pre:true},
 {id:'SNAPSHOT_START_CHANGES_ROLE',beforeSample:3,expectedPass:false,actions:0,pre:true},
 {id:'ACTION_CHANGES_TARGET',afterAction:1,expectedPass:false,actions:1,pre:false},
 {id:'ACTION_CHANGES_NONE',afterAction:0,expectedPass:false,actions:1,pre:false},
 {id:'POST_SNAPSHOT_CHANGES_OTHER',afterSample:3,expectedPass:false,actions:1,pre:false},
 {id:'LOADER_MISSING_BEFORE_ACTION',loader:'missing',locatorRole:1,expectedPass:false,actions:0,pre:true},
 {id:'SINK_THROW_BEFORE',locatorRole:1,sinkThrow:true,expectedPass:false,actions:0,pre:true},
 {id:'SINK_THROW_ORIGINAL_ACTION_ERROR',actionThrow:true,sinkThrow:true,expectedPass:false,actions:1,pre:false},
 {id:'NON_NUMERIC_BEFORE_ROLE',beforeSample:'OWNED_SENTINEL_MUST_NOT_LEAK',expectedPass:false,actions:0,pre:true},
];
for(const fixturePath of [path.posix,path.win32])for(const spec of specifications)test('#572 passive mode observation '+(fixturePath===path.posix?'posix ':'win32 ')+spec.id,async()=>{
 const markerPath=fixturePath.join('/OWNED_INERT','target.marker');
 const files=new Map<string,string>(),owners:any[]=[],calls:string[]=[],records:string[]=[],state:any={fg:2,actions:0,prePassed:false,clock:0};
 const actionError=new Error('OWNED_ORIGINAL_ACTION');let originalAssertError:unknown;const controlledAssert:any=Object.assign(function(){},assert);controlledAssert.equal=(...args:any[])=>{try{return (assert.equal as any)(...args)}catch(error){originalAssertError=error;throw error}};
 const shot=()=>({foreground:state.fg,cursor:{got:true,x:0,y:0},zorder:[2,1]});
 const scope:any={assert:controlledAssert,path:fixturePath,performance:{now:()=>state.clock++},process:{arch:'x64'},console:{log:()=>{}},
  mkdtempSync:()=>'/OWNED_INERT',tmpdir:()=>'/OWNED_INERT',
  existsSync:(p:string)=>p==='/OWNED_PS'||files.has(p),readFileSync:(p:string)=>{assert.ok(files.has(p));return files.get(p)},
  rmSync:()=>calls.push('REMOVE'),modes572:[{mode:'setvalue',name:'OwnedSetValue572',automationId:'owned_setvalue572'}],
  resolvePowerShellExe:()=>'/OWNED_PS',resolveWinScript:(n:string)=>n,resolveComputerUiaNoFocusDll:()=>'/OWNED_INERT/current.dll',
  startMode572:(args:string[])=>{const role=args[args.indexOf('-Role')+1];const owner={dead:false,closed:Promise.resolve(),isClosed(){return this.dead},launchError:()=>undefined,child:{ref:()=>{},kill(){owner.dead=true;calls.push('CLOSE_'+role);return true}}};owners.push(owner);calls.push('LAUNCH_'+role);return owner},
  waitModeFile572:async(p:string)=>{if(p.endsWith('target.json'))return{schema:1,hwnd:1,foreground:1,active:true,initialUnchanged:true};if(p.endsWith('sibling.json')){state.fg=2;calls.push('READY_SIBLING');if(spec.beforeLocator!==undefined)state.fg=spec.beforeLocator;return{schema:1,hwnd:2,foreground:2,active:true,initialUnchanged:true}};assert.equal(p,markerPath);return vm.runInContext('JSON.parse('+JSON.stringify(files.get(p))+')',scope)},
  runPs:async(_script:string,args:string[])=>{const mode=args[args.indexOf('-Mode')+1],dest=args[args.indexOf('-Out')+1];calls.push(mode==='compare'?'COMPARE':dest.endsWith('before.json')?'SNAPSHOT_BEFORE':'SNAPSHOT_AFTER');if(mode==='snapshot'){if(dest.endsWith('before.json')&&spec.beforeSample!==undefined)state.fg=spec.beforeSample;if(dest.endsWith('after.json')&&spec.afterSample!==undefined)state.fg=spec.afterSample;files.set(dest,JSON.stringify(shot()))}else{files.set(dest,JSON.stringify({ok:true,delivery:'uia-pattern',target_hwnd:1,focus_kept:true,zorder_kept:true,cursor_kept:true,no_leaked_input:true,background_verified:true,no_leaked_input_kind:'derived'}))}return ''},
  PsUiaLocator:class{async locate(){calls.push('LOCATE');if(spec.locatorRole!==undefined)state.fg=spec.locatorRole;return{name:'OwnedSetValue572',controlType:'Edit',automationId:'owned_setvalue572'}}},
  PsInputInjector:class{async invokeUia(){state.prePassed=true;state.actions++;calls.push('ACTION');if(spec.actionThrow)throw actionError;if(spec.afterAction!==undefined)state.fg=spec.afterAction;files.set(markerPath,JSON.stringify({schema:1,role:'target',mode:'setvalue',changed:true}));return{ok:true,mode:'setvalue',foreground:false}}},
 };vm.createContext(scope);vm.runInContext(compiled.outputText+'\nthis.callRun=runMode572;',scope);
 let error:any;try{await scope.callRun('setvalue',spec.loader,{diagnostic:(value:string)=>{records.push(value);if(spec.sinkThrow)throw Error('OWNED_DIAGNOSTIC_SINK')}})}catch(e){error=e}
 if(spec.expectedPass&&error)throw error;assert.equal(!error,spec.expectedPass,spec.id);if(spec.actions!==undefined)assert.equal(state.actions,spec.actions,spec.id);
 if(spec.pre!==undefined)assert.equal(state.prePassed,!spec.pre,spec.id);
 if(error)assert.equal(error,spec.actionThrow?actionError:originalAssertError);assert.equal(owners.length,2);assert.ok(owners.every(o=>o.dead));assert.equal(calls.filter(x=>x==='REMOVE').length,1);
 assert.equal(records.length,spec.expectedPass?0:1,'one failure-only DTO must be emitted');
 if(records.length){
  const prefix='UIA572_MODE_FAILURE_OBSERVATION ';assert.ok(records[0].startsWith(prefix));const dto=JSON.parse(records[0].slice(prefix.length));
  assert.deepEqual(Object.keys(dto).sort(),['schema','phase','readyRole','beforeRole','afterRole','actionStarted','actionReturned','markerSeen','childrenAlive'].sort());
  assert.equal(dto.schema,1);assert.equal(dto.readyRole,'SIBLING');assert.equal(dto.childrenAlive,true);
  assert.equal(dto.actionStarted,state.actions===1);assert.equal(dto.actionReturned,state.actions===1&&!spec.actionThrow);assert.equal(dto.markerSeen,state.actions===1&&!spec.actionThrow);
  assert.equal(dto.phase,spec.pre?'BEFORE_CAPTURED':spec.actionThrow?'BEFORE_CAPTURED':'COMPARE_RETURNED');
  const role=(n:unknown)=>typeof n!=='number'||!Number.isSafeInteger(n)||n<0?'UNKNOWN':n===0?'NONE':n===1?'TARGET':n===2?'SIBLING':'OTHER';
  assert.equal(dto.beforeRole,role(spec.locatorRole??spec.beforeSample??spec.beforeLocator??2));
  assert.equal(dto.afterRole,spec.pre||spec.actionThrow?'UNKNOWN':role(spec.afterSample??spec.afterAction??2));
  assert.ok(!records[0].includes('OWNED_SENTINEL'));assert.ok(!records[0].includes('/OWNED_INERT'));assert.ok(!records[0].includes('OWNED_ORIGINAL_ACTION'));
 }
});
