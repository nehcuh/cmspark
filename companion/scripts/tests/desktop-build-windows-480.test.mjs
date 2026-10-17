import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DESKTOP_WINDOWS_INPUTS, prepareDesktopNodeHeaders, extractDesktopSdk, desktopWindowsCompilePlan } from '../build-desktop-windows.mjs'

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
  // Evaluate only the two actual argv expressions; never invoke a compiler.
  const calls=[...helperSource.matchAll(/checked\(cl,(\["\/nologo","\/std:c\+\+20"[^\n]+?\]),\{env,cwd:output,buildDiagnostic:true\}\)/g)]
  assert.equal(calls.length,2,'all actual native acceptance compile sites')
  for(const match of calls) for(const mode of ['visual','hostile','inheritance','parent']) {
    const argv=new Function('path','mode','sdk','generated','root','source','mcpSource','binary','mcpBinary',`return ${match[1]}`)(path.win32,mode,'C:\\sdk','C:\\generated','C:\\repo','C:\\owned.cpp','C:\\owned-mcp.cpp','C:\\owned.exe','C:\\owned-mcp.exe')
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
test('actual closeReferences is idempotent and cleanup error cannot leave success checks true',()=>{
  const start=identityFixture.indexOf('void D480Acceptance::closeReferences(){'),end=identityFixture.indexOf('\nD480Acceptance::CheckerResult',start)
  const source=identityFixture.slice(start,end)
  const body=source.slice(source.indexOf('{')+1,-1).replace('for(HANDLE& reference:identityRefs){','for(let i=0;i<identityRefs.length;i++){let reference=identityRefs[i];').replace('reference=nullptr;','reference=null;identityRefs[i]=reference;')
  for(const fail of [false,true]){
    const identityRefs=[100,104,108];let calls=0
    const invoke=new Function('identityRefs','CloseHandle','let checkerPositive=true,descendantDenied=true;'+body+';return {checkerPositive,descendantDenied};')
    const close=()=>{calls++;return !fail};const value=invoke(identityRefs,close);assert.deepEqual(identityRefs,[null,null,null]);assert.equal(calls,3);assert.equal(value.checkerPositive,!fail);assert.equal(value.descendantDenied,!fail)
    invoke(identityRefs,close);assert.equal(calls,3)
  }
})
