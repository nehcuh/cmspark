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
    ['guard authenticated,webView.url?.absoluteString==origin else{return};generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!])','guard authenticated,webView.url?.absoluteString==origin else{return};generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!]);D476Acceptance.document(self)'],
    ['self.retireConfirmation(response == .alertSecondButtonReturn)}','self.retireConfirmation(response == .alertSecondButtonReturn)}\n        D476Acceptance.confirmation(self)'],
    ['var out=f;out.removeValue(forKey:"generation");', 'D476Acceptance.renderer(self,f);var out=f;out.removeValue(forKey:"generation");'],
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
