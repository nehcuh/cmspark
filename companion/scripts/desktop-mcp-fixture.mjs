// #476 test-build-only hooks. Inverse must recover every original production byte.
export function desktopMcpFixture(language, original, fixture, form) {
  if(typeof form!=="string"||!form.length||fixture.split("D476_FORM_SOURCE").length!==2)throw Error("DESKTOP_MCP_FORM_SOURCE")
  fixture=fixture.replace("D476_FORM_SOURCE",(language==="cpp"?"L":"")+JSON.stringify(form))
  const parts=fixture.split("/* D476 IMPLEMENTATION */")
  const patches=language==="cpp" ? [
    ["class Desktop {",parts[0]+"\nclass Desktop {\n friend struct D476Acceptance;"],
    ['frame.Remove(L"generation");put(frame,L"id",id);send(frame);', 'D476Acceptance::renderer(*this,frame);frame.Remove(L"generation");put(frame,L"id",id);send(frame);'],
    ["deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)}","deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)D476Acceptance::document(*this);}"],
    ["ShowWindow(panel,SW_SHOW);SetForegroundWindow(panel);SetFocus(cancel);","ShowWindow(panel,SW_SHOW);SetForegroundWindow(panel);SetFocus(cancel);D476Acceptance::confirmation(*this);"],
  ] : language==="swift" ? [
    ['guard authenticated,webView.url?.absoluteString==origin else{return};retireArchive();generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!])','guard authenticated,webView.url?.absoluteString==origin else{return};retireArchive();generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!]);D476Acceptance.document(self)'],
    ['self.retireConfirmation(response == .alertSecondButtonReturn)}','self.retireConfirmation(response == .alertSecondButtonReturn)}\n        D476Acceptance.confirmation(self)'],
    ['var out=f;if type=="desktop.chat.stop"', 'D476Acceptance.renderer(self,f);var out=f;if type=="desktop.chat.stop"'],
  ] : []
  if(patches.length===0||(language==="cpp"&&parts.length!==2))throw Error("DESKTOP_MCP_FIXTURE_KIND")
  let source=original
  for(const [before,after]of patches){if(source.split(before).length!==2)throw Error("DESKTOP_MCP_FIXTURE_ANCHOR");source=source.replace(before,after)}
  const suffix="\n/* D476 unshipped native controller acceptance */\n"+(language==="cpp"?parts[1]:fixture)
  source+=suffix
  let inverse=source.slice(0,-suffix.length)
  for(const [before,after]of [...patches].reverse()){if(inverse.split(after).length!==2)throw Error("DESKTOP_MCP_FIXTURE_INVERSE");inverse=inverse.replace(after,before)}
  if(inverse!==original)throw Error("DESKTOP_MCP_FIXTURE_SOURCE_DRIFT")
  return {source,inverse}
}


