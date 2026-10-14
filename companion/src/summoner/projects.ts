/** Same authenticated metadata service as the extension. No local project persistence. */
export const SUMMONER_PROJECT_HTML = String.raw`
<details id="projectOrganization" class="thread-search"><summary>项目</summary>
  <div class="project-controls"><p>可选组织上下文，不改变工作目录或权限。</p>
  <label>项目筛选<select id="projectFilter"><option value="*">全部对话</option><option value="">项目外对话</option></select></label>
  <button id="projectRefresh" type="button">刷新项目</button>
  <form id="projectCreate"><label>新项目名称<input id="projectName" maxlength="160"></label><button type="submit">创建项目</button></form>
  <label>搜索项目<input id="projectSearch"></label>
  <label>管理项目<select id="projectSelected"><option value="">选择项目</option></select></label>
  <form id="projectRename"><label>项目新名称<input id="projectNewName" maxlength="160"></label><button type="submit">改名</button></form>
  <button id="projectArchive" type="button">归档项目</button><button id="projectRestore" type="button">恢复项目</button><button id="projectNewThread" type="button">项目内新对话</button>
  <p id="projectCurrent">当前对话项目：项目外</p>
  <label>当前对话归属<select id="projectMembership" aria-label="选择当前对话项目"><option value="">项目外</option></select></label>
  <p id="projectNotice" role="status"></p><p id="projectError" role="alert"></p></div>
</details>`

