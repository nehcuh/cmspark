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
const require=createRequire(path.join(root,'companion/package.json')),ts=require('typescript'),source=fs.readFileSync(path.join(root,'companion/tests/computer-ax-native-571.test.ts'),'utf8'),ast=ts.createSourceFile('current.ts',source,ts.ScriptTarget.Latest,true),names=['ax571Code','requireAx571Oracles','ax571Identity'],found={}
for(const n of ast.statements)if(ts.isFunctionDeclaration(n)&&n.name&&names.includes(n.name.text))found[n.name.text]=n.getText(ast)
assert.equal(Object.keys(found).length,3)
const js=ts.transpileModule(names.map(n=>found[n]).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope={assert};vm.createContext(scope);vm.runInContext(js+'\nthis.verify=requireAx571Oracles;this.code=ax571Code;this.identity=ax571Identity;',scope)
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
 assert.doesNotMatch(swift,/performClick|evaluateJavaScript|AXUIElementPerformAction|NSApp\.activate|ignoringOtherApps|AXIsProcessTrustedWithOptions|CGEventPost|DispatchQueue\.main\.asyncAfter[^\n]*changed/)
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