// Metadata-only hosted acceptance additions. Production and MCP variants recover
// byte-for-byte; this hook has no shipped renderer method or backend authority.
export function desktopMetadataFixture(language, original, fixture, form, metadata) {
  if(typeof metadata!=="string"||!metadata.length)throw Error("DESKTOP_METADATA_FIXTURE_KIND")
  const base=desktopMcpFixture(language,original,fixture,form)
  const parts=metadata.split("/* D476 METADATA IMPLEMENTATION */")
  const patches=language==="cpp" ? [
    ["class Desktop {",parts[0]+"\nclass Desktop {\n friend struct D476MetadataAcceptance;"],
    ["D476Acceptance::document(*this);","D476MetadataAcceptance::arm(*this);D476Acceptance::document(*this);"],
    ["D476Acceptance::renderer(*this,frame);","D476Acceptance::renderer(*this,frame);D476MetadataAcceptance::renderer(*this,frame);"],
    ['void renderer(std::wstring const& source,std::wstring const& body){','void renderer(std::wstring const& source,std::wstring const& body){if(D476MetadataAcceptance::observe(*this,source,body))return;'],
    ['else if(message==native_offline){self->retire_local();self->retire_picker();self->retire_confirmation();','else if(message==native_offline){D476MetadataAcceptance::lost(*self);self->retire_local();self->retire_picker();self->retire_confirmation();'],
  ] : language==="swift" ? [
    ["D476Acceptance.document(self)","D476MetadataAcceptance.arm(self);D476Acceptance.document(self)"],
    ["D476Acceptance.renderer(self,f);","D476Acceptance.renderer(self,f);D476MetadataAcceptance.renderer(self,f);"],
    ['func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {','func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {\n        if D476MetadataAcceptance.observe(self,message){return}'],
    ['guard socket === task else { return };let wasAuthenticated=authenticated;','guard socket === task else { return };D476MetadataAcceptance.lost(self);let wasAuthenticated=authenticated;'],
  ] : []
  if(!metadata||patches.length===0||(language==="cpp"&&parts.length!==2))throw Error("DESKTOP_METADATA_FIXTURE_KIND")
  let source=base.source
  for(const [before,after]of patches){if(source.split(before).length!==2)throw Error("DESKTOP_METADATA_FIXTURE_ANCHOR");source=source.replace(before,after)}
  const suffix="\n/* D476 unshipped metadata acceptance */\n"+(language==="cpp"?parts[1]:metadata);source+=suffix
  let inverse=source.slice(0,-suffix.length)
  for(const [before,after]of [...patches].reverse()){if(inverse.split(after).length!==2)throw Error("DESKTOP_METADATA_FIXTURE_INVERSE");inverse=inverse.replace(after,before)}
  if(inverse!==base.source||base.inverse!==original)throw Error("DESKTOP_METADATA_SOURCE_DRIFT")
  return {source,inverse:base.inverse}
}


// New native dialog acceptance remains a separate unshipped binary.
export function desktopDialogFixture(language, original, fixture, form, dialog) {
  if(typeof dialog!=="string"||!dialog.length)throw Error("DESKTOP_DIALOG_FIXTURE_KIND")
  const base=desktopMcpFixture(language,original,fixture,form)
  const parts=dialog.split("/* D476 DIALOG IMPLEMENTATION */")
  const patches=language==="cpp" ? [
    ["class Desktop {",parts[0]+"\nclass Desktop {\n friend struct D476DialogAcceptance;"],
    ["D476Acceptance::document(*this);","D476DialogAcceptance::arm(*this);D476Acceptance::document(*this);"],
    ["D476Acceptance::renderer(*this,frame);","D476Acceptance::renderer(*this,frame);D476DialogAcceptance::renderer(*this,frame);"],
    ['void renderer(std::wstring const& source,std::wstring const& body){','void renderer(std::wstring const& source,std::wstring const& body){if(D476DialogAcceptance::observe(*this,source,body))return;'],
    ['else if(message==native_offline){self->retire_local();self->retire_picker();self->retire_confirmation();','else if(message==native_offline){D476DialogAcceptance::lost(*self);self->retire_local();self->retire_picker();self->retire_confirmation();'],
  ] : language==="swift" ? [
    ["D476Acceptance.document(self)","D476DialogAcceptance.arm(self);D476Acceptance.document(self)"],
    ["D476Acceptance.renderer(self,f);","D476Acceptance.renderer(self,f);D476DialogAcceptance.renderer(self,f);"],
    ['func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {','func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {\n        if D476DialogAcceptance.observe(self,message){return}'],
    ['guard socket === task else { return };let wasAuthenticated=authenticated;','guard socket === task else { return };D476DialogAcceptance.lost(self);let wasAuthenticated=authenticated;'],
  ] : []
  if(!dialog||patches.length===0||(language==="cpp"&&parts.length!==2))throw Error("DESKTOP_DIALOG_FIXTURE_KIND")
  let source=base.source
  for(const [before,after]of patches){if(source.split(before).length!==2)throw Error("DESKTOP_DIALOG_FIXTURE_ANCHOR");source=source.replace(before,after)}
  const suffix="\n/* D476 unshipped dialog acceptance */\n"+(language==="cpp"?parts[1]:dialog);source+=suffix
  let inverse=source.slice(0,-suffix.length)
  for(const [before,after]of [...patches].reverse()){if(inverse.split(after).length!==2)throw Error("DESKTOP_DIALOG_FIXTURE_INVERSE");inverse=inverse.replace(after,before)}
  if(inverse!==base.source||base.inverse!==original)throw Error("DESKTOP_DIALOG_SOURCE_DRIFT")
  return {source,inverse:base.inverse}
}

