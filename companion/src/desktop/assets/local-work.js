/* Native local-work view. No credentials, paths, process IDs or approval decisions. */
"use strict";
window.cmsparkTerminalWork=({post,currentDocument})=>{
 const $=id=>document.getElementById(id),pending=new Map(),operations=new Map();let target=null,revision=null,epoch=0,sequence=0,state=null,documentId=null;
 const id=()=>"local-"+(++sequence),feedback=text=>{$("local-feedback").textContent=text};
 function current(p){return p&&p.document===currentDocument()&&p.epoch===epoch&&p.thread===target}
 function request(type,extra={},op){if(!currentDocument()||!target)return;const key=id(),record={id:key,method:type,thread:target,document:currentDocument(),epoch,operation:op};pending.set(key,record);post({type,id:key,thread_id:target,...extra});return key}
 function controls(){const visible=[...operations.values()].reverse().find(o=>o.thread===target&&o.document===currentDocument()&&o.kind==="terminal");for(const op of operations.values())if(op.holder)op.holder.hidden=op!==visible||op.thread!==target||op.document!==currentDocument();const connected=!!currentDocument()&&documentId===currentDocument(),running=[...operations.values()].find(o=>o.thread===target&&o.document===documentId&&o.kind==="terminal"&&o.status!=="closed");$("local-terminal-open").disabled=!connected||!revision||!state?.modules?.terminal||!!running||[...pending.values()].some(p=>current(p)&&p.method==="desktop.terminal.open");$("local-stop").disabled=!connected||![...operations.values()].some(o=>o.thread===target&&o.document===documentId&&o.status!=="closed"&&!o.stopPending);$("local-return").disabled=!connected||!running&&![...operations.values()].some(o=>o.thread===target&&o.kind==="terminal")}
 function forget(){for(const op of operations.values()){clearInterval(op.ping);op.terminal?.dispose()}operations.clear();pending.clear();revision=null;state=null;documentId=null;epoch++;controls()}
 function stateRequest(){revision=null;state=null;request("desktop.local.state");controls()}
 function open(thread){hide();target=thread;documentId=currentDocument();$("local-work").hidden=false;$("local-title").textContent="用户终端 · "+thread;feedback("正在核对当前对话和显式工作目录…");stateRequest()}
 function hide(){epoch++;pending.clear();revision=null;state=null;$("local-work").hidden=true;if(target&&currentDocument())post({type:"desktop.local.state",id:id(),thread_id:target});target=null;controls()}
 function terminal(op){
  if(!window.Terminal||!window.FitAddon?.FitAddon){feedback("固定本地终端组件缺失，未创建可输入终端。");return false}
  let holder,term,fit;try{
  holder=document.createElement("div");holder.className="local-terminal";holder.setAttribute("data-local-terminal",op.id);$("local-terminals").append(holder)
  term=new window.Terminal({scrollback:5000,convertEol:false,cursorBlink:true}),fit=new window.FitAddon.FitAddon();term.loadAddon(fit);term.open(holder);fit.fit();op.terminal=term;op.holder=holder;op.fit=fit;op.inputSeq=0;
  term.onData(text=>{if(op.status!=="running"||op.thread!==target||op.document!==currentDocument()||$("local-work").hidden)return;const bytes=new TextEncoder().encode(text);for(let offset=0;offset<bytes.length;){let end=Math.min(bytes.length,offset+16384);while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;const part=bytes.subarray(offset,end);let binary="";for(const b of part)binary+=String.fromCharCode(b);request("desktop.terminal.input",{operation_id:op.id,seq:++op.inputSeq,b64:btoa(binary)},op);offset=end}})
  term.onResize(({cols,rows})=>{if(op.status==="running"&&op.thread===target&&op.document===currentDocument())request("desktop.terminal.resize",{operation_id:op.id,cols,rows},op)})
  op.ping=setInterval(()=>{if(op.status!=="running"||op.document!==currentDocument())return;post({type:"desktop.terminal.ping",id:id(),thread_id:op.thread,operation_id:op.id})},25000)
  request("desktop.terminal.resize",{operation_id:op.id,cols:term.cols,rows:term.rows},op);return true
  }catch{try{term?.dispose();holder?.remove()}catch{}feedback("固定终端组件不可用，已请求关闭原操作。");return false}
 }
 function validState(v){return v&&typeof v==="object"&&typeof v.bound==="boolean"&&(v.revision===null||typeof v.revision==="string"&&/^[a-f0-9]{64}$/.test(v.revision))&&["windows","macos","unsupported"].includes(v.platform)&&v.modules&&typeof v.modules.terminal==="boolean"&&v.modules.agent===false&&Array.isArray(v.agents)&&v.agents.length===0&&Array.isArray(v.operations)&&v.operations.length<=1&&v.operations.every(o=>o&&typeof o.operation_id==="string"&&o.operation_id.length>0&&o.operation_id.length<=200&&o.kind==="terminal"&&["pending","starting","running","closed"].includes(o.status))}
 function receive(frame){
  if(frame.type==="desktop.document"){forget();return false}
  if(frame.type==="desktop.offline"){forget();feedback("连接中断；执行与保存状态未确认，不会自动重放。");return false}
  if(frame.type==="desktop.terminal.data"||frame.type==="desktop.terminal.closed"){
   const op=operations.get(frame.operation_id);if(!op||op.document!==currentDocument()||frame.thread_id!==op.thread)return true;
   if(frame.type==="desktop.terminal.data"&&op.terminal){let binary;try{binary=atob(frame.b64)}catch{return true}const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));op.terminal.write(bytes,()=>{if(op.document===currentDocument()&&op.status==="running")post({type:"desktop.terminal.ack",id:id(),thread_id:op.thread,operation_id:op.id,seq:frame.seq})})}
   else if(frame.type==="desktop.terminal.closed"){op.status="closed";clearInterval(op.ping);if(op.thread===target)feedback("终端已结束；可明确选择摘录，内容不是验证过的执行结果。")}controls();return true
  }
  const p=pending.get(frame.id);if(!p||frame.type!==p.method+".result")return false;pending.delete(frame.id)
  if(p.document!==currentDocument()||frame.thread_id!==p.thread)return true;
  if(p.method==="desktop.terminal.open"){
   if(frame.ok===true&&frame.operation_id===p.id){const op={id:p.id,thread:p.thread,document:p.document,kind:"terminal",status:frame.status};for(const prior of operations.values())if(prior.status==="closed"){clearInterval(prior.ping);prior.terminal?.dispose();prior.holder?.remove();operations.delete(prior.id)}operations.set(op.id,op);if(!terminal(op)){post({type:"desktop.terminal.close",id:id(),thread_id:op.thread,operation_id:op.id})}if(!current(p))feedback("已启动的操作归原对话；请选择原对话查看或停止，不自动再建。")}
  }
  if(!current(p)){controls();return true}
  if(p.method==="desktop.local.state"){
   state=frame.ok===true&&validState(frame.state)?frame.state:null;revision=state?.revision||null;for(const value of state?.operations||[]){if(value.kind!=="terminal")continue;if(operations.has(value.operation_id)){const existing=operations.get(value.operation_id);if(existing.thread===target&&existing.document===documentId&&(existing.kind!=="terminal"||existing.status!=="closed")){existing.status=value.status;if(value.status==="closed")clearInterval(existing.ping)}operations.delete(value.operation_id);operations.set(value.operation_id,existing);continue}const op={id:value.operation_id,thread:target,document:documentId,kind:value.kind,status:value.status};operations.set(op.id,op);if(op.kind==="terminal"&&op.status==="running"&&!terminal(op))post({type:"desktop.terminal.close",id:id(),thread_id:op.thread,operation_id:op.id})}feedback(!state?.bound?"此对话没有可用的显式工作目录；本页不会猜测目录或创建默认目录。":!state.modules.terminal?"用户终端模块未启用；本页不会更改配置。":"启动用户shell需原生确认；此桌面Agent入口尚未交付。")
  }else if(frame.ok!==true){if(p.operation?.stopPending&&p.method.endsWith(".close"))p.operation.stopPending=false;feedback(frame.status==="unknown"?"保存结果未确认，请核对原对话历史；不会自动重放。":"操作被拒绝或不可用；未收到成功确认。")}else if(frame.status==="saved")feedback("已确认保存到原对话，请重开历史核对。");else if(p.method.endsWith(".close")||p.method.endsWith(".cancel")){if(p.operation)p.operation.status="closed";feedback("已提交停止，仅归属原操作。")}else feedback("操作已接收；实际状态以输出和保存回执为准。")
  controls();return true
 }
 window.addEventListener?.("resize",()=>{for(const op of operations.values())if(op.thread===target&&op.document===currentDocument()&&!$("local-work").hidden)op.fit?.fit()});
 $("local-refresh")?.addEventListener("click",stateRequest);$("local-hide")?.addEventListener("click",hide)
 $("local-terminal-open")?.addEventListener("click",()=>{if(!revision||!state?.modules?.terminal||[...pending.values()].some(p=>current(p)&&p.method==="desktop.terminal.open"))return;request("desktop.terminal.open",{revision,cols:80,rows:24});revision=null;feedback("等待原生确认，尚未启动终端…");controls()})
 $("local-stop")?.addEventListener("click",()=>{for(const op of operations.values())if(op.thread===target&&op.document===currentDocument()&&op.status!=="closed"&&!op.stopPending){op.stopPending=true;feedback("已请求停止，等待原操作回执；未确认前不会重放。");request("desktop.terminal.close",{operation_id:op.id},op)}controls()})
 $("local-select")?.addEventListener("click",()=>{const op=[...operations.values()].reverse().find(o=>o.thread===target&&o.kind==="terminal"&&o.document===currentDocument());if(op?.terminal){op.terminal.selectAll();feedback("已选择当前终端显示内容；请求原生确认后才会保存摘录。")}});
 $("local-return")?.addEventListener("click",()=>{const op=[...operations.values()].reverse().find(o=>o.thread===target&&o.kind==="terminal"&&o.document===currentDocument()),text=op?.terminal?.getSelection();if(!op||!text?.trim()||text.length>48000||[...pending.values()].some(p=>p.method==="desktop.terminal.return"&&p.operation===op))return;request("desktop.terminal.return",{operation_id:op.id,text},op);feedback("等待原生确认所选摘录；尚未确认持久化。")})
 return{open,hide,receive}
};
