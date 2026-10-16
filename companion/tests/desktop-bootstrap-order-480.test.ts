import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const native=fs.readFileSync(path.resolve(__dirname,"../../src/desktop/native/DesktopHost.cpp"),"utf8")
const main=native.slice(native.indexOf("int WINAPI wWinMain("))
const once=(needle:string)=>{const first=main.indexOf(needle);assert.ok(first>=0,needle);assert.equal(main.indexOf(needle,first+needle.length),-1,needle);return first}

test("Windows bootstrap validates the complete existing URL before acknowledging consumed bootstrap",()=>{
 const ack=once("d480_client_finish(&bootstrap,parent)")
 for(const field of [
  'auto url=text(boot,L"url")',
  'url.rfind(prefix,0)!=0',
  'url.substr(url.size()-8)!=L"/desktop"',
  'port_text.size()>5',
  'c>=L\'0\'&&c<=L\'9\'',
  'unsigned port=std::stoul(port_text)',
  'if(!port||port>65535)return 15',
 ]){
  const position=main.indexOf(field,main.indexOf('auto url=text(boot,L"url")'))
  assert.ok(position>=0&&position<ack,`${field} must refuse before ACK, not after send succeeds`)
 }
})

test("Windows bootstrap URL admission keeps string type and original fixed loopback endpoint",()=>{
 assert.match(native,/static std::wstring text[\s\S]*?ValueType\(\)==JsonValueType::String\?std::wstring\(v.GetString\(\)\):L"";/)
 assert.equal(once('std::wstring prefix=L"ws://127.0.0.1:"')>=0,true)
 assert.match(main,/if\(!keys\(boot,\{L"capability_id",L"secret",L"url",L"protocol_version",L"issued_method_set_version",L"parent_handle"\}\)/)
 assert.match(main,/!hex\(text\(boot,L"capability_id"\),32\)\|\|!hex\(text\(boot,L"secret"\),64\)/)
})

test("Windows bootstrap full validation precedes ACK EOF and every native effect",()=>{
 const ack=once("d480_client_finish(&bootstrap,parent)"),closed=once("CloseHandle(input);bootstrap.pipe=nullptr;"),queryClosed=once("d480_client_close(&bootstrap);")
 assert.ok(once('auto boot=flat(wide(data))')<ack)
 assert.ok(once('if(!sync_parent(parent))return 16')<ack)
 assert.ok(ack<closed&&closed<queryClosed)
 assert.ok(queryClosed<once('std::thread([parent]'))
 assert.ok(queryClosed<once('Desktop app('))
 assert.ok(queryClosed<once('return app.run(instance)'))
})

// Executes the complete actual C helper body after syntax-only C→JS translation.
// External Windows calls are controlled seams; this is not a Win32 timing claim.
test("Windows bootstrap finish source projection refuses late issuer metadata after clean EOF",()=>{
 const header=fs.readFileSync(path.resolve(__dirname,"../../src/desktop/native/windows-bootstrap.h"),"utf8")
 const match=/static int d480_client_finish\(CmsparkBootstrapClient \*state, HANDLE target_parent\) \{([\s\S]*?)\n\}/.exec(header)
 assert.ok(match)
 const body=match[1].replace("unsigned char ack = 1;","const ack = 1;").replace("int valid =","const valid =").replace(/state->/g,"state.").replace("&ack","ack")
 assert.equal(body.includes("->"),false);assert.equal(body.includes("&ack"),false)
 for(const late of[false,true]){
  let clock=1,creationCalls=0,writes=0,eofs=0
  const creation=()=>{creationCalls++;if(creationCalls===2&&late)clock=11;return true}
  const write=()=>{writes++;return true},eof=()=>{eofs++;return true}
  const now=(_issuer:unknown,deadline:number)=>clock<deadline
  const finish=new Function("state","target_parent","d480_creation","d480_sync_parent","d480_write","d480_eof","d480_now",body)
  const accepted=finish({issuer:"owned",creation:9,pipe:"owned",deadline:10},"target",creation,()=>true,write,eof,now)
  assert.equal(writes,1);assert.equal(eofs,1);assert.equal(creationCalls,2)
  assert.equal(Boolean(accepted),!late,"Final matching issuer metadata cannot revive an expired deadline")
 }
})

test("Windows actual finish now and live composition rejects a late final liveness result",()=>{
 const header=fs.readFileSync(path.resolve(__dirname,"../../src/desktop/native/windows-bootstrap.h"),"utf8")
 const extract=(name:string)=>{const body=new RegExp(`static int ${name}\\([^\\n]*\\) \\{([\\s\\S]*?)\\n\\}`).exec(header)?.[1];assert.ok(body,name);return body}
 const liveBody=extract("d480_live"),nowBody=extract("d480_now")
 const finishBody=extract("d480_client_finish").replace("unsigned char ack = 1;","const ack = 1;").replace("int valid =","const valid =").replace(/state->/g,"state.").replace("&ack","ack")
 for(const late of[false,true]){
  let clock=1,waits=0
  const wait=(_process:unknown,delay:number)=>{assert.equal(delay,0);waits++;if(late)clock=11;return 258}
  const live=new Function("process","WaitForSingleObject","WAIT_TIMEOUT","INVALID_HANDLE_VALUE",liveBody)
  const now=new Function("process","deadline","GetTickCount64","d480_live",nowBody)
  const actualNow=(process:unknown,deadline:number)=>now(process,deadline,()=>clock,(value:unknown)=>live(value,wait,258,-1))
  const finish=new Function("state","target_parent","d480_creation","d480_sync_parent","d480_write","d480_eof","d480_now",finishBody)
  const accepted=finish({issuer:42,creation:9,pipe:43,deadline:10},44,()=>true,()=>true,()=>true,()=>true,actualNow)
  assert.equal(waits,1);assert.equal(Boolean(accepted),!late,"A pre-query timestamp cannot accept a liveness result returned after the same deadline")
 }
})