/** Separate unshipped resource controller. The normal host always retains its exact bytes. */
export function desktopResourceFixture(language, original, fixture, form) {
  const base=desktopMcpFixture(language,original,fixture,form)
  const patches=language==='cpp' ? [
    ['void renderer(std::wstring const& source,std::wstring const& body){','void renderer(std::wstring const& source,std::wstring const& body){if(D476Acceptance::observe(*this,source,body))return;'],
    ['else if(message==native_offline){self->retire_local();self->retire_picker();self->retire_confirmation();','else if(message==native_offline){D476Acceptance::lost(*self);self->retire_local();self->retire_picker();self->retire_confirmation();'],
  ] : language==='swift' ? [
    ['func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {','func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {\n        if D476Acceptance.observe(self,message){return}'],
    ['guard socket === task else { return };let wasAuthenticated=authenticated;','guard socket === task else { return };D476Acceptance.lost(self);let wasAuthenticated=authenticated;'],
  ] : []
  if(patches.length!==2)throw Error('DESKTOP_RESOURCE_FIXTURE_KIND')
  let source=base.source
  for(const [before,after]of patches){if(source.split(before).length!==2)throw Error('DESKTOP_RESOURCE_FIXTURE_ANCHOR');source=source.replace(before,after)}
  let inverse=source
  for(const [before,after]of [...patches].reverse()){if(inverse.split(after).length!==2)throw Error('DESKTOP_RESOURCE_FIXTURE_INVERSE');inverse=inverse.replace(after,before)}
  if(inverse!==base.source||base.inverse!==original)throw Error('DESKTOP_RESOURCE_SOURCE_DRIFT')
  return{source,inverse:base.inverse}
}

/** Workspace-only unshipped host: private picker observation never reaches the WebView. */
export function desktopWorkspaceFixture(language, original, fixture, form) {
 const base=desktopMcpFixture(language,original,fixture,form)
 const patches=language==='cpp' ? [
  ['void accept(std::wstring const& body,unsigned long frame_epoch){','void accept(std::wstring const& body,unsigned long frame_epoch){if(D476Acceptance::picker(*this,parse(body)))return;'],
  ['HRESULT shown=dialog->Show(window);KillTimer(window,workspace_picker_timer);','HRESULT shown=dialog->Show(window);KillTimer(window,workspace_picker_timer);D476Acceptance::shown(*this,shown,p->settled,picker_current(p));'],
 ] : language==='swift' ? [
  ['func accept(_ f:[String:Any],_ task:URLSessionWebSocketTask) {','func accept(_ f:[String:Any],_ task:URLSessionWebSocketTask) {\n        if D476Acceptance.picker(self,f){return}'],
  // Pin only the unshipped fixture's default button before presentation.
  ['p.panel.beginSheetModal(for:owner){','p.panel.prompt="Choose";p.panel.beginSheetModal(for:owner){'],
 ] : []
 if(patches.length!==2)throw Error('DESKTOP_WORKSPACE_FIXTURE_KIND')
 let source=base.source
 for(const [before,after]of patches){if(source.split(before).length!==2)throw Error('DESKTOP_WORKSPACE_FIXTURE_ANCHOR');source=source.replace(before,after)}
 let inverse=source
 for(const [before,after]of [...patches].reverse()){if(inverse.split(after).length!==2)throw Error('DESKTOP_WORKSPACE_FIXTURE_INVERSE');inverse=inverse.replace(after,before)}
 if(inverse!==base.source||base.inverse!==original)throw Error('DESKTOP_WORKSPACE_SOURCE_DRIFT')
 return{source,inverse:base.inverse}
}

