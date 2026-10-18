class Desktop;
struct D476Acceptance {
 static Desktop* owner;static std::wstring documentGeneration,selection;static DWORD pickerPid;static bool cancelPicker;static unsigned panels,confirmations,receipts;
 static void document(Desktop&);static void confirmation(Desktop&);static void emit(Desktop&,wchar_t const*);static void renderer(Desktop&,JsonObject const&);static bool picker(Desktop&,JsonObject const&);static void panel(Desktop&);
};
/* D476 IMPLEMENTATION */
Desktop* D476Acceptance::owner=nullptr;std::wstring D476Acceptance::documentGeneration,D476Acceptance::selection;DWORD D476Acceptance::pickerPid=0;bool D476Acceptance::cancelPicker=false;unsigned D476Acceptance::panels=0,D476Acceptance::confirmations=0,D476Acceptance::receipts=0;
void D476Acceptance::emit(Desktop& h,wchar_t const* id){JsonObject f;put(f,L"type",L"system.ping");put(f,L"id",id);h.send(f);}
void D476Acceptance::document(Desktop& h){if(owner){emit(h,L"D476_WS_FAIL");return;}owner=&h;documentGeneration=h.generation;std::wstring code=L"const documentGeneration="+std::wstring(JsonValue::CreateStringValue(h.generation).Stringify())+L";"+D476_FORM_SOURCE;auto result=h.web->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT hr,LPCWSTR)->HRESULT{if(FAILED(hr))emit(h,L"D476_WS_FAIL");return S_OK;}).Get());if(FAILED(result))emit(h,L"D476_WS_FAIL");}
void D476Acceptance::confirmation(Desktop& h){if(owner!=&h||!h.confirmation||h.confirmation->purpose!=L"workspace"||h.generation!=documentGeneration||++confirmations!=1||panels!=1||!IsWindowVisible(h.confirmation->window)||GetWindow(h.confirmation->window,GW_OWNER)!=h.window){emit(h,L"D476_WS_FAIL");return;}auto& p=*h.confirmation;SendMessageW(p.window,WM_COMMAND,MAKEWPARAM(3,BN_CLICKED),0);auto action=flat(p.full);if(text(action,L"path")!=selection){emit(h,L"D476_WS_FAIL");return;}int n=GetWindowTextLengthW(p.details);std::wstring shown((size_t)n+1,L'\0');GetWindowTextW(p.details,shown.data(),n+1);shown.resize(n);auto button=GetDlgItem(p.window,1);if(shown!=p.full||!button){emit(h,L"D476_WS_FAIL");return;}emit(h,L"D476_WS_CONFIRMATION");SendMessageW(button,BM_CLICK,0,0);}
bool D476Acceptance::picker(Desktop& h,JsonObject const& f){if(text(f,L"type")!=L"D476.workspace.picker")return false;auto pid=f.TryLookup(L"pid"),cancel=f.TryLookup(L"cancel");auto active=h.requests.find(L"desktop.workspace.pick");if(owner!=&h||h.generation!=documentGeneration||active==h.requests.end()||active->second.generation!=documentGeneration||!keys(f,{L"type",L"selection",L"pid",L"cancel"})||!pid||pid.ValueType()!=JsonValueType::Number||!std::isfinite(pid.GetNumber())||pid.GetNumber()<1||pid.GetNumber()>4294967295.0||std::floor(pid.GetNumber())!=pid.GetNumber()||!cancel||cancel.ValueType()!=JsonValueType::Boolean||panels>=2||pickerPid){emit(h,L"D476_WS_FAIL");return true;}auto root=text(f,L"selection");if(root.empty()||!std::filesystem::path(root).is_absolute()){emit(h,L"D476_WS_FAIL");return true;}selection=root;pickerPid=(DWORD)pid.GetNumber();cancelPicker=cancel.GetBoolean();if(cancelPicker!=(panels==1)){emit(h,L"D476_WS_FAIL");return true;}if(!SetTimer(h.window,476,16,[](HWND,UINT,UINT_PTR,DWORD){if(owner)panel(*owner);})){emit(h,L"D476_WS_FAIL");}return true;}
// BFFM_SETSELECTIONW is a private message: its pointer must belong to the picker.
// This unshipped fixture marshals only an owned directory string, never code.
static bool d476SelectFolder(HWND dialog,DWORD expectedPid,std::wstring const& value){
 DWORD observed=0;GetWindowThreadProcessId(dialog,&observed);
 if(!IsWindow(dialog)||!expectedPid||expectedPid==GetCurrentProcessId()||observed!=expectedPid||value.empty())return false;
 HANDLE process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_VM_OPERATION|PROCESS_VM_WRITE,FALSE,expectedPid);
 if(!process)return false;
 bool ok=false;LPVOID remote=nullptr;
 SIZE_T bytes=(value.size()+1)*sizeof(wchar_t),written=0;
 if(GetProcessId(process)==expectedPid){
  remote=VirtualAllocEx(process,nullptr,bytes,MEM_RESERVE|MEM_COMMIT,PAGE_READWRITE);
  if(remote&&WriteProcessMemory(process,remote,value.c_str(),bytes,&written)&&written==bytes){
   observed=0;GetWindowThreadProcessId(dialog,&observed);
   if(IsWindow(dialog)&&observed==expectedPid){SendMessageW(dialog,WM_USER+103,TRUE,(LPARAM)remote);ok=true;}
  }
 }
 if(remote&&!VirtualFreeEx(process,remote,0,MEM_RELEASE))ok=false;
 if(!CloseHandle(process))ok=false;
 return ok;
}
void D476Acceptance::panel(Desktop& h){if(owner!=&h||h.generation!=documentGeneration||!h.ready){KillTimer(h.window,476);return;}struct Found{DWORD pid;HWND window;unsigned count;};Found found{pickerPid,nullptr,0};EnumWindows([](HWND w,LPARAM p)->BOOL{auto& f=*(Found*)p;DWORD pid=0;GetWindowThreadProcessId(w,&pid);wchar_t cls[64]{};GetClassNameW(w,cls,64);if(pid==f.pid&&IsWindowVisible(w)&&std::wstring(cls)==L"#32770"){f.window=w;++f.count;}return TRUE;},(LPARAM)&found);if(!found.count)return;KillTimer(h.window,476);if(found.count!=1){emit(h,L"D476_WS_FAIL");return;}auto button=GetDlgItem(found.window,cancelPicker?IDCANCEL:IDOK);if(!cancelPicker&&!d476SelectFolder(found.window,pickerPid,selection)){emit(h,L"D476_WS_FAIL");return;}if(!button||!IsWindowEnabled(button)){emit(h,L"D476_WS_FAIL");return;}++panels;pickerPid=0;emit(h,panels==1?L"D476_WS_PICKER_SELECTED":L"D476_WS_PICKER_CANCELLED");SendMessageW(button,BM_CLICK,0,0);}
void D476Acceptance::renderer(Desktop& h,JsonObject const& f){if(owner!=&h||h.generation!=documentGeneration||text(f,L"type")!=L"system.ping")return;auto id=text(f,L"id");static wchar_t const* names[]={L"D476_WS_UNBOUND",L"D476_WS_COMMITTED",L"D476_WS_LISTED",L"D476_WS_READ",L"D476_WS_REOPENED",L"D476_WS_CANCELLED",L"D476_WS_DONE"};for(unsigned i=0;i<7;i++)if(id==names[i]){if(receipts&(1u<<i)){emit(h,L"D476_WS_FAIL");return;}receipts|=1u<<i;emit(h,names[i]);if(i==6){if(receipts!=127||panels!=2||confirmations!=1)emit(h,L"D476_WS_FAIL");}return;}if(id==L"D476_WS_FAIL")emit(h,L"D476_WS_FAIL");}
