// #480 Windows native-only desktop identity. No credentials are exposed to WebView2.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winternl.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <shlwapi.h>
#include <wrl.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Data.Json.h>
#include <WebView2.h>
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <chrono>
#include <cmath>
#include <fstream>
#include <filesystem>
#include <stdexcept>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>
#include "desktop-capabilities.h"
#include <shellapi.h>
#pragma comment(lib, "shell32.lib")
#define CMSPARK_BOOTSTRAP_CHILD
#include "windows-bootstrap.h"
using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using namespace winrt::Windows::Data::Json;
static constexpr wchar_t document_origin[]=L"https://cmspark-desktop.invalid/";
static constexpr wchar_t document_url[]=L"https://cmspark-desktop.invalid/index.html";
static constexpr UINT native_frame=WM_APP+1,native_connect=WM_APP+2,native_offline=WM_APP+3;
static std::wstring text(JsonObject const& o,wchar_t const* k){auto v=o.TryLookup(k);return v&&v.ValueType()==JsonValueType::String?std::wstring(v.GetString()):L"";}
static bool keys(JsonObject const& o,std::initializer_list<wchar_t const*> expected){if(o.Size()!=expected.size())return false;for(auto k:expected)if(!o.HasKey(k))return false;return true;}
static bool exact_one(JsonObject const& o,wchar_t const* k){auto v=o.TryLookup(k);return v&&v.ValueType()==JsonValueType::Number&&v.GetNumber()==1;}
static bool hex(std::wstring const& s,size_t count){return s.size()==count&&std::all_of(s.begin(),s.end(),[](wchar_t c){return(c>=L'0'&&c<=L'9')||(c>=L'a'&&c<=L'f');});}
static std::wstring wide(std::string const& s){if(s.empty())return L"";int n=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,s.data(),(int)s.size(),nullptr,0);if(!n)throw std::runtime_error("UTF8");std::wstring out(n,0);if(!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,s.data(),(int)s.size(),out.data(),n))throw std::runtime_error("UTF8");return out;}
static std::string utf8(std::wstring const& s){int n=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,s.data(),(int)s.size(),nullptr,0,nullptr,nullptr);if(!n&&!s.empty())throw std::runtime_error("UTF16");std::string out(n,0);if(n&&!WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,s.data(),(int)s.size(),out.data(),n,nullptr,nullptr))throw std::runtime_error("UTF16");return out;}
static JsonObject parse(std::wstring const& s){return JsonObject::Parse(s);}
// JSON parser remains the OS implementation; the scanner rejects duplicate decoded keys
// before the system object can collapse them. Only primitive protocol envelopes use this.
static JsonObject flat(std::wstring const& s){
 auto result=parse(s);for(auto const& v:result)if(v.Value().ValueType()==JsonValueType::Object||v.Value().ValueType()==JsonValueType::Array)throw std::runtime_error("NESTED");
 size_t i=0;std::set<std::wstring> seen;
 auto space=[&](){while(i<s.size()&&(s[i]==L' '||s[i]==L'\r'||s[i]==L'\n'||s[i]==L'\t'))++i;};
 auto quoted=[&](){if(i>=s.size()||s[i]!=L'"')throw std::runtime_error("STRING");size_t start=i++;while(i<s.size()){if(s[i]==L'\\'){i+=2;continue;}if(s[i++]==L'"')return std::wstring(JsonValue::Parse(s.substr(start,i-start)).GetString());}throw std::runtime_error("STRING");};
 space();if(i==s.size()||s[i++]!=L'{')throw std::runtime_error("OBJECT");space();if(i<s.size()&&s[i]==L'}'){++i;space();if(i!=s.size())throw std::runtime_error("TAIL");return result;}
 while(i<s.size()){space();if(!seen.insert(quoted()).second)throw std::runtime_error("DUPLICATE");space();if(i==s.size()||s[i++]!=L':')throw std::runtime_error("COLON");space();if(i<s.size()&&s[i]==L'"')quoted();else{size_t start=i;while(i<s.size()&&s[i]!=L','&&s[i]!=L'}'&&s[i]!=L' '&&s[i]!=L'\r'&&s[i]!=L'\n'&&s[i]!=L'\t')++i;if(start==i)throw std::runtime_error("VALUE");}space();if(i==s.size())throw std::runtime_error("END");if(s[i]==L'}'){++i;space();if(i!=s.size())throw std::runtime_error("TAIL");return result;}if(s[i++]!=L',')throw std::runtime_error("COMMA");}
 throw std::runtime_error("END");
}
static void put(JsonObject& o,wchar_t const* k,std::wstring const& v){o.Insert(k,JsonValue::CreateStringValue(v));}
static std::wstring random_id(){unsigned char data[16];if(BCryptGenRandom(nullptr,data,sizeof(data),BCRYPT_USE_SYSTEM_PREFERRED_RNG)<0)throw std::runtime_error("RNG");static wchar_t const digits[]=L"0123456789abcdef";std::wstring s;for(auto b:data){s+=digits[b>>4];s+=digits[b&15];}return s;}
static std::wstring hmac(std::wstring const& keyhex,std::wstring const& message){
 std::vector<unsigned char> key;for(size_t i=0;i<keyhex.size();i+=2)key.push_back((unsigned char)std::stoul(keyhex.substr(i,2),nullptr,16));auto input=utf8(message);
 BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;DWORD size=0,got=0;std::vector<unsigned char> object;unsigned char digest[32];
 auto cleanup=[&](){if(hash)BCryptDestroyHash(hash);if(algorithm)BCryptCloseAlgorithmProvider(algorithm,0);SecureZeroMemory(key.data(),key.size());};
 if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,BCRYPT_ALG_HANDLE_HMAC_FLAG)<0||BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,(PUCHAR)&size,sizeof(size),&got,0)<0){cleanup();throw std::runtime_error("HMAC");}
 object.resize(size);if(BCryptCreateHash(algorithm,&hash,object.data(),size,key.data(),(ULONG)key.size(),0)<0||BCryptHashData(hash,(PUCHAR)input.data(),(ULONG)input.size(),0)<0||BCryptFinishHash(hash,digest,sizeof(digest),0)<0){cleanup();throw std::runtime_error("HMAC");}cleanup();static wchar_t const d[]=L"0123456789abcdef";std::wstring out;for(auto b:digest){out+=d[b>>4];out+=d[b&15];}SecureZeroMemory(digest,sizeof(digest));return out;
}
// Exact target-context SYNCHRONIZE-only capability, never a PID-derived permanent watcher.
static bool sync_parent(HANDLE handle){return d480_sync_parent(handle)!=0;}