/** Separate local-work acceptance binary; every shipped byte is recovered by inverse. */
export function desktopLocalFixture(language,original,controller,form){
 const parts=controller.split('/* D476 LOCAL IMPLEMENTATION */');if(parts.length!==2||form.length===0||controller.split('D476_LOCAL_FORM').length!==2)throw Error('DESKTOP_LOCAL_FIXTURE_KIND')
 controller=controller.replace('D476_LOCAL_FORM',(language==='cpp'?'L':'')+JSON.stringify(form));const filled=controller.split('/* D476 LOCAL IMPLEMENTATION */')
 const patches=language==='cpp'?[
  ['void accept(std::wstring const& body,unsigned long frame_epoch){','void accept(std::wstring const& body,unsigned long frame_epoch){if(D476LocalAcceptance::complete(*this,parse(body)))return;'],
  ['class Desktop {',filled[0]+'\nclass Desktop {\n friend struct D476LocalAcceptance;'],
  ['deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)}','deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)D476LocalAcceptance::document(*this);}'],
  ['ShowWindow(panel,SW_SHOW);SetForegroundWindow(panel);SetFocus(cancel);','ShowWindow(panel,SW_SHOW);SetForegroundWindow(panel);SetFocus(cancel);D476LocalAcceptance::confirmation(*this);'],
  ['auto type=text(frame,L"type");if(type==L"desktop.view"','D476LocalAcceptance::renderer(*this,frame);auto type=text(frame,L"type");if(type==L"desktop.view"'],
 ]:language==='swift'?[
  ['guard authenticated,webView.url?.absoluteString==origin else{return};retireArchive();generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!])','guard authenticated,webView.url?.absoluteString==origin else{return};retireArchive();generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!]);D476LocalAcceptance.document(self)'],
  ['self.retireConfirmation(response == .alertSecondButtonReturn)}','self.retireConfirmation(response == .alertSecondButtonReturn)}\n        D476LocalAcceptance.confirmation(self)'],
  ['func accept(_ f:[String:Any],_ task:URLSessionWebSocketTask) {','func accept(_ f:[String:Any],_ task:URLSessionWebSocketTask) {if D476LocalAcceptance.complete(self,f){return}'],
  ['if type=="desktop.view",Set(f.keys)','D476LocalAcceptance.renderer(self,f);if type=="desktop.view",Set(f.keys)'],
 ]:[]
 if(!patches.length)throw Error('DESKTOP_LOCAL_FIXTURE_KIND');let source=original
 for(const [before,after]of patches){if(source.split(before).length!==2)throw Error('DESKTOP_LOCAL_FIXTURE_ANCHOR');source=source.replace(before,after)}
 const suffix='\n/* D476 unshipped local-work acceptance */\n'+(language==='cpp'?filled[1]:controller);source+=suffix;let inverse=source.slice(0,-suffix.length)
 for(const [before,after]of [...patches].reverse()){if(inverse.split(after).length!==2)throw Error('DESKTOP_LOCAL_FIXTURE_INVERSE');inverse=inverse.replace(after,before)}
 if(inverse!==original)throw Error('DESKTOP_LOCAL_SOURCE_DRIFT');return desktopInitialActivation788(language,source,inverse,'LOCAL')
}
// Separate unshipped archive acceptance; no shipped source hook.
export function desktopArchiveFixture(language, original, fixture, form, metadata) {
  if(typeof metadata!=="string"||!metadata.length)throw Error("DESKTOP_ARCHIVE_FIXTURE_KIND")
  // Archive-only copy: shared controller and other fixture families stay unchanged.
  if(language==="cpp"){
    const pairs=[['if(FAILED(code))emit(h,L"D476_FAIL_SCRIPT");','if(FAILED(code)){try{emit(h,L"D476_ARCHIVE_FIRST_S_2");}catch(...){}emit(h,L"D476_FAIL_SCRIPT");}'],['if(FAILED(result))emit(h,L"D476_FAIL_SCRIPT");','if(FAILED(result)){try{emit(h,L"D476_ARCHIVE_FIRST_S_1");}catch(...){}emit(h,L"D476_FAIL_SCRIPT");}']]
    for(const [before,after]of pairs){if(fixture.split(before).length!==2)throw Error("DESKTOP_ARCHIVE_SCRIPT_OBSERVATION_ANCHOR");fixture=fixture.replace(before,after)}
  }
  const base=desktopMcpFixture(language,original,fixture,form)
  const parts=metadata.split("/* D476 ARCHIVE IMPLEMENTATION */")
  const patches=language==="cpp" ? [
    ["class Desktop {",parts[0]+"\nclass Desktop {\n friend struct D476ArchiveAcceptance;"],
    ["D476Acceptance::document(*this);","D476ArchiveAcceptance::arm(*this);D476Acceptance::document(*this);"],
    ["D476Acceptance::renderer(*this,frame);","D476Acceptance::renderer(*this,frame);D476ArchiveAcceptance::renderer(*this,frame);"],
    ['void renderer(std::wstring const& source,std::wstring const& body){','void renderer(std::wstring const& source,std::wstring const& body){if(D476ArchiveAcceptance::observe(*this,source,body))return;'],
    ['else if(message==native_offline){self->retire_local();self->retire_picker();self->retire_confirmation();','else if(message==native_offline){D476ArchiveAcceptance::lost(*self);self->retire_local();self->retire_picker();self->retire_confirmation();'],
  ] : language==="swift" ? [
    ["D476Acceptance.document(self)","D476ArchiveAcceptance.arm(self);D476Acceptance.document(self)"],
    ["D476Acceptance.renderer(self,f);","D476Acceptance.renderer(self,f);D476ArchiveAcceptance.renderer(self,f);"],
    ['func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {','func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {\n        if D476ArchiveAcceptance.observe(self,message){return}'],
    ['guard socket === task else { return };let wasAuthenticated=authenticated;','guard socket === task else { return };D476ArchiveAcceptance.lost(self);let wasAuthenticated=authenticated;'],
  ] : []
  if(!metadata||patches.length===0||(language==="cpp"&&parts.length!==2))throw Error("DESKTOP_ARCHIVE_FIXTURE_KIND")
  let source=base.source
  for(const [before,after]of patches){if(source.split(before).length!==2)throw Error("DESKTOP_ARCHIVE_FIXTURE_ANCHOR");source=source.replace(before,after)}
  const suffix="\n/* D476 unshipped archive acceptance */\n"+(language==="cpp"?parts[1]:metadata);source+=suffix
  let inverse=source.slice(0,-suffix.length)
  for(const [before,after]of [...patches].reverse()){if(inverse.split(after).length!==2)throw Error("DESKTOP_ARCHIVE_FIXTURE_INVERSE");inverse=inverse.replace(after,before)}
  if(inverse!==base.source||base.inverse!==original)throw Error("DESKTOP_ARCHIVE_SOURCE_DRIFT")
  return desktopInitialActivation788(language,source,base.inverse,'ARCHIVE')
}

