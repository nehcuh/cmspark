// Unshipped acceptance declarations, inserted before the exact production Desktop class.
#include <cstdio>
#include <chrono>
// Parent-only zero-access identity references. No reference enters the checker.
using D480Compare=BOOL (WINAPI *)(HANDLE,HANDLE);
static D480Compare d480_identity_api(){return (D480Compare)GetProcAddress(GetModuleHandleW(L"kernelbase.dll"),"CompareObjectHandles");}
static bool d480_identity_one(HANDLE process,HANDLE subject,HANDLE reference,D480Compare compare,bool* same){
 DWORD flags=0;*same=false;
 if(!compare||!GetHandleInformation(reference,&flags)||(flags&HANDLE_FLAG_INHERIT)||!compare(reference,reference)||!GetHandleInformation(process,&flags)||WaitForSingleObject(process,0)!=WAIT_TIMEOUT)return false;
 HANDLE copy=nullptr;SetLastError(ERROR_SUCCESS);
 if(!DuplicateHandle(process,subject,GetCurrentProcess(),&copy,0,FALSE,0)){
  DWORD error=GetLastError();
  return error==ERROR_INVALID_HANDLE&&GetHandleInformation(reference,&flags)&&!(flags&HANDLE_FLAG_INHERIT)&&WaitForSingleObject(process,0)==WAIT_TIMEOUT;
 }
 bool valid=GetHandleInformation(copy,&flags)&&!(flags&HANDLE_FLAG_INHERIT)&&compare(copy,copy)&&compare(reference,reference);
 SetLastError(ERROR_SUCCESS);BOOL equal=compare(copy,reference);DWORD error=GetLastError();
 valid=valid&&(equal||error==ERROR_NOT_SAME_OBJECT||error==ERROR_SUCCESS)&&GetHandleInformation(copy,&flags)&&!(flags&HANDLE_FLAG_INHERIT)&&GetHandleInformation(reference,&flags)&&!(flags&HANDLE_FLAG_INHERIT)&&WaitForSingleObject(process,0)==WAIT_TIMEOUT;
 bool closed=CloseHandle(copy)!=FALSE;
 if(valid&&equal)*same=true;
 return valid&&closed;
}
static bool d480_known_identity(HANDLE process,const HANDLE known[3],const HANDLE refs[3],D480Compare compare,unsigned* mask){
 *mask=0;for(unsigned i=0;i<3;i++){bool same=false;if(!d480_identity_one(process,known[i],refs[i],compare,&same))return false;if(same)*mask|=1u<<i;}return true;
}
class Desktop;
class D480Acceptance {
 inline static unsigned auths=0,createdCount=0,admitted=0;
 inline static HWND firstWindow=nullptr;
 inline static int phase=0;
 inline static std::wstring oldGeneration;
 // One exact top-level cancelled navigation in the current ready document.
 inline static bool remotePending=false;
 inline static UINT64 remoteNavigationId=0;
 inline static std::wstring remoteGeneration;
 inline static HANDLE oldInput=nullptr,ownedSentinel=nullptr,knownParent=nullptr;
 inline static HANDLE identityRefs[3]{};
 inline static unsigned controlIdentity=257,descendantIdentity=257;
 inline static bool inputWasClosed=false,parentWasCleared=false,descendantDenied=false,checkerPositive=false;
 inline static ULONGLONG inheritanceStarted=0;
 // Test-only finite observations: 257=not run, 256=unexpected status; no raw HANDLE/path/error.
 inline static unsigned inheritanceStage=0,controlResult=257,descendantResult=257;
 inline static HANDLE parentReceipt=nullptr;
 inline static BY_HANDLE_FILE_INFORMATION parentReceiptInfo{};
 struct CheckerResult{DWORD raw=255;unsigned objects=256;bool valid=false;};
 static CheckerResult inheritedChecker(std::wstring const&,wchar_t const*);
 static bool captureReference(HANDLE,unsigned);
 static void closeReferences();
 static void emit(Desktop&,std::wstring const&);
 static void script(Desktop&,wchar_t const*,std::wstring const&);
 public:
 struct InheritanceScope{~InheritanceScope(){D480Acceptance::closeReferences();if(D480Acceptance::ownedSentinel){CloseHandle(D480Acceptance::ownedSentinel);D480Acceptance::ownedSentinel=nullptr;}}};
 static void safetyWatchdog();
 static void parentObserved();
 static void preConsume(HANDLE);
 static void inputClosed(HANDLE);
 static void parentCleared(HANDLE);
 static void created(Desktop&);
 static void window(Desktop&);
 static void auth(Desktop&);
 static void document(Desktop&);
 static void message(Desktop&,std::wstring const&,std::wstring const&);
 static void forward(Desktop&,JsonObject const&);
 static void navigation(Desktop&,ICoreWebView2NavigationStartingEventArgs*);
 static void completed(Desktop&,ICoreWebView2NavigationCompletedEventArgs*);
 static void newWindow(Desktop&);
 static void download(Desktop&);
 static void attach(Desktop&);
 static void settled(Desktop&);
};
// D480_IMPLEMENTATION
void D480Acceptance::emit(Desktop& h,std::wstring const& value){try{JsonObject out;put(out,L"type",L"system.ping");put(out,L"id",L"D480A_"+value);(void)h.send(out);}catch(...){/* Missing observation fails coordinator. */}}
void D480Acceptance::script(Desktop& h,wchar_t const* literal,std::wstring const& generation){
 if(!h.web||generation.empty()){emit(h,L"FAIL_NO_DOCUMENT");return;}
 std::wstring code=L"(function(g){"+std::wstring(literal)+L"})("+std::wstring(JsonValue::CreateStringValue(generation).Stringify())+L")";
 HRESULT started=h.web->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT status,LPCWSTR)->HRESULT{if(FAILED(status))emit(h,L"FAIL_SCRIPT");return S_OK;}).Get());if(FAILED(started))emit(h,L"FAIL_SCRIPT");
}
void D480Acceptance::created(Desktop& h){if(h.window)createdCount++;}
void D480Acceptance::auth(Desktop& h){auths++;emit(h,L"AUTH_"+std::to_wstring(auths));
#ifdef D480_PARENT
 emit(h,parentReceipt?L"PARENT_LOCK_ARMED":L"FAIL_PARENT_LOCK");
#endif
#ifdef D480_INHERITANCE
 bool checkBits[]={inputWasClosed,parentWasCleared,checkerPositive,descendantDenied};std::wstring checks;for(bool bit:checkBits)checks+=bit?L'1':L'0';
 emit(h,L"INHERITANCE_"+checks+L"_"+std::to_wstring(inheritanceStage)+L"_"+std::to_wstring(controlResult)+L"_"+std::to_wstring(descendantResult));
 emit(h,L"IDENTITY_"+std::to_wstring(controlIdentity)+L"_"+std::to_wstring(descendantIdentity));
 emit(h,inputWasClosed&&parentWasCleared&&descendantDenied&&checkerPositive?L"CONSUMED_HANDLES_DENIED":L"FAIL_DESCENDANT_NOT_OBSERVED");
#endif
}
void D480Acceptance::window(Desktop& h){
 if(!firstWindow)firstWindow=h.window;
 RECT client{},frame{};MONITORINFO monitor{sizeof(monitor)};
 if(!GetClientRect(h.window,&client)||!GetWindowRect(h.window,&frame)||!GetMonitorInfoW(MonitorFromWindow(h.window,MONITOR_DEFAULTTONEAREST),&monitor)){emit(h,L"FAIL_WINDOW");return;}
 SIZE desired=h.view==L"compact"?h.compact:h.workspace;RECT converted{0,0,desired.cx,desired.cy};
 if(!AdjustWindowRectEx(&converted,WS_OVERLAPPEDWINDOW,FALSE,0)){emit(h,L"FAIL_WINDOW");return;}
 LONG ew=std::min(desired.cx,monitor.rcWork.right-monitor.rcWork.left-(converted.right-converted.left-desired.cx));
 LONG eh=std::min(desired.cy,monitor.rcWork.bottom-monitor.rcWork.top-(converted.bottom-converted.top-desired.cy));
 bool foreground=GetForegroundWindow()==h.window;
 bool bits[]={IsWindowVisible(h.window)!=FALSE,foreground,foreground,firstWindow==h.window,createdCount==1,client.right==ew&&client.bottom==eh,frame.left>=monitor.rcWork.left&&frame.top>=monitor.rcWork.top&&frame.right<=monitor.rcWork.right&&frame.bottom<=monitor.rcWork.bottom};
 std::wstring suffix;for(bool bit:bits)suffix+=bit?L'1':L'0';
 emit(h,L"WINDOW_"+std::wstring(h.view==L"compact"?L"C":L"W")+L"_"+std::to_wstring(client.right)+L"_"+std::to_wstring(client.bottom)+L"_"+std::to_wstring(ew)+L"_"+std::to_wstring(eh)+L"_"+suffix);
}
void D480Acceptance::document(Desktop& h){
#ifdef D480_HOSTILE
 if(phase==0){
  oldGeneration=h.generation;phase=1;ComPtr<ICoreWebView2Settings> settings;BOOL enabled=TRUE;
  if(FAILED(h.web->get_Settings(&settings))||FAILED(settings->get_AreDevToolsEnabled(&enabled)))emit(h,L"FAIL_ENGINE_API");else emit(h,enabled?L"FAIL_DEVTOOLS":L"DEVTOOLS_DENIED");
  script(h,L"const f=document.createElement('iframe');document.body.appendChild(f);",h.generation);
 }else if(phase==5){
  if(oldGeneration==h.generation){emit(h,L"FAIL_GENERATION");return;}
  emit(h,L"DOCUMENT_FRESH");phase=6;script(h,L"chrome.webview.postMessage({type:'mcp.list',id:'D480A_HIT_STALE',generation:g});",oldGeneration);
 }
#else
 (void)h;
#endif
}
void D480Acceptance::message(Desktop& h,std::wstring const& source,std::wstring const& body){
#ifdef D480_HOSTILE
 try{auto f=flat(body);if(phase==6&&source==document_url&&text(f,L"id")==L"D480A_HIT_STALE")PostMessageW(h.window,WM_APP+100,0,0);}catch(...){}
#else
 (void)h;(void)source;(void)body;
#endif
}
void D480Acceptance::forward(Desktop& h,JsonObject const& frame){(void)h;if(text(frame,L"id").rfind(L"D480A_HIT_",0)==0)admitted++;}
void D480Acceptance::navigation(Desktop& h,ICoreWebView2NavigationStartingEventArgs* args){
#ifdef D480_HOSTILE
 if(phase!=2||remotePending||!h.ready||h.generation.empty()||!args)return;
 const std::wstring generation=h.generation;
 LPWSTR uri=nullptr;HRESULT uriStatus=args->get_Uri(&uri);
 bool blocked=SUCCEEDED(uriStatus)&&uri&&std::wstring(uri)==L"https://cmspark-480-blocked.invalid/";
 CoTaskMemFree(uri);if(!blocked)return;
 UINT64 navigationId=0;if(FAILED(args->get_NavigationId(&navigationId)))return;
 if(phase!=2||remotePending||!h.ready||h.generation!=generation)return;
 remoteNavigationId=navigationId;remoteGeneration=generation;remotePending=true;
#else
 (void)h;(void)args;
#endif
}
void D480Acceptance::completed(Desktop& h,ICoreWebView2NavigationCompletedEventArgs* args){
#ifdef D480_HOSTILE
 if(phase!=2||!remotePending||!h.ready||!h.web||!args||h.generation!=remoteGeneration)return;
 const auto web=h.web;const std::wstring generation=remoteGeneration;
 UINT64 navigationId=0;BOOL succeeded=TRUE;
 COREWEBVIEW2_WEB_ERROR_STATUS status=COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
 if(FAILED(args->get_NavigationId(&navigationId))||navigationId!=remoteNavigationId||
    FAILED(args->get_IsSuccess(&succeeded))||succeeded||
    FAILED(args->get_WebErrorStatus(&status))||status!=COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED)return;
 LPWSTR uri=nullptr;HRESULT sourceStatus=web->get_Source(&uri);
 bool own=SUCCEEDED(sourceStatus)&&uri&&std::wstring(uri)==document_url;
 CoTaskMemFree(uri);
 if(!own||phase!=2||!remotePending||remoteNavigationId!=navigationId||remoteGeneration!=generation||!h.ready||h.web.Get()!=web.Get()||h.generation!=generation)return;
 remotePending=false;phase=3;
 emit(h,L"REMOTE_DENIED");script(h,L"window.open('https://cmspark-480-blocked.invalid/','_blank');",generation);
#else
 (void)h;(void)args;
#endif
}
void D480Acceptance::newWindow(Desktop& h){
#ifdef D480_HOSTILE
 if(phase==3){emit(h,L"NEW_WINDOW_DENIED");phase=4;script(h,L"const a=document.createElement('a');a.href='https://cmspark-desktop.invalid/index.html';a.download='owned-inert.txt';document.body.appendChild(a);a.click();",h.generation);}
#else
 (void)h;
#endif
}
void D480Acceptance::download(Desktop& h){
#ifdef D480_HOSTILE
 if(phase==4){emit(h,L"DOWNLOAD_DENIED");phase=5;h.web->Reload();}
#else
 (void)h;
#endif
}
void D480Acceptance::attach(Desktop& h){
#ifdef D480_HOSTILE
 // Observe the original production cancellation; never advance inside Starting.
 EventRegistrationToken startingToken{},completedToken{};
 HRESULT starting=h.web->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([&h](ICoreWebView2* sender,ICoreWebView2NavigationStartingEventArgs* args)->HRESULT{
  if(sender&&sender==h.web.Get())D480Acceptance::navigation(h,args);return S_OK;
 }).Get(),&startingToken);
 HRESULT completedRegistration=h.web->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>([&h](ICoreWebView2* sender,ICoreWebView2NavigationCompletedEventArgs* args)->HRESULT{
  if(sender&&sender==h.web.Get())D480Acceptance::completed(h,args);return S_OK;
 }).Get(),&completedToken);
 if(FAILED(starting)||FAILED(completedRegistration)){emit(h,L"FAIL_ENGINE_API");return;}
 ComPtr<ICoreWebView2_4> frames;if(FAILED(h.web.As(&frames))){emit(h,L"FAIL_ENGINE_API");return;}
 EventRegistrationToken token{};
 HRESULT result=frames->add_FrameCreated(Callback<ICoreWebView2FrameCreatedEventHandler>([&h](ICoreWebView2*,ICoreWebView2FrameCreatedEventArgs* args)->HRESULT{
  ComPtr<ICoreWebView2Frame> frame;ComPtr<ICoreWebView2Frame2> bridge;
  if(FAILED(args->get_Frame(&frame))||FAILED(frame.As(&bridge))){emit(h,L"FAIL_ENGINE_API");return S_OK;}
  EventRegistrationToken messageToken{};
  HRESULT listening=bridge->add_WebMessageReceived(Callback<ICoreWebView2FrameWebMessageReceivedEventHandler>([&h](ICoreWebView2Frame*,ICoreWebView2WebMessageReceivedEventArgs* message)->HRESULT{
   LPWSTR body=nullptr;if(SUCCEEDED(message->get_WebMessageAsJson(&body))&&body){try{auto f=flat(body);if(phase==1&&text(f,L"id")==L"D480A_HIT_FRAME")PostMessageW(h.window,WM_APP+100,0,0);}catch(...){}CoTaskMemFree(body);}return S_OK;
  }).Get(),&messageToken);
  if(FAILED(listening)){emit(h,L"FAIL_ENGINE_API");return S_OK;}
  // Frame2 drops ExecuteScript before ContentLoading, even with S_OK/null.
  // Register while the frame is created, then dispatch once in its ready document.
  auto attempted=std::make_shared<bool>(false);const std::wstring frameGeneration=h.generation;
  EventRegistrationToken loadedToken{};
  HRESULT loading=bridge->add_DOMContentLoaded(Callback<ICoreWebView2FrameDOMContentLoadedEventHandler>([&h,attempted,frameGeneration](ICoreWebView2Frame* sender,ICoreWebView2DOMContentLoadedEventArgs*)->HRESULT{
   if(phase!=1||*attempted||h.generation!=frameGeneration)return S_OK;*attempted=true;
   ComPtr<ICoreWebView2Frame> currentFrame=sender;ComPtr<ICoreWebView2Frame2> current;
   if(!sender||FAILED(currentFrame.As(&current))){emit(h,L"FAIL_FRAME_NOT_OBSERVED");return S_OK;}
   std::wstring code=L"chrome.webview.postMessage({type:'mcp.list',id:'D480A_HIT_FRAME',generation:"+std::wstring(JsonValue::CreateStringValue(frameGeneration).Stringify())+L"});";
   HRESULT executed=current->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT status,LPCWSTR)->HRESULT{if(FAILED(status))emit(h,L"FAIL_FRAME_NOT_OBSERVED");return S_OK;}).Get());if(FAILED(executed))emit(h,L"FAIL_FRAME_NOT_OBSERVED");return S_OK;
  }).Get(),&loadedToken);if(FAILED(loading))emit(h,L"FAIL_ENGINE_API");return S_OK;
 }).Get(),&token);if(FAILED(result))emit(h,L"FAIL_ENGINE_API");
