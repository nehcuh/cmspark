class Desktop;
struct D476ArchiveAcceptance {
 static Desktop* owner;static std::wstring document;static unsigned keys,saves;static bool loss;
 static void arm(Desktop&);static void renderer(Desktop&,JsonObject const&);static void lost(Desktop&);static bool observe(Desktop&,std::wstring const&,std::wstring const&);
 static void key(Desktop&,WORD);static void failure(Desktop&,unsigned);static bool firstNoted;
/*OBS788_BEGIN*/
 static unsigned relation788(Desktop&,HWND) noexcept;
 static void observe788(Desktop&,unsigned) noexcept;
 static unsigned seen788;
/*OBS788_END*/};
/*OBS788_BEGIN*/
// Passive classification only. Never a key/focus/authority gate.
/*OBS788_END*//* D476 ARCHIVE IMPLEMENTATION */
Desktop* D476ArchiveAcceptance::owner=nullptr;
std::wstring D476ArchiveAcceptance::document;
unsigned D476ArchiveAcceptance::keys=0,D476ArchiveAcceptance::saves=0;
bool D476ArchiveAcceptance::loss=false;
bool D476ArchiveAcceptance::firstNoted=false;
void D476ArchiveAcceptance::failure(Desktop& h,unsigned site){if(!firstNoted){firstNoted=true;try{auto id=std::wstring(L"D476_ARCHIVE_FIRST_W_")+std::to_wstring(site);D476Acceptance::emit(h,id.c_str());}catch(...){}}D476Acceptance::emit(h,L"D476_FAIL_ARCHIVE_PHASE");}
void D476ArchiveAcceptance::arm(Desktop& h){if(owner){failure(h,1);return;}owner=&h;document=h.generation;}
void D476ArchiveAcceptance::key(Desktop& h,WORD code){
 if(owner!=&h||loss||!h.ready||h.generation!=document||!h.controller||!h.window||!IsWindowVisible(h.window)){failure(h,2);return;}
 /*OBS788_BEGIN*/const BOOL activation788=/*OBS788_END*/SetForegroundWindow(h.window);
 if(FAILED(h.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC))){failure(h,3);return;}
 /*OBS788_BEGIN*/HWND foreground788=nullptr;/*OBS788_END*/if(/*OBS788_BEGIN*/(foreground788=/*OBS788_END*/GetForegroundWindow()/*OBS788_BEGIN*/)/*OBS788_END*/!=h.window){/*OBS788_BEGIN*/try{observe788(h,(activation788?7u:0u)+relation788(h,foreground788)+1u);}catch(...){}/*OBS788_END*/failure(h,4);return;}
 GUITHREADINFO info{};info.cbSize=sizeof(info);if(!GetGUIThreadInfo(0,&info)||!info.hwndFocus||GetAncestor(info.hwndFocus,GA_ROOT)!=h.window){failure(h,5);return;}
 const LPARAM scan=(LPARAM)(MapVirtualKeyW(code,MAPVK_VK_TO_VSC)&0xffu)<<16;
 // Target only the already verified owned WebView focus HWND, never the global
 // input queue (another CI window must not receive this synthetic key).
 if(!PostMessageW(info.hwndFocus,WM_KEYDOWN,code,1|scan)||!PostMessageW(info.hwndFocus,WM_KEYUP,code,1|scan|((LPARAM)1<<30)|((LPARAM)1<<31)))failure(h,6);
}
void D476ArchiveAcceptance::renderer(Desktop& h,JsonObject const& frame){
 if(owner!=&h||loss||h.generation!=document)return;auto type=text(frame,L"type");
 if(type==L"desktop.archive.set"){if(text(frame,L"thread_id")!=L"native-archive-A"||++saves>3||(keys!=2&&keys!=6&&keys!=10))failure(h,8);return;}
 if(type!=L"system.ping")return;auto id=text(frame,L"id");
 const wchar_t* names[]={L"ROW",L"SAVE",L"VIEW",L"HISTORY",L"RESTORE_ROW",L"RESTORE_SAVE",L"NORMAL",L"BUSY_ROW",L"RETRY_ROW",L"LOST_SAVE"};
 for(unsigned index=0;index<10;index++){if(id==std::wstring(L"D476_ARCHIVE_")+names[index]+L"_KEY"){if(keys!=index||saves!=(index<2?0u:index<6?1u:2u)){failure(h,7);return;}keys=index+1;key(h,VK_RETURN);return;}}
 for(auto name:{L"D476_ARCHIVE_FIRST_R_1",L"D476_ARCHIVE_FIRST_R_2",L"D476_ARCHIVE_FIRST_R_3",L"D476_ARCHIVE_FIRST_R_4",L"D476_ARCHIVE_FIRST_R_5",L"D476_ARCHIVE_FIRST_R_6",L"D476_ARCHIVE_FIRST_R_7",L"D476_ARCHIVE_FIRST_R_8",L"D476_ARCHIVE_FIRST_R_9",L"D476_ARCHIVE_FIRST_R_10",L"D476_ARCHIVE_ARCHIVED",L"D476_ARCHIVE_VIEW",L"D476_ARCHIVE_HISTORY",L"D476_ARCHIVE_RESTORED",L"D476_ARCHIVE_BUSY",L"D476_ARCHIVE_BEFORE_LOST_ACK",L"D476_ARCHIVE_BLOCK",L"D476_ARCHIVE_UNBLOCK",L"D476_FAIL_ARCHIVE_PHASE"})if(id==name){D476Acceptance::emit(h,name);return;}
}
void D476ArchiveAcceptance::lost(Desktop& h){loss=owner==&h&&h.ready&&h.generation==document&&keys==10&&saves==3;}
bool D476ArchiveAcceptance::observe(Desktop& h,std::wstring const& source,std::wstring const& body){
 if(owner!=&h||!loss||h.ready||!h.generation.empty()||source!=document_url)return false;
 auto f=flat(body);if(text(f,L"type")!=L"D476.archive.offline")return false;
 bool ok=keys==10&&saves==3&&::keys(f,{L"type",L"generation",L"result"})&&text(f,L"generation")==document&&text(f,L"result")==L"ok";
 if(!ok)ExitProcess(64);loss=false;ExitProcess(76);return true;
}
/*OBS788_BEGIN*/
unsigned D476ArchiveAcceptance::seen788=0;
unsigned D476ArchiveAcceptance::relation788(Desktop& h,HWND observed) noexcept {
 if(!observed)return 0;
 if(observed==h.window)return 1;
 if(h.confirmation&&h.confirmation->generation==h.generation&&h.confirmation->epoch==h.epoch&&observed==h.confirmation->window)return 2;
 DWORD pid=0;const auto thread=GetWindowThreadProcessId(observed,&pid);
 if(!thread||!pid||GetForegroundWindow()!=observed)return 5;
 return pid==GetCurrentProcessId()?3:4;
}
void D476ArchiveAcceptance::observe788(Desktop& h,unsigned code) noexcept {
 if(code<1||code>16||(seen788&(1u<<(code-1))))return;seen788|=1u<<(code-1);
 try{if(code>14)return;const auto activation=(code-1)/7,relation=(code-1)%7;auto id=std::wstring(L"D476_OBS788_FG_A_")+std::to_wstring(activation)+L"_"+(relation==6?L"X":std::to_wstring(relation));D476Acceptance::emit(h,id.c_str());}catch(...){} // A diagnostic fault cannot replace the original action/refusal.
}
/*OBS788_END*/