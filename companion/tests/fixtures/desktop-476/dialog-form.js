(function(){
  // Hosted native controller key path, controlled provider, actual backend store.
  // No DOM KeyboardEvent, synthetic backend ACK, timer or automatic resend.
  let phase=0,started=false,target=null,newKey=false,sendKey=false,stopKey=false,otherKey=false,reopenKey=false,reopened=false,lostKey=false,offline=false;
  const $=id=>document.getElementById(id);
  const send=f=>{if(window.chrome?.webview)window.chrome.webview.postMessage(f);else window.webkit.messageHandlers.desktop.postMessage(f)};
  const post=id=>send({type:"system.ping",id,generation:documentGeneration});
  const fail=()=>post("D476_FAIL_DIALOG_PHASE");
  const pick=id=>[...$("list").querySelectorAll("[data-thread-dialog]")].find(b=>b.getAttribute("data-thread-dialog")===id);
  const start=()=>{if(started)return;started=true;$("dialog-new").focus();post("D476_DIALOG_NEW_KEY")};
  document.addEventListener("keyup",e=>{if(e.key!=="Enter")return;if(e.isTrusted!==true){fail();return}if(e.target.id==="dialog-new")newKey=true;else if(e.target.getAttribute("data-thread-dialog")==="native-dialog-other")otherKey=true;else if(e.target.getAttribute("data-thread-dialog")===target)reopenKey=true;else if(e.target.id==="dialog-send"){if(phase===7)lostKey=true;else sendKey=true;}else if(e.target.id==="dialog-stop")stopKey=true;finishReopen();finishOffline()});
  const finishReopen=()=>{if(phase!==6||!reopened||!newKey||!sendKey||!stopKey||!otherKey||!reopenKey)return;phase=7;$("dialog-input").value="offline owned draft";$("dialog-send").focus();post("D476_DIALOG_REOPEN");post("D476_DIALOG_LOST_ACK_KEY")};
  const finishOffline=()=>{if(!offline||!lostKey)return;const ok=phase===7&&$("dialog-input").value==="offline owned draft"&&$("dialog-send").disabled&&$("status").textContent==="连接已断开"&&$("dialog-feedback").textContent.includes("未确认");send({type:"D476.dialog.offline",generation:documentGeneration,result:ok?"ok":"fail"})};
  const original=window.cmsparkDesktopReceive;
  window.cmsparkDesktopReceive=f=>{
    original(f);
    if(f.type==="desktop.document"){start();return}
    if(f.type==="desktop.thread.create.result"){
      if(phase!==0||f.ok!==true||f.created!==true||typeof f.thread_id!=="string"){fail();return}target=f.thread_id;phase=1;post("D476_DIALOG_CREATED");return
    }
    if(f.type==="desktop.thread.open.result"){
      if(f.ok!==true){fail();return}
      if(phase===1&&f.thread_id===target){if(f.history.messages.length!==0){fail();return}phase=2;$("dialog-input").value="native dialog owned message";$("dialog-send").focus();post("D476_DIALOG_SEND_KEY");return}
      if(phase===4&&f.thread_id===target){const other=pick("native-dialog-other");if(!other){fail();return}phase=5;other.focus();post("D476_DIALOG_OTHER_KEY");return}
      if(phase===5&&f.thread_id==="native-dialog-other"){const button=pick(target);if(!button){fail();return}phase=6;button.focus();post("D476_DIALOG_REOPEN_KEY");return}
      if(phase===6&&f.thread_id===target){if(!f.history.messages.some(m=>m.role==="user"&&m.content==="native dialog owned message")||!$("dialog-history").textContent.includes("native dialog owned message")){fail();return}reopened=true;finishReopen();return}
      fail();return
    }
    if(f.type==="desktop.chat.event"){
      if(f.thread_id!==target){fail();return}
      if(f.kind==="user"){if(phase!==2||f.persisted!==true){fail();return}post("D476_DIALOG_USER");return}
      if(f.kind==="confirmation_unavailable"){if(phase!==2||!$("dialog-feedback").textContent.includes("已拒绝执行")){fail();return}post("D476_DIALOG_L2_DENIED");return}
      if(f.kind==="snapshot"){if(phase!==2||f.content!=="native stream"||!$("dialog-history").textContent.includes("native stream")){fail();return}post("D476_DIALOG_STREAMED");phase=3;$("dialog-stop").focus();post("D476_DIALOG_STOP_KEY");return}
      if(f.kind==="terminal"){if(phase!==3||f.state!=="stopped_or_failed"){fail();return}phase=4;post("D476_DIALOG_STOPPED");return}
    }
    if(f.type==="desktop.offline"){
      offline=true;finishOffline();
    }
  };
  if($("status").textContent==="已连接 · MCP 保存需确认")start();
})();
