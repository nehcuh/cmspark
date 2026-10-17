class Desktop;
struct D476Acceptance {static unsigned count;static void document(Desktop&);static void confirmation(Desktop&);static void emit(Desktop&,wchar_t const*);static void renderer(Desktop&,JsonObject const&);};
/* D476 IMPLEMENTATION */
unsigned D476Acceptance::count=0;
void D476Acceptance::emit(Desktop& h,wchar_t const* id){JsonObject frame;put(frame,L"type",L"system.ping");put(frame,L"id",id);h.send(frame);}
void D476Acceptance::document(Desktop& h){
 std::wstring code=L"const documentGeneration="+std::wstring(JsonValue::CreateStringValue(h.generation).Stringify())+L";"+D476_FORM_SOURCE;
 auto result=h.web->ExecuteScript(code.c_str(),Callback<ICoreWebView2ExecuteScriptCompletedHandler>([&h](HRESULT code,LPCWSTR)->HRESULT{if(FAILED(code))emit(h,L"D476_FAIL_SCRIPT");return S_OK;}).Get());if(FAILED(result))emit(h,L"D476_FAIL_SCRIPT");
}
void D476Acceptance::confirmation(Desktop& h){
 ++count;if(!h.confirmation||!IsWindowVisible(h.confirmation->window)||GetWindow(h.confirmation->window,GW_OWNER)!=h.window||count>3){emit(h,L"D476_FAIL_NATIVE_WINDOW");return;}
 auto& p=*h.confirmation;auto length=GetWindowTextLengthW(p.details);std::wstring summary((size_t)length+1,L'\0');GetWindowTextW(p.details,summary.data(),length+1);summary.resize((size_t)length);
 if(summary.find(L"OWNED_PRIVATE_476")!=std::wstring::npos){emit(h,L"D476_FAIL_DEFAULT_SECRET");return;}
 SendMessageW(p.window,WM_COMMAND,MAKEWPARAM(3,BN_CLICKED),0);
 length=GetWindowTextLengthW(p.details);std::wstring full((size_t)length+1,L'\0');GetWindowTextW(p.details,full.data(),length+1);full.resize((size_t)length);
 if(full!=p.full||(count<3&&full.find(L"OWNED_PRIVATE_476")==std::wstring::npos)){emit(h,L"D476_FAIL_FULL_VIEW");return;}
 std::wstring receipt=L"D476_NATIVE_WINDOW_"+std::to_wstring(count);emit(h,receipt.c_str());
 auto button=GetDlgItem(p.window,count==2?2:1);if(!button){emit(h,L"D476_FAIL_BUTTON");return;}SendMessageW(button,BM_CLICK,0,0); // Synthetic activation of actual native button; not human evidence.
}
// Fixed test receipts only, after real renderer admission; ordinary send remains.
void D476Acceptance::renderer(Desktop& h,JsonObject const& frame){
 static wchar_t const* names[]={L"D476_SAVE_APPROVED",L"D476_SAVE_DENIED",L"D476_NATIVE_DONE",L"D476_FAIL_ROW",L"D476_FAIL_APPROVE",L"D476_FAIL_DENY",L"D476_FAIL_ADD",L"D476_FAIL_RENDERER_SECRET"};
 if(text(frame,L"type")!=L"system.ping")return;auto id=text(frame,L"id");
 for(auto name:names)if(id==name){emit(h,name);return;}
}