#else
 (void)h;
#endif
}
void D480Acceptance::settled(Desktop& h){
#ifdef D480_HOSTILE
 if(admitted){emit(h,L"FAIL_HOSTILE_FORWARDED");return;}
 if(phase==1){emit(h,L"FRAME_DENIED");phase=2;script(h,L"location.href='https://cmspark-480-blocked.invalid/';",h.generation);}
 else if(phase==6){emit(h,L"STALE_DENIED");phase=7;}
#else
 (void)h;
#endif
}

void D480Acceptance::preConsume(HANDLE input){
#ifdef D480_PARENT
 wchar_t raw[32768];DWORD count=GetModuleFileNameW(nullptr,raw,32768);
 if(count&&count<32768){std::wstring file(raw,count);auto slash=file.find_last_of(L"\\/");if(slash!=std::wstring::npos){file.resize(slash+1);file+=L"parent-exit.receipt";
  HANDLE fd=CreateFileW(file.c_str(),GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);OVERLAPPED lock{};
  if(fd!=INVALID_HANDLE_VALUE){BY_HANDLE_FILE_INFORMATION info{};if(GetFileInformationByHandle(fd,&info)&&!(info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))&&info.nNumberOfLinks==1&&!info.nFileSizeHigh&&!info.nFileSizeLow&&LockFileEx(fd,LOCKFILE_EXCLUSIVE_LOCK|LOCKFILE_FAIL_IMMEDIATELY,0,1,0,&lock)){// Separate fixed, coordinator-created metadata binds the probe's process HANDLE.
    // This test-only record is neither an authentication proof nor a PID scan.
    std::wstring processFile=file.substr(0,file.find_last_of(L"\\/")+1)+L"parent-process.receipt";
    HANDLE processRecord=CreateFileW(processFile.c_str(),GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
    FILETIME created{},ended{},kernel{},user{};BY_HANDLE_FILE_INFORMATION recordInfo{};DWORD wrote=0;
    bool valid=processRecord!=INVALID_HANDLE_VALUE&&GetFileInformationByHandle(processRecord,&recordInfo)&&!(recordInfo.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))&&recordInfo.nNumberOfLinks==1&&!recordInfo.nFileSizeHigh&&!recordInfo.nFileSizeLow&&GetProcessTimes(GetCurrentProcess(),&created,&ended,&kernel,&user);
    DWORD record[4]={0x44343830u,GetCurrentProcessId(),created.dwLowDateTime,created.dwHighDateTime};
    static_assert(sizeof(record)==16,"D480 fixed process receipt is exactly 16 bytes");
    valid=valid&&WriteFile(processRecord,record,sizeof(record),&wrote,nullptr)&&wrote==sizeof(record)&&FlushFileBuffers(processRecord);
    if(processRecord!=INVALID_HANDLE_VALUE)CloseHandle(processRecord);
    if(valid){parentReceipt=fd;parentReceiptInfo=info;}else CloseHandle(fd);}else CloseHandle(fd);}
 }}
