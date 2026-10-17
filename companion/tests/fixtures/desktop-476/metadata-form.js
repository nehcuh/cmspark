(function(){
  // Hosted metadata-only acceptance. Real ACKs only; no DOM KeyboardEvent spoof.
  let phase=0,started=false,enterObserved=false,enterEdit=false;
  const $=id=>document.getElementById(id);
  const row=()=>document.querySelector('[data-thread-metadata="native-metadata-A"]');
  const send=frame=>{if(window.chrome?.webview)window.chrome.webview.postMessage(frame);else window.webkit.messageHandlers.desktop.postMessage(frame)};
  const post=id=>send({type:"system.ping",id,generation:documentGeneration});
  const fail=()=>post("D476_FAIL_METADATA_PHASE");
  const values=alias=>$("metadata-alias").value===alias&&$("metadata-tags").value==="Review\n付款"&&$("metadata-folder").value==="项目资料";
  const start=()=>{if(started)return;started=true;document.querySelector('[data-page="thread.list"]').click()};
  const afterEnter=()=>{if(phase!==4||!enterObserved||!enterEdit)return;post("D476_META_ENTER_OK");phase=6;$("metadata-alias").value="未确认 中文草稿";post("D476_META_BEFORE_LOST_ACK");$("metadata-save").click()};
  document.addEventListener("keyup",event=>{
    if(event.key==="Enter"&&phase===4){if(event.isTrusted!==true){fail();return}enterObserved=true;afterEnter();return}
    if(event.key!=="Escape"||phase!==3)return;
    if(event.isTrusted!==true){fail();return}
    if(!$("metadata-editor").hidden||document.activeElement!==row()){fail();return}
    phase=4;post("D476_META_ESCAPE_OK");post("D476_META_ENTER_REQUEST");
  });
  const original=window.cmsparkDesktopReceive;
  window.cmsparkDesktopReceive=frame=>{
    original(frame);
    if(frame.type==="desktop.document"){start();return}
    if(frame.type==="desktop.offline"){
      const ok=phase===6&&values("未确认 中文草稿")&&!$("metadata-editor").hidden&&$("metadata-save").disabled&&$("status").textContent==="连接已断开"&&$("metadata-feedback").textContent.includes("未确认")&&$("metadata-feedback").textContent.includes("草稿");
      // Test-only terminal observation; controller checks real socket-loss latch,
      // old owned document and native key/save phases. Never a backend RPC/ACK.
      send({type:"D476.metadata.offline",generation:documentGeneration,result:ok?"ok":"fail"});return;
    }
    if(frame.type==="thread.list"&&phase===0){const button=row();if(!button){fail();return}phase=1;button.click();return}
    if(frame.type==="desktop.thread.metadata.edit.result"){
      if(frame.ok!==true||frame.thread_id!=="native-metadata-A"){fail();return}
      if(phase===1){phase=2;$("metadata-alias").value="原生 中文对话";$("metadata-tags").value="Review\n付款";$("metadata-folder").value="项目资料";$("metadata-save").click();return}
      if(phase===3){fail();return} // Escape must close before a new edit arrives.
      if(phase===7){if(!values("原生 中文对话")){fail();return}post("D476_META_REOPEN_OK");phase=3;post("D476_META_ESCAPE_REQUEST");return}
      if(phase===4){if(!values("原生 中文对话")){fail();return}enterEdit=true;afterEnter();return}
      fail();return;
    }
    if(frame.type==="desktop.thread.metadata.save.result"){
      if(phase!==2||frame.ok!==true||frame.saved!==true||frame.thread_id!=="native-metadata-A"||!values("原生 中文对话")){fail();return}
      post("D476_META_FIRST_SAVED");phase=7;$("metadata-cancel").click();const button=row();if(!button){fail();return}button.click();
    }
  };
  if($("status").textContent==="已连接 · MCP 保存需确认")start();
})();
