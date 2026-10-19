(function(){
  // Real ACKs and owned-window native Enter events only. No DOM key dispatch,
  // success fabrication, timer, retry, automatic write or native permission.
  let phase=0,started=false,requested=0,keyMask=0,pendingButton=null;
  const $=id=>document.getElementById(id),target="native-archive-A";
  const names=["ROW","SAVE","VIEW","HISTORY","RESTORE_ROW","RESTORE_SAVE","NORMAL","BUSY_ROW","RETRY_ROW","LOST_SAVE"];
  const send=f=>{if(window.chrome?.webview)window.chrome.webview.postMessage(f);else window.webkit.messageHandlers.desktop.postMessage(f)};
  const post=id=>send({type:"system.ping",id,generation:documentGeneration}),fail=()=>post("D476_FAIL_ARCHIVE_PHASE");
  const pick=attribute=>[...$("list").querySelectorAll("["+attribute+"]")].find(b=>b.getAttribute(attribute)===target);
  const key=(index,button)=>{if(!button||button.disabled||index!==requested+1){fail();return}button.focus();if(document.activeElement!==button){fail();return}requested=index;pendingButton=button;post("D476_ARCHIVE_"+names[index-1]+"_KEY")};
  document.addEventListener("keydown",e=>{if(e.key!=="Enter")return;if(e.isTrusted!==true||e.target!==document.activeElement||e.target!==pendingButton||requested<1||requested>10||(keyMask&(1<<(requested-1)))){fail();return}keyMask|=1<<(requested-1);pendingButton=null});
  const start=()=>{if(started)return;started=true;document.querySelector('[data-page="thread.list"]').click()};
  const original=window.cmsparkDesktopReceive;
  window.cmsparkDesktopReceive=f=>{
    original(f);
    if(f.type==="desktop.document"){start();return}
    if(f.type==="thread.list"&&phase===0){phase=1;key(1,pick("data-thread-archive"));return}
    if(f.type==="desktop.archive.state.result"&&typeof f.id==="string"&&f.id.startsWith("archive-state-")){
      if(f.ok!==true||f.thread_id!==target||!f.state){fail();return}
      if(phase===1&&f.state.archived===false&&f.state.activity==="idle"&&(keyMask&1)){phase=2;key(2,$("archive-save"));return}
      if(phase===5&&f.state.archived===true&&f.state.activity==="idle"&&(keyMask&16)){phase=6;key(6,$("archive-save"));return}
      if(phase===8&&f.state.activity==="busy"&&$("archive-save").disabled&&(keyMask&128)){post("D476_ARCHIVE_BUSY");post("D476_ARCHIVE_UNBLOCK");phase=9;key(9,pick("data-thread-archive"));return}
      if(phase===9&&f.state.archived===false&&f.state.activity==="idle"&&(keyMask&256)){phase=10;post("D476_ARCHIVE_BEFORE_LOST_ACK");key(10,$("archive-save"));return}
      fail();return;
    }
    if(f.type==="desktop.archive.set.result"){
      if(f.ok!==true||f.saved!==true||f.thread_id!==target){fail();return}
      if(phase===2&&f.archived===true&&(keyMask&2)){post("D476_ARCHIVE_ARCHIVED");phase=3;key(3,$("archive-view"));return}
      if(phase===6&&f.archived===false&&(keyMask&32)){post("D476_ARCHIVE_RESTORED");phase=7;key(7,$("archive-normal"));return}
      fail();return;
    }
    if(f.type==="desktop.archive.list.result"&&phase===3){if(f.ok!==true||!pick("data-thread-dialog")){fail();return}post("D476_ARCHIVE_VIEW");phase=4;key(4,pick("data-thread-dialog"));return}
    if(f.type==="desktop.thread.open.result"&&phase===4){if(f.ok!==true||f.thread_id!==target||!f.history||!f.history.messages.some(m=>m.role==="user"&&m.content==="owned archive history")||!$("dialog-history").textContent.includes("owned archive history")){fail();return}post("D476_ARCHIVE_HISTORY");phase=5;key(5,pick("data-thread-archive"));return}
    if(f.type==="thread.list"&&phase===7){if(!pick("data-thread-archive")){fail();return}post("D476_ARCHIVE_BLOCK");phase=8;key(8,pick("data-thread-archive"));return}
    if(f.type==="desktop.offline"){
      const ok=phase===10&&requested===10&&keyMask===1023&&$("archive-save").disabled&&$("status").textContent==="连接已断开"&&$("archive-feedback").textContent.includes("未确认");
      send({type:"D476.archive.offline",generation:documentGeneration,result:ok?"ok":"fail"});
    }
  };
  if($("status").textContent==="已连接 · MCP 保存需确认")start();
})();
