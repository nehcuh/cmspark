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
#include <cstring>
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
#include <shobjidl.h>
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
// Fixed HTML template only. The nonce never enters a business frame or persistent asset.
static bool desktop_style_html(std::string& data,std::wstring const& nonce){
 if(!hex(nonce,64))return false;
 for(auto marker:{"__CMSPARK_STYLE_NONCE_CSP__","__CMSPARK_STYLE_NONCE_META__"}){auto at=data.find(marker);if(at==std::string::npos||data.find(marker,at+1)!=std::string::npos)return false;}
 auto value=utf8(nonce);for(auto marker:{"__CMSPARK_STYLE_NONCE_CSP__","__CMSPARK_STYLE_NONCE_META__"})data.replace(data.find(marker),std::strlen(marker),value);
 return data.find("__CMSPARK_STYLE_NONCE_")==std::string::npos;
}
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

struct Pending{std::wstring native_id,ui_id,generation,thread,kind,target,revision;};
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
 struct Confirmation {std::wstring id,digest,full,generation,purpose;IJsonValue thread{nullptr};double deadline=0;unsigned long epoch=0;HWND window=nullptr,details=nullptr;};
 std::unique_ptr<Confirmation> confirmation;
 static double wall_ms(){return std::chrono::duration<double,std::milli>(std::chrono::system_clock::now().time_since_epoch()).count();}
 HWND window=nullptr;std::wstring cap,secret,root,generation,style_nonce,view=L"compact";INTERNET_PORT port=0;
 ComPtr<ICoreWebView2Environment> environment;ComPtr<ICoreWebView2Controller> controller;ComPtr<ICoreWebView2> web;
 std::mutex socket_lock;HINTERNET socket=nullptr;std::atomic<bool> ready{false};std::atomic<unsigned long> epoch{0};
 struct LocalRequest{Pending pending;std::wstring method,operation;};
 std::map<std::wstring,Pending> local_operations;std::map<std::wstring,LocalRequest> local_requests;std::set<std::wstring> local_closed;std::wstring local_thread;
 std::wstring workspace_owner,browser_request,browser_thread,archive_target;
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
 bool retire_browser(bool all){auto parent=browser_request;requests.erase(L"desktop.browser.tasks");requests.erase(L"desktop.browser.visibility");if(all){browser_request.clear();browser_thread.clear();}if(!ready||parent.empty())return true;JsonObject frame;put(frame,L"type",L"desktop.browser.retire");put(frame,L"context_request_id",parent);put(frame,L"scope",all?L"all":L"view");return send(frame);}
 void retire_archive(){auto target=archive_target;archive_target.clear();requests.erase(L"desktop.archive.state");requests.erase(L"desktop.archive.set");if(ready&&!target.empty()){JsonObject state;put(state,L"type",L"desktop.archive.state");put(state,L"id",random_id());put(state,L"thread_id",target);send(state);}}
 void retire_dialog(){retire_local();auto r=requests.find(L"desktop.chat.send");if(r==requests.end())return;if(ready){JsonObject stop;put(stop,L"type",L"desktop.chat.stop");put(stop,L"id",random_id());put(stop,L"thread_id",r->second.thread);put(stop,L"run_id",r->second.native_id);send(stop);}requests.erase(r);}
 struct WorkspaceSelection {
  ComPtr<IFileOpenDialog> dialog;std::wstring request,thread,revision,nonce,generation;unsigned long epoch=0;double deadline=0;bool settled=false,selected=false;
 };
 std::shared_ptr<WorkspaceSelection> workspace_selection;
 static constexpr UINT_PTR workspace_picker_timer=0x705;
 bool picker_current(std::shared_ptr<WorkspaceSelection> const& p){
  auto request=requests.find(L"desktop.workspace.pick");return workspace_selection==p&&ready&&epoch==p->epoch&&generation==p->generation&&request!=requests.end()&&request->second.native_id==p->request&&request->second.thread==p->thread&&request->second.revision==p->revision&&request->second.generation==p->generation;
 }
 void retire_picker(){
  auto p=workspace_selection;workspace_selection.reset();if(!p)return;p->settled=true;KillTimer(window,workspace_picker_timer);
  if(p->dialog)(void)p->dialog->Close(HRESULT_FROM_WIN32(ERROR_CANCELLED));p->dialog.Reset();
 }
 void finish_picker(std::shared_ptr<WorkspaceSelection> const& p,std::wstring const& outcome,std::wstring const& selected=L""){
  if(p->settled)return;bool current=picker_current(p);p->settled=true;p->selected=outcome==L"selected";KillTimer(window,workspace_picker_timer);
  if(outcome!=L"selected"&&p->dialog)(void)p->dialog->Close(HRESULT_FROM_WIN32(ERROR_CANCELLED));p->dialog.Reset();
  if(!current)return;JsonObject reply;put(reply,L"type",L"desktop.workspace.picker.result");put(reply,L"request_id",p->request);put(reply,L"thread_id",p->thread);put(reply,L"revision",p->revision);put(reply,L"pick_id",p->nonce);put(reply,L"outcome",outcome);if(outcome==L"selected")put(reply,L"path",selected);(void)send(reply);
 }
 void begin_picker(JsonObject const& frame){
  if(workspace_selection||!keys(frame,{L"type",L"request_id",L"thread_id",L"revision",L"pick_id",L"deadline_ms"}))return;
  auto request=requests.find(L"desktop.workspace.pick");auto id=text(frame,L"request_id"),thread=text(frame,L"thread_id"),revision=text(frame,L"revision"),nonce=text(frame,L"pick_id");auto end=frame.TryLookup(L"deadline_ms");
  if(id.empty()||id.size()>200||!hex(revision,64)||!hex(nonce,64)||!end||end.ValueType()!=JsonValueType::Number||request==requests.end()||request->second.native_id!=id||request->second.thread!=thread||request->second.revision!=revision||request->second.generation!=generation)return;
  double deadline=end.GetNumber(),now=wall_ms();if(!std::isfinite(deadline)||std::floor(deadline)!=deadline||deadline<=now||deadline>now+120000)return;
  auto p=std::make_shared<WorkspaceSelection>();p->request=id;p->thread=thread;p->revision=revision;p->nonce=nonce;p->generation=generation;p->epoch=epoch;p->deadline=deadline;workspace_selection=p;
  HRESULT created=CoCreateInstance(__uuidof(FileOpenDialog),nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(p->dialog.GetAddressOf()));
  if(FAILED(created)){finish_picker(p,L"unavailable");return;}
  FILEOPENDIALOGOPTIONS options{};if(FAILED(p->dialog->GetOptions(&options))||FAILED(p->dialog->SetOptions((options&~(FOS_ALLOWMULTISELECT|FOS_ALLNONSTORAGEITEMS|FOS_FILEMUSTEXIST|FOS_CREATEPROMPT))|FOS_PICKFOLDERS|FOS_FORCEFILESYSTEM|FOS_PATHMUSTEXIST|FOS_NOCHANGEDIR|FOS_DONTADDTORECENT))||FAILED(p->dialog->SetTitle(L"选择工作区文件夹"))){finish_picker(p,L"unavailable");return;}
  double remaining=deadline-wall_ms();if(remaining<=0||!SetTimer(window,workspace_picker_timer,(UINT)std::max(1.0,std::floor(remaining)),nullptr)){finish_picker(p,L"unavailable");return;}
  // Keep a local reference throughout modal reentrancy, even if owner cancellation retires p.
  auto dialog=p->dialog;HRESULT shown=dialog->Show(window);KillTimer(window,workspace_picker_timer);
  if(p->settled||!picker_current(p))return;
  if(shown==HRESULT_FROM_WIN32(ERROR_CANCELLED)){finish_picker(p,L"cancelled");return;}
  if(FAILED(shown)||wall_ms()>=deadline){finish_picker(p,L"unavailable");return;}
  ComPtr<IShellItem> item;SFGAOF attributes=0;PWSTR raw=nullptr;
  if(FAILED(dialog->GetResult(&item))||FAILED(item->GetAttributes(SFGAO_FILESYSTEM|SFGAO_FOLDER,&attributes))||(attributes&(SFGAO_FILESYSTEM|SFGAO_FOLDER))!=(SFGAO_FILESYSTEM|SFGAO_FOLDER)||FAILED(item->GetDisplayName(SIGDN_FILESYSPATH,&raw))){if(raw)CoTaskMemFree(raw);finish_picker(p,L"unavailable");return;}
  std::unique_ptr<wchar_t,decltype(&CoTaskMemFree)> owned(raw,&CoTaskMemFree);std::wstring selected=raw?raw:L"";
  if(selected.empty()||!std::filesystem::path(selected).is_absolute()){finish_picker(p,L"unavailable");return;}
  finish_picker(p,L"selected",selected);
 }
 void cancel_picker(JsonObject const& frame){auto p=workspace_selection;if(!p||!keys(frame,{L"type",L"request_id",L"thread_id",L"revision",L"pick_id"})||text(frame,L"request_id")!=p->request||text(frame,L"thread_id")!=p->thread||text(frame,L"revision")!=p->revision||text(frame,L"pick_id")!=p->nonce)return;retire_picker();}

 void retire_workspace(bool replace_snapshot=true){
  retire_picker();
  auto r=requests.find(L"desktop.workspace.pick");if(r!=requests.end()){if(ready){JsonObject stop;put(stop,L"type",L"desktop.workspace.cancel");put(stop,L"id",random_id());put(stop,L"thread_id",r->second.thread);put(stop,L"operation_id",r->second.native_id);send(stop);}requests.erase(r);}
  if(confirmation&&confirmation->purpose==L"workspace")retire_confirmation(0);
  if(replace_snapshot&&!workspace_owner.empty()){if(ready){JsonObject state;put(state,L"type",L"desktop.workspace.state");put(state,L"id",random_id());put(state,L"thread_id",workspace_owner);send(state);}workspace_owner.clear();} // Untracked reply cannot enter the next document.
 }
 static bool local_method(std::wstring const& type){return std::set<std::wstring>{L"desktop.local.state",L"desktop.terminal.open",L"desktop.terminal.input",L"desktop.terminal.resize",L"desktop.terminal.ack",L"desktop.terminal.ping",L"desktop.terminal.close",L"desktop.terminal.return",L"desktop.agent.start",L"desktop.agent.prompt",L"desktop.agent.cancel"}.count(type)!=0;}
 static bool local_integer(JsonObject const& frame,wchar_t const* key,double maximum){auto value=frame.TryLookup(key);if(!value||value.ValueType()!=JsonValueType::Number)return false;auto n=value.GetNumber();return std::isfinite(n)&&n>=1&&n<=maximum&&std::floor(n)==n;}
 static bool local_base64(std::wstring const& value){
  auto count=value.size();if(!count||count>21848||count%4)return false;
  auto digit=[](wchar_t c){if(c>=L'A'&&c<=L'Z')return int(c-L'A');if(c>=L'a'&&c<=L'z')return int(c-L'a')+26;if(c>=L'0'&&c<=L'9')return int(c-L'0')+52;if(c==L'+')return 62;if(c==L'/')return 63;return -1;};
  size_t padding=value[count-1]==L'='?1:0;if(count>1&&value[count-2]==L'=')++padding;
  if(count/4*3-padding>16384)return false;
  for(size_t i=0;i<count-padding;++i)if(digit(value[i])<0)return false;
  if(padding==2&&(digit(value[count-3])&15))return false;
  if(padding==1&&(digit(value[count-2])&3))return false;
  return true;
 }
 void retire_local(){
  if(confirmation&&confirmation->purpose==L"local-work")retire_confirmation(0);
  for(auto const& [id,op]:local_operations)if(ready&&op.generation==generation){JsonObject close;put(close,L"type",op.kind==L"terminal"?L"desktop.terminal.close":L"desktop.agent.cancel");put(close,L"id",random_id());put(close,L"thread_id",op.thread);put(close,L"operation_id",id);send(close);}
  local_operations.clear();local_requests.clear();local_closed.clear();local_thread.clear();
 }
 void render_local(JsonObject frame){
  auto type=text(frame,L"type"),ui=text(frame,L"id"),thread=text(frame,L"thread_id");if(!local_method(type)||!method(type)||ui.empty()||utf8(ui).size()>200||thread.empty())return;
  std::set<std::wstring> expected{L"type",L"id",L"thread_id",L"generation"};
  bool start=type==L"desktop.terminal.open"||type==L"desktop.agent.start";
  if(start)expected.insert(L"revision");
  if(type==L"desktop.terminal.open"||type==L"desktop.terminal.resize"){expected.insert(L"cols");expected.insert(L"rows");if(!local_integer(frame,L"cols",500)||!local_integer(frame,L"rows",200))return;}
  if(type==L"desktop.agent.start"){expected.insert(L"agent_id");expected.insert(L"goal");if(text(frame,L"agent_id").empty()||text(frame,L"goal").empty()||text(frame,L"goal").size()>8000)return;}
  if(type!=L"desktop.local.state"&&!start)expected.insert(L"operation_id");
  if(type==L"desktop.terminal.input"||type==L"desktop.terminal.ack"){expected.insert(L"seq");if(!local_integer(frame,L"seq",9007199254740991.0))return;}
  if(type==L"desktop.terminal.input"){expected.insert(L"b64");auto b64=text(frame,L"b64");if(!local_base64(b64))return;}
  if(type==L"desktop.terminal.return"||type==L"desktop.agent.prompt"){expected.insert(L"text");if(text(frame,L"text").empty()||text(frame,L"text").size()>(type==L"desktop.terminal.return"?48000:8000))return;}
  if(frame.Size()!=expected.size())return;for(auto const& item:frame)if(!expected.count(std::wstring(item.Key())))return;
  if(start&&!hex(text(frame,L"revision"),64))return;
  std::wstring operation;
  if(frame.HasKey(L"operation_id")){auto original=text(frame,L"operation_id");auto found=std::find_if(local_operations.begin(),local_operations.end(),[&](auto const& row){return row.second.ui_id==original&&row.second.thread==thread&&row.second.generation==generation;});if(found==local_operations.end()||(type.rfind(L"desktop.terminal.",0)==0)!=(found->second.kind==L"terminal"))return;operation=found->first;put(frame,L"operation_id",operation);}
  if(type==L"desktop.local.state"){if(confirmation&&confirmation->purpose==L"local-work")retire_confirmation(0);local_thread=thread;}
  if((type==L"desktop.terminal.open"||type==L"desktop.terminal.input"||type==L"desktop.terminal.resize"||type==L"desktop.terminal.return")&&local_thread!=thread)return;
  auto native=random_id();Pending pending{native,ui,generation,thread,type.rfind(L"desktop.terminal.",0)==0?L"terminal":L"agent",L"",text(frame,L"revision")};
  if(start){if(std::any_of(local_operations.begin(),local_operations.end(),[&](auto const& row){return row.second.generation==generation&&(row.second.ui_id==ui||(type==L"desktop.terminal.open"&&row.second.kind==L"terminal"&&!local_closed.count(row.first)));}))return;if(type==L"desktop.terminal.open"&&confirmation&&confirmation->purpose==L"local-work")retire_confirmation(0);local_operations[native]=pending;}
  local_requests[native]={pending,type,operation};frame.Remove(L"generation");put(frame,L"id",native);if(!send(frame)){local_requests.erase(native);if(start)local_operations.erase(native);}
 }
 bool accept_local(JsonObject frame){
  auto type=text(frame,L"type");
  if(type==L"desktop.terminal.data"||type==L"desktop.terminal.closed"||type==L"desktop.terminal.heartbeat"||type==L"desktop.agent.event"){
   auto found=local_operations.find(text(frame,L"operation_id"));if(found==local_operations.end()||found->second.generation!=generation||text(frame,L"thread_id")!=found->second.thread)return true;
   if((type.rfind(L"desktop.terminal.",0)==0)!=(found->second.kind==L"terminal"))return true;if(type==L"desktop.terminal.heartbeat"){JsonObject ping;put(ping,L"type",L"desktop.terminal.ping");put(ping,L"id",random_id());put(ping,L"thread_id",found->second.thread);put(ping,L"operation_id",found->first);send(ping);return true;}if(type==L"desktop.terminal.closed")local_closed.insert(found->first);put(frame,L"operation_id",found->second.ui_id);deliver(frame);return true;
  }
  auto request=local_requests.find(text(frame,L"id"));if(request==local_requests.end())return false;auto value=request->second;
  if(value.pending.generation!=generation||type!=value.method+L".result"||text(frame,L"thread_id")!=value.pending.thread)return true;
  if(frame.HasKey(L"operation_id")){
   auto expected=value.operation.empty()?value.pending.native_id:value.operation;if(text(frame,L"operation_id")!=expected)return true;auto operation=local_operations.find(expected);if(operation==local_operations.end())return true;put(frame,L"operation_id",operation->second.ui_id);
  }
  if(value.method==L"desktop.local.state"&&frame.HasKey(L"state")){
   auto state=frame.GetNamedObject(L"state");if(state.HasKey(L"operations")){JsonArray mapped;for(auto const& entry:state.GetNamedArray(L"operations")){if(entry.ValueType()!=JsonValueType::Object)continue;auto row=entry.GetObject();auto op=local_operations.find(text(row,L"operation_id"));if(op==local_operations.end()||op->second.generation!=generation||op->second.thread!=value.pending.thread)continue;put(row,L"operation_id",op->second.ui_id);mapped.Append(row);}state.Insert(L"operations",mapped);frame.Insert(L"state",state);}
  }
  if(value.method==L"desktop.terminal.open"){
   auto ok=frame.TryLookup(L"ok");if(!ok||ok.ValueType()!=JsonValueType::Boolean)return true;
   if(!ok.GetBoolean())local_operations.erase(value.pending.native_id);
   else{if(text(frame,L"operation_id")!=value.pending.ui_id)return true;for(auto old=local_operations.begin();old!=local_operations.end();){if(old->first!=value.pending.native_id&&old->second.kind==L"terminal"&&local_closed.count(old->first)){local_closed.erase(old->first);old=local_operations.erase(old);}else ++old;}}
  }
  if(value.method==L"desktop.terminal.close"&&text(frame,L"status")==L"closed")local_closed.insert(value.operation);
  if(value.method==L"desktop.agent.start"&&frame.HasKey(L"ok")&&frame.GetNamedValue(L"ok").ValueType()==JsonValueType::Boolean&&!frame.GetNamedBoolean(L"ok"))local_operations.erase(value.pending.native_id);
  local_requests.erase(request);put(frame,L"id",value.pending.ui_id);deliver(frame);return true;
 }
 void document(){retire_local();retire_workspace();if(!retire_browser(true))ExitProcess(46);retire_archive();retire_dialog();retire_confirmation(0);requests.clear();generation=random_id();JsonObject frame;put(frame,L"type",L"desktop.document");put(frame,L"generation",generation);deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)}
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
 void show(std::wstring const& next){if(view!=next){if(confirmation&&confirmation->purpose==L"local-work")retire_confirmation(0);local_thread.clear();retire_archive();}RECT old{};GetClientRect(window,&old);if(view==L"compact")compact={old.right,old.bottom};else workspace={old.right,old.bottom};view=next;auto size=view==L"compact"?compact:workspace;RECT rect{0,0,size.cx,size.cy};AdjustWindowRectEx(&rect,WS_OVERLAPPEDWINDOW,FALSE,0);MONITORINFO monitor{sizeof(monitor)};GetMonitorInfoW(MonitorFromWindow(window,MONITOR_DEFAULTTONEAREST),&monitor);int width=std::min(rect.right-rect.left,monitor.rcWork.right-monitor.rcWork.left),height=std::min(rect.bottom-rect.top,monitor.rcWork.bottom-monitor.rcWork.top);RECT current{};GetWindowRect(window,&current);int x=std::clamp((int)current.left,(int)monitor.rcWork.left,(int)monitor.rcWork.right-width),y=std::clamp((int)current.top,(int)monitor.rcWork.top,(int)monitor.rcWork.bottom-height);SetWindowPos(window,nullptr,x,y,width,height,SWP_NOZORDER);ShowWindow(window,SW_SHOW);SetForegroundWindow(window);}
 // A native window owns decisions. No private action/credentials pass to WebView.
 void retire_confirmation(int decision=-1){
  if(!confirmation)return;auto value=std::move(confirmation); // Remove pending before close/callback.
  if(value->window){KillTimer(value->window,1);DestroyWindow(value->window);}
  if(decision>=0&&ready&&value->epoch==epoch&&value->generation==generation&&wall_ms()<value->deadline){JsonObject result;put(result,L"type",L"desktop.confirmation.decision");put(result,L"confirmation_id",value->id);put(result,L"action_digest",value->digest);result.Insert(L"thread_id",value->thread);result.Insert(L"approved",JsonValue::CreateBooleanValue(decision==1));if(value->purpose==L"resource"||value->purpose==L"workspace"||value->purpose==L"local-work")put(result,L"purpose",value->purpose);send(result);}
 }
 static LRESULT CALLBACK confirmation_proc(HWND hwnd,UINT message,WPARAM w,LPARAM l){
  auto self=(Desktop*)GetWindowLongPtrW(hwnd,GWLP_USERDATA);if(message==WM_NCCREATE){self=(Desktop*)((CREATESTRUCTW*)l)->lpCreateParams;SetWindowLongPtrW(hwnd,GWLP_USERDATA,(LONG_PTR)self);}if(!self)return DefWindowProcW(hwnd,message,w,l);
  if(message==WM_CLOSE){self->retire_confirmation(0);return 0;}
  if(message==WM_TIMER){self->retire_confirmation();return 0;}
  if(message==WM_COMMAND&&self->confirmation&&self->confirmation->window==hwnd){switch(LOWORD(w)){case 1:self->retire_confirmation(1);return 0;case 2:self->retire_confirmation(0);return 0;case 3:if(!SetWindowTextW(self->confirmation->details,self->confirmation->full.c_str())||(size_t)GetWindowTextLengthW(self->confirmation->details)!=self->confirmation->full.size())self->retire_confirmation(0);return 0;}}
  return DefWindowProcW(hwnd,message,w,l);
 }
 void begin_confirmation(JsonObject const& frame){
  bool local=text(frame,L"purpose")==L"local-work";
  bool resource=text(frame,L"purpose")==L"resource",workspace=text(frame,L"purpose")==L"workspace";
  if(confirmation)return;
  if(resource||workspace||local){if(!keys(frame,{L"type",L"purpose",L"request_method",L"request_id",L"confirmation_id",L"thread_id",L"action_digest",L"action_json",L"deadline_ms",L"timeout_ms"}))return;}
  else if(!keys(frame,{L"type",L"request_id",L"confirmation_id",L"thread_id",L"action_digest",L"action_json",L"deadline_ms",L"timeout_ms"}))return;
  auto method=(resource||workspace||local)?text(frame,L"request_method"):L"desktop.mcp.save";
  if(workspace&&method!=L"desktop.workspace.pick")return;
  if(resource&&!std::set<std::wstring>{L"desktop.resource.import",L"desktop.resource.update",L"desktop.resource.remove"}.count(method))return;
  auto request=requests.find(method);Pending binding;
  if(local){auto owned=local_operations.find(text(frame,L"request_id"));if(owned==local_operations.end()||owned->second.generation!=generation||(owned->second.kind==L"terminal"&&owned->second.thread!=local_thread))return;binding=owned->second;}else{if(request==requests.end()||request->second.native_id!=text(frame,L"request_id")||request->second.generation!=generation)return;binding=request->second;}
  auto id=text(frame,L"confirmation_id"),digest=text(frame,L"action_digest"),full=text(frame,L"action_json");if(id.empty()||!hex(digest,64))return;
  // SHA256 of the complete exact private JSON, not a clipped preview/socket alone.
  auto bytes=utf8(full);BCRYPT_ALG_HANDLE algorithm=nullptr;unsigned char hash[32]{};
  if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0)return;
  auto hash_result=BCryptHash(algorithm,nullptr,0,(PUCHAR)bytes.data(),(ULONG)bytes.size(),hash,sizeof(hash));BCryptCloseAlgorithmProvider(algorithm,0);if(hash_result<0)return;
  std::wstring actual;static wchar_t const digits[]=L"0123456789abcdef";for(auto b:hash){actual+=digits[b>>4];actual+=digits[b&15];}if(actual!=digest)return;
  auto deadline=frame.TryLookup(L"deadline_ms"),timeout=frame.TryLookup(L"timeout_ms"),thread=frame.TryLookup(L"thread_id");if(!deadline||!timeout||!thread||deadline.ValueType()!=JsonValueType::Number||timeout.ValueType()!=JsonValueType::Number)return;
  double end=deadline.GetNumber(),budget=timeout.GetNumber(),now=wall_ms();if(!std::isfinite(end)||!std::isfinite(budget)||budget<=0||budget>45000||end<=now||end>now+budget)return;
  if(!((thread.ValueType()==JsonValueType::Null&&binding.thread.empty())||(thread.ValueType()==JsonValueType::String&&!binding.thread.empty()&&std::wstring(thread.GetString())==binding.thread)))return;
  auto action=parse(full);JsonObject summary;
  if(local){
   if(!keys(action,{L"purpose",L"kind",L"thread_id",L"operation_id",L"payload"})||text(action,L"purpose")!=L"local-work"||text(action,L"thread_id")!=binding.thread||text(action,L"operation_id")!=binding.native_id||action.GetNamedValue(L"payload").ValueType()!=JsonValueType::Object)return;
   auto kind=text(action,L"kind");bool terminal=binding.kind==L"terminal";
   if((kind==L"terminal-open"&&(!terminal||method!=L"desktop.terminal.open"))||(kind==L"terminal-return"&&(!terminal||method!=L"desktop.terminal.return"))||(kind==L"agent-start"&&(terminal||method!=L"desktop.agent.start"))||(kind==L"agent-prompt"&&(terminal||method!=L"desktop.agent.prompt"))||(kind==L"agent-permission"&&(terminal||method!=L"desktop.agent.start"))||!std::set<std::wstring>{L"terminal-open",L"terminal-return",L"agent-start",L"agent-prompt",L"agent-permission"}.count(kind))return;
   if(kind!=L"agent-permission"&&!std::any_of(local_requests.begin(),local_requests.end(),[&](auto const& row){auto const& item=row.second;return item.method==method&&item.pending.generation==generation&&item.pending.thread==binding.thread&&(item.operation.empty()?item.pending.native_id:item.operation)==binding.native_id;}))return;
   auto payload=action.GetNamedObject(L"payload");if((kind==L"terminal-open"||kind==L"agent-start")&&text(payload,L"revision")!=binding.revision)return;
   summary=action;
  }else if(workspace){
   if(!workspace_selection||!workspace_selection->selected||!picker_current(workspace_selection)||workspace_selection->request!=request->second.native_id)return;
   action=flat(full);auto selected=text(action,L"path");
   if(!keys(action,{L"purpose",L"op",L"thread_id",L"revision",L"path"})||text(action,L"purpose")!=L"workspace"||text(action,L"op")!=L"bind"||text(action,L"thread_id")!=binding.thread||text(action,L"revision")!=binding.revision||!hex(text(action,L"revision"),64)||selected.empty()||selected.find(L'\0')!=std::wstring::npos||!std::filesystem::path(selected).is_absolute())return;
   summary=action; // Exact selected private directory, native controls only.
  }else if(resource){
   if(!keys(action,{L"purpose",L"op",L"kind",L"resource_id",L"revision",L"payload",L"thread_id"})||text(action,L"purpose")!=L"resource"||text(action,L"op")!=method.substr(17)||text(action,L"kind")!=binding.kind||text(action,L"resource_id").empty()||thread.ValueType()!=JsonValueType::Null||action.GetNamedValue(L"thread_id").ValueType()!=JsonValueType::Null||action.GetNamedValue(L"payload").ValueType()!=JsonValueType::Object)return;
   if(method!=L"desktop.resource.import"&&(text(action,L"resource_id")!=binding.target||text(action,L"revision")!=binding.revision))return;
   if(method==L"desktop.resource.import"&&action.GetNamedValue(L"revision").ValueType()!=JsonValueType::Null)return;
   summary=action; // Complete normalized action is shown only inside the native controller.
  }else{
   auto operation=text(action,L"action"),name=text(action,L"name");if((operation!=L"add"&&operation!=L"update")||name.empty())return;auto server=action.GetNamedObject(L"server");
   put(summary,L"action",operation);put(summary,L"name",name);for(auto key:{L"command",L"args",L"cwd",L"enabled"})if(server.HasKey(key))summary.Insert(key,server.Lookup(key));if(action.HasKey(L"enable_global"))summary.Insert(L"enable_global",action.Lookup(L"enable_global"));put(summary,L"env",L"默认隐藏；可在本原生窗口查看完整操作");
  }
  WNDCLASSW cls{};cls.lpfnWndProc=confirmation_proc;cls.hInstance=GetModuleHandleW(nullptr);cls.lpszClassName=L"CMsparkMcpNativeConfirmation";cls.hCursor=LoadCursor(nullptr,IDC_ARROW);if(!RegisterClassW(&cls)&&GetLastError()!=ERROR_CLASS_ALREADY_EXISTS)return;
  auto value=std::make_unique<Confirmation>();value->id=id;value->digest=digest;value->full=full;value->thread=thread;value->deadline=end;value->generation=generation;value->epoch=epoch;value->purpose=local?L"local-work":workspace?L"workspace":resource?L"resource":L"";confirmation=std::move(value);
  auto panel=CreateWindowExW(WS_EX_DLGMODALFRAME,cls.lpszClassName,local?L"确认本地终端／编程接力":resource?L"确认全局技能／知识变更":L"确认保存 MCP stdio 配置",WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU,CW_USEDEFAULT,CW_USEDEFAULT,660,500,window,nullptr,cls.hInstance,this);if(!panel){retire_confirmation(0);return;}confirmation->window=panel;
  auto note=CreateWindowExW(0,L"STATIC",local&&binding.kind==L"terminal"?L"用户终端可执行命令并离开起始目录；不是 OS 沙箱；本次许可不授权模型读取终端屏显。完整操作如下。":resource?L"全局资源变更可能影响后续对话读取。完整操作在下方；管理许可不授权执行内容。":L"此操作可能启动或重启本地进程。凭据默认隐藏，只有此原生窗口可以批准。",WS_CHILD|WS_VISIBLE,14,12,620,40,panel,nullptr,cls.hInstance,nullptr);
  confirmation->details=CreateWindowExW(WS_EX_CLIENTEDGE,L"EDIT",summary.Stringify().c_str(),WS_CHILD|WS_VISIBLE|WS_TABSTOP|WS_VSCROLL|WS_HSCROLL|ES_MULTILINE|ES_READONLY|ES_AUTOVSCROLL|ES_AUTOHSCROLL,14,56,614,330,panel,nullptr,cls.hInstance,nullptr);
  if(confirmation->details&&(resource||local)){SendMessageW(confirmation->details,EM_SETLIMITTEXT,10*1024*1024,0);SetWindowTextW(confirmation->details,summary.Stringify().c_str());}
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
  if(type==L"desktop.close"){flat(body);if(!keys(frame,{L"type"}))throw std::runtime_error("CONTROL");retire_workspace();retire_dialog();retire_confirmation(0);DestroyWindow(window);return;}
  if(type==L"desktop.workspace.picker.request"){begin_picker(flat(body));return;}
  if(type==L"desktop.workspace.picker.cancel"){cancel_picker(flat(body));return;}
  if(type==L"desktop.confirmation.request"){begin_confirmation(flat(body));return;}
  if(type==L"desktop.confirmation.resolved"){auto terminal=flat(body);if(confirmation&&text(terminal,L"confirmation_id")==confirmation->id)retire_confirmation();return;}
  if(accept_local(frame))return;
  auto request=std::find_if(requests.begin(),requests.end(),[&](auto const& r){return r.second.native_id==text(frame,L"id");});if(request==requests.end()||request->second.generation!=generation)return;auto pending=request->second;auto name=request->first;
  if(name==L"desktop.chat.send"){
   if(text(frame,L"thread_id")!=pending.thread)return;
   if(type!=L"desktop.chat.send.result"&&type!=L"desktop.chat.event")return;
   if(frame.HasKey(L"run_id")&&text(frame,L"run_id")!=pending.native_id)return;
   if(type==L"desktop.chat.event"){auto kind=text(frame,L"kind");if(!frame.HasKey(L"run_id")||!std::set<std::wstring>{L"user",L"snapshot",L"assistant",L"done",L"aborted",L"error",L"confirmation_unavailable",L"terminal"}.count(kind))return;if(kind==L"terminal")requests.erase(request);}
   else {auto ok=frame.TryLookup(L"ok");if(!ok||ok.ValueType()!=JsonValueType::Boolean)return;if(!ok.GetBoolean())requests.erase(request);}
   put(frame,L"id",pending.ui_id);if(frame.HasKey(L"run_id"))put(frame,L"run_id",pending.ui_id);deliver(frame);return;
  }
  if(name==L"desktop.thread.create"||name==L"desktop.thread.open"||name==L"desktop.chat.stop"){
   if(type!=name+L".result")return;if(name!=L"desktop.thread.create"&&text(frame,L"thread_id")!=pending.thread)return;
   auto active=requests.find(L"desktop.chat.send");
   if(name==L"desktop.thread.open"&&frame.HasKey(L"owned_run_id")){if(active!=requests.end()&&active->second.generation==generation&&active->second.thread==pending.thread&&text(frame,L"owned_run_id")==active->second.native_id)put(frame,L"owned_run_id",active->second.ui_id);else frame.Insert(L"owned_run_id",JsonValue::CreateNullValue());}
   if(name==L"desktop.chat.stop"&&frame.HasKey(L"run_id")){if(active==requests.end()||text(frame,L"run_id")!=active->second.native_id)return;put(frame,L"run_id",active->second.ui_id);}
  }
  if(name.rfind(L"desktop.workspace.",0)==0&&(type!=name+L".result"||text(frame,L"thread_id")!=pending.thread))return;
  if(name==L"desktop.workspace.cancel")put(frame,L"operation_id",pending.target);
  if(name.rfind(L"desktop.browser.",0)==0&&(type!=name+L".result"||(name!=L"desktop.browser.status"&&text(frame,L"thread_id")!=pending.thread)))return;
  if((name==L"desktop.archive.list"||name==L"desktop.archive.state"||name==L"desktop.archive.set")&&(type!=name+L".result"||(name!=L"desktop.archive.list"&&text(frame,L"thread_id")!=pending.thread)))return;
  if(name.rfind(L"desktop.resource.",0)==0&&type!=name+L".result")return;
  requests.erase(request);if(name==L"desktop.workspace.pick")retire_picker();if(name==L"thread.peek"&&type==L"thread.peek_result"&&text(frame,L"thread_id")!=pending.thread)return;if((name==L"desktop.thread.metadata.edit"||name==L"desktop.thread.metadata.save")&&(type!=name+L".result"||text(frame,L"thread_id")!=pending.thread))return;put(frame,L"id",pending.ui_id);deliver(frame);
 }
 void renderer(std::wstring const& source,std::wstring const& body){if(!ready||source!=document_url||generation.empty())return;auto frame=flat(body);if(text(frame,L"generation")!=generation)return;auto type=text(frame,L"type");if(type==L"desktop.view"&&keys(frame,{L"type",L"view",L"generation"})){auto next=text(frame,L"view");if(next==L"compact"||next==L"workspace")show(next);return;}
  if(local_method(type)){render_local(frame);return;}
  std::set<std::wstring> allowed{L"type",L"id",L"generation"};if(type==L"thread.peek")allowed.insert(L"thread_id");
  if(type==L"thread.search"){
   allowed.insert(L"query");if(frame.HasKey(L"limit"))allowed.insert(L"limit");auto query=frame.TryLookup(L"query");auto id=frame.TryLookup(L"id");
   if(frame.Size()!=allowed.size()||!query||query.ValueType()!=JsonValueType::String||query.GetString().size()>120||!id||id.ValueType()!=JsonValueType::String||id.GetString().size()>200)return;
   if(frame.HasKey(L"limit")){auto value=frame.GetNamedValue(L"limit");if(value.ValueType()!=JsonValueType::Number)return;auto limit=value.GetNumber();if(!std::isfinite(limit)||std::floor(limit)!=limit||limit<1||limit>20)return;}
  }
  if(type==L"desktop.archive.list"||type==L"desktop.archive.state"||type==L"desktop.archive.set"){
   if(type==L"desktop.archive.list"){if(frame.HasKey(L"query"))allowed.insert(L"query");}
   else{allowed.insert(L"thread_id");if(type==L"desktop.archive.set"){allowed.insert(L"revision");allowed.insert(L"archived");}}
   if(frame.Size()!=allowed.size()||text(frame,L"id").empty()||text(frame,L"id").size()>200)return;
   if(type==L"desktop.archive.list"){if(frame.HasKey(L"query")){auto query=frame.GetNamedValue(L"query");if(query.ValueType()!=JsonValueType::String||query.GetString().size()>120)return;}}
   else{auto target=text(frame,L"thread_id");if(target.empty()||target.size()>64||!std::all_of(target.begin(),target.end(),[](wchar_t c){return(c>=L'a'&&c<=L'z')||(c>=L'A'&&c<=L'Z')||(c>=L'0'&&c<=L'9')||c==L'_'||c==L'-';}))return;if(type==L"desktop.archive.set"&&(!hex(text(frame,L"revision"),64)||!frame.TryLookup(L"archived")||frame.GetNamedValue(L"archived").ValueType()!=JsonValueType::Boolean))return;}
  }
  if(type==L"desktop.browser.tasks"||type==L"desktop.browser.visibility"){
   allowed.insert(L"thread_id");if(type==L"desktop.browser.visibility"){allowed.insert(L"context_id");allowed.insert(L"selection_id");allowed.insert(L"visibility");}
   auto target=text(frame,L"thread_id");if(frame.Size()!=allowed.size()||target.empty()||target.size()>64||!std::all_of(target.begin(),target.end(),[](wchar_t c){return(c>=L'a'&&c<=L'z')||(c>=L'A'&&c<=L'Z')||(c>=L'0'&&c<=L'9')||c==L'_'||c==L'-';}))return;
   if(type==L"desktop.browser.visibility"&&(browser_request.empty()||browser_thread!=target||!hex(text(frame,L"context_id"),32)||!hex(text(frame,L"selection_id"),32)||(text(frame,L"visibility")!=L"background"&&text(frame,L"visibility")!=L"foreground")))return;
  }
  if(type==L"desktop.mcp.edit"||type==L"desktop.mcp.save"){allowed.insert(L"name");allowed.insert(L"thread_id");if(type==L"desktop.mcp.save"){allowed.insert(L"action");allowed.insert(L"payload_json");}if(frame.Size()!=allowed.size()||text(frame,L"name").empty()||requests.count(L"desktop.mcp.save"))return;auto thread=frame.TryLookup(L"thread_id");if(!thread||(thread.ValueType()!=JsonValueType::Null&&thread.ValueType()!=JsonValueType::String))return;if(type==L"desktop.mcp.save"&&(text(frame,L"payload_json").empty()||(text(frame,L"action")!=L"add"&&text(frame,L"action")!=L"update")))return;}
  if(type==L"desktop.resource.read"||type==L"desktop.resource.import"||type==L"desktop.resource.update"||type==L"desktop.resource.remove"){
   allowed.insert(L"kind");if(type!=L"desktop.resource.import")allowed.insert(L"resource_id");if(type==L"desktop.resource.update"||type==L"desktop.resource.remove")allowed.insert(L"revision");if(type==L"desktop.resource.import"||type==L"desktop.resource.update")allowed.insert(L"payload_json");
   auto id=text(frame,L"id"),kind=text(frame,L"kind");if(frame.Size()!=allowed.size()||id.empty()||id.size()>128||!std::all_of(id.begin(),id.end(),[](wchar_t c){return(c>=L'a'&&c<=L'z')||(c>=L'A'&&c<=L'Z')||(c>=L'0'&&c<=L'9')||c==L'_'||c==L'-';})||(kind!=L"skill"&&kind!=L"knowledge"))return;
   if(type!=L"desktop.resource.import"&&text(frame,L"resource_id").empty())return;
   if((type==L"desktop.resource.update"||type==L"desktop.resource.remove")&&!hex(text(frame,L"revision"),64))return;
   if(type==L"desktop.resource.update"&&kind!=L"knowledge")return;
   if((type==L"desktop.resource.import"||type==L"desktop.resource.update")&&text(frame,L"payload_json").empty())return;
   if(type!=L"desktop.resource.read"&&(requests.count(L"desktop.resource.import")||requests.count(L"desktop.resource.update")||requests.count(L"desktop.resource.remove")))return;
  }
  if(type.rfind(L"desktop.workspace.",0)==0){
   if(!std::set<std::wstring>{L"desktop.workspace.state",L"desktop.workspace.pick",L"desktop.workspace.list",L"desktop.workspace.read",L"desktop.workspace.cancel"}.count(type))return;
   allowed.insert(L"thread_id");if(type!=L"desktop.workspace.state"&&type!=L"desktop.workspace.cancel")allowed.insert(L"revision");if(type==L"desktop.workspace.read"||(type==L"desktop.workspace.list"&&frame.HasKey(L"path")))allowed.insert(L"path");if(type==L"desktop.workspace.cancel")allowed.insert(L"operation_id");
   if(frame.Size()!=allowed.size()||text(frame,L"id").empty()||text(frame,L"id").size()>200||text(frame,L"thread_id").empty())return;
   if(type!=L"desktop.workspace.state"&&type!=L"desktop.workspace.cancel"&&!hex(text(frame,L"revision"),64))return;
   if(allowed.count(L"path")){auto value=frame.TryLookup(L"path");if(!value||value.ValueType()!=JsonValueType::String)return;}
   if(type==L"desktop.workspace.pick"&&requests.count(type))return;
   if(type==L"desktop.workspace.state")retire_workspace(false);
   if(type==L"desktop.workspace.cancel"){auto active=requests.find(L"desktop.workspace.pick");if(active==requests.end()||active->second.generation!=generation||active->second.thread!=text(frame,L"thread_id")||active->second.ui_id!=text(frame,L"operation_id")||text(frame,L"operation_id").size()>200)return;retire_picker();auto original=text(frame,L"operation_id");put(frame,L"operation_id",active->second.native_id);requests.erase(active);if(confirmation&&confirmation->purpose==L"workspace")retire_confirmation(0);auto native=random_id();requests[type]={native,text(frame,L"id"),generation,text(frame,L"thread_id"),L"",original,L""};frame.Remove(L"generation"); put(frame,L"id",native);send(frame);return;}
  }
  if(type==L"desktop.thread.metadata.edit"||type==L"desktop.thread.metadata.save"){allowed.insert(L"thread_id");if(type==L"desktop.thread.metadata.save")allowed.insert(L"payload_json");if(frame.Size()!=allowed.size()||text(frame,L"id").empty()||text(frame,L"id").size()>200||text(frame,L"thread_id").empty()||(type==L"desktop.thread.metadata.save"&&text(frame,L"payload_json").empty()))return;}
  if(type==L"desktop.thread.create"||type==L"desktop.thread.open"||type==L"desktop.chat.send"||type==L"desktop.chat.stop"){
   if(type!=L"desktop.thread.create")allowed.insert(L"thread_id");if(type==L"desktop.chat.send")allowed.insert(L"message");if(type==L"desktop.chat.stop")allowed.insert(L"run_id");
   if(frame.Size()!=allowed.size()||text(frame,L"id").empty()||text(frame,L"id").size()>200||(type!=L"desktop.thread.create"&&text(frame,L"thread_id").empty()))return;
   if(type==L"desktop.chat.send"&&(text(frame,L"message").empty()||requests.count(type)))return;
   if(type==L"desktop.thread.create"&&requests.count(type))return;
   if(type==L"desktop.chat.stop"){auto active=requests.find(L"desktop.chat.send");if(active==requests.end()||active->second.generation!=generation||active->second.thread!=text(frame,L"thread_id")||active->second.ui_id!=text(frame,L"run_id"))return;put(frame,L"run_id",active->second.native_id);}
  }
  for(auto const& item:frame)if(!allowed.count(std::wstring(item.Key())))return;if(!method(type))return;auto original=frame.TryLookup(L"id");if(original&&original.ValueType()!=JsonValueType::String)return;if(type==L"thread.peek"&&text(frame,L"thread_id").empty())return;if(type.rfind(L"desktop.workspace.",0)==0)workspace_owner=text(frame,L"thread_id");DESKTOP_TEST_NOTE(renderer_admitted)bool changeThread=type==L"thread.peek"||type==L"desktop.thread.open"||type==L"desktop.chat.send";if(type==L"desktop.thread.create"||(changeThread&&local_thread!=text(frame,L"thread_id"))){if(confirmation&&confirmation->purpose==L"local-work")retire_confirmation(0);local_thread.clear();}bool allBrowser=type==L"desktop.thread.create"||(changeThread&&!browser_thread.empty()&&browser_thread!=text(frame,L"thread_id"));bool viewBrowser=changeThread||type==L"thread.list"||type==L"mcp.list"||type==L"skill.list"||type==L"knowledge.list"||type==L"desktop.browser.status"||type==L"desktop.browser.tasks";if((allBrowser||viewBrowser)&&!retire_browser(allBrowser))ExitProcess(46);if(type==L"desktop.archive.state"||type==L"desktop.archive.set")archive_target=text(frame,L"thread_id");auto id=random_id();requests[type]={id,text(frame,L"id"),generation,text(frame,L"thread_id"),text(frame,L"kind"),text(frame,L"resource_id"),text(frame,L"revision")};if(type==L"desktop.browser.tasks"){browser_request=id;browser_thread=text(frame,L"thread_id");}frame.Remove(L"generation");put(frame,L"id",id);send(frame);DESKTOP_TEST_NOTE(renderer_send_attempted)
 }
 void build_webview(){
  // UDF is exclusively owned by this host. No existing browser profile is opened.
  wchar_t temporary[MAX_PATH];DWORD temporary_length=GetTempPathW(MAX_PATH,temporary);if(!temporary_length||temporary_length>=MAX_PATH)throw std::runtime_error("PROFILE");profile=std::wstring(temporary)+L"cmspark-desktop-"+random_id();if(!CreateDirectoryW(profile.c_str(),nullptr))throw std::runtime_error("PROFILE");
  auto result=CreateCoreWebView2EnvironmentWithOptions(nullptr,profile.c_str(),nullptr,Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([this](HRESULT hr,ICoreWebView2Environment* env)->HRESULT{DESKTOP_TEST_NOTE(env_callback)if(FAILED(hr)||!env){ExitProcess(51);return E_FAIL;}environment=env;
   auto controller_result=env->CreateCoreWebView2Controller(window,Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([this](HRESULT code,ICoreWebView2Controller* host)->HRESULT{DESKTOP_TEST_NOTE(controller_callback)if(FAILED(code)||!host){ExitProcess(52);return E_FAIL;}controller=host;if(FAILED(host->get_CoreWebView2(&web))||!web){ExitProcess(53);return E_FAIL;}
    ComPtr<ICoreWebView2Settings> settings;web->get_Settings(&settings);settings->put_AreDevToolsEnabled(FALSE);settings->put_AreDefaultContextMenusEnabled(FALSE);settings->put_AreDefaultScriptDialogsEnabled(FALSE);settings->put_IsStatusBarEnabled(FALSE);settings->put_IsWebMessageEnabled(TRUE);
    // Virtual-folder mapping bypasses WebResourceRequested; this origin uses only the nonce-aware response handler.
    EventRegistrationToken token{};
    auto navigation_start_result=web->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([this](ICoreWebView2*,ICoreWebView2NavigationStartingEventArgs* args)->HRESULT{LPWSTR uri=nullptr;args->get_Uri(&uri);bool allow=uri&&std::wstring(uri)==document_url;CoTaskMemFree(uri);args->put_Cancel(!allow);if(allow){retire_local();retire_workspace();if(!retire_browser(true))ExitProcess(46);retire_archive();retire_dialog();retire_confirmation(0);generation.clear();requests.clear();style_nonce=random_id()+random_id();}return S_OK;}).Get(),&token);if(FAILED(navigation_start_result)){ExitProcess(54);return navigation_start_result;}
    web->add_FrameNavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([](ICoreWebView2*,ICoreWebView2NavigationStartingEventArgs* args)->HRESULT{args->put_Cancel(TRUE);return S_OK;}).Get(),&token);
    web->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>([](ICoreWebView2*,ICoreWebView2NewWindowRequestedEventArgs* args)->HRESULT{args->put_Handled(TRUE);return S_OK;}).Get(),&token);
    web->add_PermissionRequested(Callback<ICoreWebView2PermissionRequestedEventHandler>([](ICoreWebView2*,ICoreWebView2PermissionRequestedEventArgs* args)->HRESULT{args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);return S_OK;}).Get(),&token);
    ComPtr<ICoreWebView2_4> downloads;if(SUCCEEDED(web.As(&downloads)))downloads->add_DownloadStarting(Callback<ICoreWebView2DownloadStartingEventHandler>([](ICoreWebView2*,ICoreWebView2DownloadStartingEventArgs* args)->HRESULT{args->put_Cancel(TRUE);return S_OK;}).Get(),&token);else{ExitProcess(55);return E_FAIL;}
    auto resource_filter_result=web->AddWebResourceRequestedFilter(L"*",COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);if(FAILED(resource_filter_result)){ExitProcess(54);return resource_filter_result;}
    auto resource_handler_result=web->add_WebResourceRequested(Callback<ICoreWebView2WebResourceRequestedEventHandler>([this](ICoreWebView2*,ICoreWebView2WebResourceRequestedEventArgs* args)->HRESULT{ComPtr<ICoreWebView2WebResourceRequest> request;args->get_Request(&request);LPWSTR uri=nullptr;request->get_Uri(&uri);std::wstring u=uri?uri:L"";CoTaskMemFree(uri);std::map<std::wstring,std::pair<std::wstring,std::wstring>> resources{{document_url,{L"index.html",L"text/html"}},{std::wstring(document_origin)+L"app.css",{L"app.css",L"text/css"}},{std::wstring(document_origin)+L"app.js",{L"app.js",L"text/javascript"}},{std::wstring(document_origin)+L"local-work.js",{L"local-work.js",L"text/javascript"}},{std::wstring(document_origin)+L"terminal-core.js",{L"terminal-core.js",L"text/javascript"}},{std::wstring(document_origin)+L"terminal-fit.js",{L"terminal-fit.js",L"text/javascript"}},{std::wstring(document_origin)+L"terminal.css",{L"terminal.css",L"text/css"}}};auto found=resources.find(u);ComPtr<ICoreWebView2WebResourceResponse> response;
      if(found==resources.end())environment->CreateWebResourceResponse(nullptr,403,L"Denied",L"",&response);else{std::ifstream file(std::filesystem::path(root+L"\\assets\\"+found->second.first),std::ios::binary);std::string data((std::istreambuf_iterator<char>(file)),{});if(found->second.first==L"index.html"&&!desktop_style_html(data,style_nonce)){environment->CreateWebResourceResponse(nullptr,403,L"Denied",L"",&response);args->put_Response(response.Get());return S_OK;}ComPtr<IStream> stream;stream.Attach(SHCreateMemStream((BYTE const*)data.data(),(UINT)data.size()));environment->CreateWebResourceResponse(stream.Get(),file?200:404,file?L"OK":L"Missing",(L"Content-Type: "+found->second.second+L"; charset=utf-8\r\nX-Content-Type-Options: nosniff\r\n").c_str(),&response);}args->put_Response(response.Get());return S_OK;}).Get(),&token);if(FAILED(resource_handler_result)){ExitProcess(54);return resource_handler_result;}
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
  if(message==native_frame||message==native_connect||message==native_offline){std::unique_ptr<Frame> frame((Frame*)l);if(frame->epoch!=self->epoch)return 0;try{if(message==native_connect){self->retire_local();self->retire_picker();self->retire_confirmation();self->phase=L"initial";self->generation.clear();self->requests.clear();}else if(message==native_offline){self->retire_local();self->retire_picker();self->retire_confirmation();self->ready=false;self->archive_target.clear();self->browser_request.clear();self->browser_thread.clear();self->generation.clear();self->requests.clear();if(self->web){JsonObject offline;put(offline,L"type",L"desktop.offline");self->web->PostWebMessageAsJson(offline.Stringify().c_str());}}else self->accept(frame->value,frame->epoch);}catch(...){ExitProcess(45);}return 0;}
  if(message==WM_TIMER&&w==workspace_picker_timer){auto p=self->workspace_selection;if(p&&!p->settled&&wall_ms()>=p->deadline)self->finish_picker(p,L"unavailable");return 0;}
  if(message==WM_CLOSE){self->retire_local();self->retire_workspace();if(!self->retire_browser(true))ExitProcess(46);self->retire_archive();self->retire_dialog();self->retire_confirmation(0);DestroyWindow(hwnd);return 0;}if(message==WM_DESTROY){if(self->controller)self->controller->Close();PostQuitMessage(0);return 0;}return DefWindowProcW(hwnd,message,w,l);
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
 auto boot=flat(wide(data));SecureZeroMemory(data.data(),data.size());if(!keys(boot,{L"capability_id",L"secret",L"url",L"protocol_version",L"issued_method_set_version",L"parent_handle"})||!hex(text(boot,L"capability_id"),32)||!hex(text(boot,L"secret"),64)||!exact_one(boot,L"protocol_version")||boot.GetNamedValue(L"issued_method_set_version").ValueType()!=JsonValueType::Number||boot.GetNamedNumber(L"issued_method_set_version")!=desktop_method_set_version||desktop_method_set_version!=10)return 15;
 auto url=text(boot,L"url");std::wstring prefix=L"ws://127.0.0.1:";if(url.rfind(prefix,0)!=0||url.size()<prefix.size()+9||url.substr(url.size()-8)!=L"/desktop")return 15;auto port_text=url.substr(prefix.size(),url.size()-prefix.size()-8);if(port_text.empty()||port_text.size()>5||!std::all_of(port_text.begin(),port_text.end(),[](wchar_t c){return c>=L'0'&&c<=L'9';}))return 15;unsigned port=std::stoul(port_text);if(!port||port>65535)return 15;
 auto parent_text=text(boot,L"parent_handle");if(parent_text.empty()||parent_text[0]==L'0'||!std::all_of(parent_text.begin(),parent_text.end(),[](wchar_t c){return c>=L'0'&&c<=L'9';}))return 16;size_t used=0;auto number=std::stoull(parent_text,&used,10);if(used!=parent_text.size()||number>(uintptr_t)-1)return 16;HANDLE parent=(HANDLE)(uintptr_t)number;if(!sync_parent(parent))return 16;if(!d480_client_finish(&bootstrap,parent))return 16;
 CloseHandle(input);bootstrap.pipe=nullptr;
 d480_client_close(&bootstrap);
 std::thread([parent](){if(WaitForSingleObject(parent,INFINITE)==WAIT_OBJECT_0)ExitProcess(1);ExitProcess(17);}).detach();
 wchar_t binary[32768];DWORD length=GetModuleFileNameW(nullptr,binary,32768);if(!length||length==32768)return 18;std::wstring root(binary,length);auto slash=root.find_last_of(L"\\/");if(slash==std::wstring::npos)return 18;root.resize(slash);
 Desktop app(text(boot,L"capability_id"),text(boot,L"secret"),(INTERNET_PORT)port,root);return app.run(instance);
 }catch(...){return 15;}}
