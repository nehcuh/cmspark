import test from 'node:test'
import './ax-focus-oracle-571.test.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {ax571BuildPlan} from '../build-ax-native-571.mjs'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),script=fs.readFileSync(path.join(root,'scripts/computer-bg-oracles.sh'),'utf8')
const start="compare_js() {\n  cat <<'JSEOF'\n";assert.equal(script.split(start).length,2)
const closure=script.split(start)[1].split('\nJSEOF')[0],base={foreground:100,zorder:[100,101,102],cursor:{x:10,y:10}}
function compare(after,delivery='ax-action',before=base){let result;vm.runInNewContext(closure,{require:name=>{assert.equal(name,'node:fs');return{readFileSync:p=>JSON.stringify(p==='b'?before:after),writeFileSync:(p,s)=>{assert.equal(p,'out');result=JSON.parse(s)}}},process:{env:{ORACLE_BEFORE:'b',ORACLE_AFTER:'a',ORACLE_OUT:'out',ORACLE_DELIVERY:delivery},stderr:{write:()=>{}},exit:()=>{throw Error('ORACLE_REFUSED')}}},{timeout:1000});return result}
for(const [id,after] of [['shorter',{...base,zorder:[100,101]}],['longer',{...base,zorder:[100,101,102,103]}]])test('#571 real compare closure rejects '+id+' full sequence',()=>{const r=compare(after);assert.equal(r.zorder_kept,false);assert.equal(r.background_verified,false);assert.equal(r.zorder_diff_at,id==='shorter'?2:3)})
test('#571 real compare closure preserves existing flags and unreadable null',()=>{
 assert.equal(compare(base).background_verified,true);assert.equal(compare({...base,foreground:101}).focus_kept,false);assert.equal(compare({...base,cursor:{x:11,y:10}}).cursor_kept,false)
 assert.equal(compare({...base,zorder:[100,102,101]}).zorder_diff_at,1);assert.equal(compare(base,'sendinput').no_leaked_input,false)
 for(const after of [{...base,foreground:null},{...base,cursor:null},{...base,zorder:[] }])assert.equal(compare(after).background_verified,false)
 assert.equal(compare({...base,foreground:null}).focus_kept,null);assert.equal(compare({...base,cursor:null}).cursor_kept,null);assert.equal(compare({...base,zorder:[]}).zorder_kept,null)
 assert.equal(compare(base).no_leaked_input_kind,'derived')
})
test('#571 hosted plan uses real host/identity and only unshipped fixture outputs',()=>{
 const p=ax571BuildPlan('/OWNED/companion');assert.equal(p.dest,'/OWNED/companion/dist/ax-native-571');assert.equal(p.commands.length,6)
 assert.equal(p.commands[0][0],'/usr/bin/swiftc');assert.ok(p.commands[0][1].includes('/OWNED/companion/src/host-use/darwin/host.swift'));assert.ok(p.commands[0][1].includes('/OWNED/companion/src/host-use/darwin/host-Info.plist'))
 assert.ok(p.commands[1][1].includes('/OWNED/companion/src/host-use/darwin/host.entitlements'));assert.ok(p.commands[3][1].includes('/OWNED/companion/tests/fixtures/ax-571/owned-target.swift'))
 for(const [bin,args] of p.commands)assert.ok(![bin,...args].some(x=>/tccutil|osascript|performClick|evaluateJavaScript|host-integrity\.ts/.test(x)))
})
const require=createRequire(path.join(root,'companion/package.json')),ts=require('typescript'),source=fs.readFileSync(path.join(root,'companion/tests/computer-ax-native-571.test.ts'),'utf8'),ast=ts.createSourceFile('current.ts',source,ts.ScriptTarget.Latest,true),names=['ax571Code','requireAx571Oracles','ax571Identity','ax571Setup'],found={}
for(const n of ast.statements)if(ts.isFunctionDeclaration(n)&&n.name&&names.includes(n.name.text))found[n.name.text]=n.getText(ast)
assert.equal(Object.keys(found).length,4)
const js=ts.transpileModule(names.map(n=>found[n]).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope={assert};vm.createContext(scope);vm.runInContext(js+'\nthis.verify=requireAx571Oracles;this.code=ax571Code;this.identity=ax571Identity;this.setup=ax571Setup;',scope)
test('#571 native row code and responsibility proof never reflect unknown input',()=>{
 for(const value of [{error_code:'PRIVATE_SENTINEL'},{get error_code(){throw Error('PRIVATE_SENTINEL')}},null,{},[]])assert.equal(scope.code(value),'UNKNOWN')
 assert.equal(scope.code({error_code:'TASK_ABORTED'}),'TASK_ABORTED');assert.equal(scope.code({code:'AX_ACTION_UNAVAILABLE'}),'AX_ACTION_UNAVAILABLE')
 const identity={schema:1,identifierExpected:true,signatureVerified:true,route:'DIRECT_CLI_NODE_PARENT',tccResponsibility:'UNKNOWN'};assert.equal(scope.identity(identity),true)
 for(const key of ['identifierExpected','signatureVerified'])assert.equal(scope.identity({...identity,[key]:false}),false)
 assert.equal(scope.identity({...identity,tccResponsibility:'com.cmspark.agent'}),false)
})
test('#571 actual native oracle assertion rejects every missing or changed observation',()=>{
 const before={foreground:2,zorder:[2,1],cursor:{x:0,y:0}},verdict={focus_kept:true,zorder_kept:true,cursor_kept:true,no_leaked_input:true,background_verified:true,no_leaked_input_kind:'derived'}
 scope.verify(before,structuredClone(before),verdict,1,2)
 for(const after of [{...before,foreground:1},{...before,foreground:null},{...before,zorder:[2]},{...before,zorder:[2,1,3]},{...before,zorder:[1,2]},{...before,cursor:null},{...before,cursor:{x:1,y:0}}])assert.throws(()=>scope.verify(before,after,verdict,1,2))
 for(const key of ['focus_kept','zorder_kept','cursor_kept','no_leaked_input','background_verified'])assert.throws(()=>scope.verify(before,before,{...verdict,[key]:false},1,2))
 assert.throws(()=>scope.verify(before,before,{...verdict,no_leaked_input_kind:'observed'},1,2));assert.throws(()=>scope.verify(before,before,verdict,1,1))
})
test('#571 owned fixture has no direct action/permission/focus restoration shortcut',()=>{
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8')
 assert.match(swift,/event\.isTrusted/);assert.match(swift,/message\.webView === web/);assert.match(swift,/message\.frameInfo\.isMainFrame/)
 assert.doesNotMatch(swift,/performClick|evaluateJavaScript|AXUIElementPerformAction|AXIsProcessTrustedWithOptions|CGEventPost|DispatchQueue\.main\.asyncAfter[^\n]*changed/)
 assert.match(source,/\['ax-locate'/);assert.match(source,/\['ax-invoke'/);assert.match(source,/AX571_PERMISSION_REQUIRED/);assert.match(source,/lease\.settled\(\)/)
})

function ax571CiBlock(workflow){
 const normalized=workflow.replace(/\r\n/g,'\n'),anchor='      - name: "macOS external AX action and background oracles (#571)"\n';assert.equal(normalized.split(anchor).length,2)
 const block=normalized.split(anchor)[1].split('\n      - name:')[0]
 assert.match(block,/^        if: matrix\.os == 'macos-latest'\n        shell: bash\n        run: \|\n/)
 const commands=block.split('        run: |\n')[1].split('\n').map(l=>l.trim()).filter(Boolean)
 assert.deepEqual(commands,['set -euo pipefail','cd companion','node --test scripts/tests/ax-native-571.test.mjs','node scripts/build-ax-native-571.mjs','node scripts/run-tests.mjs .test-dist/tests/computer-ax-native-571.test.js'])
 return commands
}
test('#571 CI builds signed actual host before external AX hard gate, preserves fail-closed order on LF/CRLF',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8')
 for(const eol of ['\n','\r\n']){
  const current=workflow.replace(/\r\n/g,'\n').replace(/\n/g,eol);ax571CiBlock(current)
  const normalized=current.replace(/\r\n/g,'\n'),anchor='      - name: "macOS external AX action and background oracles (#571)"\n',block=normalized.split(anchor)[1].split('\n      - name:')[0]
  for(const mutation of [block.replace('set -euo pipefail','set -uo pipefail'),block.replace('node scripts/build-ax-native-571.mjs','true'),block.replace('node scripts/build-ax-native-571.mjs','node scripts/run-tests.mjs .test-dist/tests/computer-ax-native-571.test.js'),block.replace('node scripts/run-tests.mjs .test-dist/tests/computer-ax-native-571.test.js','true')])assert.throws(()=>ax571CiBlock(normalized.replace(anchor+block,anchor+mutation)))
 }
})
test('#571 ledger records native framework/action rows as unproven, keeps permission and executor residual explicit',()=>{
 const ledger=fs.readFileSync(path.join(root,'docs/computer-capability-ledger.md'),'utf8'),section=ledger.split('### 4.1 macOS AX')[1]?.split('## 5.')[0]
 assert.ok(section);for(const framework of ['AppKit NSButton','WKWebView'])assert.ok(section.includes('| '+framework+' | press | **Gap**'))
 for(const fact of ['AX571_ROW','AX571_PERMISSION','TCC','UNKNOWN','executor','至少一条'])assert.ok(section.includes(fact))
 assert.equal(section.includes('| **Delivered**'),false);assert.equal(ledger.includes('我们**只在 Windows 上有实现**'),false);assert.equal(ledger.includes('darwin-estop.ps1'),false)
})

test('#571 actual initial readiness gate observes active/key and both CG identities before publishing',()=>{
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8')
 const expression=swift.match(/func ax571Readiness\([^)]*\) -> Bool \{ return ([^}]+) \}/)?.[1];assert.ok(expression)
 for(let mask=0;mask<16;mask++){const values=Array.from({length:4},(_,i)=>!!(mask&(1<<i))),[active,key,targetBound,siblingBound]=values;assert.equal(vm.runInNewContext(expression,{active,key,targetBound,siblingBound}),mask===15)}
 const begin=swift.slice(swift.indexOf('    func publishReady() {'),swift.indexOf('    func queueReadiness() {')),tail=swift.slice(swift.indexOf('    func queueReadiness() {'))
 assert.match(begin,/guard !setupStarted else/);assert.match(begin,/NSApplication\.didBecomeActiveNotification/);assert.match(begin,/NSWindow\.didBecomeKeyNotification/);assert.doesNotMatch(begin,/NSApp\.activate/)
 assert.equal((begin.match(/NSApp\.activate\(/g)||[]).length,0);assert.doesNotMatch(tail,/NSApp\.activate|makeKeyAndOrderFront|asyncAfter/)
 assert.ok(tail.indexOf('guard ax571Readiness(active,key,targetBound,siblingBound)')<tail.indexOf('self.published = true'));assert.match(tail,/kCGWindowOwnerPID/);assert.match(tail,/kCGWindowNumber/)
 assert.match(source,/assert\.ok\(before.foreground===sibling,'AX571_INITIAL_SIBLING_REQUIRED'\)/)
})
test('#571 setup diagnostic is a closed enum/boolean projection and never publishes raw identities',()=>{
 const value={schema:1,appActive:true,siblingKey:true,targetBound:true,siblingBound:true,firstRole:'SIBLING'};assert.deepEqual(JSON.parse(JSON.stringify(scope.setup(value))),value)
 for(const role of ['UNKNOWN','NONE','TARGET','SIBLING','OTHER'])assert.equal(scope.setup({...value,firstRole:role}).firstRole,role)
 for(const x of [null,[],{}, {...value,firstRole:'OWNED_PRIVATE_SENTINEL'},{...value,pid:17},{...value,target:18},{...value,appActive:1},{...value,schema:2}])assert.equal(scope.setup(x),null)
 let reads=0;const access=Object.defineProperty({...value},'appActive',{get(){reads++;throw Error('OWNED_PRIVATE_SENTINEL')}});assert.equal(scope.setup(access),null);assert.equal(reads,0)
 assert.match(source,/Buffer\.byteLength\(b,'utf8'\)<=2048/);assert.match(source,/Diagnostics cannot replace primary or cleanup/)
})

// Owned-app launcher regression controls. No AppKit/LaunchServices is executed.
function actualAx571Finally(){
 const matches=[];function visit(n){if(ts.isTryStatement(n)&&n.finallyBlock&&n.finallyBlock.getText(ast).includes("AX571_OWNER_CLEANUP_FAILED"))matches.push(n.finallyBlock.getText(ast));ts.forEachChild(n,visit)}visit(ast);assert.equal(matches.length,1);return matches[0].slice(1,-1)
}
async function actualAx571Cleanup(terminated,options={}){
 let removed=false,settled=false;const pid=123,owned={dev:1n,ino:2n},start={schema:1,framework:'APPKIT',pid,urlBound:true,terminated:false},finish={...start,terminated:true,...options.closed};
 const get=p=>{if(p.endsWith('.owner-started')){if(options.noStart)throw Error('OWNED_MISSING_START');return JSON.stringify(start)};if(p.endsWith('.owner-closed')){if(terminated)return JSON.stringify(finish);throw Object.assign(Error('OWNED_MISSING_CLOSE'),{code:'ENOENT'})}throw Error('OWNED_NO_SETUP')};
 const helper=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['ax571OwnerReceipt','ax571PrelaunchRefused'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n'),code=ts.transpileModule(helper+'\nasync function clean(){'+actualAx571Finally()+'};this.clean=clean;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const context={assert,fs:{readFileSync:get,lstatSync:(name)=>{if(name==='/OWNED_AX571')return{isDirectory:()=>true,isSymbolicLink:()=>false,...owned,ino:options.replaced?3n:2n};if(options.presentEvidence)return{isSymbolicLink:()=>true};throw Object.assign(Error('OWNED_ABSENCE'),{code:options.absenceError||'ENOENT'})},rmSync:()=>{removed=true}},Buffer,t:{diagnostic(){}},child:{pid:99,kill(){throw Error('ALREADY_CLOSED_LAUNCHER')}},closed:Promise.resolve(),ended:true,launcherExit:options.launcherExit??0,launcherSignal:options.launcherSignal??null,marker:'/OWNED_AX571/target.json',siblingMarker:'/OWNED_AX571/sibling.json',failed:!!options.primary,primary:options.primary,framework:'APPKIT',dir:'/OWNED_AX571',ready:'/OWNED_AX571/ready.json',owned,appPID:pid,lease:{settled(){settled=true}},ax571Setup:()=>null};vm.createContext(context);vm.runInContext(code,context);let refused=false,primaryKept=false;try{await context.clean()}catch(e){refused=true;primaryKept=e===options.primary}return{removed,settled,refused,primaryKept}
}
test('#571 owned bundle plan signs fixed app identity, never substitutes the product host',()=>{
 const p=ax571BuildPlan('/OWNED/companion');assert.equal(p.fixtureBundle,'/OWNED/companion/dist/ax-native-571/OwnedAX571.app');assert.equal(p.fixture,p.fixtureBundle+'/Contents/MacOS/owned-target');assert.ok(p.fixtureInfoSource.endsWith('/tests/fixtures/ax-571/Info.plist'));assert.equal(p.commands[4][1].at(-1),p.fixtureBundle);assert.equal(p.commands[5][1].at(-1),p.fixtureBundle)
})
test('#571 owned app termination is required after launcher close before cleanup or lease release',async()=>{
 const pending=await actualAx571Cleanup(false);assert.equal(pending.removed,false);assert.equal(pending.settled,false);assert.equal(pending.refused,true)
 const done=await actualAx571Cleanup(true);assert.equal(done.removed,true);assert.equal(done.settled,true);assert.equal(done.refused,false)
})
test('#571 owned launcher only opens one fixed signed app and waits actual returned instance termination',()=>{
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8');assert.equal((swift.match(/NSWorkspace\.shared\.openApplication\(/g)||[]).length,1);assert.match(swift,/configuration\.activates = true/);assert.match(swift,/configuration\.createsNewApplicationInstance = true/);assert.match(swift,/configuration\.allowsRunningApplicationSubstitution = false/);assert.match(swift,/\.observe\(\\\.isTerminated/);assert.match(swift,/returned\.processIdentifier/);assert.match(swift,/returned\.bundleURL/);assert.match(swift,/returned\.executableURL/);assert.doesNotMatch(swift,/runningApplications\(|runningApplication\(processIdentifier|NSApp\.activate\(/)
})
test('#571 private app owner receipt rejects unknown, stale PID, wrong framework/phase and getters',()=>{
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ax571OwnerReceipt');assert.ok(node);const s={Object,Number};vm.createContext(s);vm.runInContext(ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';this.parse=ax571OwnerReceipt;',s)
 const good={schema:1,framework:'APPKIT',pid:123,urlBound:true,terminated:true};assert.equal(s.parse(good,'APPKIT',true,123).pid,123)
 for(const value of [null,{},[],{...good,extra:'SECRET_OWNED'},{...good,pid:124},{...good,pid:0},{...good,pid:2147483648},{...good,framework:'WKWEBVIEW'},{...good,terminated:false},{...good,urlBound:false},{...good,schema:2}])assert.equal(s.parse(value,'APPKIT',true,123),null)
 let getters=0;const accessor=Object.defineProperty({...good},'pid',{get(){getters++;throw Error('SECRET_OWNED')}});assert.equal(s.parse(accessor,'APPKIT',true,123),null);assert.equal(getters,0)
})
test('#571 actual finally cannot use stale app proof or replace primary during unobserved close',async()=>{
 for(const options of [{noStart:true},{closed:{pid:124}},{closed:{framework:'WKWEBVIEW'}},{closed:{terminated:false}},{closed:{urlBound:false}}]){const r=await actualAx571Cleanup(true,options);assert.equal(r.refused,true);assert.equal(r.removed,false);assert.equal(r.settled,false)}
 const primary=Error('OWNED_PRIMARY');const r=await actualAx571Cleanup(false,{primary});assert.equal(r.primaryKept,true);assert.equal(r.removed,false);assert.equal(r.settled,false)
})
function actualBuild571Fixture(fault){
 const file=path.join(root,'companion/scripts/build-ax-native-571.mjs'),text=fs.readFileSync(file,'utf8'),sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),definitions=['ax571BuildPlan','buildAx571'].map(name=>{const n=sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(n);return n.getText(sf).replace(/^export /,'')}).join('\n')
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR,'ax571-plan-')),r=path.join(dir,'companion'),plist=path.join(r,'tests/fixtures/ax-571/Info.plist');fs.mkdirSync(path.dirname(plist),{recursive:true});fs.copyFileSync(path.join(root,'companion/tests/fixtures/ax-571/Info.plist'),plist)
 const commands=[];const execute=(bin,args)=>{commands.push([bin,args]);if(bin==='/usr/bin/swiftc'){const dest=args[args.indexOf('-o')+1];fs.writeFileSync(dest,'OWNED_INERT_NOT_MACHO',{flag:'wx'})}if(args.includes('--verify')&&fault==='signature')return{status:1};if(args.includes('-dv')){const id=args.at(-1).endsWith('.app')?(fault==='identifier'?'OWNED_WRONG':'com.cmspark.ax571.owned-target'):'com.cmspark.agent';return{status:0,stderr:'Identifier='+id+'\n'}}return{status:0}}
 const context={fs,path,spawnSync:execute,process:{platform:'darwin',version:'v22.23.2'}};vm.createContext(context);vm.runInContext(definitions+';this.build=buildAx571;',context)
 let error;try{context.build(r);const result=JSON.parse(fs.readFileSync(path.join(r,'dist/ax-native-571/identity.json'),'utf8'));assert.equal(result.fixtureBundleVerified,true);assert.equal(result.fixtureIdentifierExpected,true);assert.equal(fs.readFileSync(path.join(r,'dist/ax-native-571/OwnedAX571.app/Contents/Info.plist'),'utf8'),fs.readFileSync(plist,'utf8'))}catch(e){error=e.message}finally{fs.rmSync(dir,{recursive:true,force:true})}return{error,commands}
}
test('#571 actual bundle builder writes exclusive fixed plist and checks both real signing identities',()=>{const r=actualBuild571Fixture();assert.equal(r.error,undefined);assert.equal(r.commands.length,8);assert.equal(r.commands.filter(([bin])=>bin==='/usr/bin/swiftc').length,2);for(const [bin,args]of r.commands)assert.ok(['/usr/bin/swiftc','/usr/bin/codesign'].includes(bin))})
test('#571 actual bundle builder refuses signature or fixture identifier failure',()=>{assert.equal(actualBuild571Fixture('signature').error,'AX571_BUILD_FAILED');assert.equal(actualBuild571Fixture('identifier').error,'AX571_FIXTURE_BUNDLE_IDENTITY')})
function actualLauncherBodies571(){
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8'),a=swift.indexOf('    func observedTermination(_ owned: NSRunningApplication) {'),b=swift.indexOf('    func retire() {',a),c=swift.indexOf('    func start() {',b);assert.ok(a>=0&&b>a&&c>b)
 let observed=swift.slice(a,b).slice(swift.slice(a,b).indexOf('{')+1,swift.slice(a,b).lastIndexOf('}')),retire=swift.slice(b,c).slice(swift.slice(b,c).indexOf('{')+1,swift.slice(b,c).lastIndexOf('}'))
 const replace=(s,x,y)=>{assert.equal(s.split(x).length,2,x);return s.replace(x,y)}
 observed=replace(observed,'guard application === owned, owned.isTerminated, !completed else { return }','if(!(application === owned && owned.isTerminated && !completed))return')
 observed=replace(observed,'guard receipt(true) else { exit(65) }','if(!receipt(true)){exit(65)}');observed=replace(observed,'terminationObservation = nil','terminationObservation = null');observed=replace(observed,'for source in signalSources { source.cancel() }; signalSources.removeAll()','for(const source of signalSources){source.cancel()};signalSources.splice(0)')
 retire=replace(retire,'guard let owned = application else { return }','const owned=application;if(!owned)return');retire=replace(retire,'if owned.isTerminated { observedTermination(owned); return }','if(owned.isTerminated){observedTermination(owned);return}');retire=replace(retire,'guard !terminationRequested else { return }','if(terminationRequested)return');retire=replace(retire,'_ = owned.forceTerminate()','owned.forceTerminate()')
 assert.doesNotMatch(observed+retire,/\bguard\b|\bnil\b|for source in|_ =/)
 return {observe:vm.runInNewContext('(state,owned)=>{with(state){'+observed+'}}'),retire:vm.runInNewContext('(state)=>{with(state){'+retire+'}}')}
}
function launcherState571(){const events=[],owner={isTerminated:false,forceTerminate(){events.push('REQUEST');return true}},state={application:owner,completed:false,stopping:false,terminationRequested:false,signalSources:[{cancel(){events.push('SIGNAL_CANCEL')}}],terminationObservation:{invalidate(){events.push('OBSERVATION_INVALIDATE')}},receipt(v){assert.equal(v,true);events.push('ACTUAL_CLOSE_RECEIPT');return true},exit(n){events.push(n);throw Error('OWNED_EXIT')},observedTermination(owned){bodies.observe(state,owned)}};const bodies=actualLauncherBodies571();return{state,owner,events,bodies}}
test('#571 actual launcher never equates termination request success or foreign close with owned app close',()=>{
 const f=launcherState571();f.bodies.retire(f.state);assert.deepEqual(f.events,['REQUEST']);f.bodies.retire(f.state);assert.deepEqual(f.events,['REQUEST']);f.bodies.observe(f.state,{isTerminated:true});assert.deepEqual(f.events,['REQUEST']);assert.equal(f.state.completed,false)
 f.owner.isTerminated=true;assert.throws(()=>f.bodies.observe(f.state,f.owner),/OWNED_EXIT/);assert.deepEqual(f.events,['REQUEST','ACTUAL_CLOSE_RECEIPT','OBSERVATION_INVALIDATE','SIGNAL_CANCEL',177]);f.bodies.observe(f.state,f.owner);assert.equal(f.events.filter(x=>x==='ACTUAL_CLOSE_RECEIPT').length,1)
})
test('#571 actual launcher keeps a stop while launch completion is pending and retires only its later owner',()=>{
 const f=launcherState571();f.state.application=undefined;f.bodies.retire(f.state);assert.equal(f.state.stopping,true);assert.deepEqual(f.events,[]);f.state.application=f.owner;f.bodies.retire(f.state);assert.deepEqual(f.events,['REQUEST']);f.owner.isTerminated=true;assert.throws(()=>f.bodies.observe(f.state,f.owner),/OWNED_EXIT/)
})
test('#571 fixed owned app plist has only its closed bundle identity and no URL/document associations',()=>{
 const plist=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/Info.plist'),'utf8'),keys=[...plist.matchAll(/<key>([^<]+)<\/key>/g)].map(m=>m[1]);assert.deepEqual(keys,['CFBundleIdentifier','CFBundleExecutable','CFBundleName','CFBundlePackageType','CFBundleVersion','CFBundleShortVersionString','NSPrincipalClass','LSUIElement','LSBackgroundOnly']);assert.match(plist,/<key>CFBundleIdentifier<\/key><string>com\.cmspark\.ax571\.owned-target<\/string>/);assert.match(plist,/<key>CFBundleExecutable<\/key><string>owned-target<\/string>/);assert.match(plist,/<key>CFBundlePackageType<\/key><string>APPL<\/string>/);assert.match(plist,/<key>LSUIElement<\/key><false\/>/)
})

// Dedicated pre-start outcomes are lifetime proof, never a native action PASS.
for(const code of [78,79])test('#571 root dedicated never-launched close permits owned cleanup '+code,async()=>{const r=await actualAx571Cleanup(false,{noStart:true,launcherExit:code});assert.equal(r.removed,true);assert.equal(r.settled,true);assert.equal(r.refused,false)})
test('#571 root unknown and signalled launch outcomes never gain cleanup authority',async()=>{for(const launcherExit of [0,64,65,177,255]){const r=await actualAx571Cleanup(false,{noStart:true,launcherExit});assert.equal(r.removed,false);assert.equal(r.settled,false);assert.equal(r.refused,true)}const signalled=await actualAx571Cleanup(false,{noStart:true,launcherExit:78,launcherSignal:'SIGTERM'});assert.equal(signalled.removed,false);assert.equal(signalled.settled,false)})
test('#571 root existing malformed or unreadable evidence is not absent',async()=>{for(const extra of [{presentEvidence:true},{absenceError:'EACCES'},{absenceError:'ELOOP'}]){const r=await actualAx571Cleanup(false,{noStart:true,launcherExit:78,...extra});assert.equal(r.removed,false);assert.equal(r.settled,false);assert.equal(r.refused,true)}})
test('#571 root never-launched classification cannot erase primary or replace directory identity',async()=>{const primary=Error('OWNED_PRIMARY'),r=await actualAx571Cleanup(false,{noStart:true,launcherExit:78,primary});assert.equal(r.removed,true);assert.equal(r.settled,true);assert.equal(r.primaryKept,true);const replaced=await actualAx571Cleanup(false,{noStart:true,launcherExit:78,replaced:true});assert.equal(replaced.removed,false);assert.equal(replaced.settled,false);assert.equal(replaced.refused,true)})
test('#571 root dedicated outcomes occur only before the single launch invocation',()=>{const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8'),branch=swift.slice(swift.indexOf('if arguments.first == "--launch-owned"'));for(const code of [78,79]){assert.equal((swift.match(new RegExp('exit\\('+code+'\\)','g'))||[]).length,1);assert.ok(branch.indexOf('exit('+code+')')<branch.indexOf('launcher.start()'))}assert.match(source,/once\('close',\(code,signal\)=>/);assert.match(source,/AX571_LIFETIME/)})

test('#571 root no prelaunch proof before actual close or from error-code getters',()=>{const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ax571PrelaunchRefused');assert.ok(n);let calls=0,reads=0;const error=Object.defineProperty(Error('OWNED_UNREADABLE'),'code',{get(){reads++;return'ENOENT'}}),state={Object,fs:{lstatSync(){calls++;throw Object.assign(Error('OWNED_ABSENT'),{code:'ENOENT'})}}};vm.createContext(state);vm.runInContext(ts.transpileModule(n.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';this.check=ax571PrelaunchRefused;',state);assert.equal(state.check(false,78,null,['/OWNED/ready']),false);assert.equal(calls,0);assert.equal(state.check(true,78,null,['/OWNED/ready']),true);state.fs.lstatSync=()=>{throw error};assert.equal(state.check(true,78,null,['/OWNED/ready']),false);assert.equal(reads,0)})

// Filesystem identity control: no Foundation/AppKit or native executable is run.
function actualCanonicalParent571(resolvePath,onFree=()=>{}){
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8')
 const start='private func ax571CanonicalDirectory(_ directory: URL) -> Bool {'
 if(!swift.includes(start)){
  const expression=swift.match(/parent\.lastPathComponent\.hasPrefix\("ax-native571-"\), ([^,\n]+),/)?.[1]
  assert.equal(expression,'parent.resolvingSymlinksInPath() == parent')
  const code=expression.replace('parent.resolvingSymlinksInPath()','foundationResolve(parent)')
  return(directory)=>vm.runInNewContext(code,{parent:directory.path,foundationResolve:resolvePath})
 }
 assert.equal(swift.split(start).length,2)
 let body=swift.split(start)[1].split('\n}')[0]
 const old='    guard directory.isFileURL, directory.path.hasPrefix("/"), !directory.path.contains("\\0"),\n          let resolved = Darwin.realpath(directory.path, nil) else { return false }'
 assert.equal(body.split(old).length,2)
 body=body.replace(old,'    if(!directory.isFileURL || !directory.path.startsWith("/") || directory.path.includes("\\0"))return false; const resolved=resolvePath(directory.path);if(resolved===null)return false;try{')
 assert.equal(body.split('    defer { free(resolved) }').length,2);body=body.replace('    defer { free(resolved) }','')
 assert.equal(body.split('String(cString: resolved)').length,2);body=body.replace('String(cString: resolved)','String(resolved)')+'\n}finally{onFree(resolved)}'
 assert.doesNotMatch(body,/\bguard\b|\bdefer\b|Darwin\.|cString:/)
 return vm.runInNewContext('(directory)=>{'+body+'}',{resolvePath,onFree})
}
test('#571 canonical parent accepts the exact POSIX spelling under documented Foundation private display alias',()=>{
 // Existence-sensitive NSURL rules are a declared API boundary model, not a Darwin runtime observation.
 const physical='/private/var/owned/ax-native571-model',display=physical.slice('/private'.length)
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8'),current=swift.includes('private func ax571CanonicalDirectory(')
 const resolve=()=>current?physical:display
 assert.equal(actualCanonicalParent571(resolve)({isFileURL:true,path:physical}),true)
})
test('#571 actual canonical parent uses real owned POSIX paths with absent receipts and rejects a symlink alias',()=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR,'ax-native571-posix-'))),alias=dir+'-alias'
 try{
  const st=fs.lstatSync(dir);assert.equal(st.isDirectory(),true);assert.equal(st.isSymbolicLink(),false);assert.equal(st.mode&0o777,0o700)
  for(const name of['ready.json','target.json','sibling.json'])assert.equal(fs.existsSync(path.join(dir,name)),false)
  const resolve=(value)=>{try{return fs.realpathSync(value)}catch{return null}}
  assert.equal(actualCanonicalParent571(resolve)({isFileURL:true,path:dir}),true)
  fs.symlinkSync(dir,alias);assert.equal(actualCanonicalParent571(resolve)({isFileURL:true,path:alias}),false)
 }finally{try{fs.unlinkSync(alias)}catch{};fs.rmSync(dir,{recursive:true,force:true})}
})
test('#571 POSIX canonical helper releases one allocated result and refuses unavailable resolution',()=>{
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8');if(!swift.includes('private func ax571CanonicalDirectory('))return
 let calls=0,freed=0;const check=actualCanonicalParent571(p=>{calls++;return p},()=>freed++)
 assert.equal(check({isFileURL:true,path:'/owned/ax-native571-inert'}),true);assert.equal(calls,1);assert.equal(freed,1)
 for(const d of[{isFileURL:false,path:'/owned/x'},{isFileURL:true,path:'relative'},{isFileURL:true,path:'/owned/\0'}])assert.equal(check(d),false)
 assert.equal(calls,1);assert.equal(freed,1);assert.equal(actualCanonicalParent571(()=>null,()=>freed++)({isFileURL:true,path:'/owned/missing'}),false);assert.equal(freed,1)
})
test('#571 both actual owned path guards use the same canonical filesystem check and retain metadata authority',()=>{
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8')
 const body=swift.slice(swift.indexOf('private struct AX571OwnedPaths'),swift.indexOf('private final class AX571OwnedLauncher'))
 assert.match(body,/ax571CanonicalDirectory\(parent\)/);assert.match(body,/ax571CanonicalDirectory\(directory\)/)
 assert.doesNotMatch(body,/resolvingSymlinksInPath/)
 for(const fact of['attributes[.type] as? FileAttributeType == .typeDirectory','permissions & 0o077 == 0','(attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid()','let dev = (attributes[.systemNumber] as? NSNumber)?.uint64Value','let ino = (attributes[.systemFileNumber] as? NSNumber)?.uint64Value','uint64Value == device','uint64Value == inode'])assert.ok(body.includes(fact))
})


function launchBoundaryConsumer571(){
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ax571LaunchBoundary');assert.ok(node,'fixed native completion marker consumer missing')
 const s={Buffer};vm.createContext(s);vm.runInContext(ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';this.parse=ax571LaunchBoundary;',s);return s.parse
}
const launchCodes571=['OPEN_ERROR','NO_RETURNED_APP','PARENT_CHANGED','RETURNED_PID','RETURNED_TERMINATED','BUNDLE_ID','BUNDLE_URL','EXECUTABLE_URL']
test('#571 fixed launch boundary consumer exports only known closed categories',()=>{
 const parse=launchBoundaryConsumer571();for(const code of launchCodes571){assert.equal(parse('AX571_LAUNCH_'+code+'\n'),code);assert.equal(parse('IGNORED_OWNED_TEXT\nAX571_LAUNCH_'+code+'\r\n'),code)}
 for(const value of [null,undefined,{},[],0,'','AX571_LAUNCH_PRIVATE_SENTINEL\n','prefix AX571_LAUNCH_OPEN_ERROR\n','AX571_LAUNCH_OPEN_ERROR suffix\n','AX571_LAUNCH_OPEN_ERROR\nAX571_LAUNCH_BUNDLE_ID\n','x'.repeat(4097)])assert.equal(parse(value),'UNKNOWN')
 let reads=0;assert.equal(parse({toString(){reads++;throw Error('OWNED_SECRET')}}),'UNKNOWN');assert.equal(reads,0)
})
test('#571 actual launch callback consumes stderr only without reflecting native error or stdout',()=>{
 const parse=launchBoundaryConsumer571();let call;const walk=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast)==='execFile'&&n.arguments[0]?.getText(ast)==='fixture')call=n;ts.forEachChild(n,walk)};walk(ast);assert.ok(call)
 const callback=call.arguments.at(-1);assert.ok(ts.isArrowFunction(callback));const s={ax571LaunchBoundary:parse,ax571LaunchLifecycle:()=>null,launchBoundary:'UNKNOWN',launchLifecycle:null};vm.createContext(s);vm.runInContext('this.callback='+ts.transpileModule('const f='+callback.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.replace(/^const f = /,'').replace(/;\s*$/,''),s)
 const error=Object.defineProperty({},'message',{get(){throw Error('PRIVATE_ERROR_READ')}})
 s.callback(error,'AX571_LAUNCH_OPEN_ERROR\n','AX571_LAUNCH_BUNDLE_URL\n');assert.equal(s.launchBoundary,'BUNDLE_URL')
 s.callback(error,'AX571_LAUNCH_OPEN_ERROR\n','UNRECOGNIZED_PRIVATE_SENTINEL');assert.equal(s.launchBoundary,'UNKNOWN')
})
test('#571 public lifetime observation includes only fixed wait stage and decoded launch category',()=>{
 const owner=source.indexOf("await waitFile(ready+'.owner-started')"),ready=source.indexOf('await waitFile(ready)'),ownerPhase=source.indexOf("waitStage='OWNER_STARTED'"),readyPhase=source.indexOf("waitStage='APP_READY'"),actionPhase=source.indexOf("waitStage='ACTION'"),diagnostic=source.indexOf("t.diagnostic('AX571_LIFETIME '");assert.ok(ownerPhase>=0&&ownerPhase<owner&&readyPhase>owner&&readyPhase<ready&&actionPhase>ready&&actionPhase<diagnostic)
 let expression;const walk=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast)==='t.diagnostic'&&n.arguments[0]?.getText(ast).startsWith("'AX571_LIFETIME '"))expression=n.arguments[0];ts.forEachChild(n,walk)};walk(ast);assert.ok(expression)
 const s={JSON,framework:'APPKIT',ended:true,launcherExit:65,launcherSignal:null,waitStage:'APP_READY',launchBoundary:'BUNDLE_URL',launchLifecycle:null};const text=vm.runInNewContext(expression.getText(ast),s);const result=JSON.parse(text.slice('AX571_LIFETIME '.length));assert.deepEqual(result,{schema:1,framework:'APPKIT',closed:true,prelaunch:'UNPROVEN',signalObserved:false,waitStage:'APP_READY',launchBoundary:'BUNDLE_URL',launchLifecycle:null})
 assert.equal(text.includes('PRIVATE_SENTINEL'),false)
})

