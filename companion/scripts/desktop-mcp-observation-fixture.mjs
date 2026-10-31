// Windows MCP acceptance only. Never inserted into the distributed host.
// Every change is inverted against the existing complete test variant. Synchronous
// observation uses the existing socket and can perturb or block the test.
export function desktopMcpObservationFixture(source, form) {
  const formPatches = [
    ['  const original=window.cmsparkDesktopReceive;', '  try{post("D476_OBS_JS_BEGIN")}catch{}\n  const original=window.cmsparkDesktopReceive;'],
    ['  document.querySelector(\'[data-page="mcp.list"]\').click();', '  try{post("D476_OBS_CLICK_ENTER")}catch{}\n  document.querySelector(\'[data-page="mcp.list"]\').click();\n  try{post("D476_OBS_CLICK_RETURN")}catch{}'],
  ]
  let markedForm = form
  for (const [before, after] of formPatches) {
    if (markedForm.split(before).length !== 2) throw Error('MCP_OBSERVATION_FORM_ANCHOR')
    markedForm = markedForm.replace(before, after)
  }
  const extraNames = ['JS_BEGIN','CLICK_ENTER','CLICK_RETURN'].map(x => `L"D476_OBS_${x}"`).join(',')
  const nav = 'bool obsReady=ready.load();D476Acceptance::observe(*this,1u+((ok?4u:0u)|(own?2u:0u)|(obsReady?1u:0u)),(ok?(own?(obsReady?L"D476_OBS_NAV_111":L"D476_OBS_NAV_110"):(obsReady?L"D476_OBS_NAV_101":L"D476_OBS_NAV_100")):(own?(obsReady?L"D476_OBS_NAV_011":L"D476_OBS_NAV_010"):(obsReady?L"D476_OBS_NAV_001":L"D476_OBS_NAV_000"))));'
  const patches = [
    ['static void renderer(Desktop&,JsonObject const&);};', 'static void renderer(Desktop&,JsonObject const&);static void observe(Desktop&,unsigned,wchar_t const*) noexcept;};'],
    ['DESKTOP_TEST_NOTE(ready_accepted)', 'DESKTOP_TEST_NOTE(ready_accepted)D476Acceptance::observe(*this,0,L"D476_OBS_READY");'],
    ['DESKTOP_TEST_NAV()if(ok&&own&&ready)document();', `DESKTOP_TEST_NAV()${nav}if(ok&&own&&ready)document();`],
    ['void D476Acceptance::document(Desktop& h){', 'void D476Acceptance::observe(Desktop& h,unsigned bit,wchar_t const* id) noexcept {static std::atomic<unsigned> seen{0};if(bit>=17||(seen.fetch_or(1u<<bit)&(1u<<bit)))return;try{emit(h,id);}catch(...){}}\nvoid D476Acceptance::document(Desktop& h){observe(h,9,L"D476_OBS_DOCUMENT");'],
    ['[&h](HRESULT code,LPCWSTR)->HRESULT{if(FAILED(code))emit(h,L"D476_FAIL_SCRIPT");return S_OK;}).Get());if(FAILED(result))emit(h,L"D476_FAIL_SCRIPT");', '[&h](HRESULT code,LPCWSTR)->HRESULT{observe(h,FAILED(code)?13:12,FAILED(code)?L"D476_OBS_CALLBACK_FAIL":L"D476_OBS_CALLBACK_OK");if(FAILED(code))emit(h,L"D476_FAIL_SCRIPT");return S_OK;}).Get());observe(h,FAILED(result)?11:10,FAILED(result)?L"D476_OBS_CALL_FAIL":L"D476_OBS_CALL_OK");if(FAILED(result))emit(h,L"D476_FAIL_SCRIPT");'],
    ['L"D476_FAIL_RENDERER_SECRET"};', `L"D476_FAIL_RENDERER_SECRET",${extraNames}};`],
    ['L'+JSON.stringify(form), 'L'+JSON.stringify(markedForm)],
  ]
  let observed = source
  for (const [before, after] of patches) {
    if (observed.split(before).length !== 2) throw Error('MCP_OBSERVATION_ANCHOR')
    observed = observed.replace(before, after)
  }
  let inverse = observed
  for (const [before, after] of [...patches].reverse()) {
    if (inverse.split(after).length !== 2) throw Error('MCP_OBSERVATION_INVERSE')
    inverse = inverse.replace(after, before)
  }
  if (inverse !== source) throw Error('MCP_OBSERVATION_DRIFT')
  return { source: observed, inverse, form: markedForm }
}