// Windows test-only initial caption selection; the original foreground gate still applies.
// Build-only initial OS selection. This explicitly changes fixture setup; it
// neither confirms a tool nor promises an atomic HWND-targeted input batch.
export function desktopOwnedCaptionSetup826(eol='\n'){
 return `static bool d476_owned_caption826(HWND window){
 const auto previous826=SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
 if(!previous826)return false;
 const bool inserted826=[&]()->bool{
  DWORD pid826=0,hitPid826=0;
  if(!window||!IsWindow(window)||!IsWindowVisible(window)||IsIconic(window)||!IsWindowEnabled(window)||!GetWindowThreadProcessId(window,&pid826)||pid826!=GetCurrentProcessId())return false;
  RECT rect826{};POINT client826{};
  if(!GetWindowRect(window,&rect826)||!ClientToScreen(window,&client826)||rect826.right<=rect826.left||rect826.bottom<=rect826.top||client826.y<=rect826.top||client826.y>=rect826.bottom)return false;
  const int64_t x826=((int64_t)rect826.left+rect826.right)/2,y826=((int64_t)rect826.top+client826.y)/2;
  if(x826< -32768||x826>32767||y826< -32768||y826>32767)return false;
  POINT point826{(LONG)x826,(LONG)y826};
  const int left826=GetSystemMetrics(SM_XVIRTUALSCREEN),top826=GetSystemMetrics(SM_YVIRTUALSCREEN),width826=GetSystemMetrics(SM_CXVIRTUALSCREEN),height826=GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if(width826<=1||height826<=1||x826<left826||y826<top826||x826>=(int64_t)left826+width826||y826>=(int64_t)top826+height826)return false;
  if(SendMessageW(window,WM_NCHITTEST,0,MAKELPARAM((short)x826,(short)y826))!=HTCAPTION)return false;
  const HWND hit826=WindowFromPoint(point826);
  if(!hit826||GetAncestor(hit826,GA_ROOT)!=window||!GetWindowThreadProcessId(hit826,&hitPid826)||hitPid826!=pid826)return false;
  INPUT batch826[3]{};
  batch826[0].type=INPUT_MOUSE;batch826[0].mi.dx=(LONG)(((x826-left826)*65535+(width826-1)/2)/(width826-1));batch826[0].mi.dy=(LONG)(((y826-top826)*65535+(height826-1)/2)/(height826-1));
  batch826[0].mi.dwFlags=MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE|MOUSEEVENTF_VIRTUALDESK;
  batch826[1].type=INPUT_MOUSE;batch826[1].mi.dwFlags=MOUSEEVENTF_LEFTDOWN;batch826[2].type=INPUT_MOUSE;batch826[2].mi.dwFlags=MOUSEEVENTF_LEFTUP;
  return SendInput(3,batch826,sizeof(INPUT))==3;
 }();
 const bool restored826=SetThreadDpiAwarenessContext(previous826)!=nullptr;
 return inserted826&&restored826;
}
`.replace(/\n/g,eol)
}
function desktopInitialActivation788(language,source,inverse,kind){
 if(language!=='cpp')return{source,inverse}
 if(kind!=='LOCAL'&&kind!=='ARCHIVE')throw Error('DESKTOP_INITIAL_ACTIVATION_KIND')
 const cls=kind==='LOCAL'?'D476LocalInitialActivation788':'D476ArchiveInitialActivation788'
 const call=kind==='LOCAL'?'D476LocalAcceptance::document(*this);':'D476ArchiveAcceptance::arm(*this);D476Acceptance::document(*this);'
 const start=kind==='LOCAL'?'D476LocalAcceptance::document(h);':'D476ArchiveAcceptance::arm(h);D476Acceptance::document(h);'
 const failure=kind==='LOCAL'?'D476LocalAcceptance::observe(h,reason==1?L"D476_LOCAL_FIRST_W_1":L"D476_LOCAL_FIRST_W_7");D476LocalAcceptance::emit(h,L"D476_LOCAL_FAIL");':'D476ArchiveAcceptance::failure(h,reason==1?1:2);'
 const suffix=kind==='LOCAL'?'/* D476 unshipped local-work acceptance */':'/* D476 unshipped archive acceptance */'
 const windows=[...source.matchAll(/return 0;}return DefWindowProcW\(hwnd,message,w,l\);(\r?\n) }/g)]
 if(windows.length!==1)throw Error('DESKTOP_INITIAL_ACTIVATION_PROC')
 const eol=windows[0][1],lines=value=>value.replace(/\n/g,eol)
 const declaration=lines(`struct ${cls} {
 static Desktop* owner;static HWND window;static std::wstring document;static unsigned long epoch;
 static ComPtr<ICoreWebView2> web;static ComPtr<ICoreWebView2Controller> controller;static bool started,failed,selectionAttempted826,selectionComplete826;
 static void documentReady(Desktop&);static void begin(Desktop&);static void fail(Desktop&,unsigned) noexcept;
};
`)
 const implementation=lines(`Desktop* ${cls}::owner=nullptr;HWND ${cls}::window=nullptr;std::wstring ${cls}::document;unsigned long ${cls}::epoch=0;
ComPtr<ICoreWebView2> ${cls}::web;ComPtr<ICoreWebView2Controller> ${cls}::controller;bool ${cls}::started=false,${cls}::failed=false,${cls}::selectionAttempted826=false,${cls}::selectionComplete826=false;
void ${cls}::fail(Desktop& h,unsigned reason) noexcept {if(failed)return;failed=true;try{${failure}}catch(...){}}
void ${cls}::documentReady(Desktop& h){
 if(owner||failed){fail(h,1);return;}
 owner=&h;window=h.window;document=h.generation;epoch=h.epoch;web=h.web;controller=h.controller;begin(h);
}
void ${cls}::begin(Desktop& h){
 if(!owner||owner!=&h||started||failed)return;
 if(h.closing||!h.ready||h.generation.empty()||h.generation!=document||h.epoch!=epoch||h.window!=window||!window||!IsWindow(window)||GetWindowLongPtrW(window,GWLP_USERDATA)!=(LONG_PTR)owner||!h.web||h.web.Get()!=web.Get()||!h.controller||h.controller.Get()!=controller.Get()){fail(h,2);return;}
 if(!IsWindowVisible(window))return;
 if(!selectionComplete826){if(selectionAttempted826)return;selectionAttempted826=true;if(!d476_owned_caption826(window)){fail(h,2);return;}selectionComplete826=true;}
 if(h.closing||!h.ready||h.generation!=document||h.epoch!=epoch||h.window!=window||!IsWindow(window)||GetWindowLongPtrW(window,GWLP_USERDATA)!=(LONG_PTR)owner||!h.web||h.web.Get()!=web.Get()||!h.controller||h.controller.Get()!=controller.Get()){fail(h,2);return;}
 if(!IsWindowVisible(window)||GetForegroundWindow()!=window)return;
 started=true;
 ${start}
}
`)
 const proc=windows[0][0],active=`return 0;}if(message==WM_ACTIVATE){const auto result=DefWindowProcW(hwnd,message,w,l);if(LOWORD(w)!=WA_INACTIVE)${cls}::begin(*self);return result;}return DefWindowProcW(hwnd,message,w,l);${eol} }`
 const pairs=[['class Desktop {',desktopOwnedCaptionSetup826(eol)+declaration+`class Desktop {${eol} friend struct ${cls};`],[call,`${cls}::documentReady(*this);`],[proc,active],[suffix,implementation+suffix]]
 let value=source
 for(const[before,after]of pairs){if(value.split(before).length!==2)throw Error('DESKTOP_INITIAL_ACTIVATION_ANCHOR');value=value.replace(before,after)}
 let restored=value
 for(const[before,after]of [...pairs].reverse()){if(restored.split(after).length!==2)throw Error('DESKTOP_INITIAL_ACTIVATION_INVERSE');restored=restored.replace(after,before)}
 if(restored!==source)throw Error('DESKTOP_INITIAL_ACTIVATION_SOURCE_DRIFT')
 return{source:value,inverse}
}
