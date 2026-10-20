// Unshipped terminal-only controller. Synthetic native input is never human consent.
class Desktop;
struct D705TerminalAcceptance {
 static Desktop* owner;static std::wstring document;static unsigned long epoch;
 static unsigned key_count,confirm_count,receipt_mask;static bool typed,resized,done,failed;
 static bool current(Desktop&);static void emit(Desktop&,wchar_t const*);static void failure(Desktop&);
 static void document_ready(Desktop&);static void renderer(Desktop&,JsonObject const&);static void confirmation(Desktop&);
 static HWND focused(Desktop&);static bool key(Desktop&,WORD);static void type_command(Desktop&);static void resize(Desktop&);
 static bool complete(Desktop&,JsonObject const&);
};
/* D705 TERMINAL IMPLEMENTATION */
Desktop* D705TerminalAcceptance::owner=nullptr;
std::wstring D705TerminalAcceptance::document;
unsigned long D705TerminalAcceptance::epoch=0;
unsigned D705TerminalAcceptance::key_count=0,D705TerminalAcceptance::confirm_count=0,D705TerminalAcceptance::receipt_mask=0;
bool D705TerminalAcceptance::typed=false,D705TerminalAcceptance::resized=false,D705TerminalAcceptance::done=false,D705TerminalAcceptance::failed=false;
bool D705TerminalAcceptance::current(Desktop& h){return owner==&h&&!failed&&h.ready&&h.generation==document&&h.epoch==epoch&&h.web&&h.controller&&h.window&&IsWindowVisible(h.window);}
void D705TerminalAcceptance::emit(Desktop& h,wchar_t const* id){JsonObject frame;put(frame,L"type",L"system.ping");put(frame,L"id",id);(void)h.send(frame);}
void D705TerminalAcceptance::failure(Desktop& h){if(failed)return;failed=true;emit(h,L"D476_TERMINAL_FAIL");}
void D705TerminalAcceptance::document_ready(Desktop& h){
 if(owner||!h.ready||h.generation.empty()||!h.web){failure(h);return;}owner=&h;document=h.generation;epoch=h.epoch;
 std::wstring code=L"const documentGeneration="+std::wstring(JsonValue::CreateStringValue(document).Stringify())+L";"+D705_TERMINAL_FORM_SOURCE+L";true";
 auto result=h.web->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT status,LPCWSTR scriptResult)->HRESULT{if(FAILED(status)||!current(h)||!scriptResult||std::wstring(scriptResult)!=L"true")failure(h);return S_OK;}).Get());if(FAILED(result))failure(h);
}
HWND D705TerminalAcceptance::focused(Desktop& h){
 if(!current(h)||GetForegroundWindow()!=h.window)return nullptr;
 GUITHREADINFO info{};info.cbSize=sizeof(info);
 if(!GetGUIThreadInfo(0,&info)||!info.hwndFocus||GetAncestor(info.hwndFocus,GA_ROOT)!=h.window)return nullptr;
 return info.hwndFocus; // No foreground rescue, global queue attachment or guessed HWND.
}
bool D705TerminalAcceptance::key(Desktop& h,WORD code){
 auto target=focused(h);if(!target){failure(h);return false;}
 const LPARAM scan=(LPARAM)(MapVirtualKeyW(code,MAPVK_VK_TO_VSC)&0xffu)<<16;
 if(!PostMessageW(target,WM_KEYDOWN,code,1|scan)||!PostMessageW(target,WM_KEYUP,code,1|scan|((LPARAM)1<<30)|((LPARAM)1<<31))){failure(h);return false;}return true;
}
void D705TerminalAcceptance::type_command(Desktop& h){
 auto target=focused(h);if(!target||typed||key_count!=6||confirm_count!=3||receipt_mask!=3){failure(h);return;}typed=true;
 // The complete output marker is not present in the typed command/echo.
 std::wstring command=L"[Console]::Write(('x'*16384)+('D476_'+'TERMINAL_')+[char]0x4e2d); [Console]::ReadLine() #\u4e2d";
 for(auto character:command)if(!current(h)||GetForegroundWindow()!=h.window||!PostMessageW(target,WM_CHAR,character,1)){failure(h);return;}
 (void)key(h,VK_RETURN);
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
 if(number==2){if(!PostMessageW(panel,WM_CLOSE,0,0))failure(h);return;} // Actual window-close Cancel path.
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
  if(index==7){if(key_count!=10||confirm_count!=4||!typed||!resized){failure(h);return;}done=true;}emit(h,id.c_str());return;
 }
 if(id==L"D476_TERMINAL_FAIL")failure(h);
}
bool D705TerminalAcceptance::complete(Desktop& h,JsonObject const& frame){
 if(text(frame,L"type")!=L"D476.terminal.complete")return false;
 if(!current(h)||!done||key_count!=10||confirm_count!=4||receipt_mask!=255||!typed||!resized||!::keys(frame,{L"type",L"result"})||text(frame,L"result")!=L"COMPLETE")ExitProcess(64);
 done=false;ExitProcess(77);return true;
}
