(() => {
  "use strict";
  let generation=null, page="thread.list", compact=true, selectedThread=null;
  let editAction="add", editRequest=null, saveRequest=null, sequence=0, draftOpen=false;
  const titles={"thread.list":"对话","mcp.list":"MCP","skill.list":"技能","knowledge.list":"知识"};
  const $=id=>document.getElementById(id);
  function post(frame){if(!generation)return;const value={...frame,generation};if(window.webkit?.messageHandlers?.desktop)window.webkit.messageHandlers.desktop.postMessage(value);else if(window.chrome?.webview)window.chrome.webview.postMessage(value)}
  function request(type,thread_id){post({type,id:type,...(thread_id?{thread_id}:{})})}
  function busy(value){if($("mcp-save"))$("mcp-save").disabled=value;if($("mcp-cancel"))$("mcp-cancel").disabled=value;for(const key of ["name","command","args","cwd","enabled"])if($("mcp-"+key))$("mcp-"+key).disabled=value||(key==="name"&&editAction==="update")}
  function feedback(text){if($("mcp-feedback"))$("mcp-feedback").textContent=text}
  function editor(action,config={},name=""){editRequest=null;editAction=action;draftOpen=true;if(!$("mcp-editor"))return;$("mcp-editor").hidden=false;$("mcp-name").value=name;$("mcp-command").value=config.command||"";$("mcp-args").value=JSON.stringify(config.args||[]);$("mcp-cwd").value=config.cwd||"";$("mcp-enabled").checked=config.enabled===true;busy(false);feedback("每次保存均需原生确认。启用的配置可能启动或重启 MCP 进程。")}
  function load(){editRequest=null;if($("mcp-new"))$("mcp-new").hidden=page!=="mcp.list";if($("mcp-editor"))$("mcp-editor").hidden=page!=="mcp.list"||!draftOpen; selectedThread=null; $("title").textContent=titles[page];$("notice").textContent="加载中…";$("list").replaceChildren();$("preview").replaceChildren();document.querySelectorAll("nav button").forEach(b=>b.setAttribute("aria-current",b.dataset.page===page?"page":"false"));request(page)}
  window.cmsparkDesktopReceive=frame=>{
    if(!frame||typeof frame!=="object")return;
    if(frame.type==="desktop.document"){editRequest=null;saveRequest=null;busy(false);feedback(draftOpen?"连接已恢复，请核对草稿后重新确认保存。":"");generation=frame.generation;$("status").textContent="已连接 · MCP 保存需确认";load();for(const type of ["mcp.list","skill.list","knowledge.list"])request(type);return}
    if(frame.type==="desktop.offline"){generation=null;selectedThread=null;editRequest=null;saveRequest=null;busy(false);feedback("连接断开，尚未确认保存。草稿保留，请重新检查后提交。");$("preview").replaceChildren();$("status").textContent="连接已断开";$("notice").textContent="等待原生宿主重新连接。";return}
    // Confirmation payloads belong exclusively to the native controller; the renderer never decides.
    if(frame.type==="desktop.confirmation.request"||frame.type==="desktop.confirmation.resolved")return;
    if(frame.type==="desktop.mcp.edit.result"){if(!editRequest||frame.id!==editRequest)return;editRequest=null;if(frame.config)editor("update",frame.config,frame.name);else feedback("无法编辑该条目；目前仅支持 stdio。");return}
    if(frame.type==="desktop.mcp.save.result"){if(!saveRequest||frame.id!==saveRequest)return;saveRequest=null;busy(false);if(frame.ok===true&&frame.saved===true){feedback("已保存配置。连接状态以列表实际结果为准。");request("mcp.list")}else feedback("未收到保存成功确认。请刷新核对当前配置，再检查草稿后重试。");return}
    if(frame.type==="desktop.error"){
      if(typeof frame.id==="string"&&Object.prototype.hasOwnProperty.call(titles,frame.id)&&frame.id!==page)return;
      if(frame.id==="thread.peek"&&(page!=="thread.list"||!selectedThread))return;
      $("notice").textContent="暂时无法读取，请重试。";return
    }
    if(frame.type==="thread.peek_result"){if(page==="thread.list"&&selectedThread&&frame.thread_id===selectedThread)$("preview").textContent=frame.markdown||"暂无预览。";return}
    if(frame.type!==page)return;
    const rows=frame.threads||frame.servers||frame.skills||frame.docs||[];$("list").replaceChildren();$("notice").textContent=rows.length?(frame.truncated?"仅显示前 64 项。":""):"暂无内容。";
    for(const row of rows){const li=document.createElement("li"), label=document.createElement(page==="thread.list"?"button":"strong");label.textContent=row.title||row.name||row.id||"未命名";if(page==="thread.list"){label.type="button";label.addEventListener("click",()=>{if(page!=="thread.list")return;selectedThread=row.id;$("preview").replaceChildren();request("thread.peek",row.id)})}li.append(label);if(page==="mcp.list"){const edit=document.createElement("button");edit.type="button";edit.textContent="编辑 stdio";edit.addEventListener("click",()=>{if(!generation||saveRequest)return;editRequest="desktop-mcp-edit-"+(++sequence);post({type:"desktop.mcp.edit",id:editRequest,name:row.name||row.id,thread_id:null})});li.append(edit)}if(row.description||row.status){const p=document.createElement("p");p.textContent=row.description||row.status;li.append(p)}$("list").append(li)}
  };
  if(window.chrome?.webview)window.chrome.webview.addEventListener("message",e=>window.cmsparkDesktopReceive(e.data));
  document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>{page=b.dataset.page;load()}));
  $("mcp-new")?.addEventListener("click",()=>{if(generation&&!saveRequest)editor("add")});
  $("mcp-cancel")?.addEventListener("click",()=>{if(!saveRequest){editRequest=null;draftOpen=false;$("mcp-editor").hidden=true}});
  $("mcp-save")?.addEventListener("click",()=>{
    if(!generation||saveRequest)return;let args;try{args=JSON.parse($("mcp-args").value)}catch{feedback("参数必须是 JSON 字符串数组。");return}
    const name=$("mcp-name").value,command=$("mcp-command").value;
    if(!/^[a-zA-Z0-9_-]+$/.test(name)||!command.trim()||!Array.isArray(args)||args.some(v=>typeof v!=="string")){feedback("请检查名称、命令和 JSON 字符串数组参数。");return}
    editRequest=null;saveRequest="desktop-mcp-save-"+(++sequence);busy(true);feedback("等待原生系统确认，尚未保存…");
    post({type:"desktop.mcp.save",id:saveRequest,name,action:editAction,thread_id:null,payload_json:JSON.stringify({command,args,cwd:$("mcp-cwd").value,enabled:$("mcp-enabled").checked})});
  });
  $("view").addEventListener("click",()=>{compact=!compact;post({type:"desktop.view",view:compact?"compact":"workspace"})});
})();
