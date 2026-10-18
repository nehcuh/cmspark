class Desktop;
struct D476Acceptance {
 static Desktop* owner;static std::wstring documentGeneration;static unsigned count,writes,receipts,keys;static bool loss;
 static void key(Desktop&);static void documentReady(Desktop&);static void document(Desktop&);static void confirmation(Desktop&);static void emit(Desktop&,wchar_t const*);static void renderer(Desktop&,JsonObject const&);static void lost(Desktop&);static bool observe(Desktop&,std::wstring const&,std::wstring const&);
};
/* D476 IMPLEMENTATION */
Desktop* D476Acceptance::owner=nullptr;std::wstring D476Acceptance::documentGeneration;unsigned D476Acceptance::count=0,D476Acceptance::writes=0,D476Acceptance::receipts=0,D476Acceptance::keys=0;bool D476Acceptance::loss=false;
void D476Acceptance::emit(Desktop& h,wchar_t const* id){JsonObject f;put(f,L"type",L"system.ping");put(f,L"id",id);h.send(f);}
void D476Acceptance::documentReady(Desktop& h){if(owner){emit(h,L"D476_RES_FAIL");return;}owner=&h;documentGeneration=h.generation;}
void D476Acceptance::document(Desktop& h){
 documentReady(h);std::wstring code=L"const documentGeneration="+std::wstring(JsonValue::CreateStringValue(h.generation).Stringify())+L";"+D476_FORM_SOURCE;
 auto result=h.web->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT result,LPCWSTR)->HRESULT{if(FAILED(result))emit(h,L"D476_RES_FAIL");return S_OK;}).Get());if(FAILED(result))emit(h,L"D476_RES_FAIL");
}
void D476Acceptance::confirmation(Desktop& h){
 ++count;if(owner!=&h||loss||!h.confirmation||h.confirmation->purpose!=L"resource"||!IsWindowVisible(h.confirmation->window)||GetWindow(h.confirmation->window,GW_OWNER)!=h.window||count>6){emit(h,L"D476_RES_FAIL");return;}
 auto& p=*h.confirmation;SendMessageW(p.window,WM_COMMAND,MAKEWPARAM(3,BN_CLICKED),0);auto length=GetWindowTextLengthW(p.details);std::wstring shown((size_t)length+1,L'\0');GetWindowTextW(p.details,shown.data(),length+1);shown.resize((size_t)length);if(shown!=p.full){emit(h,L"D476_RES_FAIL");return;}
 std::wstring receipt=L"D476_RES_WINDOW_"+std::to_wstring(count);emit(h,receipt.c_str());auto button=GetDlgItem(p.window,count==4?2:1);if(!button){emit(h,L"D476_RES_FAIL");return;}SendMessageW(button,BM_CLICK,0,0); // Real owned controller button; synthetic, never human evidence.
}
void D476Acceptance::key(Desktop& h){
 if(owner!=&h||loss||!h.ready||h.generation!=documentGeneration||!h.controller||!h.window||!IsWindowVisible(h.window)){emit(h,L"D476_RES_FAIL");return;}
 SetForegroundWindow(h.window);if(FAILED(h.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC))||GetForegroundWindow()!=h.window){emit(h,L"D476_RES_FAIL");return;}
 GUITHREADINFO info{};info.cbSize=sizeof(info);if(!GetGUIThreadInfo(0,&info)||!info.hwndFocus||GetAncestor(info.hwndFocus,GA_ROOT)!=h.window){emit(h,L"D476_RES_FAIL");return;}
 const LPARAM scan=(LPARAM)(MapVirtualKeyW(VK_ESCAPE,MAPVK_VK_TO_VSC)&0xffu)<<16;if(!PostMessageW(info.hwndFocus,WM_KEYDOWN,VK_ESCAPE,1|scan)||!PostMessageW(info.hwndFocus,WM_KEYUP,VK_ESCAPE,1|scan|((LPARAM)1<<30)|((LPARAM)1<<31)))emit(h,L"D476_RES_FAIL");
}
void D476Acceptance::renderer(Desktop& h,JsonObject const& f){
 if(owner!=&h||loss||h.generation!=documentGeneration)return;auto type=text(f,L"type");
 if(type==L"desktop.resource.import"||type==L"desktop.resource.update"||type==L"desktop.resource.remove"){if(++writes>6)emit(h,L"D476_RES_FAIL");return;}
 if(type!=L"system.ping")return;auto id=text(f,L"id");if(id==L"D476_RES_ESCAPE_REQUEST"){if(keys!=0||count!=2||writes!=2){emit(h,L"D476_RES_FAIL");return;}keys=1;key(h);return;}static wchar_t const* names[]={L"D476_RES_SKILL_IMPORTED",L"D476_RES_KNOWLEDGE_IMPORTED",L"D476_RES_REOPENED",L"D476_RES_UPDATED",L"D476_RES_DENIED",L"D476_RES_REMOVED",L"D476_RES_BEFORE_LOST_ACK",L"D476_RES_ESCAPE_OK"};for(unsigned i=0;i<8;i++)if(id==names[i]){if(receipts&(1u<<i)){emit(h,L"D476_RES_FAIL");return;}receipts|=1u<<i;emit(h,names[i]);return;}if(id==L"D476_RES_FAIL")emit(h,L"D476_RES_FAIL");
}
void D476Acceptance::lost(Desktop& h){loss=owner==&h&&h.ready&&h.generation==documentGeneration&&count==6&&writes==6&&receipts==255&&keys==1;}
bool D476Acceptance::observe(Desktop& h,std::wstring const& source,std::wstring const& body){
 if(owner!=&h||!loss||h.ready||!h.generation.empty()||source!=document_url)return false;auto f=flat(body);if(text(f,L"type")!=L"D476.resource.offline")return false;
 bool valid=::keys(f,{L"type",L"generation",L"result"})&&text(f,L"generation")==documentGeneration&&text(f,L"result")==L"ok";if(!valid)ExitProcess(64);loss=false;ExitProcess(76);return true;
}
