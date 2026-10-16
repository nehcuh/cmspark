// CI-only passive observations. Never shipped by the installer or a tool surface.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const KIND = 'NATIVE_TEST_PASSIVE_INSTRUMENTED_EXACT_ORIGINAL_BODY';
const INSIDE = "space 中文 & O'Brien ! (test)";
const TRACE = '.cmspark-stop-smoke.receipt';
const MAX_BYTES = 4096;
const NSIS_MAX_RECORD_BYTES = Math.max(...['section-enter', 'macro-return', 'nsis-failed'].map(value => Buffer.byteLength(`phase:${value}\r\n`, 'ascii')));
const PREFIX = '# CMSPARK_NSIS_OBSERVE_V1_';
const PHASES = ['section-enter', 'helper-enter', 'cim-enter', 'first-row', 'pipeline-return', 'helper-end', 'macro-return'];
const originalPath = fileURLToPath(new URL('../../companion/stop-installed-agent.ps1', import.meta.url));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const fail = () => { throw new Error('NSIS_STOP_OBSERVATION_INVALID'); };
const identity = st => Object.fromEntries(['dev','ino','mode','nlink','birthtimeNs'].map(k => [k,String(st[k])]));
const equalIdentity = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function ordinary(file, directory = false) {
  const st = fs.lstatSync(file, { bigint: true });
  if (st.isSymbolicLink() || (directory ? !st.isDirectory() : !st.isFile() || st.nlink !== 1n)) fail();
  return st;
}
function ownedRoot(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || !/^cmspark-stop-[a-f0-9]{32}$/.test(path.basename(input))) fail();
  ordinary(input,true);
  const root = fs.realpathSync(input);
  if (process.platform === 'win32' && !/^[A-Za-z]:\\/.test(root)) fail();
  ordinary(root,true); ordinary(path.join(root,INSIDE),true);
  return root;
}
function block(name, body) { return `\n${PREFIX}BEGIN:${name}\n${body}\n${PREFIX}END:${name}\n`; }
function once(text, needle, replacement) {
  const at=text.indexOf(needle);
  if (at<0 || text.indexOf(needle,at+needle.length)>=0) fail();
  return text.slice(0,at)+replacement+text.slice(at+needle.length);
}
const prelude = `$script:cmsparkSmokeObservationGap = $false
$script:cmsparkSmokeObservationFirst = $false
$script:cmsparkSmokeObservationAttempts = [long]0
function Write-CMsparkSmokeObservation([string]$record) {
    try {
        $bytes = [Text.Encoding]::ASCII.GetBytes($record + "\r\n")
        $stream = $null
        try {
            $trace = [IO.Path]::Combine($env:CMSPARK_INSTALL_STOP_ROOT, '${TRACE}')
            $stream = [IO.File]::Open($trace, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            if ($stream.Length + $bytes.Length -gt ${MAX_BYTES}) { throw 'OBSERVATION_LIMIT' }
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { if ($null -ne $stream) { $stream.Dispose() } }
    } catch { $script:cmsparkSmokeObservationGap = $true }
}
Write-CMsparkSmokeObservation 'phase:helper-enter'`;

