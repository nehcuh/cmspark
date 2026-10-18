#include <cwchar>
class Desktop;
struct D476LocalAcceptance{static bool firstNative,firstRenderer;static void observe(Desktop&,wchar_t const*) noexcept;static bool rendererSite(Desktop&,wchar_t const*) noexcept;static bool done;static bool complete(Desktop&,JsonObject const&);static unsigned confirmations;static std::wstring documentId;static void document(Desktop&);static void confirmation(Desktop&);static void renderer(Desktop&,JsonObject const&);static void emit(Desktop&,wchar_t const*);static void key(Desktop&,bool);};
/* D476 LOCAL IMPLEMENTATION */
bool D476LocalAcceptance::done=false;
bool D476LocalAcceptance::complete(Desktop& h,JsonObject const& f){if(text(f,L"type")!=L"D476.local.complete")return false;if(!h.ready||h.generation!=documentId||!done||confirmations!=5||!keys(f,{L"type",L"result"})||text(f,L"result")!=L"COMPLETE")ExitProcess(64);ExitProcess(77);return true;}
unsigned D476LocalAcceptance::confirmations=0;std::wstring D476LocalAcceptance::documentId;
void D476LocalAcceptance::emit(Desktop& h,wchar_t const* id){JsonObject f;put(f,L"type",L"system.ping");put(f,L"id",id);h.send(f);}

