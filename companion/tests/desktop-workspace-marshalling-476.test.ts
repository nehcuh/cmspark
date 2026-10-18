/** Actual Windows fixture body under documented API semantics; never native execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
const fixture=()=>fs.readFileSync(path.resolve(__dirname,'../../tests/fixtures/desktop-476/workspace-acceptance.cpp'),'utf8')
const flags={PROCESS_QUERY_LIMITED_INFORMATION:0x1000,PROCESS_VM_OPERATION:8,PROCESS_VM_WRITE:32,MEM_RESERVE:0x2000,MEM_COMMIT:0x1000,PAGE_READWRITE:4,MEM_RELEASE:0x8000,WM_USER:0x400}
function executable(){
 const source=fixture(),start=source.indexOf('static bool d476SelectFolder('),end=source.indexOf('\nvoid D476Acceptance::panel(',start);assert.ok(start>=0&&end>start)
 const full=source.slice(start,end),begin=full.indexOf('{');let body=full.slice(begin+1,full.lastIndexOf('}'))
 // Mechanical source adaptation, not a separately hand-written copy of the control flow.
 body=body.replace('DWORD observed=0;','let observed=0;').replaceAll('GetWindowThreadProcessId(dialog,&observed);','observed=api.GetWindowThreadProcessId(dialog);').replace('HANDLE process=','const process=').replace('bool ok=false;','let ok=false;').replace('LPVOID remote=nullptr;','let remote=null;').replace('SIZE_T bytes=(value.size()+1)*sizeof(wchar_t),written=0;','let bytes=(value.size()+1)*2,written=0;').replace('WriteProcessMemory(process,remote,value.c_str(),bytes,&written)','WriteProcessMemory(process,remote,value.c_str(),bytes,n=>written=n)').replaceAll('(LPARAM)remote','remote').replaceAll('nullptr','null').replaceAll('FALSE','0').replaceAll('TRUE','1')
 for(const name of ['IsWindow','GetCurrentProcessId','OpenProcess','GetProcessId','VirtualAllocEx','WriteProcessMemory','SendMessageW','VirtualFreeEx','CloseHandle'])body=body.replace(new RegExp('\\b'+name+'\\(','g'),'api.'+name+'(')
 return {full,run:vm.runInNewContext('(function(dialog,expectedPid,value,api){'+body+'})',flags,{timeout:1000}) as Function}
}
function model(fault=''){
 const calls:any[]=[],remote={remote:true},process={pid:42},local={text:'D:\\owned\\目录😀'},value={empty:()=>false,size:()=>local.text.length,c_str:()=>local};let observations=0,windows=0
 const api={GetWindowThreadProcessId:()=>{calls.push(['pid']);return fault==='wrong-initial'?41:fault==='wrong-final'&&++observations>1?43:42},IsWindow:()=>{calls.push(['window']);return !(fault==='invalid-initial'||fault==='invalid-final'&&++windows>1)},GetCurrentProcessId:()=>7,
 OpenProcess:(rights:number,inherit:number,pid:number)=>{calls.push(['open',rights,inherit,pid]);return fault==='open'?null:process},GetProcessId:()=>fault==='wrong-handle'?99:42,
 VirtualAllocEx:(p:any,address:any,bytes:number,how:number,protection:number)=>{calls.push(['alloc',p,address,bytes,how,protection]);return fault==='alloc'?null:remote},
 WriteProcessMemory:(p:any,address:any,src:any,bytes:number,out:Function)=>{calls.push(['write',p,address,src,bytes]);assert.equal(address,remote);assert.equal(src,local);out(fault==='partial'?bytes-2:bytes);return fault!=='write'},
 SendMessageW:(dialog:any,message:number,wide:number,pointer:any)=>{calls.push(['send',dialog,message,wide,pointer]);assert.equal(pointer,remote,'remote process must never dereference a host-local address');return 0},
 VirtualFreeEx:(p:any,address:any,size:number,how:number)=>{calls.push(['free',p,address,size,how]);assert.equal(address,remote);assert.equal(size,0);assert.equal(how,flags.MEM_RELEASE);return fault!=='free'},CloseHandle:(p:any)=>{calls.push(['close',p]);return fault!=='close'}}
 return {calls,remote,process,local,value,api,run:(pid=42,v=value)=>executable().run('owned-dialog',pid,v,api)}
}
test('workspace picker never sends a host-local pointer to a foreign private window message',()=>{const s=fixture();assert.doesNotMatch(s,/SendMessageW\(found\.window,WM_USER\+103,TRUE,\(LPARAM\)selection\.c_str\(\)\)/);assert.ok(s.includes('d476SelectFolder(found.window,pickerPid,selection)'))})
test('actual marshalling helper uses only owned nonexecuting data and frees after synchronous delivery',()=>{const f=model();assert.equal(f.run(),true);const get=(n:string)=>f.calls.filter(c=>c[0]===n);assert.deepEqual(get('open')[0].slice(1),[0x1028,0,42]);assert.deepEqual(get('alloc')[0].slice(2),[null,(f.local.text.length+1)*2,0x3000,4]);assert.equal(get('write').length,1);assert.deepEqual(get('send')[0].slice(2,4),[0x467,1]);assert.equal(get('send')[0][4],f.remote);assert.equal(get('free').length,1);assert.equal(get('close').length,1);assert.ok(f.calls.findIndex(c=>c[0]==='send')<f.calls.findIndex(c=>c[0]==='free'));assert.ok(f.calls.findIndex(c=>c[0]==='free')<f.calls.findIndex(c=>c[0]==='close'))})
for(const fault of ['wrong-initial','invalid-initial','open','wrong-handle','alloc','write','partial','wrong-final','invalid-final','free','close'])test('actual marshalling failure '+fault+' remains a failed fixture with exact owned cleanup',()=>{const f=model(fault);assert.equal(f.run(),false);const count=(n:string)=>f.calls.filter(c=>c[0]===n).length;assert.equal(count('send'),['free','close'].includes(fault)?1:0);assert.equal(count('close'),['wrong-initial','invalid-initial','open'].includes(fault)?0:1);assert.equal(count('free'),['wrong-initial','invalid-initial','open','wrong-handle','alloc'].includes(fault)?0:1)})
for(const pid of [0,7])test('actual marshalling refuses invalid or self picker PID '+pid+' before opening',()=>{const f=model();assert.equal(f.run(pid),false);assert.equal(f.calls.some(c=>c[0]==='open'),false)})
test('actual marshalling refuses empty selection before opening',()=>{const f=model();assert.equal(f.run(42,{...f.value,empty:()=>true}),false);assert.equal(f.calls.some(c=>c[0]==='open'),false)})
test('fixture marshalling is unshipped and does not acquire execution, read, thread or broad process rights',()=>{const s=fixture();assert.doesNotMatch(s,/PROCESS_ALL_ACCESS|PROCESS_VM_READ|PROCESS_CREATE_THREAD|PAGE_EXECUTE|CreateRemoteThread|LoadLibrary|VirtualProtectEx/);const h=executable().full;assert.equal((h.match(/OpenProcess\(/g)||[]).length,1);assert.equal((h.match(/VirtualAllocEx\(/g)||[]).length,1);assert.equal((h.match(/VirtualFreeEx\(/g)||[]).length,1)})
