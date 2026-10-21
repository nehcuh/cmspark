(function(){
 // Unshipped remote native acceptance. The real app/xterm path remains intact.
 // No DOM-dispatched key, click(), timer, injected output or fabricated success.
 let phase=0,started=false,requested=0,keyMask=0,pendingTarget=null,selectPressed=false,typing=false,typedEnter=false,output="",platform=null,dataFrames=0,ackFrames=0,outputComplete=false,firstFailure=false;const decoder=new TextDecoder();
 const target="native-terminal-A",$=id=>document.getElementById(id),send=f=>window.chrome?.webview?window.chrome.webview.postMessage(f):window.webkit.messageHandlers.desktop.postMessage(f),post=id=>send({type:"system.ping",id,generation:documentGeneration}),fail=site=>{if(!firstFailure){firstFailure=true;try{post("D476_TERMINAL_FIRST_R_"+site)}catch{}}post("D476_TERMINAL_FAIL")};
 const names=["ROW","OPEN_DENY","REFRESH_DENY","OPEN_CANCEL","REFRESH_CANCEL","OPEN_APPROVE","STOP","SELECT","RETURN","REOPEN"];
 const key=(index,button)=>{if(!button||button.disabled||index!==requested+1){fail(1);return}button.focus();if(document.activeElement!==button){fail(2);return}requested=index;pendingTarget=button;post("D476_TERMINAL_"+names[index-1]+"_KEY")};
 const outputReady=()=>{if(phase===7&&outputComplete&&ackFrames===dataFrames){typing=false;pendingTarget=null;phase=8;post("D476_TERMINAL_OUTPUT");post("D476_TERMINAL_RESIZE")}};
 const pick=kind=>[...$("list").querySelectorAll("[data-thread-"+kind+"]")].find(b=>b.getAttribute("data-thread-"+kind)===target);
 document.addEventListener("keydown",e=>{
  if(e.key!=="Enter")return;
  if(typing){if(e.isTrusted!==true||e.target!==pendingTarget||document.activeElement!==pendingTarget||typedEnter){fail(3);return}typedEnter=true;return}
  if(e.isTrusted!==true||e.target!==pendingTarget||document.activeElement!==pendingTarget||requested<1||requested>10||(keyMask&(1<<(requested-1)))){fail(4);return}
  keyMask|=1<<(requested-1);selectPressed=requested===8;pendingTarget=null;
 },true);
 document.addEventListener("keyup",e=>{if(e.key!=="Enter"||!selectPressed)return;selectPressed=false;if(e.isTrusted!==true||e.target!==$("local-select")||phase!==10||!$("local-feedback").textContent.includes("已选择")){fail(5);return}phase=11;key(9,$("local-return"))});
 const start=()=>{if(started)return;const row=pick("local");if(!row)return;started=true;phase=1;key(1,row)};
 const original=window.cmsparkDesktopReceive;
 window.cmsparkDesktopReceive=f=>{
  original(f);
  if(f.type==="desktop.document"){start();return}
  if(f.type==="thread.list"&&phase===0){start();return}
  if(f.type==="desktop.local.state.result"){
   if(![1,3,5].includes(phase))return; // Actual hide/openDialog emits an untracked retirement state.
   if(f.ok!==true||f.thread_id!==target||!f.state?.bound||!f.state.modules?.terminal||f.state.modules.agent!==false||!["windows","macos"].includes(f.state.platform)){fail(6);return}platform=f.state.platform;
   if(phase===1){phase=2;key(2,$("local-terminal-open"));return}
   if(phase===3){phase=4;key(4,$("local-terminal-open"));return}
   if(phase===5){phase=6;key(6,$("local-terminal-open"));return}
   fail(7);return;
  }
  if(f.type==="desktop.terminal.open.result"){
   if(f.thread_id!==target){fail(8);return}
   if(phase===2&&f.ok===false&&f.error_code==="LOCAL_DENIED"){phase=3;post("D476_TERMINAL_DENIED");key(3,$("local-refresh"));return}
   if(phase===4&&f.ok===false&&f.error_code==="LOCAL_DENIED"){phase=5;post("D476_TERMINAL_CANCELLED");key(5,$("local-refresh"));return}
   if(phase!==6||f.ok!==true||f.status!=="running"){fail(9);return}
   const textarea=$("local-terminals").querySelector(".xterm-helper-textarea");if(!textarea){fail(10);return}textarea.focus();if(document.activeElement!==textarea){fail(11);return}phase=7;pendingTarget=textarea;typing=true;post("D476_TERMINAL_TYPE");return;
  }
  if(f.type==="desktop.terminal.data"){
   if(f.thread_id!==target)return;dataFrames++;try{output+=decoder.decode(Uint8Array.from(atob(f.b64),c=>c.charCodeAt(0)),{stream:true})}catch{fail(12);return}
   if(output.length>256*1024){fail(13);return}
   if(phase===7&&typedEnter&&output.includes("D476_TERMINAL_中")&&new TextEncoder().encode(output).length>16384)outputComplete=true;outputReady();return;
  }
  if(f.type==="desktop.terminal.ack.result"){if(f.thread_id!==target||f.ok!==true){fail(14);return}ackFrames++;if(ackFrames>dataFrames){fail(15);return}outputReady();return}
  if(f.type==="desktop.terminal.resize.result"&&phase===8){if(f.ok!==true){fail(16);return}phase=9;post("D476_TERMINAL_RESIZED");key(7,$("local-stop"));return}
  if(f.type==="desktop.terminal.close.result"&&phase===9){if(f.ok!==true||f.status!=="closed"){fail(17);return}phase=10;post("D476_TERMINAL_STOPPED");key(8,$("local-select"));return}
  if(f.type==="desktop.terminal.return.result"&&phase===11){if(f.ok!==true||f.status!=="saved"||f.partial!==true){fail(18);return}phase=12;post("D476_TERMINAL_SAVED");key(10,pick("dialog"));return}
  if(f.type==="desktop.thread.open.result"&&phase===12){if(f.ok!==true||f.thread_id!==target||!f.history?.messages?.some(m=>m.content.includes("D476_TERMINAL_中")&&m.content.includes("partial"))||!$("dialog-history").textContent.includes("D476_TERMINAL_中")||requested!==10||keyMask!==1023){fail(19);return}phase=13;post("D476_TERMINAL_REOPENED");post("D476_TERMINAL_DONE")}
 };
 if($("status").textContent==="已连接 · MCP 保存需确认")start();
})();
