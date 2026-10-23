import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DESKTOP_WINDOWS_INPUTS, prepareDesktopNodeHeaders, extractDesktopSdk, desktopWindowsCompilePlan } from '../build-desktop-windows.mjs'
import './desktop-local-native-476.test.mjs'
if(process.platform!=='win32')await import('./desktop-workspace-ui-705.test.mjs')

test('declared SDK output itself cannot redirect into an unrelated sibling', async () => {
  const owned=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-sdk-output-'))
  const original=globalThis.fetch;let network=0
  try {
    const sibling=path.join(owned,'sibling'),output=path.join(owned,'output');fs.mkdirSync(sibling)
    fs.symlinkSync(sibling,output,process.platform==='win32'?'junction':'dir')
    globalThis.fetch=async()=>{network++;throw Error('unexpected download')}
    await assert.rejects(()=>prepareDesktopNodeHeaders({dest:output}),/DESKTOP_SDK_DIRECTORY/)
    assert.deepEqual(fs.readdirSync(sibling),[]);assert.equal(network,0)
  } finally {globalThis.fetch=original;fs.rmSync(owned,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('pinned SDK cache corruption refuses before download or extraction', async () => {
  const dest=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-sdk-cache-'))
  const original=globalThis.fetch;let network=0
  try {
    globalThis.fetch=async()=>{network++;throw Error('unexpected download')}
    const cache=path.join(dest,'.desktop-sdk-build');fs.mkdirSync(cache)
    const file=path.join(cache,'headers-'+DESKTOP_WINDOWS_INPUTS.headers.sha256);fs.writeFileSync(file,'corrupted archive')
    const before=fs.readdirSync(cache)
    await assert.rejects(()=>prepareDesktopNodeHeaders({dest}),/DESKTOP_SDK_INTEGRITY/)
    assert.deepEqual(fs.readdirSync(cache),before)
    assert.throws(()=>extractDesktopSdk('headers',Buffer.from('not an archive'),cache),/DESKTOP_SDK_INTEGRITY/)
    assert.deepEqual(fs.readdirSync(cache),before);assert.equal(network,0)
  } finally {globalThis.fetch=original;fs.rmSync(dest,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('SDK cache rejects a redirected directory and a hardlinked input without changing sibling bytes', async () => {
  const owned=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-sdk-identity-'))
  const original=globalThis.fetch;let network=0
  try {
    globalThis.fetch=async()=>{network++;throw Error('unexpected download')}
    const sibling=path.join(owned,'sibling');fs.mkdirSync(sibling);const marker=path.join(sibling,'marker');fs.writeFileSync(marker,'preserve')
    const linked=path.join(owned,'linked');fs.mkdirSync(linked)
    fs.symlinkSync(sibling,path.join(linked,'.desktop-sdk-build'),process.platform==='win32'?'junction':'dir')
    await assert.rejects(()=>prepareDesktopNodeHeaders({dest:linked}),/DESKTOP_SDK_DIRECTORY/)
    const dest=path.join(owned,'hardlinked'),cache=path.join(dest,'.desktop-sdk-build');fs.mkdirSync(cache,{recursive:true})
    fs.linkSync(marker,path.join(cache,'headers-'+DESKTOP_WINDOWS_INPUTS.headers.sha256))
    await assert.rejects(()=>prepareDesktopNodeHeaders({dest}),/DESKTOP_SDK_FILE_IDENTITY/)
    assert.equal(fs.readFileSync(marker,'utf8'),'preserve');assert.equal(network,0)
  } finally {globalThis.fetch=original;fs.rmSync(owned,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})

test('Windows compile plan keeps pinned inputs and spaced paths as argv, not shell text', () => {
  const plan=desktopWindowsCompilePlan({cl:'C:\\VS tools\\cl.exe',root:'C:\\owned path\\repo',output:'C:\\owned path\\out',headers:'C:\\headers',generated:'C:\\generated',sdk:'C:\\SDK',nodeLib:'C:\\node.lib'})
  assert.equal(plan.length,2);assert.ok(plan.every(([binary,args])=>binary==='C:\\VS tools\\cl.exe'&&Array.isArray(args)))
  assert.ok(plan[0][1].includes('/DBUILDING_NODE_EXTENSION'));assert.ok(plan[0][1].includes('C:\\node.lib'))
  assert.ok(plan[1][1].includes('C:\\owned path\\repo\\src\\desktop\\native\\DesktopHost.cpp'))
  assert.ok(plan[1][1].includes('C:\\SDK\\build\\native\\x64\\WebView2LoaderStatic.lib'))
  assert.ok(plan[1][1].includes('version.lib'));assert.ok(plan[1][1].includes('/OUT:C:\\owned path\\out\\cmspark-desktop.exe'))
})

// Execute the complete private discovery function with controlled Windows API
// outlets. These are discovery contracts; real MSVC/native execution is CI-only.
const helperSource = fs.readFileSync(new URL('../build-desktop-windows.mjs', import.meta.url), 'utf8')
function loadDiscovery(source) {
  const discovery = source.replace(/\r\n/g, '\n').match(/function toolchain\(\) \{([\s\S]*?)\n\}\nexport async function buildDesktopWindows/)
  assert.ok(discovery, 'one complete production toolchain function')
  return new Function('path', 'process', 'checked', 'fs', discovery[1])
}
const discover = loadDiscovery(helperSource)

function controlledDiscovery(major, override = {}) {
  const installation = override.installation ?? `C:\\Program Files\\Microsoft Visual Studio\\${major}\\Enterprise`
  const tools = override.tools ?? path.win32.join(installation, 'VC', 'Tools', 'MSVC', 'owned-version')
  const commands = [], env = {SystemRoot: 'C:\\Windows', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', PATH: 'OWNED_PATH_MUST_NOT_SELECT_COMPILER'}
  const vcvars = path.win32.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat')
  const cl = path.win32.join(tools, 'bin', 'Hostx64', 'x64', 'cl.exe')
  const checked = (binary, args, options) => {
    commands.push({binary, args, options})
    if (binary.endsWith('vswhere.exe')) {
      assert.equal(binary, 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe')
      assert.deepEqual([...args.slice(0, 2), ...args.slice(3)], ['-latest', '-version', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'])
      const version = args[args.indexOf('-version') + 1].match(/^\[(\d+)\.0,(\d+)\.0\)$/)
      assert.ok(version, 'finite explicit major range')
      return major >= Number(version[1]) && major < Number(version[2]) ? installation : ''
    }
    assert.equal(binary, 'C:\\Windows\\System32\\cmd.exe')
    assert.deepEqual(args, ['/d', '/v:off', '/s', '/c', `"call "${vcvars}" x64 >nul && set"`])
    assert.equal(options.windowsVerbatimArguments, true)
    return `Path=OWNED_CAPTURED_PATH\r\nVCToolsInstallDir=${tools}\r\nINCLUDE=OWNED_INCLUDE\r\nOWNED_UNRELATED=not_imported\r\n`
  }
  const result = (override.discover ?? discover)(path.win32, {env}, checked, {
    existsSync: file => [vcvars, cl].includes(file),
    realpathSync: file => file,
  })
  assert.equal(result.cl, cl)
  assert.equal(result.env.Path, 'OWNED_CAPTURED_PATH')
  assert.equal(Object.hasOwn(result.env, 'PATH'), false)
  assert.equal(Object.hasOwn(result.env, 'OWNED_UNRELATED'), false)
  assert.equal(commands.length, 2, 'only fixed vswhere and vcvars before compiler selection')
  return result
}

for (const major of [17, 18]) {
  test(`installed VS major ${major} discovers the exact component compiler`, () => {
    controlledDiscovery(major)
  })
}
for (const major of [16, 19]) {
  test(`unapproved VS major ${major} cannot select a compiler`, () => {
    assert.throws(() => controlledDiscovery(major), /DESKTOP_WINDOWS_TOOLCHAIN_PATH/)
  })
}
for (const installation of ['relative\\VS', 'C:\\VS"quoted', 'C:\\VS%expanded', 'C:\\VS!expanded', 'C:\\VS\nextra']) {
  test(`toolchain rejects unsafe installation ${JSON.stringify(installation)}`, () => {
    assert.throws(() => controlledDiscovery(17, {installation}), /DESKTOP_WINDOWS_TOOLCHAIN_PATH/)
  })
}
test('selected compiler tools must remain inside the discovered installation', () => {
  assert.throws(() => controlledDiscovery(17, {tools: 'C:\\unrelated\\Tools'}), /DESKTOP_WINDOWS_TOOLCHAIN_PATH/)
})

for (const [name, newline] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test(`production discovery is complete under ${name} checkout newlines`, () => {
    const source = helperSource.replace(/\r\n/g, '\n').replace(/\n/g, newline)
    const discover = loadDiscovery(source)
    for (const major of [17, 18]) controlledDiscovery(major, {discover})
    for (const major of [16, 19]) assert.throws(() => controlledDiscovery(major, {discover}), /DESKTOP_WINDOWS_TOOLCHAIN_PATH/)
  })
}

test('native phase diagnostics are enabled only by explicit testFixtures compile plan', () => {
  const inputs={cl:'C:\\VS\\cl.exe',root:'C:\\repo',output:'C:\\out',headers:'C:\\headers',generated:'C:\\generated',sdk:'C:\\SDK',nodeLib:'C:\\node.lib'}
  const ordinary=desktopWindowsCompilePlan(inputs),disabled=desktopWindowsCompilePlan({...inputs,testFixtures:false}),diagnostic=desktopWindowsCompilePlan({...inputs,testFixtures:true})
  assert.deepEqual(disabled,ordinary)
  assert.deepEqual(diagnostic[0],ordinary[0],'no launcher/handle/bootstrap change')
  const flag='/DCMSPARK_DESKTOP_TEST_PHASES'
  assert.equal(ordinary[1][1].includes(flag),false)
  assert.equal(diagnostic[1][1].filter(value=>value===flag).length,1)
  assert.deepEqual(diagnostic[1][1].filter(value=>value!==flag),ordinary[1][1])
})

test('production C++ compile plan preserves UTF-8 native strings independently of the runner code page', () => {
  const inputs={cl:'C:\\VS\\cl.exe',root:'C:\\repo',output:'C:\\out',headers:'C:\\headers',generated:'C:\\generated',sdk:'C:\\SDK',nodeLib:'C:\\node.lib'}
  for(const testFixtures of [false,true]) {
    const plan=desktopWindowsCompilePlan({...inputs,testFixtures})
    assert.equal(plan[1][1].filter(arg=>arg==='/utf-8').length,1,'UTF-8 C++ source must not depend on the Windows ANSI code page')
    assert.equal(plan[0][1].includes('/utf-8'),false,'the unchanged C launcher has no encoding change')
  }
})

test('all actual C++ acceptance compiler arguments preserve Unicode input without weakening its assertion', () => {
  // Evaluate all three actual argv expressions; never invoke a compiler.
  const calls=[...helperSource.matchAll(/checked\(cl,(\["\/nologo","\/std:c\+\+20"[^\n]+?\]),\{env,cwd:output,buildDiagnostic:true\}\)/g)]
  assert.equal(calls.length,3,'all actual native acceptance compile sites')
  for(const match of calls) for(const mode of ['visual','hostile','inheritance','parent']) {
    const argv=new Function('path','mode','sdk','generated','root','source','mcpSource','binary','mcpBinary','terminalSource','terminalBinary',`return ${match[1]}`)(path.win32,mode,'C:\\sdk','C:\\generated','C:\\repo','C:\\owned.cpp','C:\\owned-mcp.cpp','C:\\owned.exe','C:\\owned-mcp.exe','C:\\owned-terminal.cpp','C:\\owned-terminal.exe')
    assert.equal(argv.filter(arg=>arg==='/utf-8').length,1,'acceptance C++ has the same explicit source encoding as production')
    assert.ok(argv.includes('/DUNICODE')&&argv.includes('/D_UNICODE'))
  }
  const nativeTest=fs.readFileSync(new URL('../../tests/desktop-native-mcp-476.test.ts',import.meta.url),'utf8')
  const form=fs.readFileSync(new URL('../../tests/fixtures/desktop-476/native-form.js',import.meta.url),'utf8')
  assert.ok(nativeTest.includes('assert.deepEqual((stored.owned_added_476 as any).args,["中文 空格"])'))
  assert.ok(form.includes('中文 空格'))
})

// Same-number handles are not kernel identities. Execute only the actual C
// predicate with inert Win32 outlets; this never compiles/runs Windows code.
function identityFunctions(fixture) {
  const extract = (source, signature) => {
    const begin=source.indexOf(signature);assert.ok(begin>=0,signature)
    const open=source.indexOf('{',begin);let depth=0
    for(let i=open;i<source.length;i++) {if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)return source.slice(begin,i+1)}
    assert.fail('complete C function')
  }
  if(!fixture.includes('static bool d480_identity_one(')) {
    const original=fs.readFileSync(new URL('../../tests/fixtures/desktop-480/windows-inheritance.c',import.meta.url),'utf8')
    const c=extract(original,'static unsigned fixture_mask(')
    const body=c.replace('static unsigned fixture_mask(const HANDLE known[3])','function fixture_mask(known)').replace('unsigned mask=0','let mask=0').replace('for(unsigned i=0','for(let i=0').replace('DWORD flags=0','let flags=0').replace('&flags','flags').replace('1u<<i','1<<i')
    return api => ({valid:true,mask:new Function('GetHandleInformation',body+';return fixture_mask([40,44,48])')(api.GetHandleInformation)})
  }
  const functions=['static bool d480_identity_one(','static bool d480_known_identity('].map(s=>extract(fixture,s))
  let js=functions.join('\n')
  const replacements=[[/static bool d480_identity_one\([^)]*\)/,'function d480_identity_one(process,subject,reference,compare,same)'],[/static bool d480_known_identity\([^)]*\)/,'function d480_known_identity(process,known,refs,compare,mask)'],[/DWORD flags=0/g,'let flags={value:0}'],[/HANDLE copy=nullptr/g,'let copy={value:null}'],[/DWORD error=/g,'const error='],[/BOOL equal=/g,'const equal='],[/bool valid=/g,'let valid='],[/bool closed=/g,'const closed='],[/for\(unsigned i=0/g,'for(let i=0'],[/bool same=false/g,'let same={value:false}'],[/\*same/g,'same.value'],[/\*mask/g,'mask.value'],[/if\(same\)/g,'if(same.value)'],[/&same/g,'same'],[/&copy/g,'copy'],[/&flags/g,'flags'],[/flags&HANDLE_FLAG_INHERIT/g,'flags.value&HANDLE_FLAG_INHERIT'],[/1u<<i/g,'1<<i']]
  for(const [from,to] of replacements)js=js.replace(from,to)
  return api => new Function(...Object.keys(api),js+';const mask={value:0};const valid=d480_known_identity("child",[40,44,48],[100,104,108],CompareObjectHandles,mask);return {valid,mask:mask.value};')(...Object.values(api))
}
const identityFixture=fs.readFileSync(new URL('../../tests/fixtures/desktop-480/native-acceptance.cpp',import.meta.url),'utf8')
function identityScenario(objects,inject={}) {
  const refs=[{}, {}, {}],table=new Map([[100,{object:refs[0]}],[104,{object:refs[1]}],[108,{object:refs[2]}]])
  for(const [slot,kind] of objects)table.set(slot,{object:typeof kind==='number'?refs[kind]:{}})
  let error=0,next=1000,temporary=0,calls=0
  const unwrap=h=>h&&typeof h==='object'&&'value'in h?h.value:h
  const api={FALSE:0,TRUE:1,ERROR_SUCCESS:0,ERROR_INVALID_HANDLE:6,ERROR_NOT_SAME_OBJECT:1656,HANDLE_FLAG_INHERIT:1,WAIT_TIMEOUT:258,
    GetHandleInformation(h,out){h=unwrap(h);if(h==='child'){out.value=0;return !inject.dead}const v=table.get(h);if(!v)return false;out.value=inject.inheritedReference&&h===100?1:0;return !(inject.badRef&&h===100)},
    WaitForSingleObject(){return inject.dead?0:258},GetCurrentProcess(){return 'self'},SetLastError(value){error=value},GetLastError(){return error},
    DuplicateHandle(process,subject,target,out,access,inherit,options){calls++;assert.equal(process,'child');assert.equal(target,'self');assert.equal(access,0);assert.equal(inherit,0);assert.equal(options,0);if(inject.dupError){error=5;return false}if(!table.has(subject)){error=6;return false}out.value=next++;table.set(out.value,table.get(subject));temporary++;return true},
    CompareObjectHandles(a,b){a=unwrap(a);b=unwrap(b);if(a!==b&&inject.compareError){error=5;return false}if(inject.selfCompareFailure&&a===b)return false;const same=table.get(a)?.object===table.get(b)?.object;error=same?0:(inject.differentZero?0:1656);return same},
    CloseHandle(h){assert.ok(table.delete(unwrap(h)));temporary--;return !inject.closeFailure},
  }
  const result=identityFunctions(identityFixture)(api);assert.equal(temporary,0,'temporary duplicate closed on every branch');return {...result,calls}
}
for(const kind of ['Event','File','Pipe'])test(`known input slot reused by different ${kind} is not an original-object leak`,()=>{
  assert.deepEqual(identityScenario([[40,kind],[48,2]]),{valid:true,mask:4,calls:3})
})
for(const [name,objects,mask] of [['positive',[[48,2]],4],['input leak',[[40,0],[48,2]],5],['parent leak',[[44,1],[48,2]],6],['both leak',[[40,0],[44,1],[48,2]],7],['wrong sentinel',[[48,'Event']],0]])test(`exact identity keeps ${name} mask${mask}`,()=>{
  const value=identityScenario(objects);assert.equal(value.valid,true);assert.equal(value.mask,mask)
})
for(const failure of ['badRef','inheritedReference','dead','dupError','compareError','selfCompareFailure','closeFailure'])test(`known-object inspection refuses ${failure} without leaking a temporary copy`,()=>{
  assert.equal(identityScenario([[40,0],[48,2]],{[failure]:true}).valid,false)
})
test('different-object FALSE with zero last-error requires successful valid-handle controls',()=>{
  assert.equal(identityScenario([[40,'Pipe'],[48,2]],{differentZero:true}).mask,4)
  assert.equal(identityScenario([[40,'Pipe'],[48,2]],{differentZero:true,selfCompareFailure:true}).valid,false)
})

function checkerSequence(overrides={}) {
  const start=identityFixture.indexOf('D480Acceptance::CheckerResult D480Acceptance::inheritedChecker('),end=identityFixture.indexOf('\nvoid D480Acceptance::parentCleared',start)
  assert.ok(start>=0&&end>start)
  const whole=identityFixture.slice(start,end),active=whole.slice(whole.indexOf('#ifdef D480_INHERITANCE')+'#ifdef D480_INHERITANCE'.length,whole.indexOf('#else'))
  const owned=active.match(/struct OwnedProcess\{PROCESS_INFORMATION value\{\};bool reaped=false;~OwnedProcess\(\)\{(.*?)\}\} child;/s);assert.ok(owned)
  const cleanup=owned[1]
  let body=active.replace(/std::wstring command=[^\n]+STARTUPINFOW startup\{\};startup.cb=sizeof\(startup\);/,'const command="OWNED";const startup={};').replace(owned[0],'const child={value:{hThread:null,hProcess:null},reaped:false};try{')
  const replacements=[[/binary\.c_str\(\)/g,'binary'],[/command\.data\(\)/g,'command'],[/&startup/g,'startup'],[/&child\.value/g,'child.value'],[/HANDLE known\[3\]=\{oldInput,knownParent,ownedSentinel\}/g,'const known=[40,44,48]'],[/unsigned objects=256/g,'const objects={value:256}'],[/&objects/g,'objects'],[/ULONGLONG elapsed=/g,'let elapsed='],[/\(DWORD\)/g,''],[/DWORD remaining=/g,'const remaining='],[/&result\.raw/g,'result'],[/result.objects=objects/g,'result.objects=objects.value'],[/nullptr/g,'null']]
  for(const [from,to] of replacements)body=body.replace(from,to)
  body+='return result;}finally{const value=child.value,reaped=child.reaped;'+cleanup.replaceAll('nullptr','null')+'}'
  let clockCalls=0,terminated=0,reaped=0,threadClosed=0,processClosed=0,resumed=0
  const api={TRUE:1,FALSE:0,CREATE_SUSPENDED:4,WAIT_TIMEOUT:258,WAIT_OBJECT_0:0,INFINITE:0xffffffff,inheritanceStarted:0,identityRefs:[100,104,108],
    CreateProcessW(binary,command,p,t,inherit,flags,env,cwd,startup,out){assert.equal(inherit,1);assert.equal(flags,4);assert.equal(env,null);assert.equal(cwd,null);if(overrides.createFail)return false;out.hThread='thread';out.hProcess='process';return true},
    d480_identity_api(){return 'ownedCompare'},d480_known_identity(process,known,refs,compare,out){assert.equal(resumed,0);assert.deepEqual(known,[40,44,48]);assert.deepEqual(refs,[100,104,108]);out.value=overrides.mask??4;return !overrides.inspectFail},
    GetTickCount64(){return overrides.expired?20000:++clockCalls},ResumeThread(thread){assert.equal(thread,'thread');resumed++;return overrides.resumeFail?0xffffffff:1},
    WaitForSingleObject(handle,time){assert.equal(handle,'process');if(time===0xffffffff){reaped++;return 0}assert.ok(time<=20000);if(overrides.timeout)return 258;reaped++;return 0},
    GetExitCodeProcess(handle,out){out.raw=overrides.raw??4;return !overrides.exitReadFail},TerminateProcess(handle,code){assert.equal(handle,'process');assert.equal(code,251);terminated++;return true},
    CloseHandle(h){if(h==='thread')threadClosed++;else if(h==='process')processClosed++;else assert.fail('unknown cleanup handle');return true},
  }
  const result=new Function(...Object.keys(api),'binary','role','const result={raw:255,objects:256,valid:false};'+body)(...Object.values(api),'OWNED.exe','--descendant')
  if(!overrides.createFail){assert.equal(threadClosed,1);assert.equal(processClosed,1);assert.equal(reaped,1)}else{assert.equal(threadClosed,0);assert.equal(processClosed,0)}
  return {result,terminated,resumed}
}
test('actual inheritedChecker source resumes once, preserves raw values and reaps its process',()=>{
  for(const raw of [0,4,5,7,240,251,259]){
    const value=checkerSequence({raw});assert.equal(value.resumed,1);assert.equal(value.terminated,0);assert.equal(value.result.raw,raw);assert.equal(value.result.valid,raw<=7)
  }
})
for(const fault of ['createFail','inspectFail','expired','resumeFail','timeout','exitReadFail'])test(`actual inheritedChecker source ${fault} cannot authorize and closes owned handles`,()=>{
  const value=checkerSequence({[fault]:true});assert.equal(value.result.valid,false)
  if(['inspectFail','expired','resumeFail','timeout'].includes(fault))assert.equal(value.terminated,1)
})
test('acceptance variant keeps exact production bytes and releases refs on bootstrap early exit', async()=>{
  const {desktopAcceptanceVariant}=await import('../build-desktop-windows.mjs')
  const original=fs.readFileSync(new URL('../../src/desktop/native/DesktopHost.cpp',import.meta.url),'utf8')
  const value=desktopAcceptanceVariant('cpp',original,identityFixture)
  assert.equal(value.inverse,original)
  assert.ok(value.source.includes('HANDLE input=bootstrap.pipe;D480Acceptance::InheritanceScope identityScope;D480Acceptance::preConsume(input);'))
  assert.ok(identityFixture.includes('~InheritanceScope(){D480Acceptance::closeReferences();'))
  assert.ok(identityFixture.includes('if(!CloseHandle(reference)){checkerPositive=false;descendantDenied=false;}'))
  assert.ok(identityFixture.includes('checkerPositive=result.valid&&result.raw==4&&result.objects==4'))
  assert.ok(identityFixture.includes('descendantDenied=result.valid&&result.objects==4'))
  assert.ok(identityFixture.includes('inputWasClosed&&parentWasCleared&&descendantDenied&&checkerPositive'))
})

function referenceCapture(fault) {
  const begin=identityFixture.indexOf('bool D480Acceptance::captureReference('),end=identityFixture.indexOf('\nvoid D480Acceptance::closeReferences',begin)
  const whole=identityFixture.slice(begin,end),branch=whole.slice(whole.indexOf('#ifdef D480_INHERITANCE')+'#ifdef D480_INHERITANCE'.length,whole.indexOf('#else'))
  const body=branch.replace('D480Compare compare=d480_identity_api();HANDLE reference=nullptr;DWORD flags=0;','const compare=d480_identity_api();const reference={value:null};const flags={value:0};').replaceAll('&flags','flags').replaceAll('&reference','reference').replaceAll('flags&HANDLE_FLAG_INHERIT','flags.value&HANDLE_FLAG_INHERIT').replace('identityRefs[index]=reference','identityRefs[index]=reference.value')
  const refs=[null,null,null];let closed=0,duplicates=0
  const api={FALSE:0,HANDLE_FLAG_INHERIT:1,identityRefs:refs,
    d480_identity_api(){return fault==='missingAPI'?null:(a,b)=>fault!=='compareFailure'},
    GetHandleInformation(h,out){out.value=fault==='inheritableRef'&&typeof h==='object'?1:0;return fault!=='unknownSubject'},GetCurrentProcess(){return 'self'},
    DuplicateHandle(source,subject,target,out,access,inherit,options){assert.equal(source,'self');assert.equal(target,'self');assert.equal(access,0);assert.equal(inherit,0);assert.equal(options,0);duplicates++;if(fault==='duplicateFailure')return false;out.value='noninheritReference';return true},
    CloseHandle(h){assert.equal(h.value,'noninheritReference');closed++;return true},
  }
  const result=new Function(...Object.keys(api),'subject','index',body)(...Object.values(api),'liveOriginal',fault==='badIndex'?3:0)
  return {result,closed,duplicates,refs}
}
test('actual captureReference captures a live original with zero access and never marks its reference inheritable',()=>{
  assert.deepEqual(referenceCapture('none'),{result:true,closed:0,duplicates:1,refs:['noninheritReference',null,null]})
})
for(const fault of ['missingAPI','unknownSubject','duplicateFailure','inheritableRef','compareFailure','badIndex'])test(`actual captureReference ${fault} refuses without retaining a partial reference`,()=>{
  const value=referenceCapture(fault);assert.equal(value.result,false);assert.deepEqual(value.refs,[null,null,null]);assert.equal(value.closed,['inheritableRef','compareFailure'].includes(fault)?1:0)
})
for(const lineEnding of ['LF','CRLF'])test(`actual closeReferences is idempotent and cleanup error cannot leave success checks true (${lineEnding})`,()=>{
  const fixture=identityFixture.replace(/\r\n/g,'\n').replace(/\n/g,lineEnding==='CRLF'?'\r\n':'\n')
  const start=fixture.indexOf('void D480Acceptance::closeReferences(){'),end=fixture.indexOf('\nD480Acceptance::CheckerResult',start)
  const source=fixture.slice(start,end)
  const body=source.slice(source.indexOf('{')+1,source.lastIndexOf('}')).replace('for(HANDLE& reference:identityRefs){','for(let i=0;i<identityRefs.length;i++){let reference=identityRefs[i];').replace('reference=nullptr;','reference=null;identityRefs[i]=reference;')
  for(const fail of [false,true]){
    const identityRefs=[100,104,108];let calls=0
    const invoke=new Function('identityRefs','CloseHandle','let checkerPositive=true,descendantDenied=true;'+body+';return {checkerPositive,descendantDenied};')
    const close=()=>{calls++;return !fail};const value=invoke(identityRefs,close);assert.deepEqual(identityRefs,[null,null,null]);assert.equal(calls,3);assert.equal(value.checkerPositive,!fail);assert.equal(value.descendantDenied,!fail)
    invoke(identityRefs,close);assert.equal(calls,3)
  }
})


// Frame2.ExecuteScript before ContentLoading is documented to return null without
// running the script. These are source/event-guard contracts, not native timing.
function frameCallbackBody650(source,signature){
 const start=source.indexOf(signature);if(start<0)return undefined
 const open=source.indexOf('{',start);let depth=0,quoted=false,escaped=false
 for(let i=open;i<source.length;i++){const c=source[i];if(quoted){if(escaped)escaped=false;else if(c.charCodeAt(0)===92)escaped=true;else if(c==='"')quoted=false;continue}if(c==='"'){quoted=true;continue}if(c==='{')depth++;else if(c==='}'&&--depth===0)return source.slice(open+1,i)}
 assert.fail('complete actual C++ callback required')
}
function frameClosures650(){
 const source=fs.readFileSync(new URL('../../tests/fixtures/desktop-480/native-acceptance.cpp',import.meta.url),'utf8')
 const created=frameCallbackBody650(source,'Callback<ICoreWebView2FrameCreatedEventHandler>(');assert.ok(created)
 const loaded=frameCallbackBody650(created,'Callback<ICoreWebView2FrameDOMContentLoadedEventHandler>(');assert.ok(loaded,'frame script must wait for the documented document event')
 return {created,loaded}
}
test('hostile frame script waits for DOMContentLoaded instead of executing in FrameCreated',()=>{
 const {created,loaded}=frameClosures650()
 assert.ok(created.includes('bridge->add_DOMContentLoaded('))
 assert.ok(loaded.includes('current->ExecuteScript('))
 assert.equal(created.replace(loaded,'').includes('->ExecuteScript('),false)
 assert.ok(created.indexOf('bridge->add_WebMessageReceived(')<created.indexOf('bridge->add_DOMContentLoaded('))
})
test('actual frame document callback guard dispatches once and only in the original hostile phase',()=>{
 const {loaded}=frameClosures650(),end=loaded.indexOf('ComPtr<ICoreWebView2Frame>');assert.ok(end>0)
 const prefix=loaded.slice(0,end).replaceAll('*attempted','attempted.value').replaceAll('S_OK','0')
 const advance=new Function('phase','attempted','h','frameGeneration',prefix+';return 1;')
 const state={value:false};assert.equal(advance(1,state,{generation:'owned-document'},'owned-document'),1);assert.equal(advance(1,state,{generation:'owned-document'},'owned-document'),0)
 for(const phase of [0,2,3,4,5,6,7]){const fresh={value:false};assert.equal(advance(phase,fresh,{generation:'owned-document'},'owned-document'),0);assert.equal(fresh.value,false)}
 const stale={value:false};assert.equal(advance(1,stale,{generation:'new-document'},'old-document'),0);assert.equal(stale.value,false)
})
test('frame document work uses the event sender and retains fixed callback failure refusals',()=>{
 const {created,loaded}=frameClosures650()
 assert.ok(loaded.includes('ComPtr<ICoreWebView2Frame> currentFrame=sender;'))
 assert.ok(loaded.includes('FAILED(currentFrame.As(&current))'))
 assert.ok(loaded.includes('FAIL_FRAME_NOT_OBSERVED'))
 assert.ok(created.includes('if(FAILED(loading))emit(h,L"FAIL_ENGINE_API")'))
 assert.doesNotMatch(loaded,/Sleep[(]|SetForegroundWindow|SendInput|LoadLibrary|http:/)
})

// #705 case36 sentinel identity: current-process numeric occupancy is not inheritance.
function sentinelSource705(){return fs.readFileSync(new URL('../../tests/fixtures/desktop-480/windows-inheritance.c',import.meta.url),'utf8')}
function sentinelPredicate705(source=sentinelSource705()){
 const extract=(signature)=>{const start=source.indexOf(signature);assert.ok(start>=0,signature);const open=source.indexOf('{',start);let depth=0;for(let i=open;i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)return source.slice(open+1,i)}assert.fail('whole actual C function')}
 if(!source.includes('static int fixture_sentinel_same(')){
  const body=extract('static unsigned fixture_mask(').replace(/\bunsigned /g,'let ').replace(/\bDWORD /g,'let ').replace('&flags','flags').replace('1u<<i','1<<i')
  const old=new Function('known','GetHandleInformation',body);return api=>!!(old([40,44,48],api.GetHandleInformation)&4)
 }
 let body=extract('static int fixture_sentinel_same(')
 const declarations='typedef BOOL (WINAPI *FixtureCompare)(HANDLE,HANDLE);';assert.ok(body.includes(declarations));body=body.replace(declarations,'')
 const size='_Static_assert(sizeof(compare)==sizeof(raw),"fixed Win32 function pointer size");';assert.ok(body.includes(size));body=body.replace(size,'').replace('memcpy(&compare,&raw,sizeof(compare));','compare=raw;')
 const replacements=[[/HANDLE candidate=NULL,reference=NULL;/,'let candidate={value:null},reference=null;'],[/int result=-1;/,'let result=-1;'],[/HMODULE module=/,'const module='],[/FARPROC raw=/,'const raw='],[/FixtureCompare compare=NULL;/,'let compare=null;'],[/DWORD flags=0;/,'let flags={value:0};'],[/BOOL captured=/,'const captured='],[/DWORD captureError=/,'const captureError='],[/BOOL equal=/,'const equal='],[/DWORD error=/,'const error='],[/&candidate/g,'candidate'],[/&flags/g,'flags'],[/flags&HANDLE_FLAG_INHERIT/g,'flags.value&HANDLE_FLAG_INHERIT'],[/\bcandidate=NULL/g,'candidate.value=null'],[/!candidate\b/g,'!candidate.value'],[/candidate==INVALID_HANDLE_VALUE/g,'candidate.value==INVALID_HANDLE_VALUE'],[/GetHandleInformation\(candidate,/g,'GetHandleInformation(candidate.value,'],[/compare\(candidate,candidate\)/g,'compare(candidate.value,candidate.value)'],[/compare\(candidate,reference\)/g,'compare(candidate.value,reference)'],[/if\(candidate&&/g,'if(candidate.value&&'],[/CloseHandle\(candidate\)/g,'CloseHandle(candidate.value)'],[/\bNULL\b/g,'null'],[/\bL"/g,'"']]
 for(const [from,to]of replacements)body=body.replace(from,to)
 return api=>new Function(...Object.keys(api),'subject',body)(...Object.values(api),48)
}
function sentinelScenario705(kind,inject={}){
 const sentinel={},other={},table=new Map();if(kind!=='empty')table.set(48,{object:kind==='same'?sentinel:other,type:kind==='pipe'?'Pipe':'Event'})
 let error=0,next=100,opened=0,duplicates=0,closed=0;const trace=[],temporary=new Set(),unwrap=h=>h&&typeof h==='object'&&'value'in h?h.value:h
 const compare=(a,b)=>{a=unwrap(a);b=unwrap(b);trace.push('compare');if(inject.compareFailure&&a!==b){error=5;return false}if(inject.selfFailure&&a===b)return false;const same=table.get(a)?.object===table.get(b)?.object;error=same||inject.differentZero?0:1656;return same}
 const api={FALSE:0,TRUE:1,NULL:null,INVALID_HANDLE_VALUE:-1,ERROR_SUCCESS:0,ERROR_INVALID_HANDLE:6,ERROR_NOT_SAME_OBJECT:1656,HANDLE_FLAG_INHERIT:1,SYNCHRONIZE:0x100000,fixture_event_name:'Local\\cmspark-d480-sentinel-0123456789abcdef0123456789abcdef',
  GetModuleHandleW:name=>{assert.equal(name,'kernelbase.dll');return inject.missingAPI?null:'fixed-kernelbase'},GetProcAddress:(m,name)=>{assert.equal(name,'CompareObjectHandles');return compare},GetCurrentProcess:()=> 'self',GetLastError:()=>error,SetLastError:v=>error=v,
  DuplicateHandle(from,subject,to,out,access,inherit,options){trace.push('duplicate');assert.equal(from,'self');assert.equal(to,'self');assert.equal(subject,48);assert.equal(access,0);assert.equal(inherit,0);assert.equal(options,0);duplicates++;if(inject.duplicateFailure){error=5;return false}if(!table.has(subject)){error=6;return false}const id=next++;out.value=id;table.set(id,table.get(subject));temporary.add(id);return true},
  OpenEventW(access,inherit,name){trace.push('open');assert.equal(access,0x100000);assert.equal(inherit,0);assert.equal(name,api.fixture_event_name);opened++;if(inject.missingReference)return null;const id=inject.reuseKnownSlot?48:next++;table.set(id,{object:sentinel,type:'Event'});temporary.add(id);return id},
  GetHandleInformation(h,out){h=unwrap(h);const value=table.get(h);if(out&&typeof out==='object')out.value=inject.inheritedTemporary?1:0;return !!value&&!inject.invalidReference},
  CloseHandle(h){h=unwrap(h);trace.push('close');assert.ok(temporary.delete(h),'close only an owned temporary reference');table.delete(h);closed++;return !inject.closeFailure},
 }
 const raw=sentinelPredicate705()(api);assert.equal(temporary.size,0);return{raw,opened,duplicates,closed,trace}
}
for(const kind of ['Event','pipe'])test(`705 exact sentinel refuses true inheritance but accepts reused unrelated ${kind} slot`,()=>{
 const reused=sentinelScenario705(kind);assert.equal(Number(reused.raw),0);assert.equal(Number(sentinelScenario705('same').raw),1)
})
test('705 candidate capture precedes reference lookup even when lookup reuses the known numeric slot',()=>{
 const r=sentinelScenario705('empty',{reuseKnownSlot:true});assert.equal(Number(r.raw),0);assert.equal(r.duplicates,1);assert.equal(r.opened,1);assert.ok(r.trace.indexOf('duplicate')<r.trace.indexOf('open'));assert.equal(r.closed,1)
})
test('705 sentinel identity failures are unknown and close only exact temporary handles',()=>{
 for(const fault of ['missingAPI','missingReference','duplicateFailure','invalidReference','compareFailure','selfFailure','inheritedTemporary','closeFailure'])assert.equal(sentinelScenario705('Event',{[fault]:true}).raw,-1,fault)
 assert.equal(sentinelScenario705('Event',{differentZero:true}).raw,0)
})
test('705 fixture keeps legacy V1 checker but requires explicit unknown refusal for V2 identity',()=>{
 const s=sentinelSource705();assert.match(s,/D480_OWNED_HANDLES_V2/);assert.match(s,/D480_OWNED_HANDLES_V1/);assert.ok(s.includes('if(!fixture_event_name[0])return fixture_mask(known);'));assert.ok(s.includes('if(observed>7u)goto done;'));assert.ok(s.includes('(observed&4u)||!d480_client_finish(&bootstrap,parent)'))
 assert.ok(s.includes('OpenEventW(SYNCHRONIZE,FALSE,fixture_event_name)'));assert.ok(s.includes('ERROR_ALREADY_EXISTS'));assert.ok(s.includes('BCryptGenRandom'));assert.doesNotMatch(s,/OpenProcess\(.*PROCESS_ALL_ACCESS|NtQuerySystemInformation|GetProcessId\(candidate/)
 const build=fs.readFileSync(new URL('../build-desktop-windows.mjs',import.meta.url),'utf8');assert.match(build,/DESKTOP_FIXTURE_ADDON/);assert.match(build,/"bcrypt.lib"/);assert.doesNotMatch(build,/Kernelbase.lib|OneCore.lib/)
})

// Case36: run complete actual C observer bodies against inert process/object tables.
// This is a source control, never a Windows process, compiler or native binding.
function siblingSource480() { return fs.readFileSync(new URL('../../tests/fixtures/desktop-480/windows-inheritance.c', import.meta.url), 'utf8') }
function siblingFunction480(source, signature) {
  const start=source.indexOf(signature);assert.ok(start>=0,`actual case36 function ${signature}`)
  const open=source.indexOf('{',start);let depth=0
  for(let i=open;i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)return source.slice(open+1,i)}
  assert.fail('complete case36 C function')
}
function siblingFunctions480(source=siblingSource480()) {
  const signatures={fixture_identity_one:'static int fixture_identity_one(',fixture_known_identity:'static int fixture_known_identity(',fixture_capture_refs:'static int fixture_capture_refs(',fixture_close_refs:'static int fixture_close_refs('}
  const args={fixture_identity_one:'process,subject,reference,compare,same',fixture_known_identity:'process,known,refs,compare,mask',fixture_capture_refs:'refs,compare',fixture_close_refs:'refs'}
  const translate=(body)=>body
    .replace(/DWORD flags=0/g,'let flags={value:0}')
    .replace(/HANDLE copy=NULL/g,'let copy={value:null}')
    .replace(/\b(?:DWORD|BOOL|int|unsigned|HANDLE) /g,'let ')
    .replace(/&refs\[i\]/g,'({get value(){return refs[i]},set value(v){refs[i]=v}})')
    .replace(/&same/g,'same').replace(/&copy/g,'copy').replace(/&flags/g,'flags')
    .replace(/\*same/g,'same.value').replace(/\*mask/g,'mask.value')
    .replace(/let same=0/g,'let same={value:0}').replace(/if\(same\)/g,'if(same.value)')
    .replace(/flags&HANDLE_FLAG_INHERIT/g,'flags.value&HANDLE_FLAG_INHERIT')
    .replace(/1u<<i/g,'1<<i').replace(/\bNULL\b/g,'null')
  const functions=Object.entries(signatures).map(([name,signature])=>`function ${name}(${args[name]}){${translate(siblingFunction480(source,signature))}}`).join('\n')
  return api=>new Function(...Object.keys(api),functions+';return {fixture_identity_one,fixture_known_identity,fixture_capture_refs,fixture_close_refs};')(...Object.values(api))
}
function siblingIdentityScenario480(objects,inject={}) {
  const originals=[{},{},{}], table=new Map([[100,{object:originals[0]}],[104,{object:originals[1]}],[108,{object:originals[2]}]])
  for(const [slot,kind]of objects)table.set(slot,{object:typeof kind==='number'?originals[kind]:{}})
  let error=0,next=1000;const temporary=new Set(),trace=[]
  const unwrap=h=>h&&typeof h==='object'&&'value'in h?h.value:h
  const api={FALSE:0,TRUE:1,ERROR_SUCCESS:0,ERROR_INVALID_HANDLE:6,ERROR_NOT_SAME_OBJECT:1656,HANDLE_FLAG_INHERIT:1,WAIT_TIMEOUT:258,
    GetCurrentProcess:()=> 'self',SetLastError:v=>{error=v},GetLastError:()=>error,
    GetHandleInformation(h,out){h=unwrap(h);out.value=inject.inheritedReference&&h===100?1:0;if(h==='child')return !inject.dead;return table.has(h)&&!(inject.badReference&&h===100)},
    WaitForSingleObject(h,time){assert.equal(h,'child');assert.equal(time,0);return inject.dead?0:258},
    DuplicateHandle(from,subject,to,out,access,inherit,options){trace.push('duplicate');assert.equal(from,'child');assert.equal(to,'self');assert.deepEqual([access,inherit,options],[0,0,0]);if(inject.duplicateFailure){error=5;return false}if(!table.has(subject)){error=6;return false}out.value=next++;table.set(out.value,table.get(subject));temporary.add(out.value);return true},
    CompareObjectHandles(a,b){a=unwrap(a);b=unwrap(b);if(inject.selfFailure&&a===b)return false;if(inject.compareFailure&&a!==b){error=5;return false}const same=table.get(a)?.object===table.get(b)?.object;error=same||inject.differentZero?0:1656;return same},
    CloseHandle(h){h=unwrap(h);trace.push('close');assert.ok(temporary.delete(h));table.delete(h);return !inject.closeFailure},
  }
  const source=siblingSource480(),mask={value:0};let valid
  if(!source.includes('static int fixture_identity_one(')){
    // Same new counterexample against the actual old producer, not a fabricated old algorithm.
    const body=siblingFunction480(source,'static unsigned fixture_mask(').replace(/\b(?:unsigned|DWORD) /g,'let ').replace('let flags=0','let flags={value:0}').replace('&flags','flags').replace('1u<<i','1<<i')
    mask.value=new Function('known','GetHandleInformation',body)([40,44,48],api.GetHandleInformation);valid=true
  }else{const functions=siblingFunctions480(source)(api);valid=functions.fixture_known_identity('child',[40,44,48],[100,104,108],inject.missingAPI?null:api.CompareObjectHandles,mask)}
  assert.equal(temporary.size,0,'every acquired identity copy receives cleanup')
  return {valid:!!valid,mask:mask.value,trace}
}
for(const [raw,objects]of [[5,[[40,'Event'],[48,2]]],[6,[[44,'Process'],[48,2]]],[7,[[40,'Pipe'],[44,'Process'],[48,2]]]])test(`case36 actual C: unrelated numeric mask${raw} has protected-object mask4`,()=>{
  const result=siblingIdentityScenario480(objects);assert.equal(result.valid,true);assert.equal(result.mask,4)
})
for(const [name,objects,mask]of [['sentinel',[[48,2]],4],['input',[[40,0],[48,2]],5],['parent',[[44,1],[48,2]],6],['both',[[40,0],[44,1],[48,2]],7],['missing sentinel',[],0],['different sentinel',[[48,'Event']],0]])test(`case36 actual C: ${name} preserves exact object mask${mask}`,()=>{
  const result=siblingIdentityScenario480(objects);assert.equal(result.valid,true);assert.equal(result.mask,mask)
})
for(const failure of ['missingAPI','badReference','inheritedReference','dead','duplicateFailure','compareFailure','selfFailure','closeFailure'])test(`case36 actual C: ${failure} is unknown, never protected absence`,()=>{
  assert.equal(siblingIdentityScenario480([[40,0],[48,2]],{[failure]:true}).valid,false)
})
test('case36 actual C: different-object zero error needs successful self controls',()=>{
  assert.equal(siblingIdentityScenario480([[40,'Pipe'],[48,2]],{differentZero:true}).mask,4)
  assert.equal(siblingIdentityScenario480([[40,'Pipe'],[48,2]],{differentZero:true,selfFailure:true}).valid,false)
})
function siblingReferences480(fault='none') {
  const refs=[null,null,null],originals=[40,44,48],table=new Map(originals.map((h,i)=>[h,{object:i}]));let next=100,duplicates=0;const closed=[],live=new Set()
  const api={FALSE:0,INVALID_HANDLE_VALUE:-1,HANDLE_FLAG_INHERIT:1,fixture_known:originals,GetCurrentProcess:()=> 'self',
    GetHandleInformation(h,out){out.value=fault==='inheritedReference'&&h>=100?1:0;return table.has(h)&&!(fault==='missingOriginal'&&h===44)},
    DuplicateHandle(from,h,to,out,access,inherit,options){assert.deepEqual([from,to,access,inherit,options],['self','self',0,0,0]);duplicates++;if(fault==='partialDuplicate'&&duplicates===2)return false;out.value=next++;table.set(out.value,table.get(h));live.add(out.value);return true},
    CloseHandle(h){assert.ok(live.delete(h),'only acquired references are closed once');closed.push(h);table.delete(h);return fault!=='closeFailure'},
  }
  const compare=(a,b)=>fault!=='selfFailure'||a!==b?table.get(a)?.object===table.get(b)?.object:false
  const fn=siblingFunctions480()(api),captured=fn.fixture_capture_refs(refs,fault==='missingAPI'?null:compare),cleaned=fn.fixture_close_refs(refs)
  assert.deepEqual(refs,[null,null,null]);assert.equal(live.size,0)
  const again=fn.fixture_close_refs(refs);assert.equal(again,1)
  return {captured:!!captured,cleaned:!!cleaned,duplicates,closed:closed.length}
}
test('case36 actual C: three zero-access parent references remain noninheritable and close exactly once',()=>{
  assert.deepEqual(siblingReferences480(),{captured:true,cleaned:true,duplicates:3,closed:3})
})
for(const fault of ['missingAPI','missingOriginal','partialDuplicate','inheritedReference','selfFailure'])test(`case36 actual C: ${fault} cleans partial references without admission`,()=>{
  assert.equal(siblingReferences480(fault).captured,false)
})
test('case36 actual C: reference close failure cannot report successful cleanup',()=>{assert.equal(siblingReferences480('closeFailure').cleaned,false)})
function siblingChecker480(inject={}) {
  let body=siblingFunction480(siblingSource480(),'static FixtureCheckerResult fixture_checker(')
  const fixed='FixtureCheckerResult result={255,256,0};';assert.ok(body.includes(fixed));body=body.replace(fixed,'const result={raw:255,objects:256,valid:0};')
  body=body.replace('wchar_t command[32768];STARTUPINFOW startup;PROCESS_INFORMATION pi;','const command={};const startup={};const pi={hThread:null,hProcess:null};')
    .replace('HANDLE refs[3]={NULL,NULL,NULL};','const refs=[null,null,null];')
    .replace('unsigned objects=256;','const objects={value:256};')
    .replace('wchar_t *environment=NULL;','let environment=null;')
    .replace('FixtureCompare compare=NULL;','let compare=null;')
    .replace('_Static_assert(sizeof(compare)==sizeof(raw),"fixed Win32 function pointer size");memcpy(&compare,&raw,sizeof(compare));','compare=raw;')
    .replace('memset(&startup,0,sizeof(startup));memset(&pi,0,sizeof(pi));startup.cb=sizeof(startup);','startup.cb=1;')
    .replace(/\b(?:int|ULONGLONG|DWORD|HMODULE|FARPROC) /g,'let ')
    .replace('&startup','startup').replace('&pi','pi').replace('&objects','objects')
    .replace('&result.raw','({get value(){return result.raw},set value(v){result.raw=v}})')
    .replace('result.objects=objects','result.objects=objects.value')
    .replace(/\(DWORD\)/g,'').replace(/\bNULL\b/g,'null').replace(/\bL"/g,'"').replace(/\bL'/g,"'")
  const first=body.indexOf('if(wcschr('),done=body.indexOf('\ndone:');assert.ok(first>=0&&done>first)
  body=body.slice(0,first)+'work:{'+body.slice(first,done).replaceAll('goto done;','break work;')+'}'+body.slice(done+'\ndone:'.length)
  let ticks=0,resumed=0,terminated=0,waited=0;const trace=[],live=new Set();const compare=()=>true
  const api={FALSE:0,TRUE:1,CREATE_UNICODE_ENVIRONMENT:1024,CREATE_SUSPENDED:4,WAIT_OBJECT_0:0,INFINITE:0xffffffff,FIXTURE_BUDGET:20000,fixture_started:100,fixture_known:[40,44,48],
    GetModuleHandleW:n=>{assert.equal(n,'kernelbase.dll');return inject.missingAPI?null:'module'},GetProcAddress:(m,n)=>{assert.equal(n,'CompareObjectHandles');return compare},
    wcschr:()=>!!inject.badPath,swprintf_s:()=>inject.badFormat?-1:1,
    fixture_capture_refs(refs,cmp){trace.push('capture');if(!cmp||inject.captureFailure)return 0;for(let i=0;i<3;i++){refs[i]=100+i;live.add(refs[i])}return 1},
    host_environment(){trace.push('environment');if(inject.environmentFailure)return null;live.add('environment');return 'environment'},free(value){assert.ok(live.delete(value));trace.push('free')},
    CreateProcessW(binary,command,p,t,inherit,flags,environment,cwd,startup,pi){trace.push('create');assert.equal(binary,'owned.exe');assert.equal(inherit,1);assert.equal(flags,1028);assert.equal(environment,'environment');assert.equal(cwd,null);if(inject.createFailure)return false;pi.hThread='thread';pi.hProcess='child';live.add('thread');live.add('child');return true},
    fixture_known_identity(child,known,refs,cmp,objects){trace.push('inspect');assert.equal(child,'child');assert.equal(resumed,0);assert.deepEqual(known,[40,44,48]);assert.deepEqual(refs,[100,101,102]);assert.equal(cmp,compare);objects.value=inject.objects??4;return !inject.inspectFailure},
    GetTickCount64(){return inject.expired?20100:101+ticks++},ResumeThread(thread){assert.equal(thread,'thread');trace.push('resume');resumed++;return inject.resumeFailure?0xffffffff:1},
    WaitForSingleObject(child,time){assert.equal(child,'child');trace.push(time===0xffffffff?'reap':'wait');waited++;if(time===0xffffffff)return inject.reapFailure?258:0;assert.ok(time>=0&&time<20000,'remaining original cumulative budget');return inject.timeout?258:0},
    GetExitCodeProcess(child,out){assert.equal(child,'child');trace.push('exit');if(inject.exitFailure)return false;out.value=inject.raw??4;return true},
    TerminateProcess(child,code){assert.equal(child,'child');assert.equal(code,251);trace.push('terminate');terminated++;return !inject.terminateFailure},
    CloseHandle(h){assert.ok(live.delete(h),'owned process/thread closed once');trace.push('close:'+h);return !(inject.threadCloseFailure&&h==='thread'||inject.processCloseFailure&&h==='child')},
    fixture_close_refs(refs){for(let i=0;i<3;i++)if(refs[i]!==null){assert.ok(live.delete(refs[i]));refs[i]=null}trace.push('close:refs');return !inject.refsCloseFailure},
  }
  const result=new Function(...Object.keys(api),'binary','role',body)(...Object.values(api),'owned.exe','--sibling')
  assert.equal(live.size,0,'all successfully acquired modeled resources get one cleanup attempt')
  if(trace.includes('inspect'))assert.ok(trace.indexOf('create')<trace.indexOf('inspect'))
  if(trace.includes('resume'))assert.ok(trace.indexOf('inspect')<trace.indexOf('resume'))
  return {result,trace,resumed,terminated,waited}
}
test('case36 actual C: suspended object inspection precedes one resume and preserves every raw completion mask',()=>{
  for(const raw of [0,1,2,3,4,5,6,7,240,243,251,259]){const r=siblingChecker480({raw});assert.equal(r.resumed,1);assert.equal(r.terminated,0);assert.equal(r.result.raw,raw);assert.equal(!!r.result.valid,raw<=7);assert.equal(r.result.objects,raw<=7?4:256)}
})
for(const fault of ['badPath','badFormat','missingAPI','captureFailure','environmentFailure','createFailure','inspectFailure','expired','resumeFailure','timeout','exitFailure','threadCloseFailure','processCloseFailure','refsCloseFailure'])test(`case36 actual C: ${fault} cannot publish an identity proof`,()=>{
  const r=siblingChecker480({[fault]:true});assert.equal(r.result.valid,0);assert.equal(r.result.objects,256)
  if(['inspectFailure','expired','resumeFailure','timeout'].includes(fault))assert.equal(r.terminated,1)
})
for(const fault of ['terminateFailure','reapFailure'])test(`case36 actual C: ${fault} preserves refusal and all cleanup attempts`,()=>{
  const r=siblingChecker480({inspectFailure:true,[fault]:true});assert.equal(r.result.valid,0);assert.equal(r.result.objects,256);assert.equal(r.terminated,1)
})
test('case36 actual C: kernel-object leak masks reach the consumer without being cleared',()=>{
  for(const objects of [5,6,7,0])assert.deepEqual(siblingChecker480({objects,raw:4}).result,{raw:4,objects,valid:1})
})
test('case36 actual N-API producer publishes both identity values separately from raw exit masks',()=>{
  const source=siblingSource480(),body=siblingFunction480(source,'static napi_value fixture_inspect(')
  const bindings=[...body.matchAll(/napi_(get_boolean|create_uint32)\(env,(\w+),&value\);napi_set_named_property\(env,object,"([a-z_]+)",value\);/g)].map(m=>({kind:m[1],variable:m[2],field:m[3]}))
  assert.equal(bindings.length,5);assert.equal(new Set(bindings.map(x=>x.field)).size,5)
  const inputs={fixture_sidecar_ok:true,fixture_control:4,fixture_sibling:5,fixture_control_identity:4,fixture_sibling_identity:4}
  const value=Object.fromEntries(bindings.map(({variable,field})=>{assert.ok(Object.hasOwn(inputs,variable));return[field,inputs[variable]]}))
  assert.deepEqual(value,{sidecar_valid:true,control_mask:4,sibling_mask:5,control_identity_mask:4,sibling_identity_mask:4})
  const create=siblingFunction480(source,'static BOOL WINAPI fixture_create(')
  assert.ok(create.includes('fixture_control=control.raw;fixture_sibling=sibling.raw;'))
  assert.ok(create.includes('fixture_control_identity=control.valid?control.objects:256;'))
  assert.ok(create.includes('fixture_sibling_identity=sibling.valid?sibling.objects:256;'))
  assert.ok(create.includes('return CreateProcessW(app,command,process,thread,inherit,flags,environment,cwd,startup,pi);'))
})

// Actual /W4 /WX failure C4456: V2 text must not hide the module-path buffer.
test('705 actual V2 sidecar reader keeps module path and event text in distinct local names',()=>{
 const s=sentinelSource705(),a=s.indexOf('static int fixture_read_known(HANDLE known[3]) {'),b=s.indexOf('static unsigned fixture_mask',a);assert.ok(a>=0&&b>a);const body=s.slice(a,b);
 const outer=/wchar_t ([A-Za-z_][A-Za-z0-9_]*)\[32768\]; DWORD n=GetModuleFileNameW\(NULL,\1,32768\)/.exec(body),inner=/char ([A-Za-z_][A-Za-z0-9_]*)\[96\]=\{0\}/.exec(body);assert.ok(outer&&inner,'actual two buffer declarations');assert.notEqual(outer[1],inner[1],'V2 inner local must not shadow outer module path under /W4 /WX');
 assert.ok(body.includes('wcscat_s('+outer[1]+',32768,L".handles")'));assert.ok(body.includes('CreateFileW('+outer[1]+',GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,NULL)'));
});
