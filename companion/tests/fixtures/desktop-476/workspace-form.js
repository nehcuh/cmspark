(()=>{
 const receive=window.cmsparkDesktopReceive;let started=false,phase=0;
 const post=id=>window.webkit?.messageHandlers?.desktop?window.webkit.messageHandlers.desktop.postMessage({type:'system.ping',id,generation:documentGeneration}):window.chrome.webview.postMessage({type:'system.ping',id,generation:documentGeneration});
 const fail=()=>post('D476_WS_FAIL');
 function open(){const row=document.querySelector('[data-thread-workspace="native-workspace-A"]');if(!row){fail();return}row.click()}
 function start(){if(started)return;started=true;window.cmsparkDesktopReceive({type:'thread.list',threads:[{id:'native-workspace-A',title:'owned workspace'}]});open()}
 window.cmsparkDesktopReceive=frame=>{
  receive(frame);
  if(frame.type==='desktop.document'&&frame.generation===documentGeneration){start();return}
  if(frame.type==='desktop.workspace.state.result'&&typeof frame.id==='string'&&frame.id.startsWith('workspace-state-')){
   if(frame.ok!==true||frame.thread_id!=='native-workspace-A'||!frame.state||!/^[a-f0-9]{64}$/.test(frame.state.revision)){fail();return}
   if(phase===0){if(frame.state.bound){fail();return}phase=1;post('D476_WS_UNBOUND');document.getElementById('workspace-pick').click()}
   else if(phase===3){if(!frame.state.bound){fail();return}phase=4;post('D476_WS_REOPENED')}
  }
  if(frame.type==='desktop.workspace.pick.result'){
   if(phase===1){if(frame.ok!==true||frame.outcome!=='committed'){fail();return}phase=2;post('D476_WS_COMMITTED')}
   else if(phase===5){if(frame.ok!==false||frame.outcome!=='cancelled'){fail();return}post('D476_WS_CANCELLED');phase=6;post('D476_WS_DONE')}
   else fail()
  }
  if(frame.type==='desktop.workspace.list.result'&&frame.ok===true){const item=[...document.getElementById('workspace-entries').children].find(x=>x.textContent==='hello.txt');if(!item){fail();return}if(phase===2){post('D476_WS_LISTED');item.click()}else if(phase===4){phase=5;document.getElementById('workspace-pick').click()}}
  if(frame.type==='desktop.workspace.read.result'&&phase===2){if(frame.ok!==true||frame.text!=='owned workspace text'||document.getElementById('workspace-text').textContent!==frame.text){fail();return}post('D476_WS_READ');phase=3;document.getElementById('workspace-refresh').click()}
 };
 if(document.getElementById('status')?.textContent==='已连接 · MCP 保存需确认')start();
})();
