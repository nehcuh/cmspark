import test from 'node:test'
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
