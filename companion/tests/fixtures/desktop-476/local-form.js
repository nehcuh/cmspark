(function(){
 let phase=0,output='',keyCount=0,firstSite=false,dataSeen=false;const $=id=>document.getElementById(id),send=f=>window.chrome?.webview?window.chrome.webview.postMessage(f):window.webkit.messageHandlers.desktop.postMessage(f),post=id=>send({type:'system.ping',id,generation:documentGeneration}),fail=site=>{let id;switch(site){case 1:id='D476_LOCAL_FIRST_R_1';break;case 2:id='D476_LOCAL_FIRST_R_2';break;case 3:id='D476_LOCAL_FIRST_R_3';break;case 4:id='D476_LOCAL_FIRST_R_4';break;case 5:id='D476_LOCAL_FIRST_R_5';break;case 6:id='D476_LOCAL_FIRST_R_6';break;case 7:id='D476_LOCAL_FIRST_R_7';break;case 8:id='D476_LOCAL_FIRST_R_8';break;case 9:id='D476_LOCAL_FIRST_R_9';break;case 10:id='D476_LOCAL_FIRST_R_10';break;case 11:id='D476_LOCAL_FIRST_R_11';break;case 12:id='D476_LOCAL_FIRST_R_12';break;case 13:id='D476_LOCAL_FIRST_R_13';break;case 14:id='D476_LOCAL_FIRST_R_14';break;case 15:id='D476_LOCAL_FIRST_R_15';break;case 16:id='D476_LOCAL_FIRST_R_16';break;case 17:id='D476_LOCAL_FIRST_R_17';break;}if(id&&!firstSite){firstSite=true;try{post(id)}catch{/* Observation cannot suppress the original FAIL. */}}post('D476_LOCAL_FAIL')};
 const key=id=>{const button=$(id);if(!button||button.disabled){fail(1);return}button.focus();post('D476_LOCAL_KEY')},pick=kind=>{const button=[...$('list').querySelectorAll('[data-thread-'+kind+']')].find(b=>b.getAttribute('data-thread-'+kind)==='native-local-A');if(!button){fail(2);return}button.focus();post('D476_LOCAL_KEY')};
 document.addEventListener('keydown',e=>{if(e.key==='Enter'){if(!e.isTrusted){fail(3);return}keyCount++}});
 document.addEventListener('keyup',e=>{if(e.key==='Enter'&&e.target.id==='local-select'&&phase===6){if(!e.isTrusted||!$('local-feedback').textContent.includes('已选择')){fail(4);return}phase=7;key('local-return')}});
 const original=window.cmsparkDesktopReceive;window.cmsparkDesktopReceive=f=>{original(f);
  if(f.type==='thread.list'&&phase===0){phase=1;pick('local');return}
  if(f.type==='desktop.local.state.result'){
   if(![1,9,13].includes(phase))return; // Actual hide/openDialog emits an untracked retirement state.
   if(!f.ok||!f.state.bound){fail(5);return}
   if(phase===1){phase=2;key('local-terminal-open');return}
   if(phase===9||phase===13){const follow=phase===13;phase=follow?14:10;$('local-goal').value=follow?'owned native hang':'owned native task';key('local-agent-start');return}fail(6);return
  }
  if(f.type==='desktop.terminal.open.result'){if(phase!==2||!f.ok){fail(7);return}phase=3;const text=$('local-terminals').querySelector('.xterm-helper-textarea');if(!text){fail(8);return}text.focus();post('D476_LOCAL_TYPE');return}
  if(f.type==='desktop.terminal.data'){if(!dataSeen){dataSeen=true;try{post('D476_LOCAL_DATA_SEEN')}catch{/* Observation cannot suppress original data handling. */}}try{output+=new TextDecoder().decode(Uint8Array.from(atob(f.b64),c=>c.charCodeAt(0)))}catch{fail(9);return}if(output.length>256*1024){fail(10);return}if(phase===3&&output.includes('D476_LOCAL_中')){phase=4;post('D476_LOCAL_OUTPUT');post('D476_LOCAL_RESIZE')}return}
  if(f.type==='desktop.terminal.resize.result'&&phase===4){if(!f.ok){fail(11);return}phase=5;post('D476_LOCAL_RESIZED');key('local-stop');return}
  if(f.type==='desktop.terminal.close.result'){if(phase!==5||!f.ok){fail(12);return}phase=6;post('D476_LOCAL_STOPPED');key('local-select');return}
  if(f.type==='desktop.terminal.return.result'){if(phase!==7||f.status!=='saved'){fail(13);return}phase=8;post('D476_LOCAL_SAVED');pick('dialog');return}
  if(f.type==='desktop.thread.open.result'){
   if(!f.ok||!f.history.messages.some(m=>m.content.includes('D476_LOCAL_中'))||!$('dialog-history').textContent.includes('D476_LOCAL_中')){fail(14);return}
   if(phase===8){phase=9;post('D476_LOCAL_REOPENED');pick('local');return}
   if(phase===12&&f.history.messages.some(m=>m.content.includes('D476_AGENT_PERMISSION_DENIED'))){phase=13;pick('local');return}fail(15);return
  }
  if(f.type==='desktop.agent.start.result'){if(!f.ok||![10,14].includes(phase)){fail(16);return}phase=phase===10?11:15;return}
  if(f.type==='desktop.agent.event'){
   if(phase===11&&f.status==='saved'){phase=12;post('D476_LOCAL_AGENT_SAVED');pick('dialog');return}
   if(phase===15&&typeof f.tail==='string'&&f.tail.includes('D476_AGENT_RUNNING')){phase=16;key('local-stop');return}return
  }
  if(f.type==='desktop.agent.cancel.result'){if(phase!==16||!f.ok||keyCount<10){fail(17);return}phase=17;post('D476_LOCAL_AGENT_STOPPED');post('D476_LOCAL_DONE');return}
 };
 if($('status').textContent==='已连接 · MCP 保存需确认'&&[...$('list').querySelectorAll('[data-thread-local]')].length){phase=1;pick('local')}
})();
