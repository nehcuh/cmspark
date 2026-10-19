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
    ['else if(message==native_offline){self->retire_confirmation();','else if(message==native_offline){D476MetadataAcceptance::lost(*self);self->retire_confirmation();'],
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
    ['else if(message==native_offline){self->retire_confirmation();','else if(message==native_offline){D476DialogAcceptance::lost(*self);self->retire_confirmation();'],
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
    ['else if(message==native_offline){self->retire_confirmation();','else if(message==native_offline){D476Acceptance::lost(*self);self->retire_confirmation();'],
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

// Separate unshipped archive acceptance; no shipped source hook.
export function desktopArchiveFixture(language, original, fixture, form, metadata) {
  if(typeof metadata!=="string"||!metadata.length)throw Error("DESKTOP_ARCHIVE_FIXTURE_KIND")
  const base=desktopMcpFixture(language,original,fixture,form)
  const parts=metadata.split("/* D476 ARCHIVE IMPLEMENTATION */")
  const patches=language==="cpp" ? [
    ["class Desktop {",parts[0]+"\nclass Desktop {\n friend struct D476ArchiveAcceptance;"],
    ["D476Acceptance::document(*this);","D476ArchiveAcceptance::arm(*this);D476Acceptance::document(*this);"],
    ["D476Acceptance::renderer(*this,frame);","D476Acceptance::renderer(*this,frame);D476ArchiveAcceptance::renderer(*this,frame);"],
    ['void renderer(std::wstring const& source,std::wstring const& body){','void renderer(std::wstring const& source,std::wstring const& body){if(D476ArchiveAcceptance::observe(*this,source,body))return;'],
    ['else if(message==native_offline){self->retire_confirmation();','else if(message==native_offline){D476ArchiveAcceptance::lost(*self);self->retire_confirmation();'],
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
  return {source,inverse:base.inverse}
}