test('#571 PID refusal decoder distinguishes fixed nonpositive and self categories without exposing values',()=>{
 const parse=launchBoundaryConsumer571()
 for(const code of ['RETURNED_PID_NONPOSITIVE','RETURNED_PID_SELF','RETURNED_PID'])assert.equal(parse('AX571_LAUNCH_'+code+'\n'),code)
 for(const value of ['AX571_LAUNCH_RETURNED_PID_SELF_123\n','AX571_LAUNCH_RETURNED_PID_NONPOSITIVE_PRIVATE\n','AX571_LAUNCH_RETURNED_PID_SELF\nAX571_LAUNCH_RETURNED_PID\n','AX571_LAUNCH_RETURNED_PID_SELF\nAX571_LAUNCH_RETURNED_PID_NONPOSITIVE\n'])assert.equal(parse(value),'UNKNOWN')
})
test('#571 actual Swift completion preserves all nine predicates and separates the two PID refusal boundaries',()=>{
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8'),start=swift.indexOf('                guard error == nil else'),end=swift.indexOf('                application = returned;',start);assert.ok(start>=0&&end>start)
 const guards=[...swift.slice(start,end).matchAll(/guard ([^\n]+) else \{ (?:ax571LaunchLifecycle\(\.refused, returned\); )?ax571LaunchGuardRefused\(\.(\w+)\) \}/g)].map(m=>({conditions:m[1].split(',').map(s=>s.trim()),category:m[2]}))
 const expected=['error == nil','let returned = returned','paths.current()','returned.processIdentifier > 0','returned.processIdentifier != getpid()','!returned.isTerminated','returned.bundleIdentifier == "com.cmspark.ax571.owned-target"','returned.bundleURL?.resolvingSymlinksInPath() == bundle','returned.executableURL?.resolvingSymlinksInPath() == executable']
 assert.equal(guards.length,9);assert.deepEqual(guards.flatMap(g=>g.conditions),expected)
 assert.equal(guards[3].category,'returnedPIDNonpositive');assert.equal(guards[4].category,'returnedPIDSelf')
 const markers=new Map([...swift.matchAll(/case \.(\w+): marker = "AX571_LAUNCH_([A-Z_]+)\\n"/g)].map(m=>[m[1],m[2]]));assert.equal(markers.size,9)
 const lower=s=>s==='let returned = returned'?'returned !== null':s.replaceAll(' == ',' === ').replaceAll(' != ',' !== ').replaceAll('nil','null')
 const compiled=guards.map(g=>({category:g.category,tests:g.conditions.map(c=>new Function('error','returned','paths','getpid','bundle','executable','return ('+lower(c)+');'))})),parse=launchBoundaryConsumer571(),seen=new Set();let states=0
 for(const error of [null,'OWNED_PRIVATE_SENTINEL'])for(const present of [false,true])for(const parent of [false,true])for(const pid of [-1,0,10,42])for(const terminated of [false,true])for(const bundleID of ['com.cmspark.ax571.owned-target','OWNED_PRIVATE_SENTINEL'])for(const bundleURL of [null,'wrong','bundle'])for(const executableURL of [null,'wrong','exe']){
  const returned=present?{processIdentifier:pid,isTerminated:terminated,bundleIdentifier:bundleID,bundleURL:bundleURL===null?null:{resolvingSymlinksInPath:()=>bundleURL},executableURL:executableURL===null?null:{resolvingSymlinksInPath:()=>executableURL}}:null,args=[error,returned,{current:()=>parent},()=>10,'bundle','exe']
  let actual='BOUND';for(const group of compiled){if(!group.tests.every(f=>f(...args))){actual=markers.get(group.category);break}}
  const want=error!==null?'OPEN_ERROR':!present?'NO_RETURNED_APP':!parent?'PARENT_CHANGED':pid<=0?'RETURNED_PID_NONPOSITIVE':pid===10?'RETURNED_PID_SELF':terminated?'RETURNED_TERMINATED':bundleID!=='com.cmspark.ax571.owned-target'?'BUNDLE_ID':bundleURL!=='bundle'?'BUNDLE_URL':executableURL!=='exe'?'EXECUTABLE_URL':'BOUND'
  assert.equal(actual,want);if(actual!=='BOUND'){assert.equal(parse('AX571_LAUNCH_'+actual+'\n'),actual);assert.equal(actual.includes('SENTINEL'),false);seen.add(actual)}states++
 }
 assert.equal(states,1152);assert.equal(seen.size,9)
})

