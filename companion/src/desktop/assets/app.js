(() => {
  "use strict";
  let generation=null, page="thread.list", compact=true, selectedThread=null;
  let editAction="add", editRequest=null, saveRequest=null, sequence=0, draftOpen=false;
  let metadataEpoch=0, metadataTarget=null, metadataDocument=null, metadataEdit=null, metadataSave=null, metadataInitial=null, metadataOpen=false, metadataTrigger=null;
  const titles={"thread.list":"对话","mcp.list":"MCP","skill.list":"技能","knowledge.list":"知识"};
  const $=id=>document.getElementById(id);
  function post(frame){if(!generation)return;const value={...frame,generation};if(window.webkit?.messageHandlers?.desktop)window.webkit.messageHandlers.desktop.postMessage(value);else if(window.chrome?.webview)window.chrome.webview.postMessage(value)}
  function request(type,thread_id){post({type,id:type,...(thread_id?{thread_id}:{})})}
  function busy(value){if($("mcp-save"))$("mcp-save").disabled=value;if($("mcp-cancel"))$("mcp-cancel").disabled=value;for(const key of ["name","command","args","cwd","enabled"])if($("mcp-"+key))$("mcp-"+key).disabled=value||(key==="name"&&editAction==="update")}
  function feedback(text){if($("mcp-feedback"))$("mcp-feedback").textContent=text}
  function editor(action,config={},name=""){editRequest=null;editAction=action;draftOpen=true;if(!$("mcp-editor"))return;$("mcp-editor").hidden=false;$("mcp-name").value=name;$("mcp-command").value=config.command||"";$("mcp-args").value=JSON.stringify(config.args||[]);$("mcp-cwd").value=config.cwd||"";$("mcp-enabled").checked=config.enabled===true;busy(false);feedback("每次保存均需原生确认。启用的配置可能启动或重启 MCP 进程。")}
  function metadataFeedback(text){if($("metadata-feedback"))$("metadata-feedback").textContent=text}
  function metadataBusy(value){for(const field of ["alias","tags","folder"])if($("metadata-"+field))$("metadata-"+field).disabled=value;if($("metadata-save"))$("metadata-save").disabled=value||!generation||metadataDocument!==generation}
  function retireMetadata(retain=false){metadataEpoch++;metadataEdit=metadataSave=null;if(retain)metadataDocument=null;metadataBusy(false);if(!retain){metadataOpen=false;metadataTarget=null;metadataInitial=null;if($("metadata-editor"))$("metadata-editor").hidden=true}}
  function closeMetadata(){const target=metadataTarget;retireMetadata();const current=[...document.querySelectorAll("[data-thread-metadata]")].find(b=>b.getAttribute("data-thread-metadata")===target);(current||metadataTrigger)?.focus()}
  function metadataValues(){return{alias:$("metadata-alias").value,user_tags:$("metadata-tags").value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean),topic_folder:$("metadata-folder").value.trim()||null}}
  function fillMetadata(value){$("metadata-alias").value=value.alias;$("metadata-tags").value=value.user_tags.join("\n");$("metadata-folder").value=value.topic_folder||""}
  function validMetadata(value){return value&&typeof value==="object"&&Object.keys(value).sort().join(",")==="alias,topic_folder,user_tags"&&typeof value.alias==="string"&&Array.isArray(value.user_tags)&&value.user_tags.length<=20&&value.user_tags.every(v=>typeof v==="string")&&(value.topic_folder===null||typeof value.topic_folder==="string")}
  function openMetadata(target,trigger){
    if(!generation||!$("metadata-editor"))return;
    const retained=metadataOpen&&metadataTarget===target&&metadataDocument!==generation?metadataValues():null;
    retireMetadata();metadataOpen=true;metadataTarget=target;metadataDocument=generation;metadataTrigger=trigger;
    metadataEdit={id:"desktop-metadata-edit-"+(++sequence),target,document:generation,epoch:metadataEpoch,retained};
    $("metadata-title").textContent="对话信息 · "+target;$("metadata-editor").hidden=false;fillMetadata(retained||{alias:"",user_tags:[],topic_folder:null});metadataBusy(true);metadataFeedback("正在读取对话信息…");post({type:"desktop.thread.metadata.edit",id:metadataEdit.id,thread_id:target});
  }
  function currentMetadata(p,frame){return p&&page==="thread.list"&&p.id===frame.id&&p.target===frame.thread_id&&p.target===metadataTarget&&p.document===generation&&p.document===metadataDocument&&p.epoch===metadataEpoch&&metadataOpen}
  function load(retainMetadata=false){if(!retainMetadata)retireMetadata();if($("metadata-editor"))$("metadata-editor").hidden=page!=="thread.list"||!metadataOpen;editRequest=null;if($("mcp-new"))$("mcp-new").hidden=page!=="mcp.list";if($("mcp-editor"))$("mcp-editor").hidden=page!=="mcp.list"||!draftOpen; selectedThread=null; $("title").textContent=titles[page];$("notice").textContent="加载中…";$("list").replaceChildren();$("preview").replaceChildren();document.querySelectorAll("nav button").forEach(b=>b.setAttribute("aria-current",b.dataset.page===page?"page":"false"));request(page)}
  window.cmsparkDesktopReceive=frame=>{
    if(!frame||typeof frame!=="object")return;
    if(frame.type==="desktop.document"){generation=frame.generation;retireMetadata(true);metadataFeedback(metadataOpen?"连接已恢复，草稿保留；请重新打开原对话信息核对后保存。":"");editRequest=null;saveRequest=null;busy(false);feedback(draftOpen?"连接已恢复，请核对草稿后重新确认保存。":"");$("status").textContent="已连接 · MCP 保存需确认";load(true);for(const type of ["mcp.list","skill.list","knowledge.list"])request(type);return}
    if(frame.type==="desktop.offline"){generation=null;retireMetadata(true);metadataFeedback("连接断开，保存结果未确认。草稿保留，请重连后核对原对话。");selectedThread=null;editRequest=null;saveRequest=null;busy(false);feedback("连接断开，尚未确认保存。草稿保留，请重新检查后提交。");$("preview").replaceChildren();$("status").textContent="连接已断开";$("notice").textContent="等待原生宿主重新连接。";return}
    if(frame.type==="desktop.thread.metadata.edit.result"){
      if(!currentMetadata(metadataEdit,frame))return;const retained=metadataEdit.retained;metadataEdit=null;metadataBusy(false);
      if(frame.ok!==true||!validMetadata(frame.metadata)){metadataInitial=null;metadataBusy(true);metadataFeedback(frame.error_code==="DESKTOP_METADATA_REDACTED"?"这条对话信息含隐藏内容，无法在此编辑。":"无法读取这条对话信息，请重新打开。");return}
      metadataInitial=frame.metadata;fillMetadata(retained||frame.metadata);metadataFeedback(retained?"已重新读取原对话，请核对保留的草稿再保存。":"只修改名称、人工标签和手动分组。");$("metadata-alias").focus();return;
    }
    if(frame.type==="desktop.thread.metadata.save.result"){
      if(!currentMetadata(metadataSave,frame))return;metadataSave=null;metadataBusy(false);
      if(frame.ok===true&&frame.saved===true&&validMetadata(frame.metadata)){metadataInitial=frame.metadata;fillMetadata(frame.metadata);metadataFeedback("已保存对话信息。");request("thread.list")}
      else metadataFeedback(frame.error_code==="DESKTOP_METADATA_REDACTED"?"信息含隐藏内容，未保存。请检查草稿。":"保存结果未确认，草稿保留。请刷新核对后重新提交。");return;
    }
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
    for(const row of rows){const li=document.createElement("li"), label=document.createElement(page==="thread.list"?"button":"strong");label.textContent=row.title||row.name||row.id||"未命名";if(page==="thread.list"){label.type="button";label.addEventListener("click",()=>{if(page!=="thread.list")return;retireMetadata();selectedThread=row.id;$("preview").replaceChildren();request("thread.peek",row.id)})}li.append(label);if(page==="thread.list"){const edit=document.createElement("button");edit.type="button";edit.textContent="对话信息";edit.setAttribute("data-thread-metadata",row.id);edit.addEventListener("click",()=>openMetadata(row.id,edit));li.append(edit);if(row.topic_folder||(row.user_tags||[]).length){const tags=document.createElement("p");tags.textContent=[row.topic_folder?"分组 · "+row.topic_folder:"",(row.user_tags||[]).map(v=>"#"+v).join(" ")].filter(Boolean).join(" · ");li.append(tags)}}if(page==="mcp.list"){const edit=document.createElement("button");edit.type="button";edit.textContent="编辑 stdio";edit.addEventListener("click",()=>{if(!generation||saveRequest)return;editRequest="desktop-mcp-edit-"+(++sequence);post({type:"desktop.mcp.edit",id:editRequest,name:row.name||row.id,thread_id:null})});li.append(edit)}if(row.description||row.status){const p=document.createElement("p");p.textContent=row.description||row.status;li.append(p)}$("list").append(li)}
  };
  if(window.chrome?.webview)window.chrome.webview.addEventListener("message",e=>window.cmsparkDesktopReceive(e.data));
  document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>{page=b.dataset.page;load()}));
  $("metadata-cancel")?.addEventListener("click",()=>{closeMetadata()});
  $("metadata-editor")?.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();closeMetadata()}});
  $("metadata-save")?.addEventListener("click",()=>{
    if(!generation||metadataDocument!==generation||!metadataOpen||!metadataTarget||metadataEdit||metadataSave||!metadataInitial)return;
    const values=metadataValues(),patch={};for(const key of ["alias","user_tags","topic_folder"])if(JSON.stringify(values[key])!==JSON.stringify(metadataInitial[key]))patch[key]=values[key];
    if(!Object.keys(patch).length){metadataFeedback("没有需要保存的更改。");return}if(("alias"in patch&&!values.alias.trim())||values.user_tags.length>20){metadataFeedback("名称不能为空；人工标签最多 20 个。");return}
    metadataSave={id:"desktop-metadata-save-"+(++sequence),target:metadataTarget,document:generation,epoch:metadataEpoch};metadataBusy(true);metadataFeedback("正在保存，尚未确认…");post({type:"desktop.thread.metadata.save",id:metadataSave.id,thread_id:metadataSave.target,payload_json:JSON.stringify(patch)});
  });
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