export function buildObservedHelper(bytes) {
  if (!Buffer.isBuffer(bytes)) fail();
  const hasBOM=bytes.subarray(0,3).equals(Buffer.from([239,187,191]));
  const original=bytes.subarray(hasBOM?3:0).toString('utf8');
  if (!Buffer.from(original,'utf8').equals(bytes.subarray(hasBOM?3:0)) || original.includes(PREFIX) || original.includes('cmsparkSmokeObservation')) fail();
  let out=once(original,"$ErrorActionPreference = 'Stop'", "$ErrorActionPreference = 'Stop'"+block('prelude',prelude));
  out=once(out,'Get-CimInstance Win32_Process | ForEach-Object {', block('before-cim',"Write-CMsparkSmokeObservation 'phase:cim-enter'")+'Get-CimInstance Win32_Process | ForEach-Object {'+block('first-row',`    if (-not $script:cmsparkSmokeObservationFirst) {
        $script:cmsparkSmokeObservationFirst = $true
        Write-CMsparkSmokeObservation 'phase:first-row'
    }`));
  out=once(out,'Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue',block('stop-attempt','    $script:cmsparkSmokeObservationAttempts++')+'Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue');
  out+=block('after-pipeline',`Write-CMsparkSmokeObservation 'phase:pipeline-return'
Write-CMsparkSmokeObservation ('attempts:' + $script:cmsparkSmokeObservationAttempts.ToString([Globalization.CultureInfo]::InvariantCulture))
Write-CMsparkSmokeObservation 'phase:helper-end'
if ($script:cmsparkSmokeObservationGap) { exit 149 }`);
  // Preserve original BOM choice as inverse metadata; the actual generated file is always BOM UTF-8 for PS5.1.
  const marker=block('original-bom',hasBOM?'# ORIGINAL_BOM:1':'# ORIGINAL_BOM:0');
  const result=Buffer.from('\ufeff'+marker+out,'utf8');
  if (!restoreOriginalHelper(result).equals(bytes)) fail();
  return result;
}
export function restoreOriginalHelper(bytes) {
  let text=bytes.toString('utf8');
  if (!text.startsWith('\ufeff')) fail(); text=text.slice(1);
  const names=['original-bom','prelude','before-cim','first-row','stop-attempt','after-pipeline'];
  let originalBOM=false;
  for (const name of names) {
    const begin=`\n${PREFIX}BEGIN:${name}\n`,end=`\n${PREFIX}END:${name}\n`;
    const lo=text.indexOf(begin),hi=text.indexOf(end,lo+begin.length);
    if (lo<0 || hi<0 || text.indexOf(begin,lo+begin.length)>=0 || text.indexOf(end,hi+end.length)>=0) fail();
    if (name==='original-bom') {
      const value=text.slice(lo+begin.length,hi);
      if (!['# ORIGINAL_BOM:0','# ORIGINAL_BOM:1'].includes(value)) fail();
      originalBOM=value.endsWith(':1');
    }
    text=text.slice(0,lo)+text.slice(hi+end.length);
  }
  if (text.includes(PREFIX)) fail();
  return Buffer.from((originalBOM?'\ufeff':'')+text,'utf8');
}

const nsisPreamble = `Var CMSparkSmokeObservationGap
Var CMSparkSmokeSectionEntered
!macro CMSparkSmokePhase PHASE
  Push $7
  Push $8
  Push $9
  StrCpy $9 0
  IfErrors 0 +2
    StrCpy $9 1
  ClearErrors
  FileOpen $8 "$INSTDIR\\${TRACE}" a
  IfErrors 0 +3
    StrCpy $CMSparkSmokeObservationGap 1
    Goto +12
  StrCpy $7 -1
  FileSeek $8 0 END $7
  IntCmpU $7 ${MAX_BYTES - NSIS_MAX_RECORD_BYTES} +3 +3 0
    StrCpy $CMSparkSmokeObservationGap 1
    Goto +4
  FileWrite $8 "phase:\${PHASE}$\\r$\\n"
  IfErrors 0 +2
    StrCpy $CMSparkSmokeObservationGap 1
  FileClose $8
  IfErrors 0 +2
    StrCpy $CMSparkSmokeObservationGap 1
  ClearErrors
  StrCmp $9 0 +2
    SetErrors
  Pop $9
  Pop $8
  Pop $7
!macroend
Function .onInstFailed
  StrCmp $CMSparkSmokeSectionEntered "1" 0 observation_failed_done
  !insertmacro CMSparkSmokePhase "nsis-failed"
observation_failed_done:
FunctionEnd`;
const nsisEnter = `  StrCpy $CMSparkSmokeSectionEntered 1
  !insertmacro CMSparkSmokePhase "section-enter"`;
const nsisAfterMacro = `  !insertmacro CMSparkSmokePhase "macro-return"
  \${If} $CMSparkSmokeObservationGap == 1
    SetErrorLevel 149
    Quit
  \${EndIf}`;

