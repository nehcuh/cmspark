// Pure, unshipped CPU source generation. Importing registers no test or compiler.
import assert from 'node:assert/strict'
import {desktopMcpFixture} from './desktop-mcp-fixture.mjs'
import {desktopMcpBootstrapObservationFixture773} from './desktop-bootstrap-observation-fixture.mjs'
export const MCP_SNAPSHOT_CPU_INPUTS_825=Object.freeze([
 "src/desktop/native/DesktopHost.cpp",
 "tests/fixtures/desktop-476/native-acceptance.cpp",
 "tests/fixtures/desktop-476/native-form.js",
 "tests/fixtures/desktop-476/mcp-snapshot-825.h",
 "tests/fixtures/desktop-476/mcp-snapshot-825-posix.h",
 "scripts/desktop-mcp-fixture.mjs",
 "scripts/desktop-bootstrap-observation-fixture.mjs",
 "scripts/desktop-mcp-snapshot-fixture-825.mjs",
 "scripts/desktop-mcp-snapshot-cpu-driver-825.mjs",
 "scripts/desktop-mcp-snapshot-cpu-artifact-825.mjs",
 "scripts/build-desktop-windows.mjs"
])
export function mcpSnapshotCpuMethod825(source,signature){
 assert.equal(source.split(signature).length,2);const start=source.indexOf(signature),begin=start+signature.length;let depth=1,quote='',line=false,block=false
 for(let i=begin;i<source.length;i++){const c=source[i],next=source[i+1];if(line){if(c==='\n')line=false;continue}if(block){if(c==='*'&&next==='/'){block=false;i++}continue}if(quote){if(c==='\\'){i++;continue}if(c===quote)quote='';continue}if(c==='/'&&next==='/'){line=true;i++;continue}if(c==='/'&&next==='*'){block=true;i++;continue}if(c==='"'||c==="'"){quote=c;continue}if(c==='{')depth++;if(c==='}'&&--depth===0)return source.slice(start,i+1)}throw Error('actual method boundary')
}
export function mcpSnapshotCpuDriver825(inputs){
 const read=name=>inputs[name],original=read('src/desktop/native/DesktopHost.cpp'),control=read('tests/fixtures/desktop-476/native-acceptance.cpp'),form=read('tests/fixtures/desktop-476/native-form.js'),snapshot=read('tests/fixtures/desktop-476/mcp-snapshot-825.h')
 const generated=desktopMcpBootstrapObservationFixture773(desktopMcpFixture('cpp',original,control,form).source,snapshot).source
 const a=generated.indexOf('struct D476Acceptance {'),b=generated.indexOf('static unsigned count;',a);assert.ok(a>=0&&b>a)
 const declaration=generated.slice(a,b)+'static void emit(Desktop&,wchar_t const*); };'
 const functions=['unsigned D476Acceptance::obBegin773(unsigned point){','void D476Acceptance::obRecord773(unsigned point,unsigned ordinal,unsigned edge,unsigned code,unsigned present){','void D476Acceptance::obFlush773(){','void D476Acceptance::emit(Desktop& h,std::wstring const& value){','void D476Acceptance::emit(Desktop& h,wchar_t const* id){'].map(signature=>mcpSnapshotCpuMethod825(generated,signature)).join('\n')
 // Only CPU schedules/OS leaves are controlled: the worker and reader bodies
 // remain actual source. Mode 6 injects the UI's version change between the
 // actual two capture loads; mode 7 fails the real worker's WriteFile leaf.
 const actualHeader=snapshot.replace('return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());','return probeNow825();')
  .replace('auto after=state.version.load();','if(mode825==6)state.version.fetch_add(2);auto after=state.version.load();')
  .replaceAll('WriteFile(','writeProbe825(')
 assert.ok(actualHeader!==snapshot)
 return `
#include <atomic>
#include <cassert>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <io.h>
using HINTERNET=void*;
#else
${read('tests/fixtures/desktop-476/mcp-snapshot-825-posix.h')}
#endif
int mode825=0;std::atomic<unsigned> clockCalls825{0};uint64_t target825=0;uint64_t probeNow825();
BOOL writeProbe825(HANDLE f,void const* data,DWORD size,DWORD* wrote,std::nullptr_t){if(mode825==7){*wrote=0;return false;}return WriteFile(f,data,size,wrote,nullptr);}
${actualHeader}
std::atomic<ULONGLONG> clock773{1000};ULONGLONG GetTickCount773(){return clock773.load();}
struct JsonObject{std::wstring id;std::wstring Stringify()const{return id;}};
void put(JsonObject& out,std::wstring const& key,std::wstring const& value){if(key==L"id")out.id=value;}
std::string utf8(std::wstring const& value){return std::string(value.begin(),value.end());}
std::mutex wireMutex;std::condition_variable changed;std::vector<std::string> wire;bool release825=false,writerDone825=false,uiReady825=false,parked825=false;
uint64_t probeNow825(){
 if(clockCalls825.fetch_add(1)==0){std::unique_lock<std::mutex> lock(wireMutex);bool arrived=changed.wait_for(lock,std::chrono::seconds(2),[]{return mode825==1||mode825==2?parked825:uiReady825;});assert(arrived);return target825-1;}
 return target825+(mode825==5?300:1);
}
constexpr int WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE=0;
DWORD WinHttpWebSocketSend(HINTERNET,int,void* bytes,DWORD count){
 std::string id((char*)bytes,count);std::unique_lock<std::mutex> lock(wireMutex);
 if(mode825==2&&id=="DESKTOP_480_PHASE_controller_callback"){parked825=true;changed.notify_all();changed.wait_for(lock,std::chrono::seconds(3),[]{return release825;});}
 wire.push_back(id);
 if(mode825==1&&id=="D480A_BOOT_5_1_1_9_0_2"){parked825=true;changed.notify_all();changed.wait_for(lock,std::chrono::seconds(3),[]{return release825;});}
 return NO_ERROR;
}
class Desktop;
${declaration}
class Desktop{std::mutex socket_lock;HINTERNET socket=(void*)1;std::atomic<bool> ready{true};unsigned test_phase_attempts=0;
 public:enum class TestPhase:unsigned{ready_accepted,env_callback,controller_callback,navigation_callback,document_post_attempted,renderer_callback,renderer_admitted,renderer_send_attempted};
 ${mcpSnapshotCpuMethod825(generated,'bool send(JsonObject const& value){')}
 ${mcpSnapshotCpuMethod825(generated,'void test_note(TestPhase value) noexcept {')}
};
${functions.replaceAll('GetTickCount64()','GetTickCount773()')}
void nestedComPump825(){ /* A nested COM/SDK dispatch never executes run()'s hook. */ }
int main(int argc,char** argv){assert(argc==2);mode825=std::stoi(argv[1]);
 std::string seedPath825(argv[0]);seedPath825.resize(seedPath825.find_last_of("\\\\/")+1);seedPath825+="mcp-startup-825.bin";
 {FILE* file=std::fopen(seedPath825.c_str(),"rb");assert(file);uint32_t seed[32]{};auto count=std::fread(seed,1,sizeof(seed),file);std::fclose(file);assert(count==sizeof(seed));target825=uint64_t(seed[4])|(uint64_t(seed[5])<<32);}
 if(mode825==8){FILE* file=std::fopen(seedPath825.c_str(),"r+b");assert(file);
#ifdef _WIN32
 int resized=_chsize_s(_fileno(file),127);
#else
 int resized=ftruncate(fileno(file),127);
#endif
 std::fclose(file);assert(resized==0);}
#ifndef _WIN32
 std::string executable(argv[0]);module825=std::wstring(executable.begin(),executable.end());
#endif
 Desktop h;std::thread worker([]{D476Snapshot825::worker();std::lock_guard<std::mutex> lock(wireMutex);writerDone825=true;changed.notify_all();});
 std::thread ui([&]{h.test_note(Desktop::TestPhase::ready_accepted);D476Acceptance::obBind773(h);
 D476Acceptance::obApi773(5,[&]{D476Snapshot825::CallbackScope callback825(6,0,true);clock773=2750;h.test_note(Desktop::TestPhase::env_callback);D476Acceptance::obCallback773(6,0,true);D476Acceptance::obApi773(7,[&]{clock773=3250;return HRESULT(0);});return HRESULT(0);});
 if(mode825==3)nestedComPump825();else D476Snapshot825::outerDispatch();
 if(mode825==2){D476Snapshot825::CallbackScope callback825(8,0,true);h.test_note(Desktop::TestPhase::controller_callback);D476Acceptance::obCallback773(8,0,true);}
 if(mode825==4)D476Snapshot825::state.version.fetch_add(1); // Controlled updating-state negative.
 {std::lock_guard<std::mutex> lock(wireMutex);uiReady825=true;changed.notify_all();}
 });
 {std::unique_lock<std::mutex> lock(wireMutex);bool done=changed.wait_for(lock,std::chrono::seconds(4),[]{return writerDone825;});assert(done);
  for(auto const& id:wire){std::fwrite(id.data(),1,id.size(),stdout);std::fputs("\\n",stdout);}
  release825=true;changed.notify_all();}
 ui.join();worker.join();return 0;
}
`
}
