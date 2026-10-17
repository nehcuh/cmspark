class Desktop;
struct D476MetadataAcceptance {
 static Desktop* owner;static std::wstring document;static unsigned keys,saves;static bool loss;
 static void arm(Desktop&);static void renderer(Desktop&,JsonObject const&);static void lost(Desktop&);static bool observe(Desktop&,std::wstring const&,std::wstring const&);
 static void key(Desktop&,WORD);static void failure(Desktop&);static void keyFailure(Desktop&,unsigned);
};
/* D476 METADATA IMPLEMENTATION */
Desktop* D476MetadataAcceptance::owner=nullptr;
std::wstring D476MetadataAcceptance::document;
unsigned D476MetadataAcceptance::keys=0,D476MetadataAcceptance::saves=0;
bool D476MetadataAcceptance::loss=false;
void D476MetadataAcceptance::failure(Desktop& h){D476Acceptance::emit(h,L"D476_FAIL_METADATA_PHASE");}
void D476MetadataAcceptance::keyFailure(Desktop& h,unsigned reason){
 // Failure-only replacement for the existing single failure frame: no new
 // successful-path I/O, action, wait, or acceptance relaxation.
 const wchar_t* id=reason==1?L"D476_FAIL_META_KEY_STATE":reason==2?L"D476_FAIL_META_KEY_FOCUS":reason==3?L"D476_FAIL_META_KEY_ANCESTRY":reason==4?L"D476_FAIL_META_KEY_POST":L"D476_FAIL_METADATA_PHASE";
 D476Acceptance::emit(h,id);
}
void D476MetadataAcceptance::arm(Desktop& h){if(owner){failure(h);return;}owner=&h;document=h.generation;}
void D476MetadataAcceptance::key(Desktop& h,WORD code){
 if(owner!=&h||loss||!h.ready||h.generation!=document||!h.controller||!h.window||!IsWindowVisible(h.window)){keyFailure(h,1);return;}
 SetForegroundWindow(h.window);
 if(FAILED(h.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC))||GetForegroundWindow()!=h.window){keyFailure(h,2);return;}
 GUITHREADINFO info{};info.cbSize=sizeof(info);if(!GetGUIThreadInfo(0,&info)||!info.hwndFocus||GetAncestor(info.hwndFocus,GA_ROOT)!=h.window){keyFailure(h,3);return;}
 const LPARAM scan=(LPARAM)(MapVirtualKeyW(code,MAPVK_VK_TO_VSC)&0xffu)<<16;
 // Target only the already verified owned WebView focus HWND, never the global
 // input queue (another CI window must not receive this synthetic key).
 if(!PostMessageW(info.hwndFocus,WM_KEYDOWN,code,1|scan)||!PostMessageW(info.hwndFocus,WM_KEYUP,code,1|scan|((LPARAM)1<<30)|((LPARAM)1<<31)))keyFailure(h,4);
}
void D476MetadataAcceptance::renderer(Desktop& h,JsonObject const& frame){
 if(owner!=&h||loss||h.generation!=document)return;auto type=text(frame,L"type");
 if(type==L"desktop.thread.metadata.save"){if(text(frame,L"thread_id")!=L"native-metadata-A"||++saves>2)failure(h);return;}
 if(type!=L"system.ping")return;auto id=text(frame,L"id");
 if(id==L"D476_META_ESCAPE_REQUEST"){if(keys!=0||saves!=1){failure(h);return;}keys=1;key(h,VK_ESCAPE);return;}
 if(id==L"D476_META_ENTER_REQUEST"){if(keys!=1||saves!=1){failure(h);return;}keys=2;key(h,VK_RETURN);return;}
 for(auto name:{L"D476_META_FIRST_SAVED",L"D476_META_REOPEN_OK",L"D476_META_ESCAPE_OK",L"D476_META_ENTER_OK",L"D476_META_BEFORE_LOST_ACK",L"D476_FAIL_METADATA_PHASE"})if(id==name){D476Acceptance::emit(h,name);return;}
}
void D476MetadataAcceptance::lost(Desktop& h){loss=owner==&h&&h.ready&&h.generation==document&&keys==2&&saves==2;}
bool D476MetadataAcceptance::observe(Desktop& h,std::wstring const& source,std::wstring const& body){
 if(owner!=&h||!loss||h.ready||!h.generation.empty()||source!=document_url)return false;
 auto f=flat(body);if(text(f,L"type")!=L"D476.metadata.offline")return false;
 bool ok=keys==2&&saves==2&&::keys(f,{L"type",L"generation",L"result"})&&text(f,L"generation")==document&&text(f,L"result")==L"ok";
 if(!ok)ExitProcess(64);loss=false;ExitProcess(76);return true; // Distinct test-only terminal receipt; ordinary window close still exits 0.
}
