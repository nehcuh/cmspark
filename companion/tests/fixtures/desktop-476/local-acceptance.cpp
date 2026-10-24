#include <cwchar>
class Desktop;
struct D476LocalAcceptance{static bool firstNative,firstRenderer,dataSeen;static void observe(Desktop&,wchar_t const*) noexcept;static bool rendererSite(Desktop&,wchar_t const*) noexcept;static bool done;static bool complete(Desktop&,JsonObject const&);static unsigned confirmations;static std::wstring documentId;static void document(Desktop&);static void confirmation(Desktop&);static void renderer(Desktop&,JsonObject const&);static void emit(Desktop&,wchar_t const*);static void key(Desktop&,bool);static Desktop* owner;static unsigned long epoch;static bool input_active,input_failed,input_typed,input_pending_key,done_emitted;static size_t input_cursor;static ComPtr<ICoreWebView2> input_web;static bool current(Desktop&);static void input_failure(Desktop&);static std::wstring const& command();static size_t input_length();static JsonObject input_payload(size_t);static void input_request(Desktop&);static void input_step(Desktop&);static void input_finished(Desktop&);};
/* D476 LOCAL IMPLEMENTATION */
bool D476LocalAcceptance::done=false;
bool D476LocalAcceptance::complete(Desktop& h,JsonObject const& f){if(text(f,L"type")!=L"D476.local.complete")return false;if(!current(h)||!done||!done_emitted||input_active||input_pending_key||confirmations!=5||!keys(f,{L"type",L"result"})||text(f,L"result")!=L"COMPLETE")ExitProcess(64);ExitProcess(77);return true;}
unsigned D476LocalAcceptance::confirmations=0;std::wstring D476LocalAcceptance::documentId;
Desktop* D476LocalAcceptance::owner=nullptr;unsigned long D476LocalAcceptance::epoch=0;
bool D476LocalAcceptance::input_active=false,D476LocalAcceptance::input_failed=false,D476LocalAcceptance::input_typed=false,D476LocalAcceptance::input_pending_key=false,D476LocalAcceptance::done_emitted=false;
size_t D476LocalAcceptance::input_cursor=0;ComPtr<ICoreWebView2> D476LocalAcceptance::input_web;
bool D476LocalAcceptance::current(Desktop& h){return owner==&h&&!input_failed&&!h.closing&&h.ready&&h.generation==documentId&&h.epoch==epoch&&h.web&&h.controller&&h.window&&IsWindowVisible(h.window);}
void D476LocalAcceptance::input_failure(Desktop& h){if(input_failed)return;input_failed=true;input_active=false;input_pending_key=false;input_web.Reset();(observe(h,L"D476_LOCAL_FIRST_W_10"),emit(h,L"D476_LOCAL_FAIL"));}
// Fixed synthetic input through the owned browser engine, not hardware fidelity.
std::wstring const& D476LocalAcceptance::command(){static const std::wstring value=L"#中\rWrite-Output ('D476_' + 'LOCAL_' + [char]0x4e2d)\r";return value;}
size_t D476LocalAcceptance::input_length(){size_t count=0;for(auto c:command())count+=c==L'\r'?2:1;return count;}
JsonObject D476LocalAcceptance::input_payload(size_t cursor){
 size_t at=0;for(auto c:command()){
  const size_t width=c==L'\r'?2:1;if(cursor<at+width){JsonObject payload;
   if(c!=L'\r'){put(payload,L"type",L"char");put(payload,L"text",std::wstring(1,c));put(payload,L"unmodifiedText",std::wstring(1,c));return payload;}
   const size_t step=cursor-at;put(payload,L"type",step==0?L"keyDown":L"keyUp");put(payload,L"key",L"Enter");put(payload,L"code",L"Enter");
   payload.Insert(L"windowsVirtualKeyCode",JsonValue::CreateNumberValue(VK_RETURN));payload.Insert(L"nativeVirtualKeyCode",JsonValue::CreateNumberValue(VK_RETURN));
   if(step==0){put(payload,L"text",L"\r");put(payload,L"unmodifiedText",L"\r");}return payload;
  }at+=width;
 }throw std::runtime_error("LOCAL_INPUT_STATE");
}
void D476LocalAcceptance::input_request(Desktop& h){
 if(!current(h)||GetForegroundWindow()!=h.window||input_typed||input_active){input_failure(h);return;}
 input_typed=true;input_active=true;input_cursor=0;input_web=h.web;input_step(h);
}
void D476LocalAcceptance::input_finished(Desktop& h){
 input_active=false;input_web.Reset();
 if(input_pending_key){input_pending_key=false;key(h,false);if(input_failed)return;}
 if(done&&!done_emitted){done_emitted=true;emit(h,L"D476_LOCAL_DONE");}
}
void D476LocalAcceptance::input_step(Desktop& h){
 if(!current(h)||GetForegroundWindow()!=h.window||!input_active||input_web.Get()!=h.web.Get()||input_cursor>=input_length()){input_failure(h);return;}
 const auto cursor=input_cursor;const auto window=h.window;Desktop* expected=&h;auto web=input_web;
 const auto payload=input_payload(cursor).Stringify();
 auto submitted=web->CallDevToolsProtocolMethod(L"Input.dispatchKeyEvent",payload.c_str(),Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>([expected,window,web,cursor](HRESULT status,LPCWSTR result)->HRESULT{
  if(owner!=expected||!IsWindow(window)||GetWindowLongPtrW(window,GWLP_USERDATA)!=(LONG_PTR)expected){input_failed=true;input_active=false;input_pending_key=false;input_web.Reset();return S_OK;}
  auto& target=*expected;
  if(FAILED(status)||!current(target)||GetForegroundWindow()!=window||target.web.Get()!=web.Get()||input_web.Get()!=web.Get()||!input_active||input_cursor!=cursor){input_failure(target);return S_OK;}
  try{if(!result||JsonObject::Parse(result).Size()!=0){input_failure(target);return S_OK;}}catch(...){input_failure(target);return S_OK;}
  ++input_cursor;if(input_cursor==input_length())input_finished(target);else input_step(target);return S_OK;
 }).Get());if(FAILED(submitted))input_failure(h);
}
void D476LocalAcceptance::emit(Desktop& h,wchar_t const* id){JsonObject f;put(f,L"type",L"system.ping");put(f,L"id",id);h.send(f);}

