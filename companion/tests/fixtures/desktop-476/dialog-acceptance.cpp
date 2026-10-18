class Desktop;
struct D476DialogAcceptance {
 static Desktop* owner;static std::wstring document;static unsigned keys,saves,stops;static bool loss;
 static void arm(Desktop&);static void renderer(Desktop&,JsonObject const&);static void lost(Desktop&);static bool observe(Desktop&,std::wstring const&,std::wstring const&);
 static void key(Desktop&,WORD);static void failure(Desktop&);
};
/* D476 DIALOG IMPLEMENTATION */
Desktop* D476DialogAcceptance::owner=nullptr;
std::wstring D476DialogAcceptance::document;
unsigned D476DialogAcceptance::keys=0,D476DialogAcceptance::saves=0,D476DialogAcceptance::stops=0;
bool D476DialogAcceptance::loss=false;
void D476DialogAcceptance::failure(Desktop& h){D476Acceptance::emit(h,L"D476_FAIL_DIALOG_PHASE");}
void D476DialogAcceptance::arm(Desktop& h){if(owner){failure(h);return;}owner=&h;document=h.generation;}
void D476DialogAcceptance::key(Desktop& h,WORD code){
 if(owner!=&h||loss||!h.ready||h.generation!=document||!h.controller||!h.window||!IsWindowVisible(h.window)){failure(h);return;}
 SetForegroundWindow(h.window);
 if(FAILED(h.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC))||GetForegroundWindow()!=h.window){failure(h);return;}
 GUITHREADINFO info{};info.cbSize=sizeof(info);if(!GetGUIThreadInfo(0,&info)||!info.hwndFocus||GetAncestor(info.hwndFocus,GA_ROOT)!=h.window){failure(h);return;}
 const LPARAM scan=(LPARAM)(MapVirtualKeyW(code,MAPVK_VK_TO_VSC)&0xffu)<<16;
 // Target only the already verified owned WebView focus HWND, never the global
 // input queue (another CI window must not receive this synthetic key).
 if(!PostMessageW(info.hwndFocus,WM_KEYDOWN,code,1|scan)||!PostMessageW(info.hwndFocus,WM_KEYUP,code,1|scan|((LPARAM)1<<30)|((LPARAM)1<<31)))failure(h);
}
void D476DialogAcceptance::renderer(Desktop& h,JsonObject const& frame){
 if(owner!=&h||loss||h.generation!=document)return;auto type=text(frame,L"type");
 if(type==L"desktop.chat.send"){if(++saves>2)failure(h);return;}
 if(type==L"desktop.chat.stop"){if(saves!=1||keys!=3||++stops>1)failure(h);return;}
 if(type!=L"system.ping")return;auto id=text(frame,L"id");
 if(id==L"D476_DIALOG_NEW_KEY"){if(keys!=0||saves!=0){failure(h);return;}keys=1;key(h,VK_RETURN);return;}
 if(id==L"D476_DIALOG_OTHER_KEY"){if(keys!=3||stops!=1){failure(h);return;}keys=4;key(h,VK_RETURN);return;}
 if(id==L"D476_DIALOG_REOPEN_KEY"){if(keys!=4||stops!=1){failure(h);return;}keys=5;key(h,VK_RETURN);return;}
 if(id==L"D476_DIALOG_SEND_KEY"){if(keys!=1||saves!=0){failure(h);return;}keys=2;key(h,VK_RETURN);return;}
 if(id==L"D476_DIALOG_LOST_ACK_KEY"){if(keys!=5||saves!=1||stops!=1){failure(h);return;}keys=6;key(h,VK_RETURN);return;}
 if(id==L"D476_DIALOG_STOP_KEY"){if(keys!=2||saves!=1){failure(h);return;}keys=3;key(h,VK_RETURN);return;}
 for(auto name:{L"D476_DIALOG_CREATED",L"D476_DIALOG_USER",L"D476_DIALOG_STREAMED",L"D476_DIALOG_L2_DENIED",L"D476_DIALOG_STOPPED",L"D476_DIALOG_REOPEN",L"D476_FAIL_DIALOG_PHASE"})if(id==name){D476Acceptance::emit(h,name);return;}
}
void D476DialogAcceptance::lost(Desktop& h){loss=owner==&h&&h.ready&&h.generation==document&&keys==6&&saves==2&&stops==1;}
bool D476DialogAcceptance::observe(Desktop& h,std::wstring const& source,std::wstring const& body){
 if(owner!=&h||!loss||h.ready||!h.generation.empty()||source!=document_url)return false;
 auto f=flat(body);if(text(f,L"type")!=L"D476.dialog.offline")return false;
 bool ok=keys==6&&saves==2&&stops==1&&::keys(f,{L"type",L"generation",L"result"})&&text(f,L"generation")==document&&text(f,L"result")==L"ok";
 if(!ok)ExitProcess(64);loss=false;ExitProcess(76);return true; // Distinct test-only terminal receipt; ordinary window close still exits 0.
}