bool D476LocalAcceptance::firstNative=false;bool D476LocalAcceptance::firstRenderer=false;
void D476LocalAcceptance::observe(Desktop& h,wchar_t const* id) noexcept {
 if(firstNative)return;
 static wchar_t const* known[]={L"D476_LOCAL_FIRST_W_1",L"D476_LOCAL_FIRST_W_2",L"D476_LOCAL_FIRST_W_3",L"D476_LOCAL_FIRST_W_4",L"D476_LOCAL_FIRST_W_5",L"D476_LOCAL_FIRST_W_6",L"D476_LOCAL_FIRST_W_7",L"D476_LOCAL_FIRST_W_8",L"D476_LOCAL_FIRST_W_9",L"D476_LOCAL_FIRST_W_10",L"D476_LOCAL_FIRST_W_11",L"D476_LOCAL_FIRST_W_12",L"D476_LOCAL_FIRST_W_13"};
 bool accepted=false;for(auto name:known)if(std::wcscmp(id,name)==0){accepted=true;break;}
 if(!accepted)return;firstNative=true;try{emit(h,id);}catch(...){}
}
bool D476LocalAcceptance::rendererSite(Desktop& h,wchar_t const* id) noexcept {
 static wchar_t const* known[]={L"D476_LOCAL_FIRST_R_1",L"D476_LOCAL_FIRST_R_2",L"D476_LOCAL_FIRST_R_3",L"D476_LOCAL_FIRST_R_4",L"D476_LOCAL_FIRST_R_5",L"D476_LOCAL_FIRST_R_6",L"D476_LOCAL_FIRST_R_7",L"D476_LOCAL_FIRST_R_8",L"D476_LOCAL_FIRST_R_9",L"D476_LOCAL_FIRST_R_10",L"D476_LOCAL_FIRST_R_11",L"D476_LOCAL_FIRST_R_12",L"D476_LOCAL_FIRST_R_13",L"D476_LOCAL_FIRST_R_14",L"D476_LOCAL_FIRST_R_15",L"D476_LOCAL_FIRST_R_16",L"D476_LOCAL_FIRST_R_17"};
 bool accepted=false;for(auto name:known)if(std::wcscmp(id,name)==0){accepted=true;break;}
 if(!accepted)return false;if(!firstRenderer){firstRenderer=true;try{emit(h,id);}catch(...){}}return true;
}
void D476LocalAcceptance::document(Desktop& h){if(!documentId.empty()){(observe(h,L"D476_LOCAL_FIRST_W_1"),emit(h,L"D476_LOCAL_FAIL"));return;}documentId=h.generation;std::wstring code=L"const documentGeneration="+std::wstring(JsonValue::CreateStringValue(h.generation).Stringify())+L";"+D476_LOCAL_FORM;auto result=h.web->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT status,LPCWSTR)->HRESULT{if(FAILED(status))(observe(h,L"D476_LOCAL_FIRST_W_2"),emit(h,L"D476_LOCAL_FAIL"));return S_OK;}).Get());if(FAILED(result))(observe(h,L"D476_LOCAL_FIRST_W_3"),emit(h,L"D476_LOCAL_FAIL"));}
void D476LocalAcceptance::confirmation(Desktop& h){
 static wchar_t const* expected[]={L"terminal-open",L"terminal-return",L"agent-start",L"agent-permission",L"agent-start"};
 if(!h.confirmation||h.confirmation->purpose!=L"local-work"||h.confirmation->generation!=documentId||confirmations>=5||!IsWindowVisible(h.confirmation->window)||GetWindow(h.confirmation->window,GW_OWNER)!=h.window){(observe(h,L"D476_LOCAL_FIRST_W_4"),emit(h,L"D476_LOCAL_FAIL"));return;}
 auto action=parse(h.confirmation->full);if(text(action,L"kind")!=expected[confirmations]){(observe(h,L"D476_LOCAL_FIRST_W_5"),emit(h,L"D476_LOCAL_FAIL"));return;}++confirmations;
 auto button=GetDlgItem(h.confirmation->window,confirmations==4?2:1);if(!button){(observe(h,L"D476_LOCAL_FIRST_W_6"),emit(h,L"D476_LOCAL_FAIL"));return;}SendMessageW(button,BM_CLICK,0,0); // Synthetic activation of the real native controller, never a human claim.
}
void D476LocalAcceptance::key(Desktop& h,bool type){
 if(!h.ready||h.generation!=documentId||!h.window||!h.controller||!IsWindowVisible(h.window)){(observe(h,L"D476_LOCAL_FIRST_W_7"),emit(h,L"D476_LOCAL_FAIL"));return;}
 SetForegroundWindow(h.window);const auto focusStatus=h.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);const bool focusFailed=FAILED(focusStatus);const bool foregroundMismatch=!focusFailed&&GetForegroundWindow()!=h.window;if(focusFailed||foregroundMismatch){try{emit(h,focusFailed?L"D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED":L"D476_LOCAL_FOCUS_FOREGROUND_MISMATCH");}catch(...){} (observe(h,L"D476_LOCAL_FIRST_W_8"),emit(h,L"D476_LOCAL_FAIL"));return;}GUITHREADINFO info{};info.cbSize=sizeof(info);if(!GetGUIThreadInfo(0,&info)||!info.hwndFocus||GetAncestor(info.hwndFocus,GA_ROOT)!=h.window){(observe(h,L"D476_LOCAL_FIRST_W_9"),emit(h,L"D476_LOCAL_FAIL"));return;}
 if(type){std::wstring text=L"#中\rWrite-Output ('D476_' + 'LOCAL_' + [char]0x4e2d)\r";for(auto c:text)if(!PostMessageW(info.hwndFocus,WM_CHAR,c,1)){(observe(h,L"D476_LOCAL_FIRST_W_10"),emit(h,L"D476_LOCAL_FAIL"));return;}}
 else{auto scan=(LPARAM)(MapVirtualKeyW(VK_RETURN,MAPVK_VK_TO_VSC)&0xffu)<<16;if(!PostMessageW(info.hwndFocus,WM_KEYDOWN,VK_RETURN,1|scan)||!PostMessageW(info.hwndFocus,WM_KEYUP,VK_RETURN,1|scan|((LPARAM)1<<30)|((LPARAM)1<<31)))(observe(h,L"D476_LOCAL_FIRST_W_11"),emit(h,L"D476_LOCAL_FAIL"));}
}
void D476LocalAcceptance::renderer(Desktop& h,JsonObject const& f){
 if(text(f,L"type")!=L"system.ping"||h.generation!=documentId)return;auto id=text(f,L"id");if(rendererSite(h,id.c_str()))return;
 if(id==L"D476_LOCAL_KEY"){key(h,false);return;}if(id==L"D476_LOCAL_TYPE"){key(h,true);return;}
 if(id==L"D476_LOCAL_RESIZE"){RECT r{};if(!GetWindowRect(h.window,&r)||!SetWindowPos(h.window,nullptr,0,0,r.right-r.left+120,r.bottom-r.top,SWP_NOMOVE|SWP_NOZORDER|SWP_NOACTIVATE))(observe(h,L"D476_LOCAL_FIRST_W_12"),emit(h,L"D476_LOCAL_FAIL"));return;}
 if(id==L"D476_LOCAL_DONE"){if(confirmations!=5){(observe(h,L"D476_LOCAL_FIRST_W_13"),emit(h,L"D476_LOCAL_FAIL"));return;}done=true;emit(h,L"D476_LOCAL_DONE");return;}
 for(auto name:{L"D476_LOCAL_OUTPUT",L"D476_LOCAL_RESIZED",L"D476_LOCAL_STOPPED",L"D476_LOCAL_SAVED",L"D476_LOCAL_REOPENED",L"D476_LOCAL_AGENT_SAVED",L"D476_LOCAL_AGENT_STOPPED",L"D476_LOCAL_FAIL"})if(id==name){emit(h,name);return;}
}