export const SUMMONER_PROJECT_JS = String.raw`
  var projectSnapshot=null,projectSaving=false,projectCreation=null,projectLoadEpoch=0;
  function projectOption(select,value,text,disabled){var option=document.createElement("option");option.value=value;option.textContent=text;option.disabled=!!disabled;select.appendChild(option)}
  function renderProjects(){
    var selected=$("projectSelected").value,filter=$("projectFilter").value,current=threads.find(function(t){return t.id===threadId});
    ["projectFilter","projectSelected","projectMembership"].forEach(function(id){$(id).replaceChildren()});
    projectOption($("projectFilter"),"*","全部对话");projectOption($("projectFilter"),"","项目外对话");projectOption($("projectSelected"),"","选择项目");projectOption($("projectMembership"),"","项目外");
    var query=$("projectSearch").value.trim().toLocaleLowerCase();
    (projectSnapshot&&projectSnapshot.projects||[]).forEach(function(p){var text=p.name+(p.archived_at?"（已归档）":"");projectOption($("projectFilter"),p.id,text);if(p.id===selected||p.name.toLocaleLowerCase().includes(query))projectOption($("projectSelected"),p.id,text);projectOption($("projectMembership"),p.id,text,!!p.archived_at)});
    if(filter&&filter!=="*"&&!(projectSnapshot&&projectSnapshot.projects.some(function(p){return p.id===filter})))projectOption($("projectFilter"),filter,"原项目不可用");
    if(current&&current.project_id&&!(projectSnapshot&&projectSnapshot.projects.some(function(p){return p.id===current.project_id})))projectOption($("projectMembership"),current.project_id,"原项目不可用",true);
    $("projectSelected").value=selected;$("projectFilter").value=filter;$("projectMembership").value=current&&current.project_id||"";
    var active=projectSnapshot&&projectSnapshot.projects.find(function(p){return p.id===selected}),own=projectSnapshot&&projectSnapshot.projects.find(function(p){return current&&p.id===current.project_id});
    $("projectCurrent").textContent="当前对话项目："+(current&&current.project_metadata_unavailable?"项目状态不可用":own?own.name+(own.archived_at?"（已归档）":""):current&&current.project_id?"原项目不可用":"项目外");
    $("projectRename").hidden=!active;$("projectArchive").hidden=!active||!!active.archived_at;$("projectRestore").hidden=!active||!active.archived_at;$("projectNewThread").hidden=!active||!!active.archived_at;
    $("projectOrganization").querySelectorAll("input,button,select").forEach(function(control){control.disabled=projectSaving||!projectSnapshot});$("projectRefresh").disabled=projectSaving;
    $("projectFilter").disabled=projectSaving;$("projectMembership").disabled=projectSaving||!projectSnapshot||!current||!!current.project_metadata_unavailable;
  }
  function refreshProjects(preserveError){
    var epoch=++projectLoadEpoch;
    return api("/api/projects").then(function(result){
      if(epoch!==projectLoadEpoch)return;
      if(result.type!=="project.state"||!Number.isSafeInteger(result.revision)||!Array.isArray(result.projects))throw new Error(result.error||"项目记录不可用。");
      projectSnapshot=result;if(!preserveError)$("projectError").textContent="";renderProjects();renderThreads();
    }).catch(function(error){if(epoch!==projectLoadEpoch)return;projectSnapshot=null;$("projectError").textContent=error.message||"项目记录不可用。";renderProjects()});
  }
  function projectMutate(type,fields){
    if(!projectSnapshot||projectSaving)return Promise.resolve();
    var submittedOwner=threadId,submittedSelection=selectionRevision,revision=projectSnapshot.revision,operation=crypto.randomUUID(),created=null;
    if(type==="project.create"){var normalized=fields.name.normalize("NFC").trim();if(projectCreation&&projectCreation.name===normalized)operation=projectCreation.operation;else projectCreation={name:normalized,operation:operation}}
    projectSaving=true;$("projectNotice").textContent="";$("projectError").textContent="";renderProjects();
    var begin=type==="thread.project.new"?api("/api/threads",{method:"POST"}).then(function(result){if(result.type!=="thread.created"||!result.thread||!result.thread.id)throw new Error("创建对话结果请刷新核实。");created=result.thread;threads.push(created);type="thread.project.set";fields={thread_id:created.id,project_id:fields.project_id}}):Promise.resolve();
    return begin.then(function(){
      var routes={"project.create":"/api/projects","project.rename":"/api/project/rename","project.archive":"/api/project/archive","project.restore":"/api/project/restore","thread.project.set":"/api/thread/project"};
      return api(routes[type],{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.assign({},fields,{expected_revision:revision,operation_id:operation,user_gesture:true}))});
    }).then(function(result){
      if(result.type!=="project.changed"||result.operation_id!==operation||!Number.isSafeInteger(result.revision))throw new Error(result.error||"未收到项目保存确认，请刷新核实。");
      if(type==="thread.project.set"&&(!result.thread||result.thread.id!==fields.thread_id||result.project_id!==fields.project_id||result.thread.project_id!==fields.project_id))throw new Error("项目归属回执不匹配，请刷新核实。");
      if(type!=="thread.project.set"&&(!result.project||type!=="project.create"&&result.project.id!==fields.project_id))throw new Error("项目回执不匹配，请刷新核实。");
      if(result.thread)threads=threads.map(function(t){return t.id===result.thread.id?result.thread:t});
      if(threadId!==submittedOwner||selectionRevision!==submittedSelection){$("projectNotice").textContent="已切换对话；项目保存结果请刷新核实。";return}
      if(type==="project.create"){projectCreation=null;$("projectName").value="";projectOption($("projectSelected"),result.project.id,result.project.name);$("projectSelected").value=result.project.id}
      $("projectNotice").textContent="项目记录已保存。";
      if(created)return selectThread(created.id);
    }).catch(function(error){if(threadId!==submittedOwner||selectionRevision!==submittedSelection){$("projectNotice").textContent="已切换对话；项目保存结果请刷新核实。";return}$("projectError").textContent=created?"新对话已创建在项目外；归入尚未确认，请刷新后显式整理。":error.message||"保存结果请刷新核实。";if(created)return selectThread(created.id)}).finally(function(){projectSaving=false;renderProjects();return refresh().then(function(){return refreshProjects(true)})});
  }
  $("projectOrganization").addEventListener("toggle",function(){if(this.open){$("projectName").focus();refreshProjects()}});
  $("projectOrganization").addEventListener("keydown",function(event){if(event.key==="Escape"){event.preventDefault();event.stopPropagation();this.open=false;this.querySelector("summary").focus()}});
  $("projectRefresh").onclick=refreshProjects;
  $("projectFilter").onchange=function(){renderThreads()};
  $("projectSearch").oninput=renderProjects;
  $("projectSelected").onchange=function(){var p=projectSnapshot&&projectSnapshot.projects.find(function(p){return p.id===$("projectSelected").value});$("projectNewName").value=p?p.name:"";renderProjects()};
  $("projectCreate").onsubmit=function(e){e.preventDefault();projectMutate("project.create",{name:$("projectName").value})};
  $("projectRename").onsubmit=function(e){e.preventDefault();projectMutate("project.rename",{name:$("projectNewName").value,project_id:$("projectSelected").value})};
  $("projectArchive").onclick=function(){projectMutate("project.archive",{project_id:$("projectSelected").value})};
  $("projectRestore").onclick=function(){projectMutate("project.restore",{project_id:$("projectSelected").value})};
  $("projectNewThread").onclick=function(){projectMutate("thread.project.new",{project_id:$("projectSelected").value})};
  $("projectMembership").onchange=function(){var target=$("projectMembership").value;projectMutate("thread.project.set",{thread_id:threadId,project_id:target||null})};
  renderProjects();
`
