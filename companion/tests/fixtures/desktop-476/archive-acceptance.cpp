class Desktop;
struct D476ArchiveAcceptance {
 static Desktop* owner;static std::wstring document;static unsigned keys,saves;static bool loss;
 static void arm(Desktop&);static void renderer(Desktop&,JsonObject const&);static void lost(Desktop&);static bool observe(Desktop&,std::wstring const&,std::wstring const&);
 static void key(Desktop&,WORD);static void failure(Desktop&,unsigned);static bool firstNoted;
};
/* D476 ARCHIVE IMPLEMENTATION */
Desktop* D476ArchiveAcceptance::owner=nullptr;
std::wstring D476ArchiveAcceptance::document;
unsigned D476ArchiveAcceptance::keys=0,D476ArchiveAcceptance::saves=0;
bool D476ArchiveAcceptance::loss=false;
bool D476ArchiveAcceptance::firstNoted=false;
void D476ArchiveAcceptance::failure(Desktop& h,unsigned site){if(!firstNoted){firstNoted=true;try{auto id=std::wstring(L"D476_ARCHIVE_FIRST_W_")+std::to_wstring(site);D476Acceptance::emit(h,id.c_str());}catch(...){}}D476Acceptance::emit(h,L"D476_FAIL_ARCHIVE_PHASE");}
void D476ArchiveAcceptance::arm(Desktop& h){if(owner){failure(h,1);return;}owner=&h;document=h.generation;}
void D476ArchiveAcceptance::key(Desktop& h,WORD code){
 if(owner!=&h||loss||!h.ready||h.generation!=document||!h.controller||!h.window||!IsWindowVisible(h.window)){failure(h,2);return;}
 SetForegroundWindow(h.window);
 if(FAILED(h.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC))){failure(h,3);return;}
 if(GetForegroundWindow()!=h.window){failure(h,4);return;}
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
