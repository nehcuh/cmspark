(function(){
 let phase=0,output='',keyCount=0;const $=id=>document.getElementById(id),send=f=>window.chrome?.webview?window.chrome.webview.postMessage(f):window.webkit.messageHandlers.desktop.postMessage(f),post=id=>send({type:'system.ping',id,generation:documentGeneration}),fail=()=>post('D476_LOCAL_FAIL');
 const key=id=>{const button=$(id);if(!button||button.disabled){fail();return}button.focus();post('D476_LOCAL_KEY')},pick=kind=>{const button=[...$('list').querySelectorAll('[data-thread-'+kind+']')].find(b=>b.getAttribute('data-thread-'+kind)==='native-local-A');if(!button){fail();return}button.focus();post('D476_LOCAL_KEY')};
 document.addEventListener('keydown',e=>{if(e.key==='Enter'){if(!e.isTrusted){fail();return}keyCount++}});
 document.addEventListener('keyup',e=>{if(e.key==='Enter'&&e.target.id==='local-select'&&phase===6){if(!e.isTrusted||!$('local-feedback').textContent.includes('已选择')){fail();return}phase=7;key('local-return')}});
 const original=window.cmsparkDesktopReceive;window.cmsparkDesktopReceive=f=>{original(f);
  if(f.type==='thread.list'&&phase===0){phase=1;pick('local');return}
  if(f.type==='desktop.local.state.result'){
   if(!f.ok||!f.state.bound){fail();return}
   if(phase===1){phase=2;key('local-terminal-open');return}
   if(phase===9||phase===13){const follow=phase===13;phase=follow?14:10;$('local-goal').value=follow?'owned native hang':'owned native task';key('local-agent-start');return}fail();return
  }
  if(f.type==='desktop.terminal.open.result'){if(phase!==2||!f.ok){fail();return}phase=3;const text=$('local-terminals').querySelector('.xterm-helper-textarea');if(!text){fail();return}text.focus();post('D476_LOCAL_TYPE');return}
  if(f.type==='desktop.terminal.data'){try{output+=new TextDecoder().decode(Uint8Array.from(atob(f.b64),c=>c.charCodeAt(0)))}catch{fail();return}if(output.length>256*1024){fail();return}if(phase===3&&output.includes('D476_LOCAL_中')){phase=4;post('D476_LOCAL_OUTPUT');post('D476_LOCAL_RESIZE')}return}
  if(f.type==='desktop.terminal.resize.result'&&phase===4){if(!f.ok){fail();return}phase=5;post('D476_LOCAL_RESIZED');key('local-stop');return}
  if(f.type==='desktop.terminal.close.result'){if(phase!==5||!f.ok){fail();return}phase=6;post('D476_LOCAL_STOPPED');key('local-select');return}
  if(f.type==='desktop.terminal.return.result'){if(phase!==7||f.status!=='saved'){fail();return}phase=8;post('D476_LOCAL_SAVED');pick('dialog');return}
  if(f.type==='desktop.thread.open.result'){
   if(!f.ok||!f.history.messages.some(m=>m.content.includes('D476_LOCAL_中'))||!$('dialog-history').textContent.includes('D476_LOCAL_中')){fail();return}
   if(phase===8){phase=9;post('D476_LOCAL_REOPENED');pick('local');return}
   if(phase===12&&f.history.messages.some(m=>m.content.includes('D476_AGENT_PERMISSION_DENIED'))){phase=13;pick('local');return}fail();return
  }
  if(f.type==='desktop.agent.start.result'){if(!f.ok||![10,14].includes(phase)){fail();return}phase=phase===10?11:15;return}
  if(f.type==='desktop.agent.event'){
   if(phase===11&&f.status==='saved'){phase=12;post('D476_LOCAL_AGENT_SAVED');pick('dialog');return}
   if(phase===15&&typeof f.tail==='string'&&f.tail.includes('D476_AGENT_RUNNING')){phase=16;key('local-stop');return}return
  }
  if(f.type==='desktop.agent.cancel.result'){if(phase!==16||!f.ok||keyCount<10){fail();return}phase=17;post('D476_LOCAL_AGENT_STOPPED');post('D476_LOCAL_DONE');return}
 };
 if($('status').textContent==='已连接 · MCP 保存需确认'&&[...$('list').querySelectorAll('[data-thread-local]')].length){phase=1;pick('local')}
})();