bool D476LocalAcceptance::firstNative=false;bool D476LocalAcceptance::firstRenderer=false;bool D476LocalAcceptance::dataSeen=false;
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
void D476LocalAcceptance::document(Desktop& h){if(!documentId.empty()){(observe(h,L"D476_LOCAL_FIRST_W_1"),emit(h,L"D476_LOCAL_FAIL"));return;}owner=&h;epoch=h.epoch;documentId=h.generation;std::wstring code=L"const documentGeneration="+std::wstring(JsonValue::CreateStringValue(h.generation).Stringify())+L";"+D476_LOCAL_FORM;auto result=h.web->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT status,LPCWSTR)->HRESULT{if(FAILED(status))(observe(h,L"D476_LOCAL_FIRST_W_2"),emit(h,L"D476_LOCAL_FAIL"));return S_OK;}).Get());if(FAILED(result))(observe(h,L"D476_LOCAL_FIRST_W_3"),emit(h,L"D476_LOCAL_FAIL"));}
void D476LocalAcceptance::confirmation(Desktop& h){
 static wchar_t const* expected[]={L"terminal-open",L"terminal-return",L"agent-start",L"agent-permission",L"agent-start"};
 if(!h.confirmation||h.confirmation->purpose!=L"local-work"||h.confirmation->generation!=documentId||confirmations>=5||!IsWindowVisible(h.confirmation->window)||GetWindow(h.confirmation->window,GW_OWNER)!=h.window){(observe(h,L"D476_LOCAL_FIRST_W_4"),emit(h,L"D476_LOCAL_FAIL"));return;}
 auto action=parse(h.confirmation->full);if(text(action,L"kind")!=expected[confirmations]){(observe(h,L"D476_LOCAL_FIRST_W_5"),emit(h,L"D476_LOCAL_FAIL"));return;}++confirmations;
 auto button=GetDlgItem(h.confirmation->window,confirmations==4?2:1);if(!button){(observe(h,L"D476_LOCAL_FIRST_W_6"),emit(h,L"D476_LOCAL_FAIL"));return;}SendMessageW(button,BM_CLICK,0,0); // Synthetic activation of the real native controller, never a human claim.
}
void D476LocalAcceptance::key(Desktop& h,bool type){
 if(!current(h)){(observe(h,L"D476_LOCAL_FIRST_W_7"),emit(h,L"D476_LOCAL_FAIL"));return;}
 SetForegroundWindow(h.window);const auto focusStatus=h.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);const bool focusFailed=FAILED(focusStatus);const bool foregroundMismatch=!focusFailed&&GetForegroundWindow()!=h.window;if(focusFailed||foregroundMismatch){try{emit(h,focusFailed?L"D476_LOCAL_FOCUS_MOVE_FOCUS_FAILED":L"D476_LOCAL_FOCUS_FOREGROUND_MISMATCH");}catch(...){} (observe(h,L"D476_LOCAL_FIRST_W_8"),emit(h,L"D476_LOCAL_FAIL"));return;}GUITHREADINFO info{};info.cbSize=sizeof(info);if(!GetGUIThreadInfo(0,&info)||!info.hwndFocus||GetAncestor(info.hwndFocus,GA_ROOT)!=h.window){(observe(h,L"D476_LOCAL_FIRST_W_9"),emit(h,L"D476_LOCAL_FAIL"));return;}
 if(type){input_request(h);return;}
 if(input_active){if(input_pending_key){input_failure(h);return;}input_pending_key=true;return;}
 {auto scan=(LPARAM)(MapVirtualKeyW(VK_RETURN,MAPVK_VK_TO_VSC)&0xffu)<<16;if(!PostMessageW(info.hwndFocus,WM_KEYDOWN,VK_RETURN,1|scan)||!PostMessageW(info.hwndFocus,WM_KEYUP,VK_RETURN,1|scan|((LPARAM)1<<30)|((LPARAM)1<<31)))(observe(h,L"D476_LOCAL_FIRST_W_11"),emit(h,L"D476_LOCAL_FAIL"));}
}
void D476LocalAcceptance::renderer(Desktop& h,JsonObject const& f){
 if(text(f,L"type")!=L"system.ping"||!current(h))return;auto id=text(f,L"id");if(rendererSite(h,id.c_str()))return;
  if(id==L"D476_LOCAL_DATA_SEEN"){if(!dataSeen){dataSeen=true;try{emit(h,L"D476_LOCAL_DATA_SEEN");}catch(...){}}return;}
 if(id==L"D476_LOCAL_KEY"){key(h,false);return;}if(id==L"D476_LOCAL_TYPE"){key(h,true);return;}
 if(id==L"D476_LOCAL_RESIZE"){RECT r{};if(!GetWindowRect(h.window,&r)||!SetWindowPos(h.window,nullptr,0,0,r.right-r.left+120,r.bottom-r.top,SWP_NOMOVE|SWP_NOZORDER|SWP_NOACTIVATE))(observe(h,L"D476_LOCAL_FIRST_W_12"),emit(h,L"D476_LOCAL_FAIL"));return;}
 if(id==L"D476_LOCAL_DONE"){if(confirmations!=5){(observe(h,L"D476_LOCAL_FIRST_W_13"),emit(h,L"D476_LOCAL_FAIL"));return;}done=true;if(input_active||input_pending_key)return;done_emitted=true;emit(h,L"D476_LOCAL_DONE");return;}
 for(auto name:{L"D476_LOCAL_OUTPUT",L"D476_LOCAL_RESIZED",L"D476_LOCAL_STOPPED",L"D476_LOCAL_SAVED",L"D476_LOCAL_REOPENED",L"D476_LOCAL_AGENT_SAVED",L"D476_LOCAL_AGENT_STOPPED",L"D476_LOCAL_FAIL"})if(id==name){emit(h,name);return;}
}