struct Pending{std::wstring native_id,ui_id,generation,thread;};
struct Frame{unsigned long epoch;std::wstring value;};
#ifdef CMSPARK_DESKTOP_TEST_PHASES
#define DESKTOP_TEST_NOTE(name) test_note(TestPhase::name);
#define DESKTOP_TEST_NAV_LOCALS HRESULT success_hr=E_FAIL,source_hr=E_FAIL;
#define DESKTOP_TEST_CAPTURE(name) name=
#define DESKTOP_TEST_NAV() test_navigation(success_hr,ok,source_hr,own,ready.load(),args);
#else
#define DESKTOP_TEST_NOTE(name)
#define DESKTOP_TEST_NAV_LOCALS
#define DESKTOP_TEST_CAPTURE(name)
#define DESKTOP_TEST_NAV()
#endif
class Desktop {
 struct Confirmation {std::wstring id,digest,full,generation;IJsonValue thread{nullptr};double deadline=0;unsigned long epoch=0;HWND window=nullptr,details=nullptr;};
 std::unique_ptr<Confirmation> confirmation;
 static double wall_ms(){return std::chrono::duration<double,std::milli>(std::chrono::system_clock::now().time_since_epoch()).count();}
 HWND window=nullptr;std::wstring cap,secret,root,generation,view=L"compact";INTERNET_PORT port=0;
 ComPtr<ICoreWebView2Environment> environment;ComPtr<ICoreWebView2Controller> controller;ComPtr<ICoreWebView2> web;
 std::mutex socket_lock;HINTERNET socket=nullptr;std::atomic<bool> ready{false};std::atomic<unsigned long> epoch{0};
 std::wstring phase=L"initial";std::map<std::wstring,Pending> requests;SIZE compact{360,420},workspace{1040,760};
 void post(UINT type,unsigned long id,std::wstring const& value=L""){auto frame=new Frame{id,value};if(!PostMessageW(window,type,0,(LPARAM)frame))delete frame;}
 bool send(JsonObject const& value){auto bytes=utf8(std::wstring(value.Stringify()));std::lock_guard<std::mutex> lock(socket_lock);return socket&&WinHttpWebSocketSend(socket,WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE,bytes.data(),(DWORD)bytes.size())==NO_ERROR;}
#ifdef CMSPARK_DESKTOP_TEST_PHASES
 enum class TestPhase : unsigned { ready_accepted, env_callback, controller_callback, navigation_callback, document_post_attempted, renderer_callback, renderer_admitted, renderer_send_attempted };
 unsigned test_phase_attempts=0;
 void test_note(TestPhase value) noexcept {
  auto index=static_cast<unsigned>(value);if(!ready||index>=8||index==3||(test_phase_attempts&(1u<<index)))return;
  test_phase_attempts|=1u<<index; // Lifetime bound, mark before send; no reconnect reset or retry.
  try{static wchar_t const* names[]={L"ready_accepted",L"env_callback",L"controller_callback",L"navigation_callback",L"document_post_attempted",L"renderer_callback",L"renderer_admitted",L"renderer_send_attempted"};JsonObject frame;put(frame,L"type",L"system.ping");put(frame,L"id",std::wstring(L"DESKTOP_480_PHASE_")+names[index]);(void)send(frame);}catch(...){/* Diagnostic failure cannot change native behavior. */}
 }
 void test_navigation(HRESULT success_hr,BOOL ok,HRESULT source_hr,bool own,bool ready_sample,ICoreWebView2NavigationCompletedEventArgs* args) noexcept {
  constexpr unsigned index=3;if(!ready||(test_phase_attempts&(1u<<index)))return;
  test_phase_attempts|=1u<<index; // The existing navigation slot is consumed before getter/encoding/send.
  try{COREWEBVIEW2_WEB_ERROR_STATUS status=COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;auto error_hr=args->get_WebErrorStatus(&status);
   std::wstring id=L"DESKTOP_480_NAV_H";id+=SUCCEEDED(success_hr)?L'1':L'0';id+=L"B";id+=ok?L'1':L'0';id+=L"S";id+=SUCCEEDED(source_hr)?L'1':L'0';id+=L"O";id+=own?L'1':L'0';id+=L"R";id+=ready_sample?L'1':L'0';id+=L"E";id+=SUCCEEDED(error_hr)?L'1':L'0';id+=L"W";
   auto code=static_cast<int>(status);if(SUCCEEDED(error_hr)&&code>=0&&code<=18){if(code<10)id+=L'0';id+=std::to_wstring(code);}else id+=L'u';
   JsonObject frame;put(frame,L"type",L"system.ping");put(frame,L"id",id);(void)send(frame);
  }catch(...){/* No diagnostic error may suppress the original navigation condition. */}
 }

#endif
 void deliver(JsonObject const& frame){if(web&&ready&&!generation.empty())web->PostWebMessageAsJson(frame.Stringify().c_str());}
 void document(){retire_confirmation(0);requests.clear();generation=random_id();JsonObject frame;put(frame,L"type",L"desktop.document");put(frame,L"generation",generation);deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)}
 void start_network(){std::thread([this](){winrt::init_apartment(winrt::apartment_type::multi_threaded);while(true){
   auto id=++epoch;ready=false;post(native_connect,id);
   HINTERNET session=WinHttpOpen(L"CMsparkDesktop/1",WINHTTP_ACCESS_TYPE_NO_PROXY,WINHTTP_NO_PROXY_NAME,WINHTTP_NO_PROXY_BYPASS,0),connection=nullptr,request=nullptr,ws=nullptr;
   if(session){WinHttpSetTimeouts(session,10000,10000,10000,10000);connection=WinHttpConnect(session,L"127.0.0.1",port,0);}
   if(connection)request=WinHttpOpenRequest(connection,L"GET",L"/desktop",nullptr,WINHTTP_NO_REFERER,WINHTTP_DEFAULT_ACCEPT_TYPES,0);
   if(request){DWORD never=WINHTTP_OPTION_REDIRECT_POLICY_NEVER;if(!WinHttpSetOption(request,WINHTTP_OPTION_REDIRECT_POLICY,&never,sizeof(never))){WinHttpCloseHandle(request);request=nullptr;}}
   DWORD status=0,length=sizeof(status);if(request&&WinHttpSetOption(request,WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET,nullptr,0)&&WinHttpSendRequest(request,L"Origin: cmspark-desktop-native://local\r\n",(DWORD)-1,nullptr,0,0,0)&&WinHttpReceiveResponse(request,nullptr)&&WinHttpQueryHeaders(request,WINHTTP_QUERY_STATUS_CODE|WINHTTP_QUERY_FLAG_NUMBER,WINHTTP_HEADER_NAME_BY_INDEX,&status,&length,WINHTTP_NO_HEADER_INDEX)&&status==101)ws=WinHttpWebSocketCompleteUpgrade(request,0);
   if(request)WinHttpCloseHandle(request);
   {std::lock_guard<std::mutex> lock(socket_lock);socket=ws;}
   if(ws){std::string body;unsigned char chunk[8192];while(true){DWORD bytes=0;WINHTTP_WEB_SOCKET_BUFFER_TYPE type;DWORD result=WinHttpWebSocketReceive(ws,chunk,sizeof(chunk),&bytes,&type);if(result!=NO_ERROR||type==WINHTTP_WEB_SOCKET_CLOSE_BUFFER_TYPE)break;if(type!=WINHTTP_WEB_SOCKET_UTF8_FRAGMENT_BUFFER_TYPE&&type!=WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE)break;if(body.size()+bytes>10*1024*1024)break;body.append((char*)chunk,bytes);if(type==WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE){try{post(native_frame,id,wide(body));}catch(...){break;}body.clear();}}
   }
   {std::lock_guard<std::mutex> lock(socket_lock);socket=nullptr;if(ws)WinHttpCloseHandle(ws);}
   if(connection)WinHttpCloseHandle(connection);if(session)WinHttpCloseHandle(session);
   if(!ready.load())ExitProcess(41);post(native_offline,id);Sleep(5000); // UI drains earlier frames before clearing ready; no credential fallback.
 }}).detach();}
 bool method(std::wstring const& s){for(auto value:desktop_read_methods)if(s==value)return true;return false;}
 void show(std::wstring const& next){RECT old{};GetClientRect(window,&old);if(view==L"compact")compact={old.right,old.bottom};else workspace={old.right,old.bottom};view=next;auto size=view==L"compact"?compact:workspace;RECT rect{0,0,size.cx,size.cy};AdjustWindowRectEx(&rect,WS_OVERLAPPEDWINDOW,FALSE,0);MONITORINFO monitor{sizeof(monitor)};GetMonitorInfoW(MonitorFromWindow(window,MONITOR_DEFAULTTONEAREST),&monitor);int width=std::min(rect.right-rect.left,monitor.rcWork.right-monitor.rcWork.left),height=std::min(rect.bottom-rect.top,monitor.rcWork.bottom-monitor.rcWork.top);RECT current{};GetWindowRect(window,&current);int x=std::clamp((int)current.left,(int)monitor.rcWork.left,(int)monitor.rcWork.right-width),y=std::clamp((int)current.top,(int)monitor.rcWork.top,(int)monitor.rcWork.bottom-height);SetWindowPos(window,nullptr,x,y,width,height,SWP_NOZORDER);ShowWindow(window,SW_SHOW);SetForegroundWindow(window);}
 // A native window owns decisions. No private action/credentials pass to WebView.
 void retire_confirmation(int decision=-1){
  if(!confirmation)return;auto value=std::move(confirmation); // Remove pending before close/callback.
  if(value->window){KillTimer(value->window,1);DestroyWindow(value->window);}
  if(decision>=0&&ready&&value->epoch==epoch&&value->generation==generation&&wall_ms()<value->deadline){JsonObject result;put(result,L"type",L"desktop.confirmation.decision");put(result,L"confirmation_id",value->id);put(result,L"action_digest",value->digest);result.Insert(L"thread_id",value->thread);result.Insert(L"approved",JsonValue::CreateBooleanValue(decision==1));send(result);}
 }
 static LRESULT CALLBACK confirmation_proc(HWND hwnd,UINT message,WPARAM w,LPARAM l){
  auto self=(Desktop*)GetWindowLongPtrW(hwnd,GWLP_USERDATA);if(message==WM_NCCREATE){self=(Desktop*)((CREATESTRUCTW*)l)->lpCreateParams;SetWindowLongPtrW(hwnd,GWLP_USERDATA,(LONG_PTR)self);}if(!self)return DefWindowProcW(hwnd,message,w,l);
  if(message==WM_CLOSE){self->retire_confirmation(0);return 0;}
  if(message==WM_TIMER){self->retire_confirmation();return 0;}
  if(message==WM_COMMAND&&self->confirmation&&self->confirmation->window==hwnd){switch(LOWORD(w)){case 1:self->retire_confirmation(1);return 0;case 2:self->retire_confirmation(0);return 0;case 3:if(!SetWindowTextW(self->confirmation->details,self->confirmation->full.c_str())||(size_t)GetWindowTextLengthW(self->confirmation->details)!=self->confirmation->full.size())self->retire_confirmation(0);return 0;}}
  return DefWindowProcW(hwnd,message,w,l);
 }
 void begin_confirmation(JsonObject const& frame){
  if(confirmation||!keys(frame,{L"type",L"request_id",L"confirmation_id",L"thread_id",L"action_digest",L"action_json",L"deadline_ms",L"timeout_ms"}))return;
  auto request=requests.find(L"desktop.mcp.save");if(request==requests.end()||request->second.native_id!=text(frame,L"request_id")||request->second.generation!=generation)return;
  auto id=text(frame,L"confirmation_id"),digest=text(frame,L"action_digest"),full=text(frame,L"action_json");if(id.empty()||!hex(digest,64))return;
  // SHA256 of the complete exact private JSON, not a clipped preview/socket alone.
  auto bytes=utf8(full);BCRYPT_ALG_HANDLE algorithm=nullptr;unsigned char hash[32]{};
  if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0)return;
  auto hash_result=BCryptHash(algorithm,nullptr,0,(PUCHAR)bytes.data(),(ULONG)bytes.size(),hash,sizeof(hash));BCryptCloseAlgorithmProvider(algorithm,0);if(hash_result<0)return;
  std::wstring actual;static wchar_t const digits[]=L"0123456789abcdef";for(auto b:hash){actual+=digits[b>>4];actual+=digits[b&15];}if(actual!=digest)return;
  auto deadline=frame.TryLookup(L"deadline_ms"),timeout=frame.TryLookup(L"timeout_ms"),thread=frame.TryLookup(L"thread_id");if(!deadline||!timeout||!thread||deadline.ValueType()!=JsonValueType::Number||timeout.ValueType()!=JsonValueType::Number)return;
  double end=deadline.GetNumber(),budget=timeout.GetNumber(),now=wall_ms();if(!std::isfinite(end)||!std::isfinite(budget)||budget<=0||budget>45000||end<=now||end>now+budget)return;
  if(!((thread.ValueType()==JsonValueType::Null&&request->second.thread.empty())||(thread.ValueType()==JsonValueType::String&&!request->second.thread.empty()&&std::wstring(thread.GetString())==request->second.thread)))return;
  auto action=parse(full);auto operation=text(action,L"action"),name=text(action,L"name");if((operation!=L"add"&&operation!=L"update")||name.empty())return;auto server=action.GetNamedObject(L"server");
  JsonObject summary;put(summary,L"action",operation);put(summary,L"name",name);for(auto key:{L"command",L"args",L"cwd",L"enabled"})if(server.HasKey(key))summary.Insert(key,server.Lookup(key));if(action.HasKey(L"enable_global"))summary.Insert(L"enable_global",action.Lookup(L"enable_global"));put(summary,L"env",L"默认隐藏；可在本原生窗口查看完整操作");
  WNDCLASSW cls{};cls.lpfnWndProc=confirmation_proc;cls.hInstance=GetModuleHandleW(nullptr);cls.lpszClassName=L"CMsparkMcpNativeConfirmation";cls.hCursor=LoadCursor(nullptr,IDC_ARROW);if(!RegisterClassW(&cls)&&GetLastError()!=ERROR_CLASS_ALREADY_EXISTS)return;
  auto value=std::make_unique<Confirmation>();value->id=id;value->digest=digest;value->full=full;value->thread=thread;value->deadline=end;value->generation=generation;value->epoch=epoch;confirmation=std::move(value);
  auto panel=CreateWindowExW(WS_EX_DLGMODALFRAME,cls.lpszClassName,L"确认保存 MCP stdio 配置",WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU,CW_USEDEFAULT,CW_USEDEFAULT,660,500,window,nullptr,cls.hInstance,this);if(!panel){retire_confirmation(0);return;}confirmation->window=panel;
  auto note=CreateWindowExW(0,L"STATIC",L"此操作可能启动或重启本地进程。凭据默认隐藏，只有此原生窗口可以批准。",WS_CHILD|WS_VISIBLE,14,12,620,40,panel,nullptr,cls.hInstance,nullptr);
  confirmation->details=CreateWindowExW(WS_EX_CLIENTEDGE,L"EDIT",summary.Stringify().c_str(),WS_CHILD|WS_VISIBLE|WS_TABSTOP|WS_VSCROLL|WS_HSCROLL|ES_MULTILINE|ES_READONLY|ES_AUTOVSCROLL|ES_AUTOHSCROLL,14,56,614,330,panel,nullptr,cls.hInstance,nullptr);
  auto reveal=CreateWindowExW(0,L"BUTTON",L"查看完整操作（含私有配置）",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_PUSHBUTTON,14,398,280,30,panel,(HMENU)3,cls.hInstance,nullptr);
  auto cancel=CreateWindowExW(0,L"BUTTON",L"取消",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_DEFPUSHBUTTON,360,398,110,30,panel,(HMENU)2,cls.hInstance,nullptr);
  auto approve=CreateWindowExW(0,L"BUTTON",L"确认并保存",WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_PUSHBUTTON,484,398,140,30,panel,(HMENU)1,cls.hInstance,nullptr);
  if(!note||!confirmation->details||(size_t)GetWindowTextLengthW(confirmation->details)!=summary.Stringify().size()||!reveal||!cancel||!approve||!SetTimer(panel,1,(UINT)std::max(1.0,end-wall_ms()),nullptr)){retire_confirmation(0);return;}
  ShowWindow(panel,SW_SHOW);SetForegroundWindow(panel);SetFocus(cancel);
 }
 void accept(std::wstring const& body,unsigned long frame_epoch){
  auto frame=phase==L"ready"?parse(body):flat(body);auto type=text(frame,L"type");
  if(phase==L"initial"&&type==L"desktop.challenge.request"&&keys(frame,{L"type"})){JsonObject hello;put(hello,L"type",L"desktop.hello");put(hello,L"capability_id",cap);hello.Insert(L"protocol_version",JsonValue::CreateNumberValue(1));phase=L"hello";if(!send(hello))throw std::runtime_error("SEND");return;}
  if(phase==L"hello"&&type==L"desktop.challenge"&&keys(frame,{L"type",L"capability_id",L"connection_id",L"protocol_version",L"nonce"})&&text(frame,L"capability_id")==cap&&exact_one(frame,L"protocol_version")){auto cid=text(frame,L"connection_id"),nonce=text(frame,L"nonce");if(!hex(cid,32)||!hex(nonce,64))throw std::runtime_error("CHALLENGE");auto input=L"[\"cmspark.desktop.auth.v1\",\""+cap+L"\",\""+cid+L"\",1,\""+nonce+L"\"]";JsonObject proof;put(proof,L"type",L"desktop.authenticate");put(proof,L"capability_id",cap);proof.Insert(L"protocol_version",JsonValue::CreateNumberValue(1));put(proof,L"proof",hmac(secret,input));phase=L"proof";if(!send(proof))throw std::runtime_error("SEND");return;}
  if(phase==L"proof"&&type==L"desktop.ready"&&keys(frame,{L"type",L"protocol_version"})&&exact_one(frame,L"protocol_version")){phase=L"ready";ready=true;DESKTOP_TEST_NOTE(ready_accepted)if(!web)build_webview();else document();return;}
  // The network may retire this epoch after the UI dispatch check.
  if(!ready||phase!=L"ready"){if(frame_epoch!=epoch)return;throw std::runtime_error("PHASE");}
  if(type==L"desktop.window"){frame=flat(body);if(!keys(frame,{L"type",L"view"}))throw std::runtime_error("CONTROL");auto next=text(frame,L"view");if(next!=L"compact"&&next!=L"workspace")throw std::runtime_error("VIEW");show(next);return;}
  if(type==L"desktop.close"){flat(body);if(!keys(frame,{L"type"}))throw std::runtime_error("CONTROL");DestroyWindow(window);return;}
  if(type==L"desktop.confirmation.request"){begin_confirmation(flat(body));return;}
  if(type==L"desktop.confirmation.resolved"){auto terminal=flat(body);if(confirmation&&text(terminal,L"confirmation_id")==confirmation->id)retire_confirmation();return;}
  auto request=std::find_if(requests.begin(),requests.end(),[&](auto const& r){return r.second.native_id==text(frame,L"id");});if(request==requests.end()||request->second.generation!=generation)return;auto pending=request->second;auto name=request->first;requests.erase(request);if(name==L"thread.peek"&&type==L"thread.peek_result"&&text(frame,L"thread_id")!=pending.thread)return;put(frame,L"id",pending.ui_id);deliver(frame);
 }
 void renderer(std::wstring const& source,std::wstring const& body){if(!ready||source!=document_url||generation.empty())return;auto frame=flat(body);if(text(frame,L"generation")!=generation)return;auto type=text(frame,L"type");if(type==L"desktop.view"&&keys(frame,{L"type",L"view",L"generation"})){auto next=text(frame,L"view");if(next==L"compact"||next==L"workspace")show(next);return;}
  std::set<std::wstring> allowed{L"type",L"id",L"generation"};if(type==L"thread.peek")allowed.insert(L"thread_id");
  if(type==L"desktop.mcp.edit"||type==L"desktop.mcp.save"){allowed.insert(L"name");allowed.insert(L"thread_id");if(type==L"desktop.mcp.save"){allowed.insert(L"action");allowed.insert(L"payload_json");}if(frame.Size()!=allowed.size()||text(frame,L"name").empty()||requests.count(L"desktop.mcp.save"))return;auto thread=frame.TryLookup(L"thread_id");if(!thread||(thread.ValueType()!=JsonValueType::Null&&thread.ValueType()!=JsonValueType::String))return;if(type==L"desktop.mcp.save"&&(text(frame,L"payload_json").empty()||(text(frame,L"action")!=L"add"&&text(frame,L"action")!=L"update")))return;}
  for(auto const& item:frame)if(!allowed.count(std::wstring(item.Key())))return;if(!method(type))return;auto original=frame.TryLookup(L"id");if(original&&original.ValueType()!=JsonValueType::String)return;if(type==L"thread.peek"&&text(frame,L"thread_id").empty())return;DESKTOP_TEST_NOTE(renderer_admitted)auto id=random_id();requests[type]={id,text(frame,L"id"),generation,text(frame,L"thread_id")};frame.Remove(L"generation");put(frame,L"id",id);send(frame);DESKTOP_TEST_NOTE(renderer_send_attempted)
 }
 void build_webview(){
  // UDF is exclusively owned by this host. No existing browser profile is opened.
  wchar_t temporary[MAX_PATH];DWORD temporary_length=GetTempPathW(MAX_PATH,temporary);if(!temporary_length||temporary_length>=MAX_PATH)throw std::runtime_error("PROFILE");profile=std::wstring(temporary)+L"cmspark-desktop-"+random_id();if(!CreateDirectoryW(profile.c_str(),nullptr))throw std::runtime_error("PROFILE");
  auto result=CreateCoreWebView2EnvironmentWithOptions(nullptr,profile.c_str(),nullptr,Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([this](HRESULT hr,ICoreWebView2Environment* env)->HRESULT{DESKTOP_TEST_NOTE(env_callback)if(FAILED(hr)||!env){ExitProcess(51);return E_FAIL;}environment=env;
   auto controller_result=env->CreateCoreWebView2Controller(window,Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([this](HRESULT code,ICoreWebView2Controller* host)->HRESULT{DESKTOP_TEST_NOTE(controller_callback)if(FAILED(code)||!host){ExitProcess(52);return E_FAIL;}controller=host;if(FAILED(host->get_CoreWebView2(&web))||!web){ExitProcess(53);return E_FAIL;}
    ComPtr<ICoreWebView2Settings> settings;web->get_Settings(&settings);settings->put_AreDevToolsEnabled(FALSE);settings->put_AreDefaultContextMenusEnabled(FALSE);settings->put_AreDefaultScriptDialogsEnabled(FALSE);settings->put_IsStatusBarEnabled(FALSE);settings->put_IsWebMessageEnabled(TRUE);
    ComPtr<ICoreWebView2_3> mapping;if(FAILED(web.As(&mapping))||FAILED(mapping->SetVirtualHostNameToFolderMapping(L"cmspark-desktop.invalid",(root+L"\\assets").c_str(),COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS))){ExitProcess(54);return E_FAIL;}
    EventRegistrationToken token{};
    web->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([this](ICoreWebView2*,ICoreWebView2NavigationStartingEventArgs* args)->HRESULT{LPWSTR uri=nullptr;args->get_Uri(&uri);bool allow=uri&&std::wstring(uri)==document_url;CoTaskMemFree(uri);args->put_Cancel(!allow);if(allow){retire_confirmation(0);generation.clear();requests.clear();}return S_OK;}).Get(),&token);
    web->add_FrameNavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([](ICoreWebView2*,ICoreWebView2NavigationStartingEventArgs* args)->HRESULT{args->put_Cancel(TRUE);return S_OK;}).Get(),&token);
    web->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>([](ICoreWebView2*,ICoreWebView2NewWindowRequestedEventArgs* args)->HRESULT{args->put_Handled(TRUE);return S_OK;}).Get(),&token);
    web->add_PermissionRequested(Callback<ICoreWebView2PermissionRequestedEventHandler>([](ICoreWebView2*,ICoreWebView2PermissionRequestedEventArgs* args)->HRESULT{args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);return S_OK;}).Get(),&token);
    ComPtr<ICoreWebView2_4> downloads;if(SUCCEEDED(web.As(&downloads)))downloads->add_DownloadStarting(Callback<ICoreWebView2DownloadStartingEventHandler>([](ICoreWebView2*,ICoreWebView2DownloadStartingEventArgs* args)->HRESULT{args->put_Cancel(TRUE);return S_OK;}).Get(),&token);else{ExitProcess(55);return E_FAIL;}
    web->AddWebResourceRequestedFilter(L"*",COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
    web->add_WebResourceRequested(Callback<ICoreWebView2WebResourceRequestedEventHandler>([this](ICoreWebView2*,ICoreWebView2WebResourceRequestedEventArgs* args)->HRESULT{ComPtr<ICoreWebView2WebResourceRequest> request;args->get_Request(&request);LPWSTR uri=nullptr;request->get_Uri(&uri);std::wstring u=uri?uri:L"";CoTaskMemFree(uri);std::map<std::wstring,std::pair<std::wstring,std::wstring>> resources{{document_url,{L"index.html",L"text/html"}},{std::wstring(document_origin)+L"app.css",{L"app.css",L"text/css"}},{std::wstring(document_origin)+L"app.js",{L"app.js",L"text/javascript"}}};auto found=resources.find(u);ComPtr<ICoreWebView2WebResourceResponse> response;
      if(found==resources.end())environment->CreateWebResourceResponse(nullptr,403,L"Denied",L"",&response);else{std::ifstream file(std::filesystem::path(root+L"\\assets\\"+found->second.first),std::ios::binary);std::string data((std::istreambuf_iterator<char>(file)),{});ComPtr<IStream> stream;stream.Attach(SHCreateMemStream((BYTE const*)data.data(),(UINT)data.size()));environment->CreateWebResourceResponse(stream.Get(),file?200:404,file?L"OK":L"Missing",(L"Content-Type: "+found->second.second+L"; charset=utf-8\r\nX-Content-Type-Options: nosniff\r\n").c_str(),&response);}args->put_Response(response.Get());return S_OK;}).Get(),&token);
    web->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>([this](ICoreWebView2*,ICoreWebView2NavigationCompletedEventArgs* args)->HRESULT{DESKTOP_TEST_NAV_LOCALS BOOL ok=FALSE;DESKTOP_TEST_CAPTURE(success_hr)args->get_IsSuccess(&ok);LPWSTR uri=nullptr;DESKTOP_TEST_CAPTURE(source_hr)web->get_Source(&uri);bool own=uri&&std::wstring(uri)==document_url;CoTaskMemFree(uri);DESKTOP_TEST_NAV()if(ok&&own&&ready)document();return S_OK;}).Get(),&token);
    web->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>([this](ICoreWebView2*,ICoreWebView2WebMessageReceivedEventArgs* args)->HRESULT{DESKTOP_TEST_NOTE(renderer_callback)LPWSTR source=nullptr,value=nullptr;args->get_Source(&source);args->get_WebMessageAsJson(&value);try{renderer(source?source:L"",value?value:L"");}catch(...){/* Reject invalid renderer protocol without authority fallback. */}CoTaskMemFree(source);CoTaskMemFree(value);return S_OK;}).Get(),&token);
    RECT bounds{};GetClientRect(window,&bounds);controller->put_Bounds(bounds);return web->Navigate(document_url);
   }).Get());if(FAILED(controller_result)){ExitProcess(52);return controller_result;}return S_OK;
  }).Get());if(FAILED(result))ExitProcess(50);
 }
 std::wstring profile;
 public:
 Desktop(std::wstring const& c,std::wstring const& s,INTERNET_PORT p,std::wstring const& r):cap(c),secret(s),root(r),port(p){}
 static LRESULT CALLBACK proc(HWND hwnd,UINT message,WPARAM w,LPARAM l){Desktop* self=(Desktop*)GetWindowLongPtrW(hwnd,GWLP_USERDATA);if(message==WM_NCCREATE){self=(Desktop*)((CREATESTRUCTW*)l)->lpCreateParams;self->window=hwnd;SetWindowLongPtrW(hwnd,GWLP_USERDATA,(LONG_PTR)self);}if(!self)return DefWindowProcW(hwnd,message,w,l);
  if(message==WM_SIZE&&self->controller){RECT bounds{};GetClientRect(hwnd,&bounds);self->controller->put_Bounds(bounds);return 0;}
  if(message==native_frame||message==native_connect||message==native_offline){std::unique_ptr<Frame> frame((Frame*)l);if(frame->epoch!=self->epoch)return 0;try{if(message==native_connect){self->retire_confirmation();self->phase=L"initial";self->generation.clear();self->requests.clear();}else if(message==native_offline){self->retire_confirmation();self->ready=false;self->generation.clear();self->requests.clear();if(self->web){JsonObject offline;put(offline,L"type",L"desktop.offline");self->web->PostWebMessageAsJson(offline.Stringify().c_str());}}else self->accept(frame->value,frame->epoch);}catch(...){ExitProcess(45);}return 0;}
  if(message==WM_CLOSE){self->retire_confirmation(0);DestroyWindow(hwnd);return 0;}if(message==WM_DESTROY){if(self->controller)self->controller->Close();PostQuitMessage(0);return 0;}return DefWindowProcW(hwnd,message,w,l);
 }
 int run(HINSTANCE instance){WNDCLASSW cls{};cls.lpfnWndProc=proc;cls.hInstance=instance;cls.lpszClassName=L"CMsparkDesktopOwnedWindow";cls.hCursor=LoadCursor(nullptr,IDC_ARROW);if(!RegisterClassW(&cls))return 60;RECT rect{0,0,360,420};AdjustWindowRectEx(&rect,WS_OVERLAPPEDWINDOW,FALSE,0);window=CreateWindowExW(0,cls.lpszClassName,L"CMspark 工作台",WS_OVERLAPPEDWINDOW,CW_USEDEFAULT,CW_USEDEFAULT,rect.right-rect.left,rect.bottom-rect.top,nullptr,nullptr,instance,this);if(!window)return 61;start_network();MSG msg{};while(GetMessageW(&msg,nullptr,0,0)>0){TranslateMessage(&msg);DispatchMessageW(&msg);}ExitProcess((UINT)msg.wParam);return(int)msg.wParam;}
};
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,LPWSTR,int){try{
 winrt::init_apartment(winrt::apartment_type::single_threaded);
 int argc=0;LPWSTR* argv=CommandLineToArgvW(GetCommandLineW(),&argc);if(!argv)return 11;
 CmsparkBootstrapClient bootstrap;bool opened=d480_client_open(argc,argv,&bootstrap)!=0;LocalFree(argv);if(!opened)return 11;
 struct BootstrapCleanup{CmsparkBootstrapClient* value;~BootstrapCleanup(){d480_client_close(value);}} bootstrap_cleanup{&bootstrap};
 HANDLE input=bootstrap.pipe;
 struct BootBuffer{char bytes[CMSPARK_BOOT_MAX+1]{};~BootBuffer(){SecureZeroMemory(bytes,sizeof(bytes));}} buffer;DWORD body_length=0;if(!d480_client_body(&bootstrap,buffer.bytes,&body_length))return 13;
 std::string data(buffer.bytes,body_length);SecureZeroMemory(buffer.bytes,sizeof(buffer.bytes));
 struct DataWipe{std::string& value;~DataWipe(){if(!value.empty())SecureZeroMemory(value.data(),value.size());}} data_wipe{data};
 auto boot=flat(wide(data));SecureZeroMemory(data.data(),data.size());if(!keys(boot,{L"capability_id",L"secret",L"url",L"protocol_version",L"issued_method_set_version",L"parent_handle"})||!hex(text(boot,L"capability_id"),32)||!hex(text(boot,L"secret"),64)||!exact_one(boot,L"protocol_version")||boot.GetNamedValue(L"issued_method_set_version").ValueType()!=JsonValueType::Number||boot.GetNamedNumber(L"issued_method_set_version")!=desktop_method_set_version||desktop_method_set_version!=2)return 15;
 auto url=text(boot,L"url");std::wstring prefix=L"ws://127.0.0.1:";if(url.rfind(prefix,0)!=0||url.size()<prefix.size()+9||url.substr(url.size()-8)!=L"/desktop")return 15;auto port_text=url.substr(prefix.size(),url.size()-prefix.size()-8);if(port_text.empty()||port_text.size()>5||!std::all_of(port_text.begin(),port_text.end(),[](wchar_t c){return c>=L'0'&&c<=L'9';}))return 15;unsigned port=std::stoul(port_text);if(!port||port>65535)return 15;
 auto parent_text=text(boot,L"parent_handle");if(parent_text.empty()||parent_text[0]==L'0'||!std::all_of(parent_text.begin(),parent_text.end(),[](wchar_t c){return c>=L'0'&&c<=L'9';}))return 16;size_t used=0;auto number=std::stoull(parent_text,&used,10);if(used!=parent_text.size()||number>(uintptr_t)-1)return 16;HANDLE parent=(HANDLE)(uintptr_t)number;if(!sync_parent(parent))return 16;if(!d480_client_finish(&bootstrap,parent))return 16;
 CloseHandle(input);bootstrap.pipe=nullptr;
 d480_client_close(&bootstrap);
 std::thread([parent](){if(WaitForSingleObject(parent,INFINITE)==WAIT_OBJECT_0)ExitProcess(1);ExitProcess(17);}).detach();
 wchar_t binary[32768];DWORD length=GetModuleFileNameW(nullptr,binary,32768);if(!length||length==32768)return 18;std::wstring root(binary,length);auto slash=root.find_last_of(L"\\/");if(slash==std::wstring::npos)return 18;root.resize(slash);
 Desktop app(text(boot,L"capability_id"),text(boot,L"secret"),(INTERNET_PORT)port,root);return app.run(instance);
 }catch(...){return 15;}}