function lifecycleConsumer571(){const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ax571LaunchLifecycle');assert.ok(n,'lifecycle decoder missing');const c={Buffer};vm.createContext(c);vm.runInContext(ts.transpileModule(n.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';this.parse=ax571LaunchLifecycle;',c);return c.parse}
function actualLifecycleEmitter571(){
 const s=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8'),anchor='private func ax571LaunchLifecycle(_ point: AX571LaunchLifecyclePoint, _ application: NSRunningApplication) {';assert.equal(s.split(anchor).length,2)
 let body=s.split(anchor)[1].split('\n}')[0];const sink='    do { try FileHandle.standardError.write(contentsOf: Data((marker + String(bits) + "\\n").utf8)) } catch {}';assert.equal(body.split(sink).length,2)
 body=body.replace(sink,'    try{sink(marker + String(bits) + "\\n")}catch{}').replace('point == .entry',"point === 'entry'")
 return vm.compileFunction(body,['point','application','sink'])
}
test('#571 lifecycle emitter and original nine guards distinguish queue transition without granting admission',()=>{
 const emit=actualLifecycleEmitter571(),parse=lifecycleConsumer571(),swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8'),entry=swift.indexOf('if error == nil, let observed = returned { ax571LaunchLifecycle(.entry, observed) }'),dispatch=swift.indexOf('DispatchQueue.main.async { [self] in',entry),refused='guard returned.processIdentifier > 0 else { ax571LaunchLifecycle(.refused, returned); ax571LaunchGuardRefused(.returnedPIDNonpositive) }';assert.ok(entry>=0&&dispatch>entry);assert.ok(swift.includes(refused));assert.equal(swift.split('ax571LaunchLifecycle(.entry, observed)').length,2);assert.equal(swift.split('ax571LaunchLifecycle(.refused, returned)').length,2)
 const results=[]
 for(const startPositive of [true,false]){let pid=startPositive?42:-1,terminated=false;const lines=[],guardReads=[],app={get processIdentifier(){return pid},get isTerminated(){return terminated},isFinishedLaunching:false};emit('entry',app,x=>lines.push(x));pid=-1;terminated=true;assert.equal(app.processIdentifier>0,false);guardReads.push('pid');emit('refused',app,x=>lines.push(x));const result=parse(lines.join(''));assert.ok(result);assert.equal(result.entry.pidAvailable,startPositive);assert.equal(result.refused.pidAvailable,false);assert.equal(result.refused.terminated,true);assert.deepEqual(guardReads,['pid']);results.push(JSON.stringify(result))}assert.notEqual(results[0],results[1])
})
test('#571 lifecycle snapshots have a bounded closed parser and never coerce or accept duplicate tags',()=>{
 const parse=lifecycleConsumer571();for(const point of ['ENTRY','REFUSED'])for(let bits=0;bits<8;bits++){const r=parse(`AX571_LIFECYCLE_${point}_${bits}\r\n`);assert.ok(r);const actual=r[point.toLowerCase()];assert.equal(actual.pidAvailable,!!(bits&1));assert.equal(actual.terminated,!!(bits&2));assert.equal(actual.finishedLaunching,!!(bits&4))}
 let reads=0;const trap={toString(){reads++;throw Error('PRIVATE')}}
 for(const x of [null,undefined,{},[],trap,'','AX571_LIFECYCLE_ENTRY_8\n','AX571_LIFECYCLE_ENTRY_00\n','AX571_LIFECYCLE_OTHER_0\n','AX571_LIFECYCLE_ENTRY_1\nAX571_LIFECYCLE_ENTRY_1\n','AX571_LIFECYCLE_REFUSED_0\nAX571_LIFECYCLE_REFUSED_1\n','AX571_LIFECYCLE_ENTRY_1_PRIVATE\n','prefix AX571_LIFECYCLE_ENTRY_1\n','AX571_LIFECYCLE_ENTRY_1\rPRIVATE\n','x'.repeat(4097)])assert.equal(parse(x),null)
 assert.equal(reads,0);assert.ok(parse('AX571_LIFECYCLE_ENTRY_1\nAX571_LAUNCH_RETURNED_PID_NONPOSITIVE\nAX571_LIFECYCLE_REFUSED_2\n'))
})
test('#571 lifecycle sink failure cannot replace original refusal and actual child callback retains legacy decoder',()=>{
 const emit=actualLifecycleEmitter571(),parse=lifecycleConsumer571();let reads=0;const app={get processIdentifier(){reads++;return -1},get isTerminated(){reads++;return false},get isFinishedLaunching(){reads++;return false}};assert.doesNotThrow(()=>emit('refused',app,()=>{throw Error('INERT_SINK')}));assert.equal(reads,3)
 const marker=Error('ACTUAL_REFUSAL');assert.throws(()=>{emit('refused',app,()=>{throw Error('INERT_SINK')});throw marker},e=>e===marker)
 let call;function walk(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='execFile'&&n.arguments[0]?.getText(ast)==='fixture')call=n;ts.forEachChild(n,walk)}walk(ast);assert.ok(call);const state={ax571LaunchBoundary:launchBoundaryConsumer571(),ax571LaunchLifecycle:parse,launchBoundary:'UNKNOWN',launchLifecycle:null};vm.createContext(state);vm.runInContext('this.callback='+ts.transpileModule('const f='+call.arguments.at(-1).getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.replace(/^const f = /,'').replace(/;\s*$/,''),state)
 const error=Object.defineProperty({},'message',{get(){throw Error('PRIVATE_ERROR')}});state.callback(error,'PRIVATE_STDOUT','AX571_LIFECYCLE_ENTRY_1\nAX571_LAUNCH_RETURNED_PID_NONPOSITIVE\nAX571_LIFECYCLE_REFUSED_2\n');assert.equal(state.launchBoundary,'RETURNED_PID_NONPOSITIVE');assert.equal(state.launchLifecycle.entry.pidAvailable,true);assert.equal(state.launchLifecycle.refused.terminated,true)
})

// Passive startup journal controls execute the actual TS closures and narrowly lower
// the actual Swift note body. They do not run AppKit, Swift, or a target process.
function startupConsumer571(overrides={}){
 const functions=['ax571StartupTokens','ax571StartupRead'].map(name=>{const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(n,'startup journal consumer missing: '+name);return n.getText(ast)})
 const c={Buffer,fs,path,process:{getuid:()=>process.getuid?.()},...overrides};vm.createContext(c);vm.runInContext(ts.transpileModule(functions.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';this.parse=ax571StartupTokens;this.read=ax571StartupRead;',c);return c
}
const startupStages571=['TARGET_ENTRY','PATHS_ADMITTED','REGULAR_POLICY_ADMITTED','DID_FINISH_ENTERED','READINESS_QUEUED']
function startupOwned571(run){const dir=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR,'ax-native571-journal-')));try{return run(dir,fs.lstatSync(dir,{bigint:true}))}finally{fs.rmSync(dir,{recursive:true,force:true})}}
function journalStat571(extra={}){return{st_dev:1,st_ino:2,st_uid:7,st_mode:0o100600,st_nlink:1,st_size:0,...extra}}
function actualStartupNote571(){
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8').replace(/\r\n/g,'\n'),anchor='    func note(_ point: AX571StartupPoint) {';assert.equal(swift.split(anchor).length,2)
 let b=swift.split(anchor)[1].split('\n    deinit {')[0];assert.ok(b.endsWith('    }'));b=b.slice(0,-5)
 b=b.replace('guard !stopped else { return }','if(stopped)return').replace('if last == point { return }','if(last === point)return')
 b=b.replace(/let (stages|refusals): \[AX571StartupPoint\] = /g,'const $1 = ').replace('let refusal = refusals.contains(point)','const refusal = refusals.includes(point)').replace('let next = stages.firstIndex(of: point)','const next = stages.indexOf(point)').replace('let previous = last.flatMap { stages.firstIndex(of: $0) }','const previous = last === null ? -1 : stages.indexOf(last)')
 const names={targetEntry:'TARGET_ENTRY',pathsAdmitted:'PATHS_ADMITTED',regularPolicyAdmitted:'REGULAR_POLICY_ADMITTED',didFinishEntered:'DID_FINISH_ENTERED',readinessQueued:'READINESS_QUEUED',targetPathsRefused:'TARGET_PATHS_REFUSED',regularPolicyRefused:'REGULAR_POLICY_REFUSED',wkNavigationRefused:'WK_NAVIGATION_REFUSED',receiptWriteRefused:'RECEIPT_WRITE_REFUSED'}
 b=b.replace(/\.(targetEntry|pathsAdmitted|regularPolicyAdmitted|didFinishEntered|readinessQueued|targetPathsRefused|regularPolicyRefused|wkNavigationRefused|receiptWriteRefused)\b/g,(_,k)=>JSON.stringify(names[k]))
 b=b.replace('let allowedRefusal =','const allowedRefusal =').replaceAll(' == ',' === ').replace('(previous ?? -1)','previous').replace('(previous.map { $0 + 1 } ?? 0)','(previous + 1)')
 b=b.replace('guard refusal ? allowedRefusal : next === (previous + 1) else { stopped = true; return }','if(!(refusal ? allowedRefusal : next === (previous + 1))){stopped=true;return}')
 b=b.replace('var parent = stat(), heldParent = stat(), file = stat()','const parent = {}, heldParent = {}, file = {}')
 b=b.replaceAll('Darwin.lstat(directory, &parent)','lstat(directory,parent)').replaceAll('Darwin.fstat(directoryFD, &heldParent)','fstat(directoryFD,heldParent)').replaceAll('Darwin.fstat(fileFD, &file)','fstat(fileFD,file)').replaceAll('Self.sameDirectory','sameDirectory').replaceAll('Self.same','same').replaceAll('mode_t(S_IFREG)','S_IFREG').replaceAll('mode_t(0o600)','0o600').replaceAll('off_t(bytes)','bytes')
 b=b.replace(/guard (lstat[\s\S]+?) else \{ stopped = true; return \}/,'if(!($1)){stopped=true;return}').replaceAll(',\n              ',' &&\n              ')
 b=b.replaceAll('=== 0, ','=== 0 && ').replace('sameDirectory(parent, directoryIdentity),','sameDirectory(parent, directoryIdentity) &&').replace('sameDirectory(heldParent, directoryIdentity),','sameDirectory(heldParent, directoryIdentity) &&').replace('same(file, fileIdentity, S_IFREG, 0o600), file.st_size','same(file, fileIdentity, S_IFREG, 0o600) && file.st_size')
 b=b.replace('let data = Array((point.rawValue + "\\n").utf8)','const data = Buffer.from(point + "\\n")').replaceAll('data.count','data.length').replace('guard records < 12, bytes + data.length <= 512 else { stopped = true; return }','if(!(records < 12 && bytes + data.length <= 512)){stopped=true;return}').replace('let written = data.withUnsafeBytes { Darwin.write(fileFD, $0.baseAddress, data.length) }','const written = write(fileFD,data)').replace('guard written === data.length else { stopped = true; return }','if(written !== data.length){stopped=true;return}').replace('if refusal { stopped = true }','if(refusal){stopped=true}')
 assert.doesNotMatch(b,/\bguard\b|\bvar\b|Darwin|Self\.|\.rawValue|\bmode_t\b|withUnsafe/)
 const identities={};for(const name of ['same','sameDirectory']){const start=swift.indexOf('    static func '+name+'('),ret=swift.slice(start).split('\n')[1].trim().replace(/^return /,'');assert.ok(ret.startsWith('value.st_dev'));const js=ret.replaceAll(' == ',' === ').replace(/value.st_mode & (S_IFMT|0o7777) === (kind|permissions|S_IFDIR|0o700)/g,'(value.st_mode & $1) === $2');identities[name]=new Function('value','original','kind','permissions','getuid','S_IFMT','S_IFDIR','return '+js)}
 return{run:vm.compileFunction('with(state){'+b+'}',['state','point']),same:(v,o,k,p)=>identities.same(v,o,k,p,()=>7,0o170000,0o040000),sameDirectory:(v,o)=>identities.sameDirectory(v,o,undefined,undefined,()=>7,0o170000,0o040000)}
}
function startupMachine571(extra={}){const lowered=actualStartupNote571(),identity=journalStat571(),directoryIdentity=journalStat571({st_ino:3,st_mode:0o040700,st_nlink:2}),writes=[],state={Buffer,stopped:false,last:null,records:0,bytes:0,directory:'/OWNED',directoryFD:4,fileFD:5,fileIdentity:identity,directoryIdentity,S_IFREG:0o100000,...lowered,lstat(_p,out){Object.assign(out,directoryIdentity);return 0},fstat(fd,out){Object.assign(out,fd===4?directoryIdentity:{...identity,st_size:state.bytes});return 0},write(_fd,data){writes.push(data.toString());return data.length},...extra};return{state,writes,note:point=>lowered.run(state,point)}}
test('#571 startup exact finite grammar distinguishes early refusals and last observed prefixes',()=>{
 const c=startupConsumer571();for(let n=1;n<=5;n++){const text=startupStages571.slice(0,n).join('\n')+'\n';assert.equal(c.parse(text).stage,startupStages571[n-1]);assert.equal(c.parse(text).refusal,null)}
 for(const [n,refusal]of[[1,'TARGET_PATHS_REFUSED'],[2,'REGULAR_POLICY_REFUSED'],[3,'WK_NAVIGATION_REFUSED'],[4,'RECEIPT_WRITE_REFUSED'],[5,'RECEIPT_WRITE_REFUSED']])assert.equal(c.parse(startupStages571.slice(0,n).join('\n')+'\n'+refusal+'\n').refusal,refusal)
})
test('#571 startup parser rejects malformed incomplete duplicate reordered foreign and coercing observations',()=>{
 const c=startupConsumer571();let reads=0;const trap={toString(){reads++;throw Error('PRIVATE')}};for(const x of[null,{},[],trap,'','TARGET_ENTRY','TARGET_ENTRY\r\n','TARGET_ENTRY\n\n','TARGET_ENTRY\nTARGET_ENTRY\n','PATHS_ADMITTED\n','TARGET_ENTRY\nREGULAR_POLICY_ADMITTED\n','TARGET_ENTRY\nWK_NAVIGATION_REFUSED\n','TARGET_ENTRY\nTARGET_PATHS_REFUSED\nPATHS_ADMITTED\n','TARGET_ENTRY\nPRIVATE_SENTINEL\n','x'.repeat(513),'TARGET_ENTRY\u2028\n'])assert.equal(c.parse(x),null);assert.equal(reads,0)
})
test('#571 startup actual reader accepts only stable owned private fixed files without second-writer overwrite',()=>startupOwned571((dir,owned)=>{
 const c=startupConsumer571(),file=path.join(dir,'target-startup.log'),text='TARGET_ENTRY\nPATHS_ADMITTED\n';fs.writeFileSync(file,text,{flag:'wx',mode:0o600});assert.equal(c.read(dir,owned).stage,'PATHS_ADMITTED');assert.throws(()=>fs.writeFileSync(file,'FOREIGN',{flag:'wx',mode:0o600}));assert.equal(fs.readFileSync(file,'utf8'),text);assert.equal(c.read(dir,owned).stage,'PATHS_ADMITTED')
 fs.chmodSync(file,0o644);assert.equal(c.read(dir,owned),null);fs.chmodSync(file,0o600);fs.writeFileSync(file,'TARGET_ENTRY\nPART');assert.equal(c.read(dir,owned),null);fs.writeFileSync(file,'TARGET_ENTRY\n'+'x'.repeat(513));assert.equal(c.read(dir,owned),null)
}))
test('#571 startup reader refuses symlink hardlink directory replacement and nonASCII without reflection',()=>startupOwned571((dir,owned)=>{
 const c=startupConsumer571(),file=path.join(dir,'target-startup.log'),other=path.join(dir,'owned-other');fs.writeFileSync(other,'TARGET_ENTRY\n',{mode:0o600});fs.symlinkSync(other,file);assert.equal(c.read(dir,owned),null);fs.unlinkSync(file);fs.linkSync(other,file);assert.equal(c.read(dir,owned),null);fs.unlinkSync(file);fs.writeFileSync(file,Buffer.from([255]),{mode:0o600});assert.equal(c.read(dir,owned),null);const replaced={...owned,ino:owned.ino+1n};assert.equal(c.read(dir,replaced),null)
}))
test('#571 startup actual reader nonblocking flags reject FIFO and stableFD replacement without foreign close',()=>startupOwned571((dir,owned)=>{
 const file=path.join(dir,'target-startup.log');fs.writeFileSync(file,'TARGET_ENTRY\n',{mode:0o600});let closes=0,opens=0
 const fifo=startupConsumer571({fs:{...fs,openSync(p,flags){opens++;assert.equal(p,file);assert.equal(flags&fs.constants.O_NONBLOCK,fs.constants.O_NONBLOCK);return 50},fstatSync(){return{isFile:()=>false,uid:owned.uid,dev:owned.dev,ino:9n}},closeSync(fd){assert.equal(fd,50);closes++}}});assert.equal(fifo.read(dir,owned),null);assert.equal(opens,1);assert.equal(closes,1)
 let stats=0;const replaced=startupConsumer571({fs:{...fs,openSync(){return 51},fstatSync(){const s=fs.lstatSync(file,{bigint:true});stats++;return stats===1?s:new Proxy(s,{get(t,k){return k==='ino'?s.ino+1n:Reflect.get(t,k)}})},closeSync(){throw Error('FOREIGN_CLOSE')}}});assert.equal(replaced.read(dir,owned),null)
}))
test('#571 startup actual writer body preserves first refusal limits and stops on partial or failed writes',()=>{
 const m=startupMachine571();m.note('TARGET_ENTRY');m.note('PATHS_ADMITTED');m.note('REGULAR_POLICY_REFUSED');m.note('DID_FINISH_ENTERED');assert.deepEqual(m.writes,['TARGET_ENTRY\n','PATHS_ADMITTED\n','REGULAR_POLICY_REFUSED\n']);assert.equal(m.state.stopped,true)
 for(const count of[-1,0,2]){const n=startupMachine571({write:()=>count});n.note('TARGET_ENTRY');assert.equal(n.state.stopped,true);assert.equal(n.state.records,0);n.note('PATHS_ADMITTED');assert.equal(n.state.last,null)}
 const n=startupMachine571();for(const s of startupStages571)n.note(s);n.note('READINESS_QUEUED');assert.equal(n.writes.length,5);n.state.records=12;n.note('RECEIPT_WRITE_REFUSED');assert.equal(n.writes.length,5);assert.equal(n.state.stopped,true)
})
test('#571 startup actual writer refuses lost directory file identity and foreign descriptor before write',()=>{
 for(const field of['st_dev','st_ino','st_uid','st_mode','st_nlink']){const m=startupMachine571();m.state.fstat=(fd,out)=>{Object.assign(out,fd===4?m.state.directoryIdentity:{...m.state.fileIdentity,[field]:99});return 0};m.note('TARGET_ENTRY');assert.equal(m.writes.length,0,field);assert.equal(m.state.stopped,true)}
 const m=startupMachine571();m.state.lstat=(_p,out)=>{Object.assign(out,{...m.state.directoryIdentity,st_ino:99});return 0};m.note('TARGET_ENTRY');assert.equal(m.writes.length,0)
})
test('#571 startup wiring preserves original exits admission order fixed FD creation and diagnostic-only finally',()=>{
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8').replace(/\r\n/g,'\n');assert.ok(swift.indexOf('AX571StartupJournal(); ax571StartupJournal?.note(.targetEntry)')<swift.indexOf('let app = NSApplication.shared'))
 assert.match(swift,/Darwin\.openat\(d, "target-startup.log", O_WRONLY \| O_CREAT \| O_EXCL \| O_NOFOLLOW \| O_CLOEXEC, mode_t\(0o600\)\)/);assert.doesNotMatch(swift.slice(swift.indexOf('private final class AX571StartupJournal'),swift.indexOf('private var ax571StartupJournal')),/Darwin\.(unlink|rename|truncate)|\.atomic|asyncAfter|fileExists/)
 for(const point of['targetPathsRefused','regularPolicyRefused','wkNavigationRefused','receiptWriteRefused'])assert.match(swift,new RegExp('note\\(\\.'+point+'\\); exit\\(64\\)'))
 const primary=Error('OWNED_PRIMARY');let call;const walk=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast)==='t.diagnostic'&&n.arguments[0]?.getText(ast).startsWith("'AX571_TARGET_STARTUP '"))call=n;ts.forEachChild(n,walk)};walk(ast);assert.ok(call);const statement=call.parent.parent;assert.ok(ts.isTryStatement(statement.parent));const block=ts.transpileModule(statement.parent.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const c={t:{diagnostic(){throw Error('INERT_SINK')}},JSON,framework:'APPKIT',ax571StartupRead:()=>null,dir:'/OWNED',owned:{}};assert.doesNotThrow(()=>vm.runInNewContext(block,c));assert.throws(()=>{vm.runInNewContext(block,c);throw primary},e=>e===primary)
 const prelaunch=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ax571PrelaunchRefused').getText(ast);assert.doesNotMatch(prelaunch,/Startup|journal/)
})
test('#571 journal close body checks exact descriptor identities and bootstrap keeps fixed admission',()=>{
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8').replace(/\r\n/g,'\n'),start=swift.indexOf('    deinit {'),end=swift.indexOf('\n}\nprivate var ax571StartupJournal',start);assert.ok(start>=0&&end>start)
 let b=swift.slice(start+'    deinit {'.length,end);assert.ok(b.endsWith('    }'));b=b.slice(0,-5).replace('var file = stat(), parent = stat()','const file = {}, parent = {}').replaceAll('Darwin.fstat(fileFD, &file)','fstat(fileFD,file)').replaceAll('Darwin.fstat(directoryFD, &parent)','fstat(directoryFD,parent)').replaceAll('Self.sameDirectory','sameDirectory').replaceAll('Self.same','same').replaceAll('mode_t(S_IFREG)','S_IFREG').replaceAll('mode_t(0o600)','0o600').replaceAll(' == ',' === ').replaceAll('_ = Darwin.close(','close(').replace(/if ([^\n]+) \{ close\(([^)]+)\) \}/g,'if($1){close($2)}')
 const run=vm.compileFunction('with(state){'+b+'}',['state']),lower=actualStartupNote571()
 for(const replace of[false,true]){const closed=[],file=journalStat571(),dir=journalStat571({st_ino:3,st_mode:0o040700,st_nlink:2}),s={...lower,fileFD:5,directoryFD:4,fileIdentity:file,directoryIdentity:dir,S_IFREG:0o100000,fstat(fd,out){Object.assign(out,fd===4?dir:{...file,st_ino:replace?99:file.st_ino});return 0},close:fd=>closed.push(fd)};run(s);assert.deepEqual(closed,replace?[4]:[5,4])}
 const init=swift.slice(swift.indexOf('    init?() {'),swift.indexOf('    func note(_ point:'))
 for(const token of['environment["TMPDIR"]','raw.hasPrefix("/")','!raw.contains("\\0")','url.path == raw','url.lastPathComponent.hasPrefix("ax-native571-")','ax571CanonicalDirectory(url)','Darwin.lstat(raw, &original)','Self.sameDirectory(original, original)','O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC','O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC','file.st_size == 0','Self.sameDirectory(current, original)'])assert.ok(init.includes(token),token)
 assert.doesNotMatch(init.replace(/\/\/[^\n]*/g,""),/Darwin\.close\(f\)|unlink|rename|truncate|\.atomic/)
})
test('#571 actual exit64 branches retain the original exit with early-stage and failed-write observations',()=>{
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8').replace(/\r\n/g,'\n'),branches=[...swift.matchAll(/ax571StartupJournal\?\.note\(\.(targetPathsRefused|regularPolicyRefused|wkNavigationRefused|receiptWriteRefused)\); exit\(64\)/g)];assert.equal(branches.length,5)
 const table={targetPathsRefused:[1,'TARGET_PATHS_REFUSED'],regularPolicyRefused:[2,'REGULAR_POLICY_REFUSED'],wkNavigationRefused:[4,'WK_NAVIGATION_REFUSED'],receiptWriteRefused:[5,'RECEIPT_WRITE_REFUSED']},parse=startupConsumer571().parse
 for(const branch of branches)for(const failedWrite of[false,true]){const[n,token]=table[branch[1]],m=startupMachine571();for(const stage of startupStages571.slice(0,n))m.note(stage);if(failedWrite)m.state.write=()=>-1;const code=branch[0].replace('ax571StartupJournal?.note(.'+branch[1]+')','note('+JSON.stringify(token)+')'),exit={code:0};vm.runInNewContext(code,{note:m.note,exit:n=>{exit.code=n}});assert.equal(exit.code,64);const result=parse(m.writes.join(''));assert.equal(result.refusal,failedWrite?null:token);if(failedWrite)assert.equal(m.state.stopped,true)}
})

