class Desktop;
struct D476LocalAcceptance{static bool done;static bool complete(Desktop&,JsonObject const&);static unsigned confirmations;static std::wstring documentId;static void document(Desktop&);static void confirmation(Desktop&);static void renderer(Desktop&,JsonObject const&);static void emit(Desktop&,wchar_t const*);static void key(Desktop&,bool);};
/* D476 LOCAL IMPLEMENTATION */
bool D476LocalAcceptance::done=false;
bool D476LocalAcceptance::complete(Desktop& h,JsonObject const& f){if(text(f,L"type")!=L"D476.local.complete")return false;if(!h.ready||h.generation!=documentId||!done||confirmations!=5||!keys(f,{L"type",L"result"})||text(f,L"result")!=L"COMPLETE")ExitProcess(64);ExitProcess(77);return true;}
unsigned D476LocalAcceptance::confirmations=0;std::wstring D476LocalAcceptance::documentId;
void D476LocalAcceptance::emit(Desktop& h,wchar_t const* id){JsonObject f;put(f,L"type",L"system.ping");put(f,L"id",id);h.send(f);}
void D476LocalAcceptance::document(Desktop& h){if(!documentId.empty()){emit(h,L"D476_LOCAL_FAIL");return;}documentId=h.generation;std::wstring code=L"const documentGeneration="+std::wstring(JsonValue::CreateStringValue(h.generation).Stringify())+L";"+D476_LOCAL_FORM;auto result=h.web->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT status,LPCWSTR)->HRESULT{if(FAILED(status))emit(h,L"D476_LOCAL_FAIL");return S_OK;}).Get());if(FAILED(result))emit(h,L"D476_LOCAL_FAIL");}
void D476LocalAcceptance::confirmation(Desktop& h){
 static wchar_t const* expected[]={L"terminal-open",L"terminal-return",L"agent-start",L"agent-permission",L"agent-start"};
 if(!h.confirmation||h.confirmation->purpose!=L"local-work"||h.confirmation->generation!=documentId||confirmations>=5||!IsWindowVisible(h.confirmation->window)||GetWindow(h.confirmation->window,GW_OWNER)!=h.window){emit(h,L"D476_LOCAL_FAIL");return;}
 auto action=parse(h.confirmation->full);if(text(action,L"kind")!=expected[confirmations]){emit(h,L"D476_LOCAL_FAIL");return;}++confirmations;
 auto button=GetDlgItem(h.confirmation->window,confirmations==4?2:1);if(!button){emit(h,L"D476_LOCAL_FAIL");return;}SendMessageW(button,BM_CLICK,0,0); // Synthetic activation of the real native controller, never a human claim.
}
void D476LocalAcceptance::key(Desktop& h,bool type){
 if(!h.ready||h.generation!=documentId||!h.window||!h.controller||!IsWindowVisible(h.window)){emit(h,L"D476_LOCAL_FAIL");return;}
 SetForegroundWindow(h.window);if(FAILED(h.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC))||GetForegroundWindow()!=h.window){emit(h,L"D476_LOCAL_FAIL");return;}GUITHREADINFO info{};info.cbSize=sizeof(info);if(!GetGUIThreadInfo(0,&info)||!info.hwndFocus||GetAncestor(info.hwndFocus,GA_ROOT)!=h.window){emit(h,L"D476_LOCAL_FAIL");return;}
 if(type){std::wstring text=L"#中\rWrite-Output ('D476_' + 'LOCAL_' + [char]0x4e2d)\r";for(auto c:text)if(!PostMessageW(info.hwndFocus,WM_CHAR,c,1)){emit(h,L"D476_LOCAL_FAIL");return;}}
 else{auto scan=(LPARAM)(MapVirtualKeyW(VK_RETURN,MAPVK_VK_TO_VSC)&0xffu)<<16;if(!PostMessageW(info.hwndFocus,WM_KEYDOWN,VK_RETURN,1|scan)||!PostMessageW(info.hwndFocus,WM_KEYUP,VK_RETURN,1|scan|((LPARAM)1<<30)|((LPARAM)1<<31)))emit(h,L"D476_LOCAL_FAIL");}
}
void D476LocalAcceptance::renderer(Desktop& h,JsonObject const& f){
 if(text(f,L"type")!=L"system.ping"||h.generation!=documentId)return;auto id=text(f,L"id");
 if(id==L"D476_LOCAL_KEY"){key(h,false);return;}if(id==L"D476_LOCAL_TYPE"){key(h,true);return;}
 if(id==L"D476_LOCAL_RESIZE"){RECT r{};if(!GetWindowRect(h.window,&r)||!SetWindowPos(h.window,nullptr,0,0,r.right-r.left+120,r.bottom-r.top,SWP_NOMOVE|SWP_NOZORDER|SWP_NOACTIVATE))emit(h,L"D476_LOCAL_FAIL");return;}
 if(id==L"D476_LOCAL_DONE"){if(confirmations!=5){emit(h,L"D476_LOCAL_FAIL");return;}done=true;emit(h,L"D476_LOCAL_DONE");return;}
 for(auto name:{L"D476_LOCAL_OUTPUT",L"D476_LOCAL_RESIZED",L"D476_LOCAL_STOPPED",L"D476_LOCAL_SAVED",L"D476_LOCAL_REOPENED",L"D476_LOCAL_AGENT_SAVED",L"D476_LOCAL_AGENT_STOPPED",L"D476_LOCAL_FAIL"})if(id==name){emit(h,name);return;}
}
