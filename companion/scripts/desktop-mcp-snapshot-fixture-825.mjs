// Reversible extra observation only for the already unshipped MCP source.
export function desktopMcpSnapshotFixture825(original, control, deferInitialShow = false) {
 if(typeof original!=='string'||typeof control!=='string'||!control.includes('class D476Snapshot825 {')||original.includes('D476Snapshot825'))throw Error('MCP825_SNAPSHOT_SOURCE')
 let source=original;const patches=[]
 const patch=(before,after)=>{if(source.split(before).length!==2)throw Error('MCP825_SNAPSHOT_ANCHOR');source=source.replace(before,after);patches.push([before,after])}
 patch('struct D476Acceptance {',control+'\nstruct D476Acceptance {')
 patch('phase=L"ready";ready=true;DESKTOP_TEST_NOTE(ready_accepted)','phase=L"ready";ready=true;D476Snapshot825::start();DESKTOP_TEST_NOTE(ready_accepted)')
 patch('[this](HRESULT hr,ICoreWebView2Environment* env)->HRESULT{DESKTOP_TEST_NOTE(env_callback)','[this](HRESULT hr,ICoreWebView2Environment* env)->HRESULT{D476Snapshot825::CallbackScope callback825(6,hr,env!=nullptr);DESKTOP_TEST_NOTE(env_callback)')
 patch('[this](HRESULT code,ICoreWebView2Controller* host)->HRESULT{DESKTOP_TEST_NOTE(controller_callback)','[this](HRESULT code,ICoreWebView2Controller* host)->HRESULT{D476Snapshot825::CallbackScope callback825(8,code,host!=nullptr);DESKTOP_TEST_NOTE(controller_callback)')
 patch('auto value=call();obRecord773(point,ordinal,1,static_cast<unsigned>(value),2);return value;','auto value=call();D476Snapshot825::api(point,static_cast<uint32_t>(value));obRecord773(point,ordinal,1,static_cast<unsigned>(value),2);D476Snapshot825::wrapper(point);return value;')
 patch('emit(*obHost773,L"BOOT_"','D476Snapshot825::Observation observation825(2,row.point,row.edge);emit(*obHost773,L"BOOT_"')
 patch('test_phase_attempts|=1u<<index; // Lifetime bound','D476Snapshot825::Observation observation825(1,index);test_phase_attempts|=1u<<index; // Lifetime bound')
 const send='std::lock_guard<std::mutex> lock(socket_lock);return socket&&WinHttpWebSocketSend(socket,WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE,bytes.data(),(DWORD)bytes.size())==NO_ERROR;'
 patch(send,'D476Snapshot825::sendStage(2);std::lock_guard<std::mutex> lock(socket_lock);D476Snapshot825::sendStage(3);if(!socket)return false;D476Snapshot825::sendStage(4);auto sent825=WinHttpWebSocketSend(socket,WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE,bytes.data(),(DWORD)bytes.size());D476Snapshot825::sendStage(5,sent825);return sent825==NO_ERROR;')
 patch('TranslateMessage(&msg);DispatchMessageW(&msg);','TranslateMessage(&msg);DispatchMessageW(&msg);D476Snapshot825::outerDispatch();')
 patch('void show(std::wstring const& next){','void show(std::wstring const& next){D476Snapshot825::initialShow(1);')
 patch('SetWindowPos(window,nullptr,x,y,width,height,SWP_NOZORDER);ShowWindow(window,SW_SHOW);SetForegroundWindow(window);','D476Snapshot825::initialShow(2);SetWindowPos(window,nullptr,x,y,width,height,SWP_NOZORDER);D476Snapshot825::initialShow(3);ShowWindow(window,SW_SHOW);D476Snapshot825::initialShow(4);SetForegroundWindow(window);D476Snapshot825::initialShow(5);')
 if(deferInitialShow){
  patch('throw std::runtime_error("VIEW");show(next);return;}','throw std::runtime_error("VIEW");if(!web){pending_initial_show825=next;D476Snapshot825::initialShow(6);}else show(next);return;}')
  patch('std::wstring profile;','std::wstring profile,pending_initial_show825;')
  patch('return D476Acceptance::obApi773(29,[&](){return web->Navigate(document_url);});','auto initial_navigation825=D476Acceptance::obApi773(29,[&](){return web->Navigate(document_url);});if(SUCCEEDED(initial_navigation825)&&!pending_initial_show825.empty()){auto next=std::move(pending_initial_show825);pending_initial_show825.clear();show(next);}return initial_navigation825;')
 }
 let inverse=source
 for(const [before,after]of [...patches].reverse()){if(inverse.split(after).length!==2)throw Error('MCP825_SNAPSHOT_INVERSE');inverse=inverse.replace(after,before)}
 if(inverse!==original)throw Error('MCP825_SNAPSHOT_DRIFT')
 return{source,inverse}
}