function readStableBounded(file, expectedIdentity, maxBytes, exactBytes) {
  const before=ordinary(file);
  if(!equalIdentity(identity(before),expectedIdentity)||before.size>BigInt(maxBytes)||(exactBytes!==undefined&&before.size!==BigInt(exactBytes)))fail();
  const fd=fs.openSync(file,'r');let data;
  try {
    const opened=fs.fstatSync(fd,{bigint:true});if(!equalIdentity(identity(opened),expectedIdentity)||opened.size!==before.size)fail();
    data=Buffer.alloc(Number(before.size));let offset=0;
    while(offset<data.length){const got=fs.readSync(fd,data,offset,data.length-offset,null);if(!got)fail();offset+=got;}
    if(fs.readSync(fd,Buffer.alloc(1),0,1,null)!==0)fail();
    const after=fs.fstatSync(fd,{bigint:true}),named=ordinary(file);
    if(!equalIdentity(identity(after),expectedIdentity)||!equalIdentity(identity(named),expectedIdentity)||after.size!==before.size||named.size!==before.size||after.mtimeNs!==before.mtimeNs||named.mtimeNs!==before.mtimeNs)fail();
  } finally {fs.closeSync(fd);}
  return data;
}
export function createObservation(input) {
  const root=ownedRoot(input),inside=path.join(root,INSIDE),trace=path.join(inside,TRACE),helperPath=path.join(root,'observed-stop.ps1');
  const original=fs.readFileSync(originalPath),observed=buildObservedHelper(original);
  const fd=fs.openSync(trace,'wx',0o600);fs.closeSync(fd);
  fs.writeFileSync(helperPath,observed,{flag:'wx',mode:0o600});
  return {schema:1,kind:KIND,rootIdentity:identity(ordinary(root,true)),insideIdentity:identity(ordinary(inside,true)),traceIdentity:identity(ordinary(trace)),helperPath,helperIdentity:identity(ordinary(helperPath)),sourceSHA256:hash(original),observedSHA256:hash(observed),nsisPreamble,nsisEnter,nsisAfterMacro};
}
export function collectObservation(input, expected) {
  const root=ownedRoot(input),inside=path.join(root,INSIDE),trace=path.join(inside,TRACE),helperPath=path.join(root,'observed-stop.ps1');
  if (!expected || expected.schema!==1 || expected.kind!==KIND || expected.helperPath!==helperPath || !equalIdentity(identity(ordinary(root,true)),expected.rootIdentity) || !equalIdentity(identity(ordinary(inside,true)),expected.insideIdentity)) fail();
  const original=fs.readFileSync(originalPath),expectedObserved=buildObservedHelper(original);
  if(hash(original)!==expected.sourceSHA256||hash(expectedObserved)!==expected.observedSHA256)fail();
  const observed=readStableBounded(helperPath,expected.helperIdentity,expectedObserved.length,expectedObserved.length);
  if(!observed.equals(expectedObserved)||!restoreOriginalHelper(observed).equals(original))fail();
  const data=readStableBounded(trace,expected.traceIdentity,MAX_BYTES);
  if (!equalIdentity(identity(ordinary(root,true)),expected.rootIdentity)||!equalIdentity(identity(ordinary(inside,true)),expected.insideIdentity))fail();
  const text=data.toString('ascii');if(!Buffer.from(text,'ascii').equals(data)||text&& !text.endsWith('\n'))fail();
  const lines=text?text.replace(/\r\n/g,'\n').slice(0,-1).split('\n'):[];
  const phases=[];let attempts=null,gap=false;
  for(const line of lines){
    if(line.startsWith('phase:')){const value=line.slice(6);if(![...PHASES,'nsis-failed'].includes(value)||phases.includes(value))fail();phases.push(value);}
    else if(/^attempts:(?:0|[1-9][0-9]{0,9})$/.test(line)&&attempts===null){
      if(JSON.stringify(phases)!==JSON.stringify(PHASES.slice(0,5)))fail();
      attempts=Number(line.slice(9));if(attempts>2147483647)fail();
    }
    else fail();
  }
  const complete=JSON.stringify(phases)===JSON.stringify(PHASES)&&attempts!==null;
  gap=!complete;
  return {schema:1,kind:KIND,complete,capture:complete?'complete':'incomplete',gap,phases,stopAttempts:attempts,recordBytes:data.length,identityVerified:true,helperInverseExact:true,stopOrSiblingAcceptanceProvided:false};
}
let main=false;
try{main=!!process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url));}catch{}
if(main){
  try{
    if(process.argv[2]==='prepare'&&process.argv.length===4)process.stdout.write(JSON.stringify(createObservation(process.argv[3]))+'\n');
    else if(process.argv[2]==='collect'&&process.argv.length===5&&process.argv[4].length<=16384){const value=JSON.parse(Buffer.from(process.argv[4],'base64').toString('utf8'));process.stdout.write(JSON.stringify(collectObservation(process.argv[3],value))+'\n');}
    else fail();
  }catch{process.stdout.write(JSON.stringify({schema:1,kind:KIND,complete:false,capture:'incomplete',gap:true,phases:[],stopAttempts:null,identityVerified:false,helperInverseExact:false,stopOrSiblingAcceptanceProvided:false})+'\n');process.exitCode=1;}
}
