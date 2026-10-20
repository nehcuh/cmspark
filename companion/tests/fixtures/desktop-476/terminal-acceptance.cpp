// Unshipped terminal-only controller. Synthetic native input is never human consent.
class Desktop;
struct D705TerminalAcceptance {
 static Desktop* owner;static std::wstring document;static unsigned long epoch;
 static unsigned key_count,confirm_count,receipt_mask;static bool typed,resized,done,failed;
 static bool current(Desktop&);static void emit(Desktop&,wchar_t const*);static void failure(Desktop&);
 static void document_ready(Desktop&);static void renderer(Desktop&,JsonObject const&);static void confirmation(Desktop&);
 static bool key(Desktop&,WORD);static void type_command(Desktop&);static void resize(Desktop&);
 static bool input_active,input_done_emitted;static unsigned input_action,input_pending;static size_t input_cursor;static ComPtr<ICoreWebView2> input_web;
 static std::wstring const& command();static size_t input_length(unsigned);static JsonObject input_payload(unsigned,size_t);
 static bool input_request(Desktop&,unsigned);static void input_step(Desktop&);static void input_finished(Desktop&);
 static bool complete(Desktop&,JsonObject const&);
};
/* D705 TERMINAL IMPLEMENTATION */
Desktop* D705TerminalAcceptance::owner=nullptr;
std::wstring D705TerminalAcceptance::document;
unsigned long D705TerminalAcceptance::epoch=0;
unsigned D705TerminalAcceptance::key_count=0,D705TerminalAcceptance::confirm_count=0,D705TerminalAcceptance::receipt_mask=0;
bool D705TerminalAcceptance::typed=false,D705TerminalAcceptance::resized=false,D705TerminalAcceptance::done=false,D705TerminalAcceptance::failed=false;
bool D705TerminalAcceptance::input_active=false,D705TerminalAcceptance::input_done_emitted=false;
unsigned D705TerminalAcceptance::input_action=0,D705TerminalAcceptance::input_pending=0;
size_t D705TerminalAcceptance::input_cursor=0;
ComPtr<ICoreWebView2> D705TerminalAcceptance::input_web;
bool D705TerminalAcceptance::current(Desktop& h){return owner==&h&&!failed&&h.ready&&h.generation==document&&h.epoch==epoch&&h.web&&h.controller&&h.window&&IsWindowVisible(h.window);}
void D705TerminalAcceptance::emit(Desktop& h,wchar_t const* id){JsonObject frame;put(frame,L"type",L"system.ping");put(frame,L"id",id);(void)h.send(frame);}
void D705TerminalAcceptance::failure(Desktop& h){if(failed)return;failed=true;input_active=false;input_pending=0;input_web.Reset();emit(h,L"D476_TERMINAL_FAIL");}
void D705TerminalAcceptance::document_ready(Desktop& h){
 if(owner||!h.ready||h.generation.empty()||!h.web){failure(h);return;}owner=&h;document=h.generation;epoch=h.epoch;
 std::wstring code=L"const documentGeneration="+std::wstring(JsonValue::CreateStringValue(document).Stringify())+L";"+D705_TERMINAL_FORM_SOURCE+L";true";
 auto result=h.web->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT status,LPCWSTR scriptResult)->HRESULT{if(FAILED(status)||!current(h)||!scriptResult||std::wstring(scriptResult)!=L"true")failure(h);return S_OK;}).Get());if(FAILED(result))failure(h);
}
// Fixed test-owned browser-engine input, never Win32 queue/hardware fidelity.
std::wstring const& D705TerminalAcceptance::command(){
 // The complete output marker is not present in the typed command/echo.
 static const std::wstring value=L"[Console]::Write(('x'*16384)+('D476_'+'TERMINAL_')+[char]0x4e2d); [Console]::ReadLine() #\u4e2d";return value;
}
size_t D705TerminalAcceptance::input_length(unsigned action){return action==1?2:action==2?command().size()+2:0;}
JsonObject D705TerminalAcceptance::input_payload(unsigned action,size_t cursor){
 JsonObject payload;
 if(action==2&&cursor<command().size()){
  put(payload,L"type",L"char");put(payload,L"text",std::wstring(1,command()[cursor]));put(payload,L"unmodifiedText",std::wstring(1,command()[cursor]));return payload;
 }
 const size_t step=action==2?cursor-command().size():cursor;
 if((action!=1&&action!=2)||step>1)throw std::runtime_error("TERMINAL_INPUT_STATE");
 put(payload,L"type",step==0?L"keyDown":L"keyUp");put(payload,L"key",L"Enter");put(payload,L"code",L"Enter");
 payload.Insert(L"windowsVirtualKeyCode",JsonValue::CreateNumberValue(VK_RETURN));payload.Insert(L"nativeVirtualKeyCode",JsonValue::CreateNumberValue(VK_RETURN));
 if(step==0){put(payload,L"text",L"\r");put(payload,L"unmodifiedText",L"\r");}return payload;
}
bool D705TerminalAcceptance::input_request(Desktop& h,unsigned action){
 if(!current(h)||GetForegroundWindow()!=h.window||!input_length(action)){failure(h);return false;}
 if(input_active){if(input_pending){failure(h);return false;}input_pending=action;return true;}
 input_active=true;input_action=action;input_cursor=0;input_web=h.web;input_step(h);return !failed;
}
void D705TerminalAcceptance::input_finished(Desktop& h){
 input_active=false;input_web.Reset();
 if(input_pending){auto action=input_pending;input_pending=0;(void)input_request(h,action);return;}
 if(done&&!input_done_emitted){input_done_emitted=true;emit(h,L"D476_TERMINAL_DONE");}
}
void D705TerminalAcceptance::input_step(Desktop& h){
 if(!current(h)||GetForegroundWindow()!=h.window||!input_active||input_web.Get()!=h.web.Get()||input_cursor>=input_length(input_action)){failure(h);return;}
 const auto action=input_action;const auto cursor=input_cursor;const auto window=h.window;Desktop* expected=&h;auto web=input_web;
 const auto payload=input_payload(action,cursor).Stringify();
 auto submitted=web->CallDevToolsProtocolMethod(L"Input.dispatchKeyEvent",payload.c_str(),Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>([expected,window,web,action,cursor](HRESULT status,LPCWSTR result)->HRESULT{
  // The original process exits on its window loop teardown; still reject a
  // dead/replaced native owner before dereferencing its captured pointer.
  if(owner!=expected||!IsWindow(window)||GetWindowLongPtrW(window,GWLP_USERDATA)!=(LONG_PTR)expected){failed=true;input_active=false;input_pending=0;input_web.Reset();return S_OK;}
  auto& target=*expected;
  if(FAILED(status)||!current(target)||GetForegroundWindow()!=window||target.web.Get()!=web.Get()||input_web.Get()!=web.Get()||!input_active||input_action!=action||input_cursor!=cursor){failure(target);return S_OK;}
  try{if(!result||JsonObject::Parse(result).Size()!=0){failure(target);return S_OK;}}catch(...){failure(target);return S_OK;}
  ++input_cursor;
  if(input_cursor==input_length(action))input_finished(target);else input_step(target);
  return S_OK;
 }).Get());if(FAILED(submitted))failure(h);
}
bool D705TerminalAcceptance::key(Desktop& h,WORD code){
 if(code!=VK_RETURN){failure(h);return false;}return input_request(h,1);
}
void D705TerminalAcceptance::type_command(Desktop& h){
 if(!current(h)||GetForegroundWindow()!=h.window||typed||key_count!=6||confirm_count!=3||receipt_mask!=3){failure(h);return;}typed=true;(void)input_request(h,2);
}
void D705TerminalAcceptance::resize(Desktop& h){
 if(!current(h)||resized||!typed||key_count!=6||confirm_count!=3||receipt_mask!=7||GetForegroundWindow()!=h.window){failure(h);return;}resized=true;
 RECT before{},after{};if(!GetWindowRect(h.window,&before)||!SetWindowPos(h.window,nullptr,0,0,before.right-before.left+120,before.bottom-before.top,SWP_NOMOVE|SWP_NOZORDER|SWP_NOACTIVATE)||!GetWindowRect(h.window,&after)||after.right-after.left!=before.right-before.left+120){failure(h);return;}
}
void D705TerminalAcceptance::confirmation(Desktop& h){
 if(!current(h)||!h.confirmation||confirm_count>=4){failure(h);return;}
 const unsigned number=confirm_count+1,expected_key=number==1?2u:number==2?4u:number==3?6u:9u;
 auto pending=h.confirmation.get();auto panel=pending->window;
 if(key_count!=expected_key||pending->purpose!=L"local-work"||pending->generation!=document||pending->epoch!=epoch||pending->thread.ValueType()!=JsonValueType::String||std::wstring(pending->thread.GetString())!=L"native-terminal-A"||!panel||!IsWindowVisible(panel)||GetWindow(panel,GW_OWNER)!=h.window||GetForegroundWindow()!=panel){failure(h);return;}
 auto action=parse(pending->full);if(text(action,L"kind")!=(number<4?L"terminal-open":L"terminal-return")){failure(h);return;}
 auto reveal=GetDlgItem(panel,3);if(!reveal||GetParent(reveal)!=panel||!IsWindowEnabled(reveal)){failure(h);return;}
 SendMessageW(reveal,BM_CLICK,0,0); // Invoke the actual native reveal button.
 if(!current(h)||h.confirmation.get()!=pending){failure(h);return;}
 int length=GetWindowTextLengthW(pending->details);std::wstring full((size_t)length+1,L'\0');GetWindowTextW(pending->details,full.data(),length+1);full.resize((size_t)length);
 if(full!=pending->full){failure(h);return;}confirm_count=number;
 if(number==2){SendMessageW(panel,WM_CLOSE,0,0);return;} // Complete the actual window-close Cancel before an input callback can resume.
 auto button=GetDlgItem(panel,number==1?2:1);if(!button||GetParent(button)!=panel||!IsWindowVisible(button)||!IsWindowEnabled(button)){failure(h);return;}
 SendMessageW(button,BM_CLICK,0,0); // Actual native Cancel/Approve; never a forged decision frame.
}
void D705TerminalAcceptance::renderer(Desktop& h,JsonObject const& frame){
 if(!current(h)||text(frame,L"type")!=L"system.ping")return;
 if(!::keys(frame,{L"type",L"id",L"generation"})||text(frame,L"generation")!=document){failure(h);return;}
 auto id=text(frame,L"id");const wchar_t* names[]={L"ROW",L"OPEN_DENY",L"REFRESH_DENY",L"OPEN_CANCEL",L"REFRESH_CANCEL",L"OPEN_APPROVE",L"STOP",L"SELECT",L"RETURN",L"REOPEN"};
 for(unsigned index=0;index<10;index++)if(id==std::wstring(L"D476_TERMINAL_")+names[index]+L"_KEY"){
  const unsigned expected_confirm=index<2?0u:index<4?1u:index<6?2u:index<9?3u:4u;
  const unsigned expected_receipts[]={0,0,1,1,3,3,15,31,31,63};
  if(key_count!=index||confirm_count!=expected_confirm||receipt_mask!=expected_receipts[index]||(index>=6&&(!typed||!resized))){failure(h);return;}key_count=index+1;(void)key(h,VK_RETURN);return;
 }
 if(id==L"D476_TERMINAL_TYPE"){type_command(h);return;}if(id==L"D476_TERMINAL_RESIZE"){resize(h);return;}
 const wchar_t* receipts[]={L"DENIED",L"CANCELLED",L"OUTPUT",L"RESIZED",L"STOPPED",L"SAVED",L"REOPENED",L"DONE"};
 for(unsigned index=0;index<8;index++)if(id==std::wstring(L"D476_TERMINAL_")+receipts[index]){
  if(receipt_mask!=((1u<<index)-1)){failure(h);return;}receipt_mask|=1u<<index;
  if(index==7){if(key_count!=10||confirm_count!=4||!typed||!resized){failure(h);return;}done=true;if(input_active||input_pending)return;input_done_emitted=true;}emit(h,id.c_str());return;
 }
 if(id==L"D476_TERMINAL_FAIL")failure(h);
}
bool D705TerminalAcceptance::complete(Desktop& h,JsonObject const& frame){
 if(text(frame,L"type")!=L"D476.terminal.complete")return false;
 if(!current(h)||GetForegroundWindow()!=h.window||!done||!input_done_emitted||input_active||input_pending||key_count!=10||confirm_count!=4||receipt_mask!=255||!typed||!resized||!::keys(frame,{L"type",L"result"})||text(frame,L"result")!=L"COMPLETE")ExitProcess(64);
 done=false;ExitProcess(77);return true;
}
