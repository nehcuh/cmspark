(() => {
  "use strict";
  let generation=null, page="thread.list", compact=true, selectedThread=null;
  let editAction="add", editRequest=null, saveRequest=null, sequence=0, draftOpen=false;
  let metadataEpoch=0, metadataTarget=null, metadataDocument=null, metadataEdit=null, metadataSave=null, metadataInitial=null, metadataOpen=false, metadataTrigger=null;
  let dialogEpoch=0,dialogTarget=null,dialogOpen=null,dialogCreate=null,dialogRun=null,dialogSubscription=null,dialogLive=null;
  const dialogDrafts=new Map();
  let resourceEpoch=0,resourceTarget=null,resourceDocument=null,resourceRead=null,resourceWrite=null,resourceDoc=null,resourceImport=false;
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
  function resourceKind(){return page==="skill.list"?"skill":page==="knowledge.list"?"knowledge":null}
  function resourceFeedback(text){if($("resource-feedback"))$("resource-feedback").textContent=text}
  function resourceBusy(){const waiting=!!resourceWrite||!!resourceRead,editable=!!generation&&resourceDocument===generation&&(resourceImport||resourceDoc?.writable&&resourceDoc.kind==="knowledge");for(const key of ["name","description","tags","text"])if($("resource-"+key))$("resource-"+key).disabled=waiting||!editable||(resourceImport&&key!=="text");if($("resource-save"))$("resource-save").disabled=waiting||!editable;if($("resource-remove"))$("resource-remove").disabled=waiting||!generation||resourceDocument!==generation||resourceImport||resourceDoc?.writable!==true}
  function retireResource(offline=false){resourceEpoch++;resourceRead=null;resourceDoc=null;resourceTarget=null;resourceDocument=null;if(!offline&&$("resource-editor"))$("resource-editor").hidden=true;resourceBusy()}
  function openResource(kind,target){if(!generation||!$("resource-editor"))return;retireResource();resourceImport=false;resourceTarget=target;resourceDocument=generation;resourceRead={id:"resource-read-"+(++sequence),kind,target,document:generation,epoch:resourceEpoch};$("resource-editor").hidden=false;resourceFeedback("正在核对当前正文…");resourceBusy();post({type:"desktop.resource.read",id:resourceRead.id,kind,resource_id:target})}
  function validResourceDoc(v){const keys=["kind","resource_id","title","description","tags","text","complete","truncated","redacted","builtin","writable","read_only_reason","revision"];return v&&typeof v==="object"&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))&&["skill","knowledge"].includes(v.kind)&&["resource_id","title","description","text"].every(k=>typeof v[k]==="string")&&Array.isArray(v.tags)&&v.tags.every(t=>typeof t==="string")&&["complete","truncated","redacted","builtin","writable"].every(k=>typeof v[k]==="boolean")&&(v.revision===null||typeof v.revision==="string"&&/^[a-f0-9]{64}$/.test(v.revision))&&(v.read_only_reason===null||["builtin","folder","truncated","redacted"].includes(v.read_only_reason))&&(!v.writable||(v.complete&&!v.truncated&&!v.redacted&&!v.builtin&&v.read_only_reason===null&&v.revision!==null))}
  function receiveResource(frame){
    if(frame.type==="desktop.resource.read.result"){const p=resourceRead;if(!p||p.id!==frame.id||p.document!==generation||p.epoch!==resourceEpoch||p.target!==resourceTarget||p.kind!==resourceKind())return true;resourceRead=null;if(frame.ok!==true||!validResourceDoc(frame.doc)||frame.doc.kind!==p.kind||frame.doc.resource_id!==p.target){resourceDoc=null;resourceFeedback("无法核对完整当前资源；禁止保存／移除。");resourceBusy();return true}resourceDoc=frame.doc;$("resource-title").textContent=resourceDoc.title;$("resource-name").value=resourceDoc.title;$("resource-description").value=resourceDoc.description;$("resource-tags").value=resourceDoc.tags.join("\n");$("resource-text").value=resourceDoc.text;resourceFeedback(resourceDoc.writable?"已核对完整正文；每次全局变更均需原生确认。":"只读 · "+resourceDoc.read_only_reason);resourceBusy();return true}
    if(!["desktop.resource.import.result","desktop.resource.update.result","desktop.resource.remove.result"].includes(frame.type))return false;
    const p=resourceWrite;if(!p||frame.id!==p.id||frame.type!=="desktop.resource."+p.op+".result"||p.document!==generation||frame.kind!==p.kind||(frame.ok===true&&p.op!=="import"&&frame.resource_id!==p.target))return true;resourceWrite=null;const current=p.epoch===resourceEpoch&&p.target===resourceTarget&&p.kind===resourceKind()&&resourceDocument===generation;resourceBusy();if(!current)return true;
    if(frame.ok===true&&frame.outcome==="committed"&&typeof frame.resource_id==="string"){resourceFeedback("已持久化，请重新打开核对。");request(page);if(p.op!=="remove")openResource(p.kind,frame.resource_id);else retireResource()}
    else {resourceDoc=null;resourceFeedback(frame.outcome==="conflict"?"资源已变化，请重新打开核对；草稿未自动提交。":"结果未确认或被拒绝；请先刷新核对，不会自动重放。");resourceBusy()}return true;
  }
  function load(retainMetadata=false){if(!retainMetadata)retireResource();if($("resource-import"))$("resource-import").hidden=!resourceKind();if(!retainMetadata){retireMetadata();retireDialog()}if($("dialog-new"))$("dialog-new").hidden=page!=="thread.list";if($("metadata-editor"))$("metadata-editor").hidden=page!=="thread.list"||!metadataOpen;editRequest=null;if($("mcp-new"))$("mcp-new").hidden=page!=="mcp.list";if($("mcp-editor"))$("mcp-editor").hidden=page!=="mcp.list"||!draftOpen; selectedThread=null; $("title").textContent=titles[page];$("notice").textContent="加载中…";$("list").replaceChildren();$("preview").replaceChildren();document.querySelectorAll("nav button").forEach(b=>b.setAttribute("aria-current",b.dataset.page===page?"page":"false"));request(page)}
  function dialogFeedback(text){if($("dialog-feedback"))$("dialog-feedback").textContent=text}
  function dialogBusy(){if($("dialog-send"))$("dialog-send").disabled=!generation||!dialogTarget||!!dialogOpen||!!dialogRun;if($("dialog-stop")){ $("dialog-stop").hidden=!dialogRun;$("dialog-stop").disabled=!generation||!!dialogRun?.stopPending;$("dialog-stop").textContent=dialogRun?"停止对话 · "+dialogRun.target:"停止当前对话" }if($("dialog-new"))$("dialog-new").disabled=!generation||!!dialogCreate}
  function retireDialog(){if(dialogTarget&&$("dialog-input"))dialogDrafts.set(dialogTarget,$("dialog-input").value);dialogEpoch++;dialogOpen=null;dialogTarget=null;dialogSubscription=null;dialogLive=null;if($("dialog-editor"))$("dialog-editor").hidden=true;dialogBusy()}
  function openDialog(target){if(!generation||!$("dialog-editor"))return;retireDialog();dialogTarget=target;dialogOpen={id:"desktop-dialog-open-"+(++sequence),target,document:generation,epoch:dialogEpoch};$("dialog-editor").hidden=false;$("dialog-input").value=dialogDrafts.get(target)||"";$("dialog-history").replaceChildren();dialogFeedback("正在读取真实对话历史…");dialogBusy();post({type:"desktop.thread.open",id:dialogOpen.id,thread_id:target})}
  function dialogRow(content,role){const row=document.createElement("article");row.textContent=(role==="user"?"你\n":"CMspark\n")+content;$("dialog-history").append(row);return row}
  function receiveDialog(frame){
    if(frame.type==="desktop.thread.create.result"){
      if(!dialogCreate||frame.id!==dialogCreate.id||dialogCreate.document!==generation)return true;const intent=dialogCreate,current=intent.page===page&&page==="thread.list"&&intent.epoch===dialogEpoch&&intent.target===dialogTarget;dialogCreate=null;dialogBusy();if(frame.ok===true&&frame.created===true&&typeof frame.thread_id==="string"){if(page==="thread.list")request("thread.list");if(current)openDialog(frame.thread_id);else dialogFeedback("新对话已创建；当前选择保持不变，请从列表打开。")}else dialogFeedback("新建结果未确认，请刷新列表核对；不会自动再建。");return true
    }
    if(frame.type==="desktop.thread.open.result"){
      const p=dialogOpen;if(!p||frame.id!==p.id||frame.thread_id!==p.target||p.document!==generation||p.epoch!==dialogEpoch||dialogTarget!==p.target)return true;dialogOpen=null;dialogBusy();
      if(frame.ok!==true||!frame.history||!Array.isArray(frame.history.messages)){dialogFeedback("无法读取完整历史，请刷新核对。草稿保留。");return true}
      $("dialog-history").replaceChildren();for(const row of frame.history.messages)if((row.role==="user"||row.role==="assistant")&&typeof row.content==="string")dialogRow(row.content,row.role);
      if(dialogRun&&dialogRun.target===p.target&&frame.owned_run_id===dialogRun.id)dialogSubscription={id:dialogRun.id,target:p.target,document:generation,epoch:dialogEpoch};
      dialogFeedback(frame.history.hidden_messages?"已读取历史；工具/系统详情不在此显示。":"已读取持久历史。");return true
    }
    if(frame.type==="desktop.chat.stop.result"){
      if(dialogRun&&frame.run_id===dialogRun.id&&frame.thread_id===dialogRun.target)dialogFeedback(frame.stopped===true?"停止请求已接收，等待实际运行结束。":"运行已变化，请刷新核对。");return true
    }
    if(frame.type==="desktop.chat.send.result"){
      if(!dialogRun||frame.id!==dialogRun.id||frame.thread_id!==dialogRun.target)return true;
      if(frame.ok!==true){dialogRun=null;dialogSubscription=null;dialogBusy();dialogFeedback("发送未确认或被策略拒绝，草稿保留。请先核对历史。")}return true
    }
    if(frame.type!=="desktop.chat.event")return false;
    if(!dialogRun||frame.id!==dialogRun.id||frame.run_id!==dialogRun.id||frame.thread_id!==dialogRun.target||dialogRun.document!==generation)return true;
    const subscribed=dialogSubscription&&dialogSubscription.id===frame.run_id&&dialogSubscription.target===dialogTarget&&dialogSubscription.document===generation&&dialogSubscription.epoch===dialogEpoch;
    if(frame.kind==="terminal"){const target=dialogRun.target;dialogRun=null;dialogSubscription=null;dialogBusy();if(dialogTarget===target){openDialog(target);dialogFeedback(frame.state==="done"?"运行已结束，正在核对持久历史。":"运行已停止或结果未确认，正在核对历史。草稿不会自动重发。")}return true}
    if(!subscribed)return true;
    if(frame.kind==="user"&&frame.persisted===true){dialogRow(frame.content||"","user");if($("dialog-input").value===dialogRun.message){$("dialog-input").value="";dialogDrafts.set(dialogTarget,"")}dialogFeedback("用户消息已持久化；正在生成…")}
    if(frame.kind==="snapshot"){if(!dialogLive)dialogLive=dialogRow("","assistant");dialogLive.textContent="CMspark\n"+(frame.content||"")}
    if(frame.kind==="assistant"){if(dialogLive){dialogLive.textContent="CMspark\n"+(frame.content||"");dialogLive=null}else dialogRow(frame.content||"","assistant")}
    if(frame.kind==="error"||frame.kind==="aborted")dialogFeedback("运行被停止或失败，最终结果请以重开历史核对。");
    if(frame.kind==="confirmation_unavailable")dialogFeedback("该操作需要确认；当前工作台尚不支持此工具确认，已拒绝执行。");
    return true;
  }
  window.cmsparkDesktopReceive=frame=>{
    if(!frame||typeof frame!=="object")return;
    if(frame.type==="desktop.document"){generation=frame.generation;resourceWrite=null;retireResource(true);resourceFeedback("连接已恢复；草稿保留，须重新打开并核对当前资源。");retireDialog();dialogRun=null;dialogCreate=null;dialogBusy();retireMetadata(true);metadataFeedback(metadataOpen?"连接已恢复，草稿保留；请重新打开原对话信息核对后保存。":"");editRequest=null;saveRequest=null;busy(false);feedback(draftOpen?"连接已恢复，请核对草稿后重新确认保存。":"");$("status").textContent="已连接 · MCP 保存需确认";load(true);for(const type of ["mcp.list","skill.list","knowledge.list"])request(type);return}
    if(frame.type==="desktop.offline"){generation=null;resourceWrite=null;retireResource(true);resourceFeedback("连接断开，保存结果未知；草稿保留且不会自动重放。");retireDialog();dialogRun=null;dialogCreate=null;dialogBusy();dialogFeedback("连接断开，结果未确认；请重连后核对历史，草稿保留。");retireMetadata(true);metadataFeedback("连接断开，保存结果未确认。草稿保留，请重连后核对原对话。");selectedThread=null;editRequest=null;saveRequest=null;busy(false);feedback("连接断开，尚未确认保存。草稿保留，请重新检查后提交。");$("preview").replaceChildren();$("status").textContent="连接已断开";$("notice").textContent="等待原生宿主重新连接。";return}
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
    if(receiveResource(frame))return;
    if(receiveDialog(frame))return;
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
    for(const row of rows){const li=document.createElement("li"), label=document.createElement(page==="thread.list"?"button":"strong");label.textContent=row.title||row.name||row.id||"未命名";if(page==="thread.list"){label.type="button";label.addEventListener("click",()=>{if(page!=="thread.list")return;retireMetadata();retireDialog();selectedThread=row.id;$("preview").replaceChildren();request("thread.peek",row.id)})}li.append(label);if(resourceKind()){const read=document.createElement("button");read.type="button";read.textContent="查看／管理正文";read.setAttribute("data-resource-id",row.id);read.addEventListener("click",()=>openResource(resourceKind(),row.id));li.append(read)}if(page==="thread.list"){const open=document.createElement("button");open.type="button";open.textContent="打开对话";open.setAttribute("data-thread-dialog",row.id);open.addEventListener("click",()=>{if(page!=="thread.list")return;retireMetadata();selectedThread=row.id;$("preview").replaceChildren();openDialog(row.id)});li.append(open);const edit=document.createElement("button");edit.type="button";edit.textContent="对话信息";edit.setAttribute("data-thread-metadata",row.id);edit.addEventListener("click",()=>openMetadata(row.id,edit));li.append(edit);if(row.topic_folder||(row.user_tags||[]).length){const tags=document.createElement("p");tags.textContent=[row.topic_folder?"分组 · "+row.topic_folder:"",(row.user_tags||[]).map(v=>"#"+v).join(" ")].filter(Boolean).join(" · ");li.append(tags)}}if(page==="mcp.list"){const edit=document.createElement("button");edit.type="button";edit.textContent="编辑 stdio";edit.addEventListener("click",()=>{if(!generation||saveRequest)return;editRequest="desktop-mcp-edit-"+(++sequence);post({type:"desktop.mcp.edit",id:editRequest,name:row.name||row.id,thread_id:null})});li.append(edit)}if(row.description||row.status){const p=document.createElement("p");p.textContent=row.description||row.status;li.append(p)}$("list").append(li)}
  };
  if(window.chrome?.webview)window.chrome.webview.addEventListener("message",e=>window.cmsparkDesktopReceive(e.data));
  document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>{page=b.dataset.page;load()}));
  $("resource-import")?.addEventListener("click",()=>{if(!generation||!resourceKind()||resourceWrite)return;retireResource();resourceImport=true;resourceDocument=generation;$("resource-editor").hidden=false;$("resource-title").textContent="导入单份 Markdown";for(const key of ["name","description","tags","text"])$("resource-"+key).value="";resourceFeedback("粘贴完整单份 Markdown 文本；不接受文件路径、ZIP 或执行设置。");resourceBusy()});
  function closeResource(){const target=resourceTarget;retireResource();const row=[...document.querySelectorAll("[data-resource-id]")].find(b=>b.getAttribute("data-resource-id")===target);(row||$("resource-import"))?.focus()}
  $("resource-cancel")?.addEventListener("click",closeResource);
  $("resource-editor")?.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();closeResource()}});
  function writeResource(op){if(!generation||resourceDocument!==generation||resourceWrite||resourceRead||!resourceKind())return;const kind=resourceKind();let payload={};if(op==="import"){if(!resourceImport||!$("resource-text").value)return;payload={text:$("resource-text").value}}
    else {if(!resourceDoc?.writable||resourceDoc.kind!==kind||resourceDoc.resource_id!==resourceTarget)return;if(op==="update"){if(kind!=="knowledge")return;const values={title:$("resource-name").value,description:$("resource-description").value,tags:$("resource-tags").value.split(/\r?\n/).filter(Boolean),body:$("resource-text").value};const old={title:resourceDoc.title,description:resourceDoc.description,tags:resourceDoc.tags,body:resourceDoc.text};for(const k of Object.keys(values))if(JSON.stringify(values[k])!==JSON.stringify(old[k]))payload[k]=values[k];if(!Object.keys(payload).length){resourceFeedback("没有需要保存的更改。");return}}}
    resourceWrite={id:"resource-write-"+(++sequence),kind,target:resourceTarget,document:generation,epoch:resourceEpoch,op};resourceBusy();resourceFeedback("等待原生确认，尚未确认持久化…");post({type:"desktop.resource."+op,id:resourceWrite.id,kind,...(op==="import"?{}:{resource_id:resourceTarget,revision:resourceDoc.revision}),...(op==="remove"?{}:{payload_json:JSON.stringify(payload)})});}
  $("resource-save")?.addEventListener("click",()=>writeResource(resourceImport?"import":"update"));
  $("resource-remove")?.addEventListener("click",()=>writeResource("remove"));
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
  $("dialog-new")?.addEventListener("click",()=>{if(!generation||dialogCreate)return;dialogCreate={id:"desktop-dialog-new-"+(++sequence),document:generation,page,epoch:dialogEpoch,target:dialogTarget};dialogBusy();post({type:"desktop.thread.create",id:dialogCreate.id})});
  $("dialog-send")?.addEventListener("click",()=>{if(!generation||!dialogTarget||dialogOpen||dialogRun)return;const message=$("dialog-input").value;if(!message.trim())return;dialogRun={id:"desktop-dialog-send-"+(++sequence),target:dialogTarget,document:generation,message};dialogSubscription={id:dialogRun.id,target:dialogTarget,document:generation,epoch:dialogEpoch};dialogLive=null;dialogBusy();dialogFeedback("发送已提交，尚未确认持久化…");post({type:"desktop.chat.send",id:dialogRun.id,thread_id:dialogRun.target,message})});
  $("dialog-stop")?.addEventListener("click",()=>{const run=dialogRun;if(!generation||!run||run.stopPending)return;run.stopPending=true;dialogBusy();post({type:"desktop.chat.stop",id:"desktop-dialog-stop-"+(++sequence),thread_id:run.target,run_id:run.id})});
  $("view").addEventListener("click",()=>{compact=!compact;post({type:"desktop.view",view:compact?"compact":"workspace"})});
})();