// The fixture requires an actual regular policy, not an acknowledgement of a redundant switch.
function actualRegularPolicy571(){
 const swift=fs.readFileSync(path.join(root,'companion/tests/fixtures/ax-571/owned-target.swift'),'utf8').replace(/\r\n/g,'\n'),a=swift.indexOf('    let delegate = AX571Target(arguments)'),b=swift.indexOf('    ax571StartupJournal?.note(.regularPolicyAdmitted)',a);assert.ok(a>=0&&b>a);const body=swift.slice(a,b),decl=/let ([A-Za-z_][A-Za-z0-9_]*) = app\.activationPolicy\(\)/.exec(body),g=/guard (.+) else \{ ax571StartupJournal\?\.note\(\.regularPolicyRefused\); exit\(64\) \}/.exec(body);assert.ok(g,'actual target policy refusal guard');let condition=g[1].replace(/\.regular\b/g,'"regular"');
 const code=(decl?'const '+decl[1]+'=app.activationPolicy();':'')+'Boolean('+condition+')';
 return (app)=>vm.runInNewContext(decl?'(()=>{'+code.replace('Boolean(','return Boolean(')+'})()':code,{app},{timeout:1000})
}
test('#571 regular policy already satisfied is admitted without a redundant switch',()=>{
 const evaluate=actualRegularPolicy571();for(const result of [false,true]){let gets=0,sets=0;assert.equal(evaluate({activationPolicy(){gets++;return 'regular'},setActivationPolicy(p){sets++;assert.equal(p,'regular');return result}}),true);assert.equal(gets,1);assert.equal(sets,0)}
})
test('#571 policy transitions require both successful switch and actual regular postcondition',()=>{
 const evaluate=actualRegularPolicy571();for(const initial of ['accessory','prohibited'])for(const result of [false,true])for(const final of ['regular','accessory','prohibited']){let gets=0,sets=0;const ok=evaluate({activationPolicy(){return gets++===0?initial:final},setActivationPolicy(p){sets++;assert.equal(p,'regular');return result}});assert.equal(ok,result&&final==='regular',JSON.stringify({initial,result,final}));assert.equal(sets,1);assert.equal(gets,result?2:1)}
})
