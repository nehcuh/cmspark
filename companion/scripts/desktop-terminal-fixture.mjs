// Separate unshipped terminal acceptance. No product hook or authority is shipped.
/*OWNED_INPUT826_IMPORT_BEGIN*/import {desktopOwnedCaptionSetup826} from './desktop-mcp-fixture.mjs'
/*OWNED_INPUT826_IMPORT_END*/export function desktopTerminalFixture(language, original, controller, form) {
  if (!['cpp', 'swift'].includes(language) || typeof original !== 'string' || !original.length || typeof controller !== 'string' || !controller.length || typeof form !== 'string' || !form.length) throw Error('DESKTOP_TERMINAL_FIXTURE_KIND')
  if (controller.split('D705_TERMINAL_FORM_SOURCE').length !== 2) throw Error('DESKTOP_TERMINAL_FORM_SOURCE')
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const literal = (language === 'cpp' ? 'L' : '') + JSON.stringify(form)
  controller = controller.replace('D705_TERMINAL_FORM_SOURCE', literal).replace(/\r?\n/g, eol)
/*OWNED_INPUT826_GENERATOR_BEGIN*/  if(language==='cpp'){
    // Explicit initial-input setup, not an observation or a keyboard change.
    const guards='if(!form_window||!IsWindow(form_window)||GetWindowLongPtrW(form_window,GWLP_USERDATA)!=(LONG_PTR)owner||h.window!=form_window||!h.ready||h.generation!=document||h.epoch!=epoch||!h.web||h.web.Get()!=form_web.Get()||!h.controller)'
    const identity=guards+'{/*OBS788_JOIN_BEGIN*/try{join788(h,2,0);}catch(...){}/*OBS788_JOIN_END*/failure(h);return;}'
    const checked=identity.replace('if(!form_window','if(h.closing||!form_window').replace('||!h.controller)','||!h.controller||h.controller.Get()!=form_controller826.Get())')
    const selection='if(!selection_complete826){if(selection_attempted826)return;selection_attempted826=true;if(!d476_owned_caption826(form_window)){failure(h);return;}selection_complete826=true;}'
    const pairs=[['static bool form_requested;', 'static bool selection_attempted826,selection_complete826;static bool form_requested;'],['static ComPtr<ICoreWebView2> form_web;', 'static ComPtr<ICoreWebView2Controller> form_controller826;static ComPtr<ICoreWebView2> form_web;'],['ComPtr<ICoreWebView2> D705TerminalAcceptance::form_web;', 'ComPtr<ICoreWebView2Controller> D705TerminalAcceptance::form_controller826;'+eol+'ComPtr<ICoreWebView2> D705TerminalAcceptance::form_web;'],['form_window=h.window;form_web=h.web;', 'form_window=h.window;form_web=h.web;form_controller826=h.controller;'],['bool D705TerminalAcceptance::form_requested=false;', 'bool D705TerminalAcceptance::selection_attempted826=false,D705TerminalAcceptance::selection_complete826=false;'+eol+'bool D705TerminalAcceptance::form_requested=false;'],[identity,checked+eol+' if(!IsWindowVisible(form_window))return;'+eol+' '+selection+eol+' '+checked],['// Join only the first owned document and actual native activation. Never acquire focus.','// One initial owned caption selection, then join actual foreground; no retries.']]
    for(const[before,after]of pairs){if(controller.split(before).length!==2)throw Error('DESKTOP_TERMINAL_INITIAL_INPUT_ANCHOR');controller=controller.replace(before,after)}
  }
/*OWNED_INPUT826_GENERATOR_END*/  const parts = controller.split('/* D705 TERMINAL IMPLEMENTATION */')
  if (language === 'cpp' && parts.length !== 2) throw Error('DESKTOP_TERMINAL_FIXTURE_KIND')
  const patches = language === 'cpp' ? [
    ['class Desktop {', desktopOwnedCaptionSetup826(eol) + parts[0] + eol + 'class Desktop {' + eol + ' friend struct D705TerminalAcceptance;'],
    ['deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)}', 'deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)D705TerminalAcceptance::document_ready(*this);}'],
    ['if(local_method(type)){render_local(frame);return;}', 'D705TerminalAcceptance::renderer(*this,frame);if(local_method(type)){render_local(frame);return;}'],
    ['ShowWindow(panel,SW_SHOW);SetForegroundWindow(panel);SetFocus(cancel);', 'ShowWindow(panel,SW_SHOW);SetForegroundWindow(panel);SetFocus(cancel);D705TerminalAcceptance::confirmation(*this);'],
    ['if(accept_local(frame))return;', 'if(D705TerminalAcceptance::complete(*this,frame))return;if(accept_local(frame))return;'],
    ['return 0;}return DefWindowProcW(hwnd,message,w,l);' + eol + ' }', 'return 0;}if(message==WM_ACTIVATE){const auto result=DefWindowProcW(hwnd,message,w,l);if(LOWORD(w)!=WA_INACTIVE)/*OBS788_BEGIN*/{/*OBS788_JOIN_BEGIN*/try{D705TerminalAcceptance::markJoin788(*self,2);}catch(...){}/*OBS788_JOIN_END*/D705TerminalAcceptance::observe788(*self,2);/*OBS788_END*/D705TerminalAcceptance::begin_form(*self);/*OBS788_BEGIN*/}/*OBS788_END*/return result;}return DefWindowProcW(hwnd,message,w,l);' + eol + ' }'],
  ] : [
    ['guard authenticated,webView.url?.absoluteString==origin else{return};retireArchive();generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!])', 'guard authenticated,webView.url?.absoluteString==origin else{return};retireArchive();generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!]);D705TerminalAcceptance.documentReady(self)'],
    ['if Self.localMethods.contains(type){renderLocal(f);return}', 'D705TerminalAcceptance.renderer(self,f);if Self.localMethods.contains(type){renderLocal(f);return}'],
    ['self.retireConfirmation(response == .alertSecondButtonReturn)}', 'self.retireConfirmation(response == .alertSecondButtonReturn)}' + eol + '        D705TerminalAcceptance.confirmation(self)'],
    ['if acceptLocal(f){return}', 'if D705TerminalAcceptance.complete(self,f){return};if acceptLocal(f){return}'],
  ]
  let source = original
  for (const [before, after] of patches) {
    if (source.split(before).length !== 2) throw Error('DESKTOP_TERMINAL_FIXTURE_ANCHOR')
    source = source.replace(before, after)
  }
  const tail = language === 'cpp' ? parts[1] : controller
  const suffix = eol + '/* D705 unshipped terminal acceptance */' + eol + tail
  source += suffix
  let inverse = source.slice(0, -suffix.length)
  for (const [before, after] of [...patches].reverse()) {
    if (inverse.split(after).length !== 2) throw Error('DESKTOP_TERMINAL_FIXTURE_INVERSE')
    inverse = inverse.replace(after, before)
  }
  if (inverse !== original) throw Error('DESKTOP_TERMINAL_SOURCE_DRIFT')
  return { source, inverse }
}
