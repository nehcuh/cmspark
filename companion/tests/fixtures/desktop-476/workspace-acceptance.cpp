// Test-only retained identity: path spellings are not directory identities.
struct D476Directory705 {std::shared_ptr<void> handle;};
static D476Directory705 d476CaptureDirectory705(std::wstring const& value){
 if(value.empty()||value.find(L'\0')!=std::wstring::npos||!std::filesystem::path(value).is_absolute())return {};
 HANDLE raw=CreateFileW(value.c_str(),0,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS,nullptr);
 if(raw==INVALID_HANDLE_VALUE)return {};
 D476Directory705 result{std::shared_ptr<void>(raw,[](void* h){CloseHandle(h);})};
 BY_HANDLE_FILE_INFORMATION info{};
 if(!GetFileInformationByHandle(raw,&info)||!(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)||(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||(info.nFileIndexHigh==0&&info.nFileIndexLow==0))return {};
 return result;
}
static bool d476SameDirectory705(D476Directory705 const& expected,std::wstring const& root,std::wstring const& value){
 if(!expected.handle)return false;
 auto current=d476CaptureDirectory705(root);auto candidate=d476CaptureDirectory705(value);
 BY_HANDLE_FILE_INFORMATION a{},b{},c{};
 if(!current.handle||!candidate.handle||!GetFileInformationByHandle(expected.handle.get(),&a)||!GetFileInformationByHandle(current.handle.get(),&b)||!GetFileInformationByHandle(candidate.handle.get(),&c))return false;
 if(a.dwVolumeSerialNumber!=b.dwVolumeSerialNumber||a.nFileIndexHigh!=b.nFileIndexHigh||a.nFileIndexLow!=b.nFileIndexLow||a.dwVolumeSerialNumber!=c.dwVolumeSerialNumber||a.nFileIndexHigh!=c.nFileIndexHigh||a.nFileIndexLow!=c.nFileIndexLow)return false;
 std::error_code error;
 return std::filesystem::equivalent(root,value,error)&&!error;
}
class Desktop;
struct D476Acceptance {
 static Desktop* owner;static std::wstring documentGeneration,selection,pickerNonce;static bool cancelPicker,navigationStarted;static ComPtr<IShellItem> expectedDirectory;static D476Directory705 selectionDirectory;static unsigned panels,confirmations,receipts;
 static unsigned diagnosticMask,diagnosticSite,diagnosticSends,diagnosticLocal,diagnosticOwned,diagnosticFlags,diagnosticKnown;static std::wstring diagnosticLast;static void note(Desktop&,unsigned,unsigned=0,unsigned=99,unsigned=99,unsigned=0,unsigned=0) noexcept;static void fail(Desktop&,unsigned);
 static void document(Desktop&);static void confirmation(Desktop&);static void emit(Desktop&,wchar_t const*);static void renderer(Desktop&,JsonObject const&);static bool picker(Desktop&,JsonObject const&);static void panel(Desktop&);static void cancelNote(Desktop&,wchar_t const*) noexcept;static void shown(Desktop&,HRESULT,bool,bool) noexcept;
};
/* D476 IMPLEMENTATION */
Desktop* D476Acceptance::owner=nullptr;std::wstring D476Acceptance::documentGeneration,D476Acceptance::selection,D476Acceptance::pickerNonce;bool D476Acceptance::cancelPicker=false,D476Acceptance::navigationStarted=false;ComPtr<IShellItem> D476Acceptance::expectedDirectory;
D476Directory705 D476Acceptance::selectionDirectory;unsigned D476Acceptance::panels=0,D476Acceptance::confirmations=0,D476Acceptance::receipts=0;
void D476Acceptance::emit(Desktop& h,wchar_t const* id){JsonObject f;put(f,L"type",L"system.ping");put(f,L"id",id);h.send(f);}
// #705: finite test-only observation. Transport/allocation failure is never a fixture decision.
unsigned D476Acceptance::diagnosticMask=0,D476Acceptance::diagnosticSite=0,D476Acceptance::diagnosticSends=0,D476Acceptance::diagnosticLocal=99,D476Acceptance::diagnosticOwned=99,D476Acceptance::diagnosticFlags=0,D476Acceptance::diagnosticKnown=0;std::wstring D476Acceptance::diagnosticLast;
void D476Acceptance::note(Desktop& h,unsigned bit,unsigned site,unsigned local,unsigned owned,unsigned flags,unsigned known) noexcept {try{diagnosticMask|=bit;bool first=diagnosticSite==0&&site!=0;if(first)diagnosticSite=site;if(local!=99)diagnosticLocal=local>2?2:local;if(owned!=99)diagnosticOwned=owned>2?2:owned;diagnosticFlags=(diagnosticFlags&~known)|(flags&known);diagnosticKnown|=known;auto id=L"D476_WS_DIAG_W_"+std::to_wstring(diagnosticMask)+L"_"+std::to_wstring(diagnosticSite)+L"_"+(diagnosticLocal==99?L"X":std::to_wstring(diagnosticLocal))+L"_"+(diagnosticOwned==99?L"X":std::to_wstring(diagnosticOwned))+L"_"+std::to_wstring(diagnosticFlags&7u)+L"_"+std::to_wstring(diagnosticKnown&7u);if(id==diagnosticLast||(diagnosticSends>=16&&!first))return;diagnosticLast=id;++diagnosticSends;emit(h,id.c_str());}catch(...){}}
// Fixed, bounded test-only observations; no HRESULT, path or provider text leaves the host.
void D476Acceptance::cancelNote(Desktop& h,wchar_t const* id) noexcept {try{emit(h,id);}catch(...){}}
void D476Acceptance::shown(Desktop& h,HRESULT result,bool settled,bool current) noexcept {
 if(!cancelPicker)return;
 try{auto kind=result==HRESULT_FROM_WIN32(ERROR_CANCELLED)?L"CANCELLED":FAILED(result)?L"FAILED":L"SUCCESS";std::wstring id=std::wstring(L"D476_WS_CANCEL_SHOW_")+kind+L"_"+std::to_wstring(settled?1:0)+L"_"+std::to_wstring(current?1:0);cancelNote(h,id.c_str());}catch(...){}
}
void D476Acceptance::fail(Desktop& h,unsigned site){note(h,0,site);emit(h,L"D476_WS_FAIL");}
void D476Acceptance::document(Desktop& h){if(owner){fail(h,1);return;}owner=&h;documentGeneration=h.generation;std::wstring code=L"const documentGeneration="+std::wstring(JsonValue::CreateStringValue(h.generation).Stringify())+L";"+D476_FORM_SOURCE;auto result=h.web->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT hr,LPCWSTR)->HRESULT{if(FAILED(hr))fail(h,2);return S_OK;}).Get());if(FAILED(result))fail(h,3);}
void D476Acceptance::confirmation(Desktop& h){if(owner!=&h||!h.confirmation||h.confirmation->purpose!=L"workspace"||h.generation!=documentGeneration||++confirmations!=1||panels!=1||!IsWindowVisible(h.confirmation->window)||GetWindow(h.confirmation->window,GW_OWNER)!=h.window){fail(h,4);return;}auto& p=*h.confirmation;SendMessageW(p.window,WM_COMMAND,MAKEWPARAM(3,BN_CLICKED),0);auto action=flat(p.full);if(!d476SameDirectory705(selectionDirectory,selection,text(action,L"path"))){fail(h,5);return;}int n=GetWindowTextLengthW(p.details);std::wstring shown((size_t)n+1,L'\0');GetWindowTextW(p.details,shown.data(),n+1);shown.resize(n);auto button=GetDlgItem(p.window,1);if(shown!=p.full||!button){fail(h,6);return;}note(h,64);emit(h,L"D476_WS_CONFIRMATION");SendMessageW(button,BM_CLICK,0,0);}
bool D476Acceptance::picker(Desktop& h,JsonObject const& f){
 if(text(f,L"type")!=L"D476.workspace.picker")return false;auto cancel=f.TryLookup(L"cancel");auto p=h.workspace_selection;
 if(owner!=&h||h.generation!=documentGeneration||!p||!h.picker_current(p)||p->settled||!keys(f,{L"type",L"selection",L"pick_id",L"cancel"})||text(f,L"pick_id")!=p->nonce||!cancel||cancel.ValueType()!=JsonValueType::Boolean||panels>=2||!pickerNonce.empty()){fail(h,7);return true;}
 auto root=text(f,L"selection");if(root.empty()||!std::filesystem::path(root).is_absolute()){fail(h,8);return true;}
 selectionDirectory=d476CaptureDirectory705(root);if(!selectionDirectory.handle){fail(h,8);return true;}
 selection=root;pickerNonce=p->nonce;navigationStarted=false;expectedDirectory.Reset();cancelPicker=cancel.GetBoolean();if(cancelPicker!=(panels==1)){fail(h,9);return true;}note(h,1);
 if(!SetTimer(h.window,476,16,[](HWND,UINT,UINT_PTR,DWORD){if(owner)panel(*owner);})){fail(h,10);}return true;
}
// Exact dialog obtained from this retained COM object, never a global lookup.
static bool d476OwnedDialog705(HWND dialog,HWND owner){return dialog&&owner&&dialog!=owner&&IsWindow(dialog)&&IsWindowVisible(dialog)&&GetWindow(dialog,GW_OWNER)==owner;}
void D476Acceptance::panel(Desktop& h){
 auto p=h.workspace_selection;if(owner!=&h||h.generation!=documentGeneration||!p||!h.picker_current(p)||p->nonce!=pickerNonce||p->settled||!p->dialog){KillTimer(h.window,476);return;}
 auto activeDialog=p->dialog;ComPtr<IOleWindow> owned;HWND dialog=nullptr;if(FAILED(activeDialog.As(&owned))||FAILED(owned->GetWindow(&dialog))||!IsWindowVisible(dialog))return;
 if(!d476OwnedDialog705(dialog,h.window)){KillTimer(h.window,476);fail(h,11);return;}note(h,2,0,1,1,GetForegroundWindow()==dialog?1u:0u,1u);
 if(!cancelPicker){
  // SetFolder starts navigation once. The existing timer only observes this same retained dialog.
  if(!navigationStarted){
   navigationStarted=true;ComPtr<IShellItem> directory;
   auto created=SHCreateItemFromParsingName(selection.c_str(),nullptr,IID_PPV_ARGS(directory.GetAddressOf()));
   if(owner!=&h||h.generation!=documentGeneration||!h.picker_current(p)||p->nonce!=pickerNonce||p->settled||p->dialog.Get()!=activeDialog.Get()){if(h.workspace_selection==p)KillTimer(h.window,476);return;}
   if(FAILED(created)||!directory.Get()){KillTimer(h.window,476);pickerNonce.clear();fail(h,12);return;}
   auto navigated=activeDialog->SetFolder(directory.Get());
   if(owner!=&h||h.generation!=documentGeneration||!h.picker_current(p)||p->nonce!=pickerNonce||p->settled||p->dialog.Get()!=activeDialog.Get()){if(h.workspace_selection==p)KillTimer(h.window,476);return;}
   if(FAILED(navigated)){KillTimer(h.window,476);pickerNonce.clear();fail(h,12);return;}
   expectedDirectory=directory;note(h,4,0,1,1);
  }
  // An in-flight creation/navigation never publishes a consumable expected item.
  if(!expectedDirectory.Get())return;
  if(owner!=&h||h.generation!=documentGeneration||!h.picker_current(p)||p->nonce!=pickerNonce||p->settled||p->dialog.Get()!=activeDialog.Get()){if(h.workspace_selection==p)KillTimer(h.window,476);return;}
  ComPtr<IShellItem> folder;int order=1;if(activeDialog->GetFolder(folder.GetAddressOf())!=S_OK||!folder||!expectedDirectory||folder->Compare(expectedDirectory.Get(),SICHINT_CANONICAL,&order)!=S_OK||order!=0)return;
 }
 if(owner!=&h||h.generation!=documentGeneration||!h.picker_current(p)||p->nonce!=pickerNonce||p->settled||p->dialog.Get()!=activeDialog.Get()){if(h.workspace_selection==p)KillTimer(h.window,476);return;}
 auto button=GetDlgItem(dialog,cancelPicker?IDCANCEL:IDOK);
 const auto ownedNonce=p->nonce;
 // Diagnostic arm only: same UI STA, exact retained dialog and its real public Cancel button.
 auto cancelButtonCurrent=[&](){
  wchar_t buttonClass[16]{};
  return owner==&h&&h.generation==documentGeneration&&h.picker_current(p)&&p->nonce==ownedNonce&&!p->settled&&p->dialog.Get()==activeDialog.Get()
   &&d476OwnedDialog705(dialog,h.window)&&button&&GetDlgItem(dialog,IDCANCEL)==button&&IsWindow(button)&&IsChild(dialog,button)
   &&GetDlgCtrlID(button)==IDCANCEL&&IsWindowVisible(button)&&IsWindowEnabled(button)
   &&GetClassNameW(button,buttonClass,16)>0&&lstrcmpiW(buttonClass,L"Button")==0
   &&GetWindowThreadProcessId(dialog,nullptr)==GetCurrentThreadId()&&GetWindowThreadProcessId(button,nullptr)==GetCurrentThreadId();
 };
 if(cancelPicker?!cancelButtonCurrent():(!button||!IsWindowEnabled(button)))return;note(h,8,0,1,1,2u,2u);
 KillTimer(h.window,476);++panels;pickerNonce.clear();expectedDirectory.Reset();emit(h,panels==1?L"D476_WS_PICKER_SELECTED":L"D476_WS_PICKER_CANCELLED");note(h,16,0,1,1);
 // Actual typed cancellation or the current real dialog's public OK button. No injected result.
 if(cancelPicker){if(!cancelButtonCurrent()){fail(h,0);return;}SendMessageW(button,BM_CLICK,0,0);}else SendMessageW(button,BM_CLICK,0,0);
 note(h,32,0,1,1,IsWindow(dialog)?4u:0u,4u);
}
void D476Acceptance::renderer(Desktop& h,JsonObject const& f){if(owner!=&h||h.generation!=documentGeneration||text(f,L"type")!=L"system.ping")return;auto id=text(f,L"id");static wchar_t const* names[]={L"D476_WS_UNBOUND",L"D476_WS_COMMITTED",L"D476_WS_LISTED",L"D476_WS_READ",L"D476_WS_REOPENED",L"D476_WS_CANCELLED",L"D476_WS_DONE"};for(unsigned i=0;i<7;i++)if(id==names[i]){if(receipts&(1u<<i)){fail(h,14);return;}receipts|=1u<<i;emit(h,names[i]);if(i==6){if(receipts!=127||panels!=2||confirmations!=1)fail(h,15);}return;}if(id==L"D476_WS_FAIL")fail(h,16);}
