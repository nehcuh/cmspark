// Separate unshipped terminal acceptance. No product hook or authority is shipped.
export function desktopTerminalFixture(language, original, controller, form) {
  if (!['cpp', 'swift'].includes(language) || typeof original !== 'string' || !original.length || typeof controller !== 'string' || !controller.length || typeof form !== 'string' || !form.length) throw Error('DESKTOP_TERMINAL_FIXTURE_KIND')
  if (controller.split('D705_TERMINAL_FORM_SOURCE').length !== 2) throw Error('DESKTOP_TERMINAL_FORM_SOURCE')
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const literal = (language === 'cpp' ? 'L' : '') + JSON.stringify(form)
  controller = controller.replace('D705_TERMINAL_FORM_SOURCE', literal).replace(/\r?\n/g, eol)
  const parts = controller.split('/* D705 TERMINAL IMPLEMENTATION */')
  if (language === 'cpp' && parts.length !== 2) throw Error('DESKTOP_TERMINAL_FIXTURE_KIND')
  const patches = language === 'cpp' ? [
    ['class Desktop {', parts[0] + eol + 'class Desktop {' + eol + ' friend struct D705TerminalAcceptance;'],
    ['deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)}', 'deliver(frame);DESKTOP_TEST_NOTE(document_post_attempted)D705TerminalAcceptance::document_ready(*this);}'],
    ['if(local_method(type)){render_local(frame);return;}', 'D705TerminalAcceptance::renderer(*this,frame);if(local_method(type)){render_local(frame);return;}'],
    ['ShowWindow(panel,SW_SHOW);SetForegroundWindow(panel);SetFocus(cancel);', 'ShowWindow(panel,SW_SHOW);SetForegroundWindow(panel);SetFocus(cancel);D705TerminalAcceptance::confirmation(*this);'],
    ['if(accept_local(frame))return;', 'if(D705TerminalAcceptance::complete(*this,frame))return;if(accept_local(frame))return;'],
    ['return 0;}return DefWindowProcW(hwnd,message,w,l);' + eol + ' }', 'return 0;}if(message==WM_ACTIVATE){const auto result=DefWindowProcW(hwnd,message,w,l);if(LOWORD(w)!=WA_INACTIVE)D705TerminalAcceptance::begin_form(*self);return result;}return DefWindowProcW(hwnd,message,w,l);' + eol + ' }'],
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