#endif
#ifdef D480_INHERITANCE
 oldInput=input;inheritanceStarted=GetTickCount64();SECURITY_ATTRIBUTES sa{sizeof(sa),nullptr,TRUE};ownedSentinel=CreateEventW(&sa,TRUE,FALSE,nullptr);inheritanceStage=1;
 if(!captureReference(input,0)||!captureReference(ownedSentinel,2))closeReferences();
#else
 (void)input;
#endif
}
void D480Acceptance::inputClosed(HANDLE input){
#ifdef D480_INHERITANCE
 DWORD flags=0;SetLastError(ERROR_SUCCESS);BOOL valid=GetHandleInformation(input,&flags);inputWasClosed=input==oldInput&&!valid&&GetLastError()==ERROR_INVALID_HANDLE;
#else
 (void)input;
#endif
}
bool D480Acceptance::captureReference(HANDLE subject,unsigned index){
#ifdef D480_INHERITANCE
 D480Compare compare=d480_identity_api();HANDLE reference=nullptr;DWORD flags=0;
 if(index>=3||identityRefs[index]||!compare||!GetHandleInformation(subject,&flags)||!DuplicateHandle(GetCurrentProcess(),subject,GetCurrentProcess(),&reference,0,FALSE,0))return false;
 if(!GetHandleInformation(reference,&flags)||(flags&HANDLE_FLAG_INHERIT)||!compare(reference,reference)||!compare(subject,reference)){CloseHandle(reference);return false;}
 identityRefs[index]=reference;return true;
#else
 (void)subject;(void)index;return false;
#endif
}
void D480Acceptance::closeReferences(){for(HANDLE& reference:identityRefs){if(reference){if(!CloseHandle(reference)){checkerPositive=false;descendantDenied=false;}reference=nullptr;}}}
D480Acceptance::CheckerResult D480Acceptance::inheritedChecker(std::wstring const& binary,wchar_t const* role){
 CheckerResult result;
#ifdef D480_INHERITANCE
 std::wstring command=L"\""+binary+L"\" "+role;STARTUPINFOW startup{};startup.cb=sizeof(startup);
 struct OwnedProcess{PROCESS_INFORMATION value{};bool reaped=false;~OwnedProcess(){if(value.hThread)CloseHandle(value.hThread);if(value.hProcess){if(!reaped){TerminateProcess(value.hProcess,251);WaitForSingleObject(value.hProcess,INFINITE);}CloseHandle(value.hProcess);}}} child;
 if(!CreateProcessW(binary.c_str(),command.data(),nullptr,nullptr,TRUE,CREATE_SUSPENDED,nullptr,nullptr,&startup,&child.value)){result.raw=252;return result;}
 HANDLE known[3]={oldInput,knownParent,ownedSentinel};unsigned objects=256;
 if(!d480_known_identity(child.value.hProcess,known,identityRefs,d480_identity_api(),&objects)){result.raw=253;return result;}
 ULONGLONG elapsed=GetTickCount64()-inheritanceStarted;
 if(elapsed>=20000){result.raw=251;return result;}
 if(ResumeThread(child.value.hThread)!=1){result.raw=254;return result;}
 CloseHandle(child.value.hThread);child.value.hThread=nullptr;
 elapsed=GetTickCount64()-inheritanceStarted;DWORD remaining=elapsed<20000?(DWORD)(20000-elapsed):0;
 if(WaitForSingleObject(child.value.hProcess,remaining)!=WAIT_OBJECT_0){result.raw=251;return result;}
 child.reaped=true;
 if(!GetExitCodeProcess(child.value.hProcess,&result.raw))return result;
 if(result.raw<=7){result.objects=objects;result.valid=true;}
#else
 (void)binary;(void)role;
#endif
 return result;
}
void D480Acceptance::parentCleared(HANDLE parent){
#ifdef D480_INHERITANCE
 struct SentinelCleanup{~SentinelCleanup(){D480Acceptance::closeReferences();if(D480Acceptance::ownedSentinel){CloseHandle(D480Acceptance::ownedSentinel);D480Acceptance::ownedSentinel=nullptr;}}} cleanup;
 DWORD flags=0;parentWasCleared=GetHandleInformation(parent,&flags)&&!(flags&HANDLE_FLAG_INHERIT);inheritanceStage=2;
 knownParent=parent;
 if(!inputWasClosed||!parentWasCleared||!ownedSentinel||!identityRefs[0]||!identityRefs[2]||!captureReference(parent,1))return;
 wchar_t self[32768];DWORD length=GetModuleFileNameW(nullptr,self,32768);if(!length||length==32768)return;
 std::wstring file(self,length);auto slash=file.find_last_of(L"\\/");if(slash==std::wstring::npos)return;
 std::wstring receiver=file.substr(0,slash+1)+L"desktop-inheritance.exe",sidecar=receiver+L".handles";inheritanceStage=3;
 HANDLE output=CreateFileW(sidecar.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,nullptr);if(output==INVALID_HANDLE_VALUE)return;inheritanceStage=4;
 char bytes[256];int size=snprintf(bytes,sizeof(bytes),"D480_OWNED_HANDLES_V1\n%llu\n%llu\n%llu\n",(unsigned long long)(uintptr_t)oldInput,(unsigned long long)(uintptr_t)parent,(unsigned long long)(uintptr_t)ownedSentinel);
 BY_HANDLE_FILE_INFORMATION info{};DWORD wrote=0;bool valid=size>0&&size<(int)sizeof(bytes)&&GetFileInformationByHandle(output,&info)&&info.nNumberOfLinks==1&&!(info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))&&WriteFile(output,bytes,(DWORD)size,&wrote,nullptr)&&wrote==(DWORD)size&&FlushFileBuffers(output);CloseHandle(output);
 if(valid){inheritanceStage=5;
  CheckerResult result=inheritedChecker(receiver,L"--sentinel");controlResult=(result.raw<=7||(result.raw>=240&&result.raw<=255))?(unsigned)result.raw:256;controlIdentity=result.objects;checkerPositive=result.valid&&result.raw==4&&result.objects==4;inheritanceStage=6;
  result=inheritedChecker(receiver,L"--descendant");descendantResult=(result.raw<=7||(result.raw>=240&&result.raw<=255))?(unsigned)result.raw:256;descendantIdentity=result.objects;descendantDenied=result.valid&&result.objects==4;inheritanceStage=7;
 }
 CloseHandle(ownedSentinel);ownedSentinel=nullptr;
#else
 (void)parent;
#endif
}

void D480Acceptance::parentObserved(){
#ifdef D480_PARENT
 if(!parentReceipt)return;BY_HANDLE_FILE_INFORMATION info{};DWORD wrote=0;
 if(!GetFileInformationByHandle(parentReceipt,&info)||info.dwVolumeSerialNumber!=parentReceiptInfo.dwVolumeSerialNumber||info.nFileIndexHigh!=parentReceiptInfo.nFileIndexHigh||info.nFileIndexLow!=parentReceiptInfo.nFileIndexLow||info.nNumberOfLinks!=1||info.nFileSizeHigh||info.nFileSizeLow)return;
 (void)WriteFile(parentReceipt,"1",1,&wrote,nullptr);(void)FlushFileBuffers(parentReceipt);
 // Hold the lock until the immediately following owned self-termination. No CloseHandle here.
#endif
}

void D480Acceptance::safetyWatchdog(){
#ifdef D480_PARENT
 const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(20);
 std::thread([deadline](){std::this_thread::sleep_until(deadline);ExitProcess(177);}).detach();
 // No parent-success marker write. Other acceptance cases and product binaries have no watchdog.
#endif
}
